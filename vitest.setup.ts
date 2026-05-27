import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';

// Clear spy call records between tests so per-test spy state doesn't leak.
// clearAllMocks (not restoreAllMocks/resetAllMocks) preserves the module-level
// console.error filter installed below; restoring/resetting it would re-surface
// React 18's "not wrapped in act" warnings or drop the filter entirely.
afterEach(() => {
  vi.clearAllMocks();
});

// jsdom does not implement BroadcastChannel. Provide a same-realm shim that
// mirrors the real browser's ASYNC microtask dispatch — earlier sync version
// hid every race between postMessage and a subsequent state update.
{
  const channels = new Map<string, Set<MockChannel>>();

  class MockChannel {
    readonly name: string;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onmessageerror: ((ev: MessageEvent) => void) | null = null;
    private listeners = new Set<(ev: MessageEvent) => void>();
    private closed = false;

    constructor(name: string) {
      this.name = name;
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name)!.add(this);
    }

    postMessage(data: unknown): void {
      if (this.closed) return;
      const others = channels.get(this.name);
      if (!others) return;
      const cloned = structuredClone(data);
      // Snapshot the receivers before the microtask so a close() during
      // dispatch can't mutate the iteration.
      const recipients = Array.from(others).filter((ch) => ch !== this && !ch.closed);
      queueMicrotask(() => {
        for (const ch of recipients) {
          if (ch.closed) continue;
          const ev = new MessageEvent('message', { data: cloned });
          ch.onmessage?.(ev);
          ch.listeners.forEach((l) => l(ev));
        }
      });
    }

    addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void {
      if (type === 'message') this.listeners.add(listener);
    }

    removeEventListener(type: 'message', listener: (ev: MessageEvent) => void): void {
      if (type === 'message') this.listeners.delete(listener);
    }

    close(): void {
      this.closed = true;
      channels.get(this.name)?.delete(this);
    }
  }

  (globalThis as { BroadcastChannel: typeof MockChannel }).BroadcastChannel = MockChannel;
}

// Mock navigator.onLine; default to true.
Object.defineProperty(navigator, 'onLine', {
  configurable: true,
  get: () => (globalThis as { __onLine?: boolean }).__onLine ?? true,
});

export function setOnline(online: boolean): void {
  (globalThis as { __onLine?: boolean }).__onLine = online;
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

// Silence React 18 jsdom act() warnings in tests.
vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
  if (typeof msg === 'string' && msg.includes('not wrapped in act')) return;
  // pass-through other errors
  // eslint-disable-next-line no-console
  console.warn(msg);
});
