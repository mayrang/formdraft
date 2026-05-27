import type { StatusMachine } from './statusMachine';

/**
 * Per-key live handles to a mounted useFormDraft instance. `useFormDraftStatus`
 * reads via getter calls. `getFormDraft` exposes the ref handles so external
 * callers can invoke save/discard/submit and read current state snapshots
 * without prop-drilling. Refs are owned by the host hook and always reflect
 * the latest closure on every read.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RegistryEntry<T = any> = {
  statusMachine: StatusMachine;
  // Imperative action refs (set by useFormDraft each render; the hook's
  // useCallback identity may churn when key/storage/defaults change, so the
  // ref-of-callback indirection keeps external callers on the current impl).
  saveRef: { current: () => Promise<void> };
  discardRef: { current: () => void };
  submitRef: {
    current: <R>(
      handler: (values: T) => Promise<R>,
    ) => (e?: { preventDefault?: () => void }) => Promise<R | undefined>;
  };
  // State snapshots — read on every getter call to return current values.
  valuesRef: { current: T };
  pendingChangesRef: { current: boolean };
  errorRef: { current: Error | null };
  lastSavedAtRef: { current: Date | null };
};

// Stack of registrations per key. Last-in is the "active" one (returned by
// getDraft / useFormDraftStatus). When two instances share a key, the second
// mounts on top of the first; if the second unmounts, the first becomes
// active again automatically. This solves the duplicate-key bug an identity-
// guarded single-slot map cannot (when B unmounts first while A is alive).
const entries = new Map<string, RegistryEntry[]>();
const subscribers = new Map<string, Set<() => void>>();

function notify(key: string): void {
  subscribers.get(key)?.forEach((cb) => cb());
}

export function registerDraft(key: string, entry: RegistryEntry): void {
  const arr = entries.get(key);
  if (arr) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(
        `[formdraft] Two useFormDraft instances are mounted with key "${key}". ` +
          `Most-recently-mounted wins for getFormDraft / useFormDraftStatus; when it ` +
          `unmounts the previous instance takes over again. Use a unique key per form ` +
          `to avoid surprises.`,
      );
    }
    arr.push(entry);
  } else {
    entries.set(key, [entry]);
  }
  notify(key);
}

export function getDraft(key: string): RegistryEntry | undefined {
  const arr = entries.get(key);
  return arr && arr.length > 0 ? arr[arr.length - 1] : undefined;
}

/**
 * Identity-aware delete: removes the matching `entry` from the per-key stack.
 * The "active" registration after removal is the previous top — so if A
 * mounts, B mounts, and B unmounts, A's registration is re-exposed.
 */
export function unregisterDraft(key: string, entry?: RegistryEntry): void {
  const arr = entries.get(key);
  if (!arr) return;
  if (entry !== undefined) {
    const idx = arr.indexOf(entry);
    if (idx === -1) return;
    arr.splice(idx, 1);
  } else {
    arr.pop();
  }
  if (arr.length === 0) entries.delete(key);
  notify(key);
}

/**
 * Fire registry subscribers for a key WITHOUT touching the entry stack. Used
 * by useFormDraft to signal "snapshot-relevant state changed" (e.g.,
 * lastSavedAt updated) without the unregister→register churn that previously
 * caused useFormDraftStatus to flicker through DEFAULT_SNAPSHOT.
 */
export function notifySubscribers(key: string): void {
  notify(key);
}

export function subscribeRegistry(key: string, listener: () => void): () => void {
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key)!.add(listener);
  return () => {
    const set = subscribers.get(key);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) subscribers.delete(key);
  };
}

export function _clearRegistryForTests(): void {
  entries.clear();
  subscribers.clear();
}
