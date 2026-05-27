import type { StorageAdapter } from '../types';
import { localStorageAdapter } from './localStorage';
import { indexedDBAdapter } from './indexedDB';

export type AutoAdapterOptions = {
  /**
   * Threshold (computed from `JSON.stringify(value).length`, i.e. UTF-16
   * code units — NOT raw bytes) strictly above which writes are routed to
   * `fallback` instead of `primary`. Default 1,000,000 — well under the
   * lowest common localStorage quota (~5 MB on most browsers, ~2.5 MB on
   * iOS Safari) leaving headroom for other libraries sharing the same
   * origin AND for multi-byte chars where UTF-16 code units under-count
   * actual bytes (Korean, emoji surrogate pairs).
   */
  thresholdBytes?: number;
  /** Adapter used for small payloads. Default `localStorageAdapter()`. */
  primary?: StorageAdapter;
  /** Adapter used for large payloads. Default `indexedDBAdapter()`. */
  fallback?: StorageAdapter;
  /**
   * Fires once per migration so callers can surface this in dev tools, log
   * to telemetry, etc. `reason` is `'size'` when crossing the threshold via
   * `JSON.stringify` measurement, or `'quota'` when primary threw
   * QuotaExceededError despite the size being under threshold (other code
   * on the same origin filled localStorage first).
   */
  onMigration?: (key: string, reason: 'size' | 'quota') => void;
};

const DEFAULT_THRESHOLD_BYTES = 1_000_000;

function isQuotaError(e: unknown): boolean {
  // localStorage quota errors are reported as DOMException with code 22 in
  // most browsers, code 1014 in Firefox, name 'QuotaExceededError' (modern),
  // 'NS_ERROR_DOM_QUOTA_REACHED' (older Firefox), or 'QUOTA_EXCEEDED_ERR'
  // (older WebKit). Match by name + code only — a regex on `.message` would
  // false-positive on unrelated errors that happen to contain "quota".
  if (!(e instanceof Error)) return false;
  if (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.name === 'QUOTA_EXCEEDED_ERR'
  ) {
    return true;
  }
  const code = (e as Error & { code?: number }).code;
  return code === 22 || code === 1014;
}

/**
 * Storage adapter that starts on `primary` (localStorage) and transparently
 * migrates a key to `fallback` (IndexedDB) once its serialized size exceeds
 * `thresholdBytes`, or when primary throws QuotaExceededError. Cleans up the
 * stale location on every write so reads stay consistent without needing a
 * sentinel.
 *
 *   useFormDraft({ ..., storage: autoAdapter() });
 *   useFormDraft({ ..., storage: autoAdapter({ thresholdBytes: 500_000 }) });
 */
