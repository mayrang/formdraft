import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeartbeatDetector } from '../heartbeatDetector';

// Fetch is the only external dependency. Mock per-test so we can control
// outcomes (ok / not-ok / throw / timeout).
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Plain fake timers — shouldAdvanceTime would let setInterval fire during
  // awaits and make ping counts non-deterministic.
  vi.useFakeTimers();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // Default reachable. Individual tests override.
  fetchMock.mockResolvedValue({ ok: true } as Response);
});

afterEach(() => {
  vi.useRealTimers();
  // Restore visibilityState in case a test redefined it (Object.defineProperty
  // persists across tests in jsdom — would leak 'hidden' into the next test).
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

describe('createHeartbeatDetector', () => {
  it('starts optimistic (isOnline=true) before the first ping completes', () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const d = createHeartbeatDetector({ url: '/health' });
    expect(d.isOnline()).toBe(true);
    d.destroy();
  });

  it('flips to offline when the initial ping fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('captive portal'));
    const d = createHeartbeatDetector({ url: '/health' });
    // Flush microtasks so the fetch rejection propagates through ping(). Can't
    // use runAllTimersAsync — the detector's setInterval would loop forever.
    await Promise.resolve();
    await Promise.resolve();
    expect(d.isOnline()).toBe(false);
    d.destroy();
  });

  it('treats non-2xx responses as reachable (server health ≠ network reachability)', async () => {
    // The detector measures whether the round-trip completes, not whether
    // the server is healthy. A 500 means the network is up but the server
    // is broken — the user's `sync` will surface that. Don't double-flag.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const d = createHeartbeatDetector({ url: '/health' });
    await Promise.resolve();
    await Promise.resolve();
    expect(d.isOnline()).toBe(true);
    d.destroy();
  });

  it('pings on the configured interval', async () => {
    const d = createHeartbeatDetector({ url: '/health', intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0); // initial ping
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    d.destroy();
  });

  it('subscribers fire only on state transitions, not every ping', async () => {
    // First ping ok, second ok, third network-fails, fourth ok again.
    // Only network failures (not 5xx) trigger an offline transition.
    fetchMock
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockRejectedValueOnce(new Error('network died'))
      .mockResolvedValueOnce({ ok: true } as Response);
    const listener = vi.fn();
    const d = createHeartbeatDetector({ url: '/health', intervalMs: 100 });
    d.subscribe(listener);
    await vi.advanceTimersByTimeAsync(350);
    // ok→ok no transition; ok→false (transition); false→ok (transition).
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, false);
    expect(listener).toHaveBeenNthCalledWith(2, true);
    d.destroy();
  });

  it('window "offline" event flips state immediately (no extra ping)', async () => {
    const d = createHeartbeatDetector({ url: '/health', intervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(d.isOnline()).toBe(true);
    const fetchCountBefore = fetchMock.mock.calls.length;
    window.dispatchEvent(new Event('offline'));
    expect(d.isOnline()).toBe(false);
    // No additional fetch was triggered — offline event is authoritative.
    expect(fetchMock.mock.calls.length).toBe(fetchCountBefore);
    d.destroy();
  });

  it('window "online" event triggers an immediate ping', async () => {
    const d = createHeartbeatDetector({ url: '/health', intervalMs: 99999 });
    await Promise.resolve();
    const callsBefore = fetchMock.mock.calls.length;
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1);
    d.destroy();
  });

  it('destroy() removes listeners, stops interval, aborts in-flight ping', async () => {
    let onlineHandler: (() => void) | null = null;
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(((
      type: string,
      handler: EventListener,
    ) => {
      if (type === 'online') onlineHandler = handler as () => void;
    }) as typeof window.addEventListener);
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const d = createHeartbeatDetector({ url: '/health', intervalMs: 1000 });
    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));

    d.destroy();
    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));

    // Subsequent timer ticks should not fire additional fetches.
    const callsBefore = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);

    // Stale handler firing post-destroy must not flip state.
    onlineHandler?.();
    expect(d.isOnline()).toBe(true); // last cached value
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('listener throwing does not stop other listeners from running', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = vi.fn();
    const d = createHeartbeatDetector({ url: '/health' });
    d.subscribe(() => {
      throw new Error('listener boom');
    });
    d.subscribe(good);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('heartbeat listener threw'),
      expect.any(Error),
    );
    expect(good).toHaveBeenCalledWith(false);
    warn.mockRestore();
    d.destroy();
  });

  it('unsubscribe removes only the specified listener', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const a = vi.fn();
    const b = vi.fn();
    const d = createHeartbeatDetector({ url: '/health' });
    const unsubA = d.subscribe(a);
    d.subscribe(b);
    unsubA();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(false);
    d.destroy();
  });

  it('timeout triggers offline (timeoutMs vs preempt distinction)', async () => {
    // Round-2 audit regression: a hung fetch must flip the detector offline
    // even though preempt-aborts (also AbortError) must NOT.
    // Mock must honor AbortSignal — real fetch rejects on abort, our basic
    // mockResolvedValue doesn't.
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const d = createHeartbeatDetector({ url: '/health', timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    await Promise.resolve();
    await Promise.resolve();
    expect(d.isOnline()).toBe(false);
    d.destroy();
  });

  it('self-preempt (new ping aborts prior) does NOT flip to offline', async () => {
    // Critical test: the prior ping's fetch must actually be aborted (not
    // just left pending) so its catch runs with `inFlight !== controller`.
    // Mock must honor signal — a pending Promise that ignores abort would
    // make this test pass tautologically (the audit caught exactly that).
    const listener = vi.fn();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
        // Otherwise pending; the new ping will abort us.
      });
    });
    const d = createHeartbeatDetector({ url: '/health', intervalMs: 99999 });
    d.subscribe(listener);
    // Initial ping is pending. Trigger a new ping via window 'online' —
    // this aborts the prior, whose catch then runs.
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Detector stays online; listener never saw a transition because the
    // prior's catch detected `inFlight !== controller` and suppressed.
    expect(d.isOnline()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    d.destroy();
  });

  it('genuine network failure of current ping flips to offline (not suppressed)', async () => {
    // Counterpart to the self-preempt test: when there's no preempt and the
    // CURRENT ping fails, setOnline(false) MUST fire. This guards against
    // an over-eager "superseded" check that would silence real failures.
    fetchMock.mockRejectedValue(new Error('DNS lookup failed'));
    const listener = vi.fn();
    const d = createHeartbeatDetector({ url: '/health' });
    d.subscribe(listener);
    await Promise.resolve();
    await Promise.resolve();
    expect(d.isOnline()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1); // exactly one transition
    expect(listener).toHaveBeenCalledWith(false);
    d.destroy();
  });

  it('hiding the tab while a ping is in flight does NOT flip offline (round-6 regression)', async () => {
    // Round 5 added inFlight?.abort() on hide; that aborted the in-flight,
    // its catch ran with inFlight still === controller (suppression failed),
    // and setOnline(false) fired purely because the user switched tabs.
    // We now leave the in-flight alone on hide.
    let resolveFetch: ((r: Response) => void) | null = null;
    fetchMock.mockImplementation(
      () => new Promise<Response>((r) => { resolveFetch = r; }),
    );
    const listener = vi.fn();
    const d = createHeartbeatDetector({ url: '/health', intervalMs: 99999 });
    d.subscribe(listener);
    // Ping is pending. Tab goes hidden.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();
    // No spurious offline transition.
    expect(listener).not.toHaveBeenCalled();
    expect(d.isOnline()).toBe(true);
    // Resolving the ping naturally is still fine.
    resolveFetch?.({ ok: true } as Response);
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled(); // still true → true, no transition
    d.destroy();
  });

  it('does not starve under intervalMs ≤ fetch RTT (skip tick if prior in-flight)', async () => {
    // F1 regression: if interval ticks faster than fetch resolves, every
    // ping would preempt its predecessor and the superseded check would
    // suppress every result. Detector would NEVER flip state.
    let resolveFetch: ((r: Response) => void) | null = null;
    fetchMock.mockImplementation(
      () => new Promise<Response>((r) => { resolveFetch = r; }),
    );
    const d = createHeartbeatDetector({ url: '/health', intervalMs: 10 });
    // Advance enough for many interval ticks while the initial ping is hung
    await vi.advanceTimersByTimeAsync(50);
    // Only the initial ping should have started; subsequent ticks were skipped.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Resolving lets the next interval tick proceed normally.
    resolveFetch?.({ ok: true } as Response);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    d.destroy();
  });

  it('visibility hidden stops the interval; visible re-starts and pings', async () => {
    const d = createHeartbeatDetector({ url: '/health', intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(0); // initial ping
    const afterInitial = fetchMock.mock.calls.length;
    expect(afterInitial).toBe(1);
    // Go hidden; advance well past 3 intervals — no pings should fire.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock.mock.calls.length).toBe(1); // interval was stopped while hidden
    // Come back; expect an immediate ping triggered by the visibility handler.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(fetchMock.mock.calls.length).toBe(2);
    d.destroy();
  });

  it('late fetch resolution after destroy() does not flip state or fire listeners', async () => {
    let resolveFetch: ((r: Response) => void) | null = null;
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((r) => { resolveFetch = r; }),
    );
    const listener = vi.fn();
    const d = createHeartbeatDetector({ url: '/health' });
    d.subscribe(listener);
    d.destroy();
    // Resolve the pending fetch AFTER destroy.
    resolveFetch?.({ ok: true } as Response);
    await Promise.resolve();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    expect(d.isOnline()).toBe(true); // last cached value
  });

  it('subscribe after destroy returns a no-op unsub that does not throw', () => {
    const d = createHeartbeatDetector({ url: '/health' });
    d.destroy();
    const listener = vi.fn();
    const unsub = d.subscribe(listener);
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('two detectors with the same URL operate independently', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true } as Response) // d1 initial
      .mockResolvedValueOnce({ ok: true } as Response); // d2 initial
    const d1 = createHeartbeatDetector({ url: '/health' });
    const d2 = createHeartbeatDetector({ url: '/health' });
    await Promise.resolve();
    await Promise.resolve();
    expect(d1.isOnline()).toBe(true);
    expect(d2.isOnline()).toBe(true);
    // Destroy d1; d2 must remain functional.
    d1.destroy();
    expect(d2.isOnline()).toBe(true);
    d2.destroy();
  });
});
