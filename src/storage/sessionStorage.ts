import type { StorageAdapter } from '../types';

const PREFIX = 'formdraft:';

export function sessionStorageAdapter(): StorageAdapter {
  return {
    name: 'sessionStorage',
    async read(key) {
      const raw = sessionStorage.getItem(PREFIX + key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[formdraft] sessionStorage adapter: invalid JSON for key "${key}". Discarding.`, e);
        return null;
      }
    },
    async write(key, value) {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
    },
    async remove(key) {
      sessionStorage.removeItem(PREFIX + key);
    },
  };
}
