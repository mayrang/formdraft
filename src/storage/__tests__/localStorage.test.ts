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

  it('read returns null and warns for invalid JSON in storage; removes the bad entry', async () => {
    // Regression: previously the bad entry stayed in storage, so every mount
    // re-parsed and re-warned. Now read() removes it once.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('formdraft:badkey', '{not json}');
    expect(await localStorageAdapter().read('badkey')).toBeNull();
    expect(localStorage.getItem('formdraft:badkey')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('write surfaces QuotaExceededError as a thrown error', async () => {
    // JSDOM doesn't enforce localStorage quota, so simulating "write 11MB"
    // silently succeeds and proves nothing. Force-throw setItem to verify
    // the adapter actually propagates the error instead of swallowing it.
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });
    const a = localStorageAdapter();
    await expect(a.write('big', { x: 1 })).rejects.toThrow(/QuotaExceeded/);
    spy.mockRestore();
  });
});
