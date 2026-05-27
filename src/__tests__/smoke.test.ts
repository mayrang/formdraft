import { describe, expect, it } from 'vitest';
import { setOnline } from '../../vitest.setup';

describe('vitest harness', () => {
  it('jsdom is available', () => {
    expect(typeof document).toBe('object');
  });

  it('BroadcastChannel shim works between two channels', () => {
    const received: unknown[] = [];
    const a = new BroadcastChannel('test');
    const b = new BroadcastChannel('test');
    b.onmessage = (ev) => received.push(ev.data);
    a.postMessage({ x: 1 });
    expect(received).toEqual([{ x: 1 }]);
    a.close();
    b.close();
  });

  it('navigator.onLine can be toggled', () => {
    setOnline(false);
    expect(navigator.onLine).toBe(false);
    setOnline(true);
    expect(navigator.onLine).toBe(true);
  });

  it('fake-indexeddb is wired', async () => {
    expect(typeof indexedDB).toBe('object');
    const req = indexedDB.open('test-db', 1);
    await new Promise<void>((resolve) => {
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onupgradeneeded = () => req.result.createObjectStore('s');
    });
    req.result.close();
  });
});
