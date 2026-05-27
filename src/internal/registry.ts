import type { StatusMachine } from './statusMachine';

export type RegistryEntry = {
  statusMachine: StatusMachine;
  lastSavedAt: Date | null;
};

const entries = new Map<string, RegistryEntry>();
const subscribers = new Map<string, Set<() => void>>();

export function registerDraft(key: string, entry: RegistryEntry): void {
  entries.set(key, entry);
  subscribers.get(key)?.forEach((cb) => cb());
}

export function getDraft(key: string): RegistryEntry | undefined {
  return entries.get(key);
}

export function unregisterDraft(key: string): void {
  entries.delete(key);
  subscribers.get(key)?.forEach((cb) => cb());
}

export function subscribeRegistry(key: string, listener: () => void): () => void {
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key)!.add(listener);
  return () => {
    subscribers.get(key)?.delete(listener);
  };
}

export function _clearRegistryForTests(): void {
  entries.clear();
  subscribers.clear();
}
