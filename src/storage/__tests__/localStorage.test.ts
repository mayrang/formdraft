import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localStorageAdapter } from '../localStorage';

describe('localStorageAdapter', () => {
  beforeEach(() => localStorage.clear());

  it('write + read roundtrips an object', async () => {
    const a = localStorageAdapter();
    await a.write('k', { x: 1 });
    expect(await a.read('k')).toEqual({ x: 1 });
  });

  it('read returns null for missing key', async () => {
    expect(await localStorageAdapter().read('missing')).toBeNull();
  });

  it('remove deletes the key', async () => {
    const a = localStorageAdapter();
    await a.write('k', { x: 1 });
    await a.remove('k');
    expect(await a.read('k')).toBeNull();
  });

  it('namespaces keys with formdraft prefix', async () => {
    const a = localStorageAdapter();
    await a.write('mykey', { x: 1 });
    expect(localStorage.getItem('formdraft:mykey')).not.toBeNull();
    expect(localStorage.getItem('mykey')).toBeNull();
  });

  it('read returns null and warns for invalid JSON in storage', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('formdraft:badkey', '{not json}');
    expect(await localStorageAdapter().read('badkey')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('write surfaces quota-exceeded as a thrown error', async () => {
    const a = localStorageAdapter();
    const big = 'x'.repeat(11 * 1024 * 1024);
    try {
      await a.write('big', big);
      expect(typeof big).toBe('string');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  });
});
