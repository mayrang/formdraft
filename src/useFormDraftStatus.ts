import { useCallback, useRef, useSyncExternalStore } from 'react';
import { getDraft, subscribeRegistry } from './internal/registry';
import type { FormDraftStatus } from './types';

type Snapshot = { status: FormDraftStatus; lastSavedAt: Date | null };
const DEFAULT_SNAPSHOT: Snapshot = { status: 'idle', lastSavedAt: null };

export function useFormDraftStatus(key: string): Snapshot {
  // Cache the last returned snapshot OBJECT so consecutive getSnapshot() calls
  // without an intervening change return the same reference. Without this,
  // useSyncExternalStore would re-render every render because we'd allocate a
  // fresh object each call (Object.is bail-out fails).
  const cacheRef = useRef<{
    status: FormDraftStatus | null;
    lastSavedMs: number | null;
    snapshot: Snapshot;
  }>({ status: null, lastSavedMs: null, snapshot: DEFAULT_SNAPSHOT });

  const subscribe = useCallback(
    (cb: () => void) => {
      // Single channel: the host useFormDraft routes its statusMachine
      // transitions through notifySubscribers(key), so we don't need to
      // separately subscribe to entry.statusMachine here (which would
      // capture the entry-at-subscribe-time and miss later registrations
      // when two instances share a key).
      return subscribeRegistry(key, cb);
    },
    [key],
  );

  const getSnapshot = useCallback((): Snapshot => {
    const entry = getDraft(key);
    if (!entry) {
      const c = cacheRef.current;
      if (c.status === null && c.lastSavedMs === null) return c.snapshot;
      cacheRef.current = { status: null, lastSavedMs: null, snapshot: DEFAULT_SNAPSHOT };
      return DEFAULT_SNAPSHOT;
    }
    const status = entry.statusMachine.getStatus();
    // Read via ref (always current). The entry's snapshot field used to be
    // here, but that required unregister→register on every save and flickered
    // subscribers through DEFAULT_SNAPSHOT.
    const lastSavedMs = entry.lastSavedAtRef.current?.getTime() ?? null;
    const c = cacheRef.current;
    if (c.status === status && c.lastSavedMs === lastSavedMs) return c.snapshot;
    const snapshot: Snapshot = {
      status,
      lastSavedAt: lastSavedMs !== null ? new Date(lastSavedMs) : null,
    };
    cacheRef.current = { status, lastSavedMs, snapshot };
    return snapshot;
  }, [key]);

  const getServerSnapshot = useCallback((): Snapshot => DEFAULT_SNAPSHOT, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
