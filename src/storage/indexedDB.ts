import type { StorageAdapter } from '../types';

const DB_NAME = 'formdraft';
const STORE_NAME = 'drafts';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
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
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  return getDb().then(
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
}

export function indexedDBAdapter(): StorageAdapter {
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

export function _resetIndexedDBForTests(): void {
  dbPromise = null;
}
