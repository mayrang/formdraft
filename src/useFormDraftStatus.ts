import { useSyncExternalStore } from 'react';
import { getDraft, subscribeRegistry } from './internal/registry';
import type { FormDraftStatus } from './types';

export function useFormDraftStatus(key: string): {
  status: FormDraftStatus;
  lastSavedAt: Date | null;
} {
  const subscribe = (cb: () => void) => {
    const unsubRegistry = subscribeRegistry(key, cb);
    const entry = getDraft(key);
    const unsubMachine = entry?.statusMachine.subscribe(cb) ?? (() => {});
    return () => {
      unsubRegistry();
      unsubMachine();
    };
  };

  const getSnapshot = () => {
    const entry = getDraft(key);
    if (!entry) return JSON.stringify({ status: 'idle', lastSavedAt: null });
    return JSON.stringify({
      status: entry.statusMachine.getStatus(),
      lastSavedAt: entry.lastSavedAt?.toISOString() ?? null,
    });
  };

  const getServerSnapshot = () => JSON.stringify({ status: 'idle', lastSavedAt: null });

  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const parsed = JSON.parse(snap) as { status: FormDraftStatus; lastSavedAt: string | null };
  return {
    status: parsed.status,
    lastSavedAt: parsed.lastSavedAt ? new Date(parsed.lastSavedAt) : null,
  };
}
