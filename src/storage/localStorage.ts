import type { StorageAdapter } from '../types';

const PREFIX = 'formdraft:';

export function localStorageAdapter(): StorageAdapter {
  return {
    name: 'localStorage',
    async read(key) {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[formdraft] localStorage adapter: invalid JSON for key "${key}". Discarding.`, e);
        return null;
      }
    },
    async write(key, value) {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    async remove(key) {
      localStorage.removeItem(PREFIX + key);
    },
    async clear() {
      const remove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) remove.push(k);
      }
      remove.forEach((k) => localStorage.removeItem(k));
    },
  };
}