export function autoAdapter(opts: AutoAdapterOptions = {}): StorageAdapter {
  const thresholdBytes = opts.thresholdBytes ?? DEFAULT_THRESHOLD_BYTES;
  const primary = opts.primary ?? localStorageAdapter();
  const fallback = opts.fallback ?? indexedDBAdapter();
  const onMigration = opts.onMigration;

  if (primary === fallback) {
    throw new Error(
      '[formdraft] autoAdapter: primary and fallback must be distinct adapters (a large-write would `fallback.write` then `primary.remove` against the same store, deleting the data).',
    );
  }

  // Per-key serialization queue. Two concurrent write/remove operations to
  // the same key would otherwise interleave the four sub-operations
  // (write+remove on primary, write+remove on fallback) and could leave the
  // key in an inconsistent state — or empty, the worst case. Each op chains
  // onto the previous op's settle so the same-key ordering is sequential.
  const queues: Map<string, Promise<void>> = new Map();

  // Global barrier for `clear()`. A clear in progress must block all new
  // write/remove tasks until the underlying adapter.clear() calls complete,
  // otherwise a write started during clear's allSettled wait could land its
  // data AFTER adapter.clear wipes the store.
  let clearing: Promise<void> = Promise.resolve();

  const runSerialized = (key: string, task: () => Promise<void>): Promise<void> => {
    const prev = queues.get(key) ?? Promise.resolve();
    // Capture both gates at call time. Once a clear is in flight, all new
    // tasks chain onto its completion before running.
    const gate = clearing;
    const next = Promise.all([
      gate.catch(() => undefined),
      prev.catch(() => undefined),
    ]).then(task);
    queues.set(key, next);
    // Detach completed tasks so the map doesn't grow forever. The catch
    // attached here only handles the bookkeeping branch — the rejection
    // still flows to the caller via the returned `next`.
    next.finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    }).catch(() => undefined);
    return next;
  };

  const writeToFallback = async (key: string, value: unknown, reason: 'size' | 'quota'): Promise<void> => {
    // Write fallback FIRST, then clean primary. If fallback rejects on a
    // re-migration, primary still holds the prior (smaller) value — the
    // caller sees the rejection and can retry. On first-ever large write,
    // primary was empty, so a fallback rejection cleanly surfaces with
    // nothing to roll back.
    await fallback.write(key, value);
    let primaryCleared = true;
    try {
      await primary.remove(key);
    } catch {
      // Best-effort cleanup. Stale primary will be overwritten on next
      // small-write or removed on explicit remove(). Until then, read()
      // returns the stale value — documented trade-off (see README).
      primaryCleared = false;
    }
    // Only fire onMigration when the move is fully consistent (data in
    // fallback, primary cleaned). Otherwise the callback would report
    // "migrated" while reads still see the old primary value.
    if (primaryCleared) onMigration?.(key, reason);
  };

  return {
    name: 'auto',
    async read(key) {
      // Respect the clearing barrier so a read STARTED after clear() sees
      // post-clear state, not mid-wipe garbage (primary cleared, fallback
      // not yet). A read started BEFORE a concurrent clear() may still
      // resolve with the pre-clear value — concurrent read+clear ordering
      // is undefined; sequence them in caller code if you need strict
      // happens-before guarantees.
      await clearing.catch(() => undefined);
      // Primary first (cheap, synchronous localStorage). Falls back to IDB
      // only when primary is empty, which is the common case after migration.
      // Stale-primary trade-off: if a partial-failure migration left primary
      // with old data (fallback.write succeeded, primary.remove threw), or
      // if a concurrent write is mid-migration, this returns the primary
      // value until the migration's primary.remove completes.
      const fromPrimary = await primary.read(key);
      if (fromPrimary !== null && fromPrimary !== undefined) return fromPrimary;
      return fallback.read(key);
    },
    write(key, value) {
      return runSerialized(key, async () => {
        // JSON.stringify returns undefined for `undefined`, function, or
        // Symbol top-level values — those can't be persisted at all. Surface
        // a clear error instead of letting `.length` throw a cryptic TypeError.
        const serialized = JSON.stringify(value);
        if (serialized === undefined) {
          throw new TypeError(
            '[formdraft] autoAdapter.write: value is not JSON-serializable (undefined / function / top-level Symbol)',
          );
        }
        const size = serialized.length;

        if (size > thresholdBytes) {
          await writeToFallback(key, value, 'size');
          return;
        }

        // Under threshold — try primary. If quota error (other libs on the
        // origin filled localStorage), migrate to fallback as a recovery path.
        try {
          await primary.write(key, value);
        } catch (e) {
          if (isQuotaError(e)) {
            await writeToFallback(key, value, 'quota');
            return;
          }
          throw e;
        }
        // Successful primary write — clean any stale fallback data so reads
        // stay consistent. Best-effort; fallback may not have an entry.
        try {
          await fallback.remove(key);
        } catch {
          // ignore — read() prefers primary so stale fallback won't be returned
        }
      });
    },
    remove(key) {
      return runSerialized(key, async () => {
        // Remove from both — value could be in either after past migrations.
        // Surface the first failure so the caller can detect that the data
        // wasn't actually cleared. Don't swallow errors silently; if the
        // user wants best-effort, they can `.catch()` themselves.
        const results = await Promise.allSettled([
          primary.remove(key),
          fallback.remove(key),
        ]);
        const failed = results.find(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        if (failed) throw failed.reason;
      });
    },
    clear() {
      // Snapshot in-flight ops + empty the queue map SYNCHRONOUSLY (before
      // any await). Tasks queued AFTER this point chain on `clearing` and
      // run after the clear completes — which is correct.
      // Capturing pending inside the async IIFE (after `await prev`) would
      // include later tasks that are themselves waiting on this clear,
      // creating a deadlock (clear awaits write awaits clear).
      const prev = clearing;
      const pending = Array.from(queues.values());
      queues.clear();
      const op = (async () => {
        // Serialize against any prior clear so the older clear can't run
        // adapter.clear() AFTER a write that chained on the newer clear.
        await prev.catch(() => undefined);
        await Promise.allSettled(pending);
        const tasks: Array<Promise<void>> = [];
        if (primary.clear) tasks.push(primary.clear());
        if (fallback.clear) tasks.push(fallback.clear());
        const results = await Promise.allSettled(tasks);
        const failed = results.find(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        if (failed) throw failed.reason;
      })();
      clearing = op.catch(() => undefined);
      return op;
    },
  };
}
