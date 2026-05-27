import type { FormDraftStatus } from '../types';

export type StatusEvent =
  | 'SAVE_START'
  | 'SAVE_SUCCESS'
  | 'SAVE_FAIL'
  | 'OFFLINE'
  | 'ONLINE'
  | 'CONFLICT'
  | 'RESOLVE'
  | 'RESET';

const transitions: Record<FormDraftStatus, Partial<Record<StatusEvent, FormDraftStatus>>> = {
  idle: {
    SAVE_START: 'saving',
    SAVE_FAIL: 'error', // persist failures happen outside of saving (storage quota etc.)
    OFFLINE: 'offline',
    CONFLICT: 'conflict',
  },
  saving: {
    SAVE_SUCCESS: 'saved',
    SAVE_FAIL: 'error',
    OFFLINE: 'offline',
    CONFLICT: 'conflict',
  },
  saved: {
    SAVE_START: 'saving',
    SAVE_FAIL: 'error',
    OFFLINE: 'offline',
    CONFLICT: 'conflict',
    RESET: 'idle',
  },
  offline: {
    ONLINE: 'idle',
    CONFLICT: 'conflict',
  },
  error: {
    SAVE_START: 'saving',
    OFFLINE: 'offline',
    CONFLICT: 'conflict',
    RESET: 'idle',
  },
  // No SAVE_START exit: an in-flight sync must NOT silently mask a conflict
  // warning the user hasn't acknowledged. RESOLVE is the only exit.
  conflict: {
    RESOLVE: 'idle',
    RESET: 'idle',
  },
};

export type StatusMachine = {
  getStatus(): FormDraftStatus;
  send(event: StatusEvent): void;
  subscribe(listener: () => void): () => void;
};

export function createStatusMachine(): StatusMachine {
  let current: FormDraftStatus = 'idle';
  const listeners = new Set<() => void>();

  return {
    getStatus: () => current,
    send: (event) => {
      const next = transitions[current][event];
      if (next === undefined || next === current) return;
      current = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
