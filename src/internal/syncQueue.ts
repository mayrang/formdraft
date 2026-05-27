import type { RetryConfig } from '../types';

export type SyncQueueOptions<T> = {
  sync: (values: T) => Promise<void>;
  retry: RetryConfig;
  onError?: (error: Error, attempt: number) => void;
  onSuccess?: () => void;
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
    if (pendingValues !== null && !inFlight) schedule(0);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') handleOnline();
    });
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
    if (pendingValues === null) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const values = pendingValues;
    inFlight = true;
    attempt += 1;
    try {
      await opts.sync(values);
      if (pendingValues === values) {
        pendingValues = null;
        attempt = 0;
      }
      opts.onSuccess?.();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      opts.onError?.(err, attempt);
      if (attempt < opts.retry.maxAttempts) {
        const backoff = Math.min(
          opts.retry.initialBackoffMs * Math.pow(opts.retry.multiplier, attempt - 1),
          opts.retry.maxBackoffMs,
        );
        schedule(backoff);
      } else {
        pendingValues = null;
        attempt = 0;
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
