import type { BroadcastMessage } from '../types';
import { safeStructuredClone } from './safeStructuredClone';

export type BroadcasterOptions = {
  key: string;
  tabId: string;
  protocolVersion?: number;
};

export type Broadcaster<T> = {
  broadcastValues(values: T): void;
  broadcastSubmitted(): void;
  broadcastDiscarded(): void;
  onValuesChanged(handler: (values: T, ts: number) => void): void;
  onSubmitted(handler: () => void): void;
  onDiscarded(handler: () => void): void;
  close(): void;
};

const CHANNEL_PREFIX = 'formdraft:';

export function createBroadcaster<T>(opts: BroadcasterOptions): Broadcaster<T> {
  const protocolVersion = opts.protocolVersion ?? 1;
  let channel: BroadcastChannel | null = null;
  const valuesHandlers: ((values: T, ts: number) => void)[] = [];
  const submittedHandlers: (() => void)[] = [];
  const discardedHandlers: (() => void)[] = [];

  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_PREFIX + opts.key);
    channel.onmessage = (ev: MessageEvent<BroadcastMessage<T>>) => {
      const msg = ev.data;
      if (!msg || msg.tabId === opts.tabId) return;
      // All message types carry `version`; mismatch means cross-version tabs.
      // Drop silently — including submitted/discarded — so an old tab can't
      // wipe a new tab's draft via a control message it doesn't understand.
      if ((msg as { version?: number }).version !== protocolVersion) return;
      if (msg.type === 'values-changed') {
        valuesHandlers.forEach((h) => h(msg.values, msg.ts));
      } else if (msg.type === 'submitted') {
        submittedHandlers.forEach((h) => h());
      } else if (msg.type === 'discarded') {
        discardedHandlers.forEach((h) => h());
      }
    };
    channel.onmessageerror = (ev) => {
      // eslint-disable-next-line no-console
      console.warn('[formdraft] broadcaster failed to deserialize a remote message:', ev);
    };
  }

  return {
    broadcastValues(values) {
      if (!channel) return;
      let cloned: T;
      try {
        cloned = safeStructuredClone(values);
      } catch (e) {
        // Values contain non-cloneable content (function, Symbol, DOM node, …).
        // Skip the broadcast — local persist still works — and warn once.
        // eslint-disable-next-line no-console
        console.warn('[formdraft] broadcaster: values not cloneable; skipping broadcast:', e);
        return;
      }
      const msg: BroadcastMessage<T> = {
        type: 'values-changed',
        tabId: opts.tabId,
        key: opts.key,
        values: cloned,
        ts: Date.now(),
        version: protocolVersion,
      };
      try {
        channel.postMessage(msg);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[formdraft] broadcaster postMessage failed:', e);
      }
    },
    broadcastSubmitted() {
      if (!channel) return;
      channel.postMessage({ type: 'submitted', tabId: opts.tabId, key: opts.key, version: protocolVersion });
    },
    broadcastDiscarded() {
      if (!channel) return;
      channel.postMessage({ type: 'discarded', tabId: opts.tabId, key: opts.key, version: protocolVersion });
    },
    onValuesChanged(handler) {
      valuesHandlers.push(handler);
    },
    onSubmitted(handler) {
      submittedHandlers.push(handler);
    },
    onDiscarded(handler) {
      discardedHandlers.push(handler);
    },
    close() {
      channel?.close();
      channel = null;
      valuesHandlers.length = 0;
      submittedHandlers.length = 0;
      discardedHandlers.length = 0;
    },
  };
}
