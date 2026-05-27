import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageAdapter } from '../../types';
import { autoAdapter } from '../auto';

// Minimal in-memory adapter so tests don't depend on the localStorage /
// IndexedDB implementations (those have their own test suites). This isolates
// autoAdapter's routing logic.
function makeMockAdapter(name: string): StorageAdapter & { _state: Map<string, unknown>; writeImpl: (key: string, value: unknown) => Promise<void> } {
  const state = new Map<string, unknown>();
  const adapter = {
    name,
    _state: state,
    async read(key: string) {
      return state.has(key) ? state.get(key) : null;
    },
    writeImpl: async (key: string, value: unknown): Promise<void> => {
      state.set(key, value);
    },
    async write(key: string, value: unknown) {
      await adapter.writeImpl(key, value);
    },
    async remove(key: string) {
      state.delete(key);
    },
    async clear() {
      state.clear();
    },
  };
  return adapter;
}

describe('autoAdapter', () => {
  let primary: ReturnType<typeof makeMockAdapter>;
  let fallback: ReturnType<typeof makeMockAdapter>;

  beforeEach(() => {
    primary = makeMockAdapter('primary');
    fallback = makeMockAdapter('fallback');
  });

  it('writes small payloads to primary; reads from primary', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 1000 });
    const small = { __v: 1, values: { name: 'Alice' } };
    await a.write('k', small);
    expect(primary._state.get('k')).toEqual(small);
    expect(fallback._state.has('k')).toBe(false);
    expect(await a.read('k')).toEqual(small);
  });

  it('writes large payloads to fallback; reads from fallback', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100 });
    // JSON.stringify of this is well over 100 bytes
    const big = { __v: 1, values: { content: 'x'.repeat(500) } };
    await a.write('k', big);
    expect(primary._state.has('k')).toBe(false);
    expect(fallback._state.get('k')).toEqual(big);
    expect(await a.read('k')).toEqual(big);
  });

  it('cleans stale primary entry when a key crosses the threshold', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100 });
    // First write small → goes to primary
    await a.write('k', { __v: 1, values: { x: 'hi' } });
    expect(primary._state.has('k')).toBe(true);
    expect(fallback._state.has('k')).toBe(false);
    // Now write large → moves to fallback, primary should be cleared so
    // read doesn't return the stale small value.
    const big = { __v: 1, values: { x: 'x'.repeat(500) } };
    await a.write('k', big);
    expect(primary._state.has('k')).toBe(false);
    expect(fallback._state.get('k')).toEqual(big);
    expect(await a.read('k')).toEqual(big);
  });

  it('cleans stale fallback entry when a key shrinks back under the threshold', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100 });
    await a.write('k', { __v: 1, values: { x: 'x'.repeat(500) } });
    expect(fallback._state.has('k')).toBe(true);
    // Subsequent small write
    await a.write('k', { __v: 1, values: { x: 'hi' } });
    expect(primary._state.has('k')).toBe(true);
    expect(fallback._state.has('k')).toBe(false);
  });

  it('falls back to fallback when primary throws QuotaExceededError', async () => {
    const onMigration = vi.fn();
    const a = autoAdapter({ primary, fallback, thresholdBytes: 1_000_000, onMigration });
    // Make primary throw quota error on next write
    const quotaErr = new Error('LocalStorage quota');
    quotaErr.name = 'QuotaExceededError';
    primary.writeImpl = async () => {
      throw quotaErr;
    };
    const small = { __v: 1, values: { x: 'hi' } };
    await a.write('k', small);
    expect(primary._state.has('k')).toBe(false);
    expect(fallback._state.get('k')).toEqual(small);
    expect(onMigration).toHaveBeenCalledWith('k', 'quota');
  });

  it('propagates non-quota errors from primary write', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 1_000_000 });
    primary.writeImpl = async () => {
      throw new TypeError('something else');
    };
    await expect(a.write('k', { foo: 1 })).rejects.toThrow('something else');
    expect(fallback._state.has('k')).toBe(false);
  });

  it('remove clears both primary and fallback', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 1_000_000 });
    // Manually populate both to simulate post-migration drift
    primary._state.set('k', { stale: true });
    fallback._state.set('k', { real: true });
    await a.remove('k');
    expect(primary._state.has('k')).toBe(false);
    expect(fallback._state.has('k')).toBe(false);
  });

  it('read prefers primary; falls back to fallback only when primary is null', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 1_000_000 });
    fallback._state.set('only-in-fallback', { from: 'fallback' });
    primary._state.set('only-in-primary', { from: 'primary' });
    primary._state.set('in-both', { from: 'primary' });
    fallback._state.set('in-both', { from: 'fallback' });

    expect(await a.read('only-in-fallback')).toEqual({ from: 'fallback' });
    expect(await a.read('only-in-primary')).toEqual({ from: 'primary' });
    expect(await a.read('in-both')).toEqual({ from: 'primary' }); // primary wins
    expect(await a.read('missing')).toBeNull();
  });

  it('fires onMigration with size reason on threshold crossing', async () => {
    const onMigration = vi.fn();
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100, onMigration });
    await a.write('k', { __v: 1, values: { x: 'x'.repeat(500) } });
    expect(onMigration).toHaveBeenCalledWith('k', 'size');
  });

  it('clear() invokes clear on both adapters', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 1_000_000 });
    primary._state.set('k', 1);
    fallback._state.set('k', 2);
    await a.clear?.();
    expect(primary._state.size).toBe(0);
    expect(fallback._state.size).toBe(0);
  });

  it('remove() surfaces underlying errors (no silent swallow)', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 1_000_000 });
    primary._state.set('k', 1);
    primary.remove = async () => {
      throw new Error('primary remove broke');
    };
    await expect(a.remove('k')).rejects.toThrow('primary remove broke');
  });

  it('clear() waits for in-flight per-key writes before clearing', async () => {
    // Audit round-2 HIGH (N1): a write resolving AFTER clear() could
    // re-populate the store. Verify clear blocks on pending queues.
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100 });
    // Slow down fallback.write so it resolves AFTER we begin clear()
    let resolveGate: () => void;
    const gate = new Promise<void>((r) => { resolveGate = r; });
    fallback.writeImpl = async (key, value) => {
      await gate;
      fallback._state.set(key, value);
    };
    const writeP = a.write('k', { __v: 1, values: { x: 'x'.repeat(500) } });
    // Yield so the write task enters its await on the gate before we clear
    await Promise.resolve();
    const clearP = a.clear?.();
    // Release the write
    resolveGate!();
    await Promise.all([writeP, clearP].filter(Boolean));
    // Store should be empty; write must not have outlived clear
    expect(fallback._state.size).toBe(0);
    expect(primary._state.size).toBe(0);
  });

  it('write fired DURING clear() lands AFTER the clear completes (not before)', async () => {
    // Round-3 audit: with only the snapshot-and-wait pattern, a write
    // submitted while clear() was awaiting allSettled would see empty
    // queues, run immediately, and be wiped by adapter.clear(). Verify
    // the clearing-barrier serializes the new write behind us.
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100 });

    // Slow down adapter.clear so a write can sneak in during the wait.
    let releaseClear: () => void;
    const clearGate = new Promise<void>((r) => { releaseClear = r; });
    primary.clear = async () => {
      await clearGate;
      primary._state.clear();
    };

    const clearP = a.clear?.();
    // While clear() is suspended awaiting clearGate, fire a write.
    await Promise.resolve();
    const writeP = a.write('after-clear', { __v: 1, values: { x: 'survives' } });
    // Allow the in-flight write to enter runSerialized + sit on `clearing`.
    await Promise.resolve();
    // Release clear so it can finish.
    releaseClear!();
    await Promise.all([clearP, writeP].filter(Boolean));
    // The write's data must survive the clear.
    expect(await a.read('after-clear')).toEqual({ __v: 1, values: { x: 'survives' } });
  });

  it('concurrent clear() calls chain (write between them survives both)', async () => {
    // Round-4 audit: clear2 used to install a new `clearing` independent of
    // clear1's. A write queued behind clear2 (already resolved fast-path)
    // could land before clear1's still-pending adapter.clear wiped it.
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100 });

    // Hold fallback.write so clear1's drain stalls.
    let releaseWrite: () => void;
    const writeGate = new Promise<void>((r) => { releaseWrite = r; });
    fallback.writeImpl = async (key, value) => {
      await writeGate;
      fallback._state.set(key, value);
    };

    // Track when clear1's adapter.clear runs so we can prove it runs AFTER
    // a subsequent write submitted between clear1 and clear2.
    let clearCalls = 0;
    const realPrimaryClear = primary.clear?.bind(primary);
    primary.clear = async () => {
      clearCalls++;
      await realPrimaryClear?.();
    };

    const slowWriteP = a.write('w0', { __v: 1, values: { x: 'x'.repeat(500) } });
    await Promise.resolve();

    // clear1 starts; suspends waiting for w0 to drain.
    const clear1P = a.clear?.();
    // clear2 follows immediately; must chain on clear1.
    const clear2P = a.clear?.();
    // A write after both clears must land AFTER both complete.
    const w1P = a.write('w1', { __v: 1, values: { x: 'survives' } });

    // Release the original write so clear1 can drain.
    releaseWrite!();
    await Promise.all([slowWriteP, clear1P, clear2P, w1P].filter(Boolean));

    expect(clearCalls).toBe(2); // both clears called primary.clear
    expect(await a.read('w1')).toEqual({ __v: 1, values: { x: 'survives' } });
    expect(await a.read('w0')).toBeNull(); // cleared
  });

  it('read() awaits in-flight clear so it cannot observe a mid-wipe state', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 1_000_000 });
    await a.write('k', { value: 'before' });

    // Slow primary.clear so a read mid-clear would see post-primary, pre-fallback state
    let releaseClear: () => void;
    const gate = new Promise<void>((r) => { releaseClear = r; });
    primary.clear = async () => {
      await gate;
      primary._state.clear();
    };

    const clearP = a.clear?.();
    // Read concurrently — must wait for clearing barrier
    const readP = a.read('k');
    // Let clear proceed
    releaseClear!();
    await Promise.all([clearP, readP].filter(Boolean));
    // Read must see post-clear state (null), not mid-wipe ghost
    expect(await readP).toBeNull();
  });

  it('best-effort cleanup: primary.remove failure does not block fallback write', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100 });
    primary._state.set('k', { stale: true });
    primary.remove = async () => {
      throw new Error('primary remove broke');
    };
    const big = { __v: 1, values: { x: 'x'.repeat(500) } };
    // Should still complete and write to fallback
    await expect(a.write('k', big)).resolves.toBeUndefined();
    expect(fallback._state.get('k')).toEqual(big);
  });

  it('serializes concurrent writes to the same key (no race-driven data loss)', async () => {
    // Without per-key serialization, big+small interleaved writes can leave
    // the store empty: big's fallback.write + small's primary.write succeed,
    // then small's trailing fallback.remove deletes big's data AND big's
    // trailing primary.remove deletes small's data. Both writes "succeeded"
    // yet the read returns null.
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100 });
    const big = { __v: 1, values: { x: 'x'.repeat(500) } };
    const small = { __v: 1, values: { x: 'hi' } };
    // Fire both without awaiting
    const p1 = a.write('k', big);
    const p2 = a.write('k', small);
    await Promise.all([p1, p2]);
    // The LAST write to enter the queue wins — small. Verify state matches.
    expect(await a.read('k')).toEqual(small);
    expect(primary._state.has('k')).toBe(true);
    expect(fallback._state.has('k')).toBe(false);
  });

  it('serializes write then remove (no orphan fallback entry)', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100 });
    const big = { __v: 1, values: { x: 'x'.repeat(500) } };
    const pWrite = a.write('k', big);
    const pRemove = a.remove('k');
    await Promise.all([pWrite, pRemove]);
    expect(await a.read('k')).toBeNull();
    expect(primary._state.has('k')).toBe(false);
    expect(fallback._state.has('k')).toBe(false);
  });

  it('payload exactly at threshold goes to primary (not fallback)', async () => {
    // Strictly-greater-than semantics: size === threshold stays on primary.
    const value = { v: 'x'.repeat(20) };
    const serializedLen = JSON.stringify(value).length;
    const a = autoAdapter({ primary, fallback, thresholdBytes: serializedLen });
    await a.write('k', value);
    expect(primary._state.has('k')).toBe(true);
    expect(fallback._state.has('k')).toBe(false);
  });

  it('rejects when primary and fallback are the same adapter instance', () => {
    expect(() => autoAdapter({ primary, fallback: primary })).toThrow(/distinct adapters/);
  });

  it('circular references throw cleanly (no infinite loop)', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100 });
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    await expect(a.write('k', circ)).rejects.toThrow(/circular|cyclic/i);
  });

  it('fallback.write failure surfaces the underlying error', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100 });
    fallback.writeImpl = async () => {
      throw new Error('IDB private mode');
    };
    const big = { __v: 1, values: { x: 'x'.repeat(500) } };
    await expect(a.write('k', big)).rejects.toThrow('IDB private mode');
    // Primary stays untouched
    expect(primary._state.has('k')).toBe(false);
  });

  it('partial-failure migration: stale primary returned until next write fixes it', async () => {
    // Pin the documented trade-off: when fallback.write succeeds but
    // primary.remove throws, read() returns the OLD primary value.
    const a = autoAdapter({ primary, fallback, thresholdBytes: 100 });
    // First, put a small value into primary
    await a.write('k', { __v: 1, values: { x: 'old' } });
    expect(primary._state.has('k')).toBe(true);
    // Now simulate primary.remove failure on next migration
    primary.remove = async () => {
      throw new Error('primary remove broke');
    };
    await a.write('k', { __v: 1, values: { x: 'x'.repeat(500) } });
    // Read returns STALE primary value because primary.remove failed
    expect(await a.read('k')).toEqual({ __v: 1, values: { x: 'old' } });
  });

  it('does not match unrelated errors that happen to contain "quota" in message', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 1_000_000 });
    // Custom adapter throws an error with "quota" in the message but with
    // a different name and no code — should propagate, NOT migrate.
    primary.writeImpl = async () => {
      throw new TypeError('exceeded quota_test_var');
    };
    await expect(a.write('k', { foo: 1 })).rejects.toThrow('exceeded quota_test_var');
    expect(fallback._state.has('k')).toBe(false);
  });

  it('matches DOMException with code 22 (Safari quota) as quota', async () => {
    const a = autoAdapter({ primary, fallback, thresholdBytes: 1_000_000 });
    primary.writeImpl = async () => {
      const err = new Error('quota') as Error & { code: number };
      err.code = 22;
      throw err;
    };
    await a.write('k', { foo: 1 });
    expect(fallback._state.get('k')).toEqual({ foo: 1 });
  });

  it('uses default localStorage primary + indexedDB fallback when no options', async () => {
    // Smoke test that default construction works (delegates to real adapters)
    const a = autoAdapter();
    expect(a.name).toBe('auto');
    expect(typeof a.read).toBe('function');
    expect(typeof a.write).toBe('function');
    expect(typeof a.remove).toBe('function');
  });
});
