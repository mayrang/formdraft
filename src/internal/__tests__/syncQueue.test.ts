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
