import type { RetryConfig } from '../types';

export type SyncQueueOptions<T> = {
  sync: (values: T) => Promise<void>;
  retry: RetryConfig;
  onError?: (error: Error, attempt: number) => void;
  onSuccess?: () => void;
  // Fires once when all `maxAttempts` retries have been exhausted and the
  // pending value is being dropped. Caller's last chance to surface the
  // failure (status pill, toast, manual retry button, etc.).
  onAbandoned?: (lastError: Error, values: T) => void;
  // Optional probe to detect captive portals and other lying-network states
  // where navigator.onLine === true but actual reachability fails. Called
  // before each sync attempt. Return false to defer; the queue retries on
  // the next online event or via the user's own save() call. Throwing is
  // treated the same as returning false.
  connectivityProbe?: () => Promise<boolean>;
};

export type SyncQueue<T> = {
  enqueue(values: T): void;
  cancel(): void;
  pending(): boolean;
  flush(): Promise<void>;
};

export function createSyncQueue<T>(opts: SyncQueueOptions<T>): SyncQueue<T> {
  let pendingValues: T | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let cancelled = false;

  const handleOnline = () => {
    if (cancelled) return;
    if (pendingValues !== null && !inFlight) schedule(0);
  };
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') handleOnline();
  };

  const hasWindow = typeof window !== 'undefined';
  if (hasWindow) {
    window.addEventListener('online', handleOnline);
    window.addEventListener('visibilitychange', handleVisibility);
  }

  function schedule(delayMs: number): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void attemptSync();
    }, delayMs);
  }

  async function attemptSync(): Promise<void> {
    if (cancelled) return;
    if (inFlight) return; // re-entry guard: flush() called while a timer attempt is mid-flight
    if (pendingValues === null) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    // Captive portal / lying-network probe. Caller's responsibility to make
    // it cheap (HEAD a small endpoint, ~50ms). Skip attempt but DON'T count
    // as a failure — it's a reachability question, not a sync failure.
    if (opts.connectivityProbe) {
      let reachable = false;
      try {
        reachable = await opts.connectivityProbe();
      } catch {
        reachable = false;
      }
      if (cancelled) return;
      if (!reachable) return;
    }

    const values = pendingValues;
    inFlight = true;
    attempt += 1;
    try {
      await opts.sync(values);
      if (cancelled) return; // caller bailed during the await; don't fire onSuccess
      if (pendingValues === values) {
        pendingValues = null;
        attempt = 0;
      } else {
        // A newer value was enqueued while this sync was in-flight. enqueue()
        // skipped scheduling because inFlight was true — re-arm now.
        attempt = 0;
        inFlight = false;
        schedule(0);
      }
      opts.onSuccess?.();
    } catch (e) {
      if (cancelled) return;
      const err = e instanceof Error ? e : new Error(String(e));
      opts.onError?.(err, attempt);
      if (attempt < opts.retry.maxAttempts) {
        const backoff = Math.min(
          opts.retry.initialBackoffMs * Math.pow(opts.retry.multiplier, attempt - 1),
          opts.retry.maxBackoffMs,
        );
        schedule(backoff);
      } else {
        // Out of retries — drop the value. Surface terminal failure to caller
        // exactly once with the last error so the hook can emit SAVE_FAIL.
        const droppedValues = values;
        pendingValues = null;
        attempt = 0;
        opts.onAbandoned?.(err, droppedValues);
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    enqueue(values) {
      pendingValues = values;
      if (!inFlight) schedule(0);
    },
    cancel() {
      cancelled = true;
      pendingValues = null;
      attempt = 0;
      if (timer) clearTimeout(timer);
      timer = null;
      if (hasWindow) {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('visibilitychange', handleVisibility);
      }
    },
    pending() {
      return pendingValues !== null || inFlight;
    },
    async flush() {
      if (pendingValues !== null) {
        if (timer) clearTimeout(timer);
        timer = null;
        await attemptSync();
      }
    },
  };
}
