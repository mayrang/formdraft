import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FormDraftOptions,
  FormDraftResult,
  RetryConfig,
} from './types';
import { debounce } from './internal/debounce';
import { createStatusMachine } from './internal/statusMachine';
import { createSyncQueue } from './internal/syncQueue';
import { createBroadcaster } from './internal/broadcaster';
import { validateOrDiscard } from './internal/schemaValidation';
import { registerDraft, unregisterDraft } from './internal/registry';
import { localStorageAdapter } from './storage/localStorage';

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 5,
  initialBackoffMs: 1000,
  multiplier: 2,
  maxBackoffMs: 30000,
};

const PERSIST_DEBOUNCE_MS = 50;
const BROADCAST_DEBOUNCE_MS = 200;
const STORAGE_RECORD_KEY = '__v';

type StoredRecord<T> = { __v: number; values: T };

function generateTabId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function stripExcluded<T>(values: T, excludeFields: Array<keyof T>): T {
  if (excludeFields.length === 0) return values;
  const out: Partial<T> = {};
  for (const k of Object.keys(values as object) as Array<keyof T>) {
    if (!excludeFields.includes(k)) out[k] = values[k];
  }
  return out as T;
}

export function useFormDraft<T extends Record<string, unknown>>(
  options: FormDraftOptions<T>,
): FormDraftResult<T> {
  const {
    key,
    schema,
    defaultValues,
    storage = localStorageAdapter(),
    sync,
    syncDebounceMs = 1500,
    syncRetry,
    multiTab = 'warn',
    onConflict,
    onSyncError,
    excludeFields = [],
    version = 1,
    migrate,
    disabled = false,
  } = options;

  const [values, setValues] = useState<T>(defaultValues);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pendingChanges, setPendingChanges] = useState(false);
  const [onConflictData, setOnConflictData] = useState<T | null>(null);

  const tabIdRef = useRef<string>(generateTabId());
  const mountedRef = useRef(true);
  const statusMachineRef = useRef(createStatusMachine());
  const [, forceStatus] = useState(0);

  // Keep a ref to the current values so callbacks can read latest without stale closure
  const valuesRef = useRef<T>(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  const retryConfig: RetryConfig = useMemo(
    () => ({ ...DEFAULT_RETRY, ...syncRetry }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(syncRetry)],
  );

  // Subscribe to status machine changes to trigger re-renders
  useEffect(() => {
    const unsub = statusMachineRef.current.subscribe(() => {
      if (mountedRef.current) forceStatus((n) => n + 1);
    });
    return unsub;
  }, []);

  // --- Sync queue ---
  const syncQueueRef = useRef<ReturnType<typeof createSyncQueue<T>> | null>(null);
  useEffect(() => {
    if (disabled || !sync) return;
    syncQueueRef.current = createSyncQueue<T>({
      sync: async (v) => {
        statusMachineRef.current.send('SAVE_START');
        try {
          await sync(v);
          if (mountedRef.current) {
            setLastSavedAt(new Date());
            setError(null);
            setPendingChanges(false);
          }
          statusMachineRef.current.send('SAVE_SUCCESS');
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          if (mountedRef.current) setError(err);
          statusMachineRef.current.send('SAVE_FAIL');
          throw err;
        }
      },
      retry: retryConfig,
      onError: onSyncError,
    });
    return () => {
      syncQueueRef.current?.cancel();
      syncQueueRef.current = null;
    };
    // retryConfig is memoized by stringified syncRetry; onSyncError is stable enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, sync, retryConfig, onSyncError]);

  // --- Broadcaster (multi-tab) ---
  const broadcasterRef = useRef<ReturnType<typeof createBroadcaster<T>> | null>(null);
  useEffect(() => {
    if (disabled || multiTab === false) return;
    const b = createBroadcaster<T>({ key, tabId: tabIdRef.current });
    broadcasterRef.current = b;
    b.onValuesChanged((remote) => {
      if (!mountedRef.current) return;
      if (multiTab === 'last-writer-wins') {
        const resolved = onConflict ? onConflict(valuesRef.current, remote) : 'remote';
        if (resolved === 'remote') setValues(remote);
        else if (resolved !== 'local') setValues(resolved as T);
      } else if (multiTab === 'warn') {
        setOnConflictData(remote);
        statusMachineRef.current.send('CONFLICT');
      } else if (multiTab === 'manual') {
        onConflict?.(valuesRef.current, remote);
      }
    });
    b.onSubmitted(() => {
      if (!mountedRef.current) return;
      setValues(defaultValues);
      void storage.remove(key);
    });
    b.onDiscarded(() => {
      if (!mountedRef.current) return;
      setValues(defaultValues);
    });
    return () => {
      b.close();
      broadcasterRef.current = null;
    };
    // defaultValues and storage are intentionally kept stable by caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, multiTab, key]);

  // --- Online/offline ---
  useEffect(() => {
    if (disabled) return;
    const handleOnline = () => statusMachineRef.current.send('ONLINE');
    const handleOffline = () => statusMachineRef.current.send('OFFLINE');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (!navigator.onLine) statusMachineRef.current.send('OFFLINE');
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [disabled]);

  // --- Restore from storage on mount ---
  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    (async () => {
      const raw = await storage.read(key);
      if (cancelled || !mountedRef.current) return;
      if (raw === null) return;
      const record = raw as StoredRecord<T>;
      if (typeof record !== 'object' || record === null || !(STORAGE_RECORD_KEY in record)) {
        void storage.remove(key);
        return;
      }
      // Excluded fields are NOT in stored data; re-merge from defaults before
      // validation so the schema (which expects all fields) doesn't reject.
      const mergeExcluded = (storedVals: unknown): unknown => {
        if (excludeFields.length === 0) return storedVals;
        if (typeof storedVals !== 'object' || storedVals === null) return storedVals;
        const out = { ...defaultValues } as Record<string, unknown>;
        for (const k of Object.keys(storedVals as object)) {
          out[k] = (storedVals as Record<string, unknown>)[k];
        }
        return out as T;
      };

      if (record.__v !== version) {
        if (migrate) {
          const migrated = migrate(record.values, record.__v);
          if (migrated === null) {
            void storage.remove(key);
            return;
          }
          const validated = validateOrDiscard(mergeExcluded(migrated), schema, key);
          if (validated !== null) setValues(validated);
          return;
        }
        // eslint-disable-next-line no-console
        console.warn(
          `[formdraft] Stored draft for key "${key}" has version ${record.__v}, current is ${version}. Discarding (no migrate fn provided).`,
        );
        void storage.remove(key);
        return;
      }
      const validated = validateOrDiscard(mergeExcluded(record.values), schema, key);
      if (validated !== null) setValues(validated);
    })();
    return () => {
      cancelled = true;
    };
    // Only run on mount — key/storage/schema/version/migrate are expected stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // --- Debounced persist, broadcast, sync refs ---
  // These are created once; we use refs so we don't recreate them on re-render.
  const excludeFieldsRef = useRef(excludeFields);
  excludeFieldsRef.current = excludeFields;

  const persistDebouncedRef = useRef(
    debounce(async (next: T) => {
      if (!mountedRef.current) return;
      const stripped = stripExcluded(next, excludeFieldsRef.current);
      try {
        await storage.write(key, { __v: version, values: stripped } as StoredRecord<T>);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (mountedRef.current) setError(err);
        statusMachineRef.current.send('SAVE_FAIL');
      }
    }, PERSIST_DEBOUNCE_MS),
  );

  const broadcastDebouncedRef = useRef(
    debounce((next: T) => {
      broadcasterRef.current?.broadcastValues(next);
    }, BROADCAST_DEBOUNCE_MS),
  );

  const syncDebouncedRef = useRef(
    debounce((next: T) => {
      syncQueueRef.current?.enqueue(next);
    }, syncDebounceMs),
  );

  // Fire side-effects whenever values change due to user actions
  useEffect(() => {
    if (disabled) return;
    if (pendingChanges) {
      persistDebouncedRef.current(values);
      broadcastDebouncedRef.current(values);
      syncDebouncedRef.current(values);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, values, pendingChanges]);

  // --- Registry registration ---
  useEffect(() => {
    const entry = {
      statusMachine: statusMachineRef.current,
      lastSavedAt,
    };
    registerDraft(key, entry);
    return () => unregisterDraft(key);
  }, [key, lastSavedAt]);

  // Track mount status. Re-set to true on each mount so React.StrictMode's
  // mount→unmount→mount cycle doesn't leave mountedRef stuck at false.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // --- Public API ---
  const set = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      setValues((prev) => ({ ...prev, [field]: value }));
      setPendingChanges(true);
    },
    [],
  );

  const patch = useCallback((partial: Partial<T>) => {
    setValues((prev) => ({ ...prev, ...partial }));
    setPendingChanges(true);
  }, []);

  const save = useCallback(async () => {
    syncDebouncedRef.current.flush();
    await syncQueueRef.current?.flush();
  }, []);

  const discard = useCallback(() => {
    setValues(defaultValues);
    setPendingChanges(false);
    setLastSavedAt(null);
    setError(null);
    setOnConflictData(null);
    syncQueueRef.current?.cancel();
    void storage.remove(key);
    broadcasterRef.current?.broadcastDiscarded();
    statusMachineRef.current.send('RESET');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValues, key, storage]);

  const submit = useCallback(
    <R,>(handler: (v: T) => Promise<R>) =>
      async (e?: { preventDefault?: () => void }) => {
        e?.preventDefault?.();
        try {
          const result = await handler(valuesRef.current);
          void storage.remove(key);
          broadcasterRef.current?.broadcastSubmitted();
          syncQueueRef.current?.cancel();
          setValues(defaultValues);
          setPendingChanges(false);
          setLastSavedAt(null);
          setError(null);
          statusMachineRef.current.send('RESET');
          return result;
        } catch (err) {
          if (mountedRef.current) {
            setError(err instanceof Error ? err : new Error(String(err)));
          }
          return undefined;
        }
      },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, storage, defaultValues],
  );

  const resolveConflict = useCallback(
    (choice: 'local' | 'remote' | T) => {
      if (choice === 'local') {
        // keep current
      } else if (choice === 'remote') {
        if (onConflictData) setValues(onConflictData);
      } else {
        setValues(choice as T);
      }
      setOnConflictData(null);
      statusMachineRef.current.send('RESOLVE');
    },
    [onConflictData],
  );

  return {
    values,
    set,
    patch,
    status: statusMachineRef.current.getStatus(),
    lastSavedAt,
    pendingChanges,
    error,
    save,
    discard,
    submit,
    onConflictData,
    resolveConflict,
  };
}
