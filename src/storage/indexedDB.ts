import type { StorageAdapter } from '../types';

const DB_NAME = 'formdraft';
const STORE_NAME = 'drafts';
const DB_VERSION = 1;

/**
 * Returns a fresh IndexedDB adapter. The DB connection promise is held inside
 * the closure, not at module scope — so each call yields an independent
 * adapter and tests get a clean slate without needing a public reset helper.
 * In typical use, callers create one adapter per form and pass it via
 * `storage: indexedDBAdapter()`.
 */
export function indexedDBAdapter(): StorageAdapter {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const getDb = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    const p = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // If open fails (Firefox private mode, version mismatch), don't cache the
    // rejection forever — next call should re-attempt.
    p.catch(() => {
      if (dbPromise === p) dbPromise = null;
    });
    dbPromise = p;
    return p;
  };

  const tx = <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T> | void,
  ): Promise<T | void> =>
    getDb().then(
      (db) =>
        new Promise<T | void>((resolve, reject) => {
          const transaction = db.transaction(STORE_NAME, mode);
          const store = transaction.objectStore(STORE_NAME);
          const req = fn(store);
          transaction.oncomplete = () => resolve(req?.result as T | undefined);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        }),
    );

  return {
    name: 'indexedDB',
    async read(key) {
      const result = await tx<unknown>('readonly', (store) => store.get(key));
      return result === undefined ? null : (result as unknown);
    },
    async write(key, value) {
      await tx('readwrite', (store) => store.put(value, key));
    },
    async remove(key) {
      await tx('readwrite', (store) => store.delete(key));
    },
    async clear() {
      await tx('readwrite', (store) => store.clear());
    },
  };
}
