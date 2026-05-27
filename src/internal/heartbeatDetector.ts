/**
 * Pluggable online detector. Provides accurate reachability under captive
 * portals (coffee shop / hotel wifi) and partial-online states where
 * `navigator.onLine === true` lies.
 *
 * Usage:
 *
 *   const detector = createHeartbeatDetector({ url: '/api/health' });
 *   useFormDraft({ onlineDetector: detector, ... });
 *
 * The detector is owned by the caller; call `destroy()` when no longer needed
 * (component unmount or app shutdown). Multiple hooks can share one detector.
 */
export type OnlineDetector = {
  /** Synchronous read of cached online state. */
  isOnline(): boolean;
  /**
   * Subscribe to state changes. Listener fires exactly when isOnline()'s
   * return value transitions (false→true or true→false). Returns
   * unsubscribe function.
   */
  subscribe(listener: (online: boolean) => void): () => void;
  /** Stop the heartbeat interval, remove listeners, release resources. */
  destroy(): void;
};

export type HeartbeatDetectorOptions = {
  /**
   * HEAD-able URL on the same origin (or CORS-permitted). The detector
   * treats ANY received response — including 4xx and 5xx — as reachable,
   * so it works against most healthchecks regardless of payload.
   *
   * **Don't pick a URL your service worker serves from cache** (e.g., a
   * Workbox `CacheFirst` route or precached asset). An offline SW that
   * returns a cached 200 will make the detector report reachable during a
   * real outage. Use `NetworkOnly` or exclude the URL from SW scope.
   */
  url: string;
  /** Heartbeat interval (ms). Default 30 seconds. */
  intervalMs?: number;
  /** Per-request timeout (ms). Treats slower responses as offline. Default 5s. */
  timeoutMs?: number;
  /** Extra fetch options. Defaults to `{ method: 'HEAD', cache: 'no-store' }`. */
  fetchOptions?: RequestInit;
};

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;

export function createHeartbeatDetector(opts: HeartbeatDetectorOptions): OnlineDetector {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchOptions: RequestInit = {
    method: 'HEAD',
    cache: 'no-store',
    ...opts.fetchOptions,
  };

  // Optimistic initial state — assume reachable until first ping disproves it.
  // Better than starting offline and blocking sync for up to intervalMs.
  let online = true;
  let destroyed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: AbortController | null = null;
  const listeners = new Set<(online: boolean) => void>();

  const setOnline = (next: boolean): void => {
    if (online === next) return;
    online = next;
    listeners.forEach((l) => {
      try {
        l(next);
      } catch (e) {
        // User listener — don't let one bad subscriber kill the others.
        // eslint-disable-next-line no-console
        console.warn('[formdraft] heartbeat listener threw:', e);
      }
    });
  };

  const ping = async (): Promise<void> => {
    if (destroyed) return;
    // Cancel a prior in-flight fetch so we don't pile up network usage. We
    // don't need to distinguish abort sources in the catch — instead, every
    // catch/try arm checks `inFlight !== controller` to detect "I'm no
    // longer the current ping; suppress my result". This is race-free
    // because `inFlight` is only mutated synchronously, and the check after
    // await happens in the microtask after a newer ping has run.
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetch(opts.url, { ...fetchOptions, signal: controller.signal });
      if (destroyed) return;
      if (inFlight !== controller) return; // superseded by a newer ping
      // Any received response — including 4xx/5xx — means the round-trip
      // completed and the network path is up. Treat reachability separately
      // from server health (which is the user's concern, not the detector's).
      setOnline(true);
    } catch {
      if (destroyed) return;
      if (inFlight !== controller) return; // superseded; the newer ping will report
      // Either the fetch failed (network/DNS/TLS) or our own timeoutMs
      // aborted it. Both mean "we couldn't reach the server" — offline.
      setOnline(false);
    } finally {
      clearTimeout(timeoutId);
      if (inFlight === controller) inFlight = null;
    }
  };

  const startInterval = (): void => {
    if (destroyed || timer !== null) return;
    timer = setInterval(() => {
      // Skip the tick if a prior ping is still in flight. Otherwise, with
      // intervalMs ≤ fetch RTT, every ping would preempt its predecessor
      // and the "superseded" check in catch/try would suppress every
      // result — detector would stay stuck at the initial value forever.
      if (inFlight !== null) return;
      void ping();
    }, intervalMs);
  };

  const stopInterval = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const handleVisibility = (): void => {
    if (destroyed) return;
    if (document.visibilityState === 'visible') {
      // User just returned; fresh probe is desirable even if a stale ping is
      // mid-flight (it'll be superseded). The setInterval guard against
      // overlapping pings does NOT apply here — explicit user/browser
      // signals beat scheduled ticks.
      void ping();
      startInterval();
    } else {
      // Only stop scheduling new pings. Don't abort the in-flight one — its
      // result is still accurate reachability data, and aborting would race
      // into the catch path (inFlight === controller at that point) and
      // cause a spurious setOnline(false) on every tab-hide.
      stopInterval();
    }
  };

  const handleWindowOnline = (): void => {
    if (destroyed) return;
    // Browser thinks we're online — re-probe to verify against captive
    // portals. Same as visibility-resume: explicit signal trumps any
    // in-flight scheduled ping.
    void ping();
  };

  const handleWindowOffline = (): void => {
    if (destroyed) return;
    // OS-level offline is authoritative; cancel any in-flight ping and flip.
    inFlight?.abort();
    setOnline(false);
  };

  const hasWindow = typeof window !== 'undefined';
  const hasDocument = typeof document !== 'undefined';

  // Initial ping primes the cache. Fire-and-forget.
  if (hasWindow && typeof fetch !== 'undefined') {
    void ping();
    if (hasDocument && document.visibilityState !== 'hidden') startInterval();
    window.addEventListener('online', handleWindowOnline);
    window.addEventListener('offline', handleWindowOffline);
    if (hasDocument) document.addEventListener('visibilitychange', handleVisibility);
  }

  return {
    isOnline() {
      return online;
    },
    subscribe(listener) {
      // No-op after destroy: don't add to a cleared set and return a dead
      // unsub. Makes "subscribed but listener never fires" impossible.
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopInterval();
      inFlight?.abort();
      inFlight = null;
      listeners.clear();
      if (hasWindow) {
        window.removeEventListener('online', handleWindowOnline);
        window.removeEventListener('offline', handleWindowOffline);
      }
      if (hasDocument) {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    },
  };
}
