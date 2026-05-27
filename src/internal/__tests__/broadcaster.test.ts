import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBroadcaster } from '../broadcaster';

// BroadcastChannel dispatch is async (microtask) in both real browsers and our
// shim. Each test awaits a tick after postMessage before asserting.
const tick = () => Promise.resolve();

describe('createBroadcaster', () => {
  afterEach(() => vi.restoreAllMocks());

  it('broadcasts values-changed to other tabs', async () => {
    const a = createBroadcaster<{ x: number }>({ key: 'k', tabId: 'A' });
    const b = createBroadcaster<{ x: number }>({ key: 'k', tabId: 'B' });
    const received: unknown[] = [];
    b.onValuesChanged((vals, ts) => received.push({ vals, ts }));
    a.broadcastValues({ x: 1 });
    await tick();
    expect(received.length).toBe(1);
    expect(received[0]).toMatchObject({ vals: { x: 1 } });
    a.close();
    b.close();
  });

  it('drops messages from its own tabId (loop prevention)', async () => {
    const a = createBroadcaster<{ x: number }>({ key: 'k', tabId: 'A' });
    const received: unknown[] = [];
    a.onValuesChanged((vals) => received.push(vals));
    a.broadcastValues({ x: 1 });
    await tick();
    expect(received).toEqual([]);
    a.close();
  });

  it('broadcasts submitted', async () => {
    const a = createBroadcaster<{ x: number }>({ key: 'k', tabId: 'A' });
    const b = createBroadcaster<{ x: number }>({ key: 'k', tabId: 'B' });
    const onSubmit = vi.fn();
    b.onSubmitted(onSubmit);
    a.broadcastSubmitted();
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    a.close();
    b.close();
  });

  it('broadcasts discarded', async () => {
    const a = createBroadcaster<{ x: number }>({ key: 'k', tabId: 'A' });
    const b = createBroadcaster<{ x: number }>({ key: 'k', tabId: 'B' });
    const onDisc = vi.fn();
    b.onDiscarded(onDisc);
    a.broadcastDiscarded();
    await tick();
    expect(onDisc).toHaveBeenCalledTimes(1);
    a.close();
    b.close();
  });

  it('different keys are isolated', async () => {
    const a = createBroadcaster<{ x: number }>({ key: 'k1', tabId: 'A' });
    const b = createBroadcaster<{ x: number }>({ key: 'k2', tabId: 'B' });
    const received: unknown[] = [];
    b.onValuesChanged((vals) => received.push(vals));
    a.broadcastValues({ x: 1 });
    await tick();
    expect(received).toEqual([]);
    a.close();
    b.close();
  });

  it('close() unsubscribes; no more messages received', async () => {
    const a = createBroadcaster<{ x: number }>({ key: 'k', tabId: 'A' });
    const b = createBroadcaster<{ x: number }>({ key: 'k', tabId: 'B' });
    const received: unknown[] = [];
    b.onValuesChanged((vals) => received.push(vals));
    b.close();
    a.broadcastValues({ x: 1 });
    await tick();
    expect(received).toEqual([]);
    a.close();
  });

  it('drops submitted/discarded from cross-version tabs', async () => {
    // Regression: an old tab broadcasting submitted/discarded would wipe a
    // new tab's draft via a control message the new tab couldn't interpret.
    const a = createBroadcaster<{ x: number }>({ key: 'k', tabId: 'A', protocolVersion: 1 });
    const b = createBroadcaster<{ x: number }>({ key: 'k', tabId: 'B', protocolVersion: 2 });
    const onSubmit = vi.fn();
    const onDisc = vi.fn();
    b.onSubmitted(onSubmit);
    b.onDiscarded(onDisc);
    a.broadcastSubmitted();
    a.broadcastDiscarded();
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onDisc).not.toHaveBeenCalled();
    a.close();
    b.close();
  });

  it('skips broadcast when values contain non-cloneable content', async () => {
    const a = createBroadcaster<{ fn?: () => void }>({ key: 'k', tabId: 'A' });
    const b = createBroadcaster<{ fn?: () => void }>({ key: 'k', tabId: 'B' });
    const received: unknown[] = [];
    b.onValuesChanged((vals) => received.push(vals));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => a.broadcastValues({ fn: () => {} })).not.toThrow();
    await tick();
    expect(received).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    a.close();
    b.close();
  });

  it('handles BroadcastChannel being undefined (gracefully no-op)', () => {
    const original = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    const a = createBroadcaster<{ x: number }>({ key: 'k', tabId: 'A' });
    expect(() => a.broadcastValues({ x: 1 })).not.toThrow();
    a.close();
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = original;
  });
});
