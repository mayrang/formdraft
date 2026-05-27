import { beforeEach, describe, expect, it } from 'vitest';
import { indexedDBAdapter, _resetIndexedDBForTests } from '../indexedDB';

describe('indexedDBAdapter', () => {
  beforeEach(async () => {
    _resetIndexedDBForTests();
    const a = indexedDBAdapter();
    if (a.clear) await a.clear();
  });

  it('write + read roundtrips a deep object', async () => {
    const a = indexedDBAdapter();
    const payload = { a: 1, nested: { b: [1, 2, 3], c: 'hi' } };
    await a.write('k', payload);
    expect(await a.read('k')).toEqual(payload);
  });

  it('read returns null for missing key', async () => {
    const a = indexedDBAdapter();
    expect(await a.read('missing')).toBeNull();
  });

  it('remove deletes the key', async () => {
    const a = indexedDBAdapter();
    await a.write('k', { x: 1 });
    await a.remove('k');
    expect(await a.read('k')).toBeNull();
  });

  it('clear deletes all keys', async () => {
    const a = indexedDBAdapter();
    await a.write('k1', 1);
    await a.write('k2', 2);
    if (a.clear) await a.clear();
    expect(await a.read('k1')).toBeNull();
    expect(await a.read('k2')).toBeNull();
  });

  it('handles binary blobs (e.g., base64 strings of 1MB)', async () => {
    const a = indexedDBAdapter();
    const big = 'x'.repeat(1024 * 1024);
    await a.write('big', big);
    expect(await a.read('big')).toBe(big);
  });
});
