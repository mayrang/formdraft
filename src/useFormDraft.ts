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
import { notifySubscribers, registerDraft, unregisterDraft } from './internal/registry';
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

type StoredRecord<T> = {
  __v: number;
  values: T;
  /**
   * Optional hint added in v0.3: names of `excludeFields` whose values were
   * non-default at persist time. Used by restore to surface "needs re-entry"
   * for sensitive fields the consumer chose to strip from storage. Key names
   * only — values are never persisted (that defeats the point of excludeFields).
   *
   * Pre-v0.3 records omit this field; restore treats them as "nothing needed
   * re-entry" — safely backward compatible.
   */
  __excludedHad?: string[];
};

function computeExcludedHad<T>(
  values: T,
  defaultValues: T,
  excludeFields: Array<keyof T>,
): string[] {
  if (excludeFields.length === 0) return [];
  const out: string[] = [];
  for (const k of excludeFields) {
    if (!Object.is(values[k], defaultValues[k])) out.push(k as string);
  }
  return out;
}

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
    connectivityProbe,
    onlineDetector,
  } = options;

  const [values, setValues] = useState<T>(defaultValues);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pendingChanges, setPendingChanges] = useState(false);
  const [onConflictData, setOnConflictData] = useState<T | null>(null);
  // Excluded fields whose pre-persist values were non-default — populated
  // from the stored record's `__excludedHad` on restore, cleared on
  // discard/submit, and used (together with current `values`) to derive
  // `fieldsNeedingReentry` per render.
  const [excludedHadOnRestore, setExcludedHadOnRestore] = useState<string[]>([]);

  const tabIdRef = useRef<string>(generateTabId());
  const mountedRef = useRef(true);
  const statusMachineRef = useRef(createStatusMachine());
  const [, forceStatus] = useState(0);

  // Keep a ref to the current values so callbacks can read latest without
  // stale closure. Updated during render (not in useEffect) so external
  // imperative callers via `getFormDraft` see committed values immediately,
  // matching the other snapshot refs below.
  const valuesRef = useRef<T>(values);
  valuesRef.current = values;

  // Refs holding the latest options so the once-created debounced functions can
  // read current values without re-running `useRef(debounce(...))` each render.
  // Without these, changing `key`, `storage`, or `version` would write to the
  // stale captured values forever.
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const keyRef = useRef(key);
  keyRef.current = key;
  const versionRef = useRef(version);
  versionRef.current = version;
  // Hoisted from below — also used by the restore effect's migrate path,
  // which would otherwise read this ref before its declaration line.
  const excludeFieldsRef = useRef(excludeFields);
  excludeFieldsRef.current = excludeFields;
  // Mirror of defaultValues so the persist debounce (frozen at mount) can
  // compute "is this excluded field at its default?" against the latest
  // user-provided defaults without recreating the debounced function.
  const defaultValuesRef = useRef(defaultValues);
  defaultValuesRef.current = defaultValues;
  // Ref tracking the derived `fieldsNeedingReentry` list (assigned at the
  // bottom of this function after we compute the derivation). Hoisted up
  // here so the registry effect can capture it on first mount — same
  // pattern as the other snapshot refs.
  const fieldsNeedingReentryRef = useRef<ReadonlyArray<keyof T & string>>([]);

  // Tracks whether user has called set()/patch() since mount. Used to skip a
  // late-arriving storage restore so user input isn't clobbered.
  const userTouchedRef = useRef(false);

  // Incremented on discard() / submit() so an in-flight sync that resolves AFTER
  // those calls can detect it was orphaned and skip its setLastSavedAt /
  // SAVE_SUCCESS dispatch. Without this guard, the status pill flips to "Saved"
  // immediately after the user clicked Discard.
  const syncGenerationRef = useRef(0);

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
  // S5 regression: callers commonly pass inline `sync` / `onSyncError` arrow
  // functions without useMemo (the lib's own example did). Including them in
  // deps recreates the queue on every render, which silently destroys pending
  // values and the queue's online listener. Use refs to read the latest
  // callbacks each invocation; deps are only structural transitions.
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const onSyncErrorRef = useRef(onSyncError);
  onSyncErrorRef.current = onSyncError;
  const connectivityProbeRef = useRef(connectivityProbe);
  connectivityProbeRef.current = connectivityProbe;
  const hasSync = sync !== undefined && sync !== null;

  const syncQueueRef = useRef<ReturnType<typeof createSyncQueue<T>> | null>(null);
  useEffect(() => {
    if (disabled || !hasSync) return;
    syncQueueRef.current = createSyncQueue<T>({
      sync: async (v) => {
        // Capture the generation at SAVE_START. If discard() or submit()
        // bumps it before the user's sync resolves, this attempt has been
        // orphaned and must NOT update lastSavedAt / status / pendingChanges.
        const myGen = syncGenerationRef.current;
        statusMachineRef.current.send('SAVE_START');
        try {
          const fn = syncRef.current;
          if (!fn) throw new Error('[formdraft] sync was removed mid-flight');
          await fn(v);
          if (myGen !== syncGenerationRef.current) return; // orphaned by discard/submit
          if (mountedRef.current) {
            setLastSavedAt(new Date());
            setError(null);
            setPendingChanges(false);
          }
          statusMachineRef.current.send('SAVE_SUCCESS');
        } catch (e) {
          if (myGen !== syncGenerationRef.current) return; // orphaned; drop error too
          const err = e instanceof Error ? e : new Error(String(e));
          if (mountedRef.current) setError(err);
          statusMachineRef.current.send('SAVE_FAIL');
          throw err;
        }
      },
      retry: retryConfig,
      onError: (err, attempt) => {
        // User-supplied callback — wrap so a throwing onSyncError doesn't
        // bubble into the queue's attemptSync catch path and cause an
        // unhandled rejection.
        try {
          onSyncErrorRef.current?.(err, attempt);
        } catch (cbErr) {
          // eslint-disable-next-line no-console
          console.warn('[formdraft] onSyncError threw:', cbErr);
        }
      },
      onAbandoned: (err) => {
        if (mountedRef.current) setError(err);
        statusMachineRef.current.send('SAVE_FAIL');
      },
      // Always pass a probe wrapper so adding/removing the user probe later
      // takes effect without recreating the queue. When user probe is absent,
      // the wrapper short-circuits to true (reachable) so the queue behaves
      // identically to having no probe.
      connectivityProbe: async () => {
        const probe = connectivityProbeRef.current;
        if (!probe) return true;
        return probe();
      },
      onlineDetector,
    });
    return () => {
      syncQueueRef.current?.cancel();
      syncQueueRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, hasSync, retryConfig, onlineDetector]);

  // --- Broadcaster (multi-tab) ---
  const broadcasterRef = useRef<ReturnType<typeof createBroadcaster<T>> | null>(null);
  useEffect(() => {
    if (disabled || multiTab === false) return;
    const b = createBroadcaster<T>({ key, tabId: tabIdRef.current });
    broadcasterRef.current = b;
    // Run a user callback safely — a thrown error in onConflict / onSubmitted /
    // etc. must not escape into the BroadcastChannel onmessage handler (which
    // would become an unhandled exception). Warn-and-swallow is the
    // appropriate boundary for user-supplied callbacks.
    const runCallback = <R,>(fn: () => R, label: string): R | undefined => {
      try {
        return fn();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[formdraft] ${label} threw:`, e);
        return undefined;
      }
    };

    b.onValuesChanged((remote) => {
      if (!mountedRef.current) return;
      if (multiTab === 'last-writer-wins') {
        const resolved = onConflict
          ? runCallback(() => onConflict(valuesRef.current, remote), 'onConflict')
          : 'remote';
        if (resolved === undefined) return; // callback threw — keep current
        if (resolved === 'remote') {
          setValues(remote);
          setExcludedHadOnRestore([]);
        } else if (resolved === 'local') {
          // keep current — nothing to do
        } else if (resolved !== null && typeof resolved === 'object') {
          // Caller returned a merged object; trust it as the resolved state.
          setValues(resolved as T);
          setExcludedHadOnRestore([]);
        }
        // Any other return (string typo, undefined, primitive) is ignored —
        // safer than coercing junk into form state.
      } else if (multiTab === 'warn') {
        setOnConflictData(remote);
        statusMachineRef.current.send('CONFLICT');
      } else if (multiTab === 'manual') {
        if (onConflict) runCallback(() => onConflict(valuesRef.current, remote), 'onConflict');
      }
    });
    b.onSubmitted(() => {
      if (!mountedRef.current) return;
      syncGenerationRef.current += 1;
      persistDebouncedRef.current.cancel();
      broadcastDebouncedRef.current.cancel();
      syncDebouncedRef.current?.cancel();
      userTouchedRef.current = false;
      setValues(defaultValues);
      setPendingChanges(false);
      setLastSavedAt(null);
      setError(null);
      setExcludedHadOnRestore([]);
      void storage.remove(key);
      statusMachineRef.current.send('RESET');
    });
    b.onDiscarded(() => {
      if (!mountedRef.current) return;
      syncGenerationRef.current += 1;
      persistDebouncedRef.current.cancel();
      broadcastDebouncedRef.current.cancel();
      syncDebouncedRef.current?.cancel();
      userTouchedRef.current = false;
      setValues(defaultValues);
      setPendingChanges(false);
      setError(null);
      setExcludedHadOnRestore([]);
      statusMachineRef.current.send('RESET');
    });
    return () => {
      b.close();
      broadcasterRef.current = null;
    };
    // defaultValues and storage are intentionally kept stable by caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, multiTab, key]);

  // --- Online/offline → status pill ---
  // When an onlineDetector is provided, subscribe to it as the source of truth
  // (captive-portal aware). Otherwise fall back to raw window events. Without
  // this, a captive-portal user typing offline would see status stuck at 'idle'
  // because the queue defers sync but the pill machine never heard OFFLINE.
  useEffect(() => {
    if (disabled) return;
    const handleOnline = () => statusMachineRef.current.send('ONLINE');
    const handleOffline = () => statusMachineRef.current.send('OFFLINE');

    if (onlineDetector) {
      // Seed initial state, then track transitions from the detector.
      if (!onlineDetector.isOnline()) statusMachineRef.current.send('OFFLINE');
      return onlineDetector.subscribe((isOnline) => {
        if (isOnline) handleOnline();
        else handleOffline();
      });
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (!navigator.onLine) statusMachineRef.current.send('OFFLINE');
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [disabled, onlineDetector]);

  // --- Restore from storage on mount ---
  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    (async () => {
      const raw = await storage.read(key);
      if (cancelled || !mountedRef.current) return;
      if (raw === null) return;
      const record = raw as StoredRecord<T>;
      // Reject corrupt records: must be a plain object with a numeric __v.
      // Arrays, Date, strings, and {__v:"1"} all fall through to remove.
      if (
        typeof record !== 'object' ||
        record === null ||
        Array.isArray(record) ||
        !(STORAGE_RECORD_KEY in record) ||
        typeof (record as { __v: unknown }).__v !== 'number'
      ) {
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
          let migrated: T | null;
          try {
            migrated = migrate(record.values, record.__v);
          } catch (e) {
            // User migrator threw — don't crash restore. Drop the entry so we
            // don't loop on the same throw every mount, and surface the error.
            void storage.remove(key);
            const err = e instanceof Error ? e : new Error(String(e));
            if (mountedRef.current) setError(err);
            // eslint-disable-next-line no-console
            console.warn(
              `[formdraft] migrate(fromVersion=${record.__v}) threw for key "${key}"; draft discarded.`,
              e,
            );
            return;
          }
          if (migrated === null) {
            void storage.remove(key);
            return;
          }
          const validated = validateOrDiscard(mergeExcluded(migrated), schema, key);
          if (validated !== null && !userTouchedRef.current) {
            setValues(validated);
            // Recompute __excludedHad against the migrated values + current
            // defaults. A naive carry-over would persist stale field names
            // forever if the migrate function renamed a key (e.g., password
            // → pw). Recomputing means: the hint reflects which CURRENT
            // excludeFields are non-default in the migrated state.
            const newExcludedHad = computeExcludedHad(
              validated,
              defaultValues,
              excludeFieldsRef.current,
            );
            if (newExcludedHad.length > 0) {
              setExcludedHadOnRestore(newExcludedHad);
            } else if (Array.isArray(record.__excludedHad)) {
              // Fall back to the carried-over hint only when filtered cleanly
              // (string keys that match current excludeFields) — the runtime
              // useMemo intersect will drop anything else.
              const carried = record.__excludedHad.filter(
                (k): k is string =>
                  typeof k === 'string' &&
                  (excludeFieldsRef.current as unknown as string[]).includes(k),
              );
              if (carried.length > 0) setExcludedHadOnRestore(carried);
            }
            // Persist with the new __v so subsequent mounts don't re-migrate
            // (non-idempotent migrators would otherwise corrupt data each mount).
            const stripped = stripExcluded(validated, excludeFieldsRef.current);
            const rewritten: StoredRecord<T> = { __v: version, values: stripped };
            if (newExcludedHad.length > 0) rewritten.__excludedHad = newExcludedHad;
            void storage.write(key, rewritten);
          }
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
      // Skip restore if user has already typed — don't clobber their input with a
      // late-arriving storage read (race surfaces in StrictMode and slow I/O).
      if (validated !== null && !userTouchedRef.current) {
        setValues(validated);
        // Hydrate the "needs re-entry" hint so consumers can prompt for
        // sensitive fields that were stripped from storage by `excludeFields`.
        // Defensively filter to strings; hand-written or downgraded records
        // could contain non-string entries that would surface as garbage in
        // the consumer-facing `fieldsNeedingReentry` list.
        if (Array.isArray(record.__excludedHad)) {
          const cleaned = record.__excludedHad.filter(
            (k): k is string => typeof k === 'string',
          );
          if (cleaned.length > 0) setExcludedHadOnRestore(cleaned);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only run on mount — key/storage/schema/version/migrate are expected stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // --- Debounced persist, broadcast, sync refs ---
  // Created once with stable identity; closures read from refs above so they
  // always see the latest storage/key/version/excludeFields without recreating
  // (which would lose pending timers and stale-close on old values).
  // excludeFieldsRef is hoisted above (near storageRef) — it's also read by
  // the restore effect's migrate path.

  const persistDebouncedRef = useRef(
    debounce(async (next: T) => {
      if (!mountedRef.current) return;
      const stripped = stripExcluded(next, excludeFieldsRef.current);
      // List excluded fields that currently hold non-default values, so a
      // future restore can surface them as `fieldsNeedingReentry`. Key names
      // only — values are not persisted (that's the whole point of excluding).
      const excludedHad = computeExcludedHad(
        next,
        defaultValuesRef.current,
        excludeFieldsRef.current,
      );
      const record: StoredRecord<T> = {
        __v: versionRef.current,
        values: stripped,
      };
      if (excludedHad.length > 0) record.__excludedHad = excludedHad;
      try {
        await storageRef.current.write(keyRef.current, record);
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

  // syncDebounceMs is dynamic — recreate the debounced fn when it changes so
  // a new delay actually takes effect. On cleanup, flush() into the queue so
  // a pending keystroke isn't silently dropped when the delay changes mid-life.
  // (Real unmount has already cancelled all debounced refs via the mount-effect
  // cleanup that runs first, so flush() is a no-op in that path.)
  const syncDebouncedRef = useRef<ReturnType<typeof debounce<[T]>> | null>(null);
  useEffect(() => {
    const d = debounce((next: T) => {
      syncQueueRef.current?.enqueue(next);
    }, syncDebounceMs);
    syncDebouncedRef.current = d;
    return () => {
      d.flush();
      syncDebouncedRef.current = null;
    };
  }, [syncDebounceMs]);

  // Fire side-effects whenever values change due to user actions
  useEffect(() => {
    if (disabled) return;
    if (pendingChanges) {
      persistDebouncedRef.current(values);
      broadcastDebouncedRef.current(values);
      syncDebouncedRef.current?.(values);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, values, pendingChanges]);

  // --- Registry registration ---
  // Holds the imperative action callbacks and live state snapshots so
  // `useFormDraftStatus` (subscribes by key) and `getFormDraft` (imperative
  // external control by key) can reach this instance without prop-drilling.
  // Refs are mutated on every render below so external callers always see
  // the latest closure / state values without us re-registering on each
  // state change (which would notify subscribers far more than needed).
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const discardRef = useRef<() => void>(() => {});
  const submitRef = useRef<
    <R>(
      handler: (v: T) => Promise<R>,
    ) => (e?: { preventDefault?: () => void }) => Promise<R | undefined>
  >(
    () => async () => undefined,
  );
  const pendingChangesRef = useRef(pendingChanges);
  pendingChangesRef.current = pendingChanges;
  const errorRef = useRef(error);
  errorRef.current = error;
  const lastSavedAtRef = useRef(lastSavedAt);
  lastSavedAtRef.current = lastSavedAt;

  // Register ONCE per mount (no `lastSavedAt` in deps). useFormDraftStatus
  // and getFormDraft read live values via the refs we hold here, so we don't
  // need the unregister→register churn that previously flickered subscribers
  // through DEFAULT_SNAPSHOT on every successful sync.
  //
  // Also route status-machine transitions through the registry's notify
  // channel. Subscribers that bound directly to this entry's statusMachine
  // would otherwise miss transitions on the actively-registered entry after
  // a duplicate-key remount (subscribe captures the entry-at-subscribe-time
  // and never re-binds).
  useEffect(() => {
    const entry = {
      statusMachine: statusMachineRef.current,
      saveRef,
      discardRef,
      submitRef,
      valuesRef,
      pendingChangesRef,
      errorRef,
      lastSavedAtRef,
      fieldsNeedingReentryRef,
    };
    registerDraft(key, entry);
    const unsubStatus = statusMachineRef.current.subscribe(() => {
      notifySubscribers(key);
    });
    return () => {
      unsubStatus();
      unregisterDraft(key, entry);
    };
  }, [key]);

  // Notify registry subscribers when state worth re-snapshotting changes
  // (just lastSavedAt for now — status changes are notified via the status
  // machine's own subscribe channel).
  useEffect(() => {
    notifySubscribers(key);
  }, [key, lastSavedAt]);

  // Track mount status. Re-set to true on each mount so React.StrictMode's
  // mount→unmount→mount cycle doesn't leave mountedRef stuck at false. Also
  // cancel any pending debounced writes so a stale 50ms-old keystroke can't
  // fire after the component is gone (and into the wrong storage key).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      persistDebouncedRef.current.cancel();
      broadcastDebouncedRef.current.cancel();
      syncDebouncedRef.current?.cancel();
    };
  }, []);

  // --- Public API ---
  const set = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      userTouchedRef.current = true;
      setValues((prev) => ({ ...prev, [field]: value }));
      setPendingChanges(true);
    },
    [],
  );

  const patch = useCallback((partial: Partial<T>) => {
    userTouchedRef.current = true;
    setValues((prev) => ({ ...prev, ...partial }));
    setPendingChanges(true);
  }, []);

  const save = useCallback(async () => {
    syncDebouncedRef.current?.flush();
    await syncQueueRef.current?.flush();
  }, []);

  const discard = useCallback(() => {
    // Bump the sync generation FIRST so an in-flight sync that resolves
    // moments later sees its generation is stale and skips its onSuccess
    // path (would otherwise set lastSavedAt + flip status to 'saved').
    syncGenerationRef.current += 1;
    // Cancel pending debounced writes BEFORE removing storage, otherwise a
    // 50ms-old keystroke fires after this call and resurrects the draft.
    persistDebouncedRef.current.cancel();
    broadcastDebouncedRef.current.cancel();
    syncDebouncedRef.current?.cancel();
    userTouchedRef.current = false;
    setValues(defaultValues);
    setPendingChanges(false);
    setLastSavedAt(null);
    setError(null);
    setOnConflictData(null);
    setExcludedHadOnRestore([]);
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
          // Bump the sync generation FIRST so any sync that began before
          // submit (still mid-await) is orphaned and cannot flip the status
          // pill after submit cleared everything.
          syncGenerationRef.current += 1;
          // Cancel pending writes so they don't rewrite storage after submit cleared it.
          persistDebouncedRef.current.cancel();
          broadcastDebouncedRef.current.cancel();
          syncDebouncedRef.current?.cancel();
          userTouchedRef.current = false;
          void storage.remove(key);
          broadcasterRef.current?.broadcastSubmitted();
          syncQueueRef.current?.cancel();
          // Long-running submit handlers may resolve after the component
          // unmounted (user navigated away). Guard all setState calls so we
          // don't get "setState on unmounted component" warnings.
          if (mountedRef.current) {
            setValues(defaultValues);
            setPendingChanges(false);
            setLastSavedAt(null);
            setError(null);
            setExcludedHadOnRestore([]);
            statusMachineRef.current.send('RESET');
          }
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
        // The user explicitly adopted the remote snapshot — the local
        // restore-hint no longer applies. Clear so we don't prompt re-entry
        // for fields the user just chose to throw away.
        setExcludedHadOnRestore([]);
      } else {
        setValues(choice as T);
        setExcludedHadOnRestore([]);
      }
      setOnConflictData(null);
      statusMachineRef.current.send('RESOLVE');
    },
    [onConflictData],
  );

  // Sync action callbacks into refs each render so registry entries (used by
  // getFormDraft) always invoke the LATEST closure even when discard/submit
  // recreate due to defaultValues/key/storage changes.
  saveRef.current = save;
  discardRef.current = discard;
  // submit is generic in R; coerce at the ref boundary — the registry only
  // needs the imperative shape, not per-call return-type fidelity.
  submitRef.current = submit as typeof submitRef.current;

  // Derive `fieldsNeedingReentry` per render: the restore hint, filtered down
  // to keys that (a) are still in the current `excludeFields` config, AND
  // (b) hold the default value in the live form. As the user re-enters one
  // (typing → value diverges from default), it falls out of the list. The
  // excludeFields intersect drops stale keys that survived a session where
  // the consumer's `excludeFields` shrank or a key was renamed via migrate.
  const fieldsNeedingReentry = useMemo<ReadonlyArray<keyof T & string>>(() => {
    if (excludedHadOnRestore.length === 0) return [];
    const excludeSet = new Set<string>(excludeFields as unknown as string[]);
    const out: Array<keyof T & string> = [];
    for (const k of excludedHadOnRestore) {
      if (!excludeSet.has(k)) continue;
      const key = k as keyof T;
      if (Object.is(values[key], defaultValues[key])) out.push(k as keyof T & string);
    }
    return out;
  }, [excludedHadOnRestore, values, defaultValues, excludeFields]);
  fieldsNeedingReentryRef.current = fieldsNeedingReentry;

  // F1 fix: notify registry subscribers when `fieldsNeedingReentry` changes
  // so `useFormDraftStatus` siblings re-render. The existing notify effect
  // only watches `lastSavedAt` and would miss reentry transitions in between
  // saves (e.g., user fills the password but no save has fired yet).
  useEffect(() => {
    notifySubscribers(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fieldsNeedingReentry]);

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
    fieldsNeedingReentry,
  };
}
