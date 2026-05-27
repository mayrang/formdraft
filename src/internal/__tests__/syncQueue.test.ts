import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncQueue } from '../syncQueue';
import { setOnline } from '../../../vitest.setup';

describe('createSyncQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setOnline(true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enqueue calls sync immediately when online', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const q = createSyncQueue({ sync, retry: { maxAttempts: 3, initialBackoffMs: 100, multiplier: 2, maxBackoffMs: 1000 } });
    q.enqueue({ x: 1 });
    await vi.runAllTimersAsync();
    expect(sync).toHaveBeenCalledWith({ x: 1 });
  });

  it('does not call sync when offline; flushes on online', async () => {
    setOnline(false);
    const sync = vi.fn().mockResolvedValue(undefined);
    const q = createSyncQueue({ sync, retry: { maxAttempts: 3, initialBackoffMs: 100, multiplier: 2, maxBackoffMs: 1000 } });
    q.enqueue({ x: 1 });
    await vi.runAllTimersAsync();
    expect(sync).not.toHaveBeenCalled();
    setOnline(true);
    await vi.runAllTimersAsync();
    expect(sync).toHaveBeenCalledWith({ x: 1 });
  });

  it('retries with exponential backoff on failure', async () => {
    const sync = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const q = createSyncQueue({ sync, onError, retry: { maxAttempts: 5, initialBackoffMs: 100, multiplier: 2, maxBackoffMs: 1000 } });
    q.enqueue({ x: 1 });
    await vi.advanceTimersByTimeAsync(0); // attempt 1
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100); // backoff 1
    expect(sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200); // backoff 2
    expect(sync).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('coalesces multiple enqueues — only latest value gets synced', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const q = createSyncQueue({ sync, retry: { maxAttempts: 3, initialBackoffMs: 100, multiplier: 2, maxBackoffMs: 1000 } });
    q.enqueue({ x: 1 });
    q.enqueue({ x: 2 });
    q.enqueue({ x: 3 });
    await vi.runAllTimersAsync();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith({ x: 3 });
  });

  it('cancel() stops pending retries', async () => {
    const sync = vi.fn().mockRejectedValue(new Error('fail'));
    const q = createSyncQueue({ sync, retry: { maxAttempts: 5, initialBackoffMs: 100, multiplier: 2, maxBackoffMs: 1000 } });
    q.enqueue({ x: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);
    q.cancel();
    await vi.advanceTimersByTimeAsync(10000);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('cancel() removes window listeners (no leak across queue lifecycle)', () => {
    const spyAdd = vi.spyOn(window, 'addEventListener');
    const spyRemove = vi.spyOn(window, 'removeEventListener');
    const q = createSyncQueue({
      sync: vi.fn(),
      retry: { maxAttempts: 3, initialBackoffMs: 100, multiplier: 2, maxBackoffMs: 1000 },
    });
    expect(spyAdd).toHaveBeenCalledWith('online', expect.any(Function));
    expect(spyAdd).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    q.cancel();
    expect(spyRemove).toHaveBeenCalledWith('online', expect.any(Function));
    expect(spyRemove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    spyAdd.mockRestore();
    spyRemove.mockRestore();
  });

  it('cancel() during in-flight sync suppresses onSuccess', async () => {
    let resolveSync: () => void = () => {};
    const sync = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolveSync = r; }),
    );
    const onSuccess = vi.fn();
    const q = createSyncQueue({
      sync,
      onSuccess,
      retry: { maxAttempts: 3, initialBackoffMs: 100, multiplier: 2, maxBackoffMs: 1000 },
    });
    q.enqueue({ x: 1 });
    await vi.advanceTimersByTimeAsync(0); // sync called, awaiting
    expect(sync).toHaveBeenCalledTimes(1);
    q.cancel();
    resolveSync(); // resolve after cancel
    await vi.runAllTimersAsync();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('flush() does not double-call sync when a timer attempt is in-flight', async () => {
    let resolveSync: () => void = () => {};
    const sync = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolveSync = r; }),
    );
    const q = createSyncQueue({
      sync,
      retry: { maxAttempts: 3, initialBackoffMs: 100, multiplier: 2, maxBackoffMs: 1000 },
    });
    q.enqueue({ x: 1 });
    await vi.advanceTimersByTimeAsync(0); // first attempt started, in-flight
    expect(sync).toHaveBeenCalledTimes(1);
    const flushP = q.flush(); // would re-enter without the guard
    expect(sync).toHaveBeenCalledTimes(1);
    resolveSync();
    await flushP;
    await vi.runAllTimersAsync();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('schedules a follow-up sync when a newer value arrives mid-flight', async () => {
    // Regression: enqueue() skips scheduling while inFlight is true. After the
    // in-flight sync completes, the newer value was previously orphaned.
    let resolveFirst: () => void = () => {};
    const sync = vi.fn().mockImplementationOnce(
      () => new Promise<void>((r) => { resolveFirst = r; }),
    ).mockResolvedValue(undefined);
    const q = createSyncQueue({
      sync,
      retry: { maxAttempts: 3, initialBackoffMs: 100, multiplier: 2, maxBackoffMs: 1000 },
    });
    q.enqueue({ x: 1 });
    await vi.advanceTimersByTimeAsync(0); // first attempt in-flight
    q.enqueue({ x: 2 }); // arrives mid-flight
    resolveFirst();
    await vi.runAllTimersAsync();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenLastCalledWith({ x: 2 });
  });

  it('exposes pending() to inspect whether something is queued', async () => {
    setOnline(false);
    const sync = vi.fn().mockResolvedValue(undefined);
    const q = createSyncQueue({ sync, retry: { maxAttempts: 3, initialBackoffMs: 100, multiplier: 2, maxBackoffMs: 1000 } });
    expect(q.pending()).toBe(false);
    q.enqueue({ x: 1 });
    expect(q.pending()).toBe(true);
    setOnline(true);
    await vi.runAllTimersAsync();
    expect(q.pending()).toBe(false);
  });
});
