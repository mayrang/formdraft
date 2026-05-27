import { beforeEach, describe, expect, it } from 'vitest';
import { sessionStorageAdapter } from '../sessionStorage';

describe('sessionStorageAdapter', () => {
  beforeEach(() => sessionStorage.clear());

  it('write + read roundtrips', async () => {
    const a = sessionStorageAdapter();
    await a.write('k', { x: 1 });
    expect(await a.read('k')).toEqual({ x: 1 });
  });

  it('read returns null for missing key', async () => {
    expect(await sessionStorageAdapter().read('missing')).toBeNull();
  });

  it('remove deletes the key', async () => {
    const a = sessionStorageAdapter();
    await a.write('k', { x: 1 });
    await a.remove('k');
    expect(await a.read('k')).toBeNull();
  });

  it('namespaces with formdraft prefix in sessionStorage', async () => {
    const a = sessionStorageAdapter();
    await a.write('mykey', { x: 1 });
    expect(sessionStorage.getItem('formdraft:mykey')).not.toBeNull();
  });
});
