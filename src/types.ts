export type FormDraftStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'error'
  | 'conflict';

export type StorageAdapter = {
  name: string;
  read(key: string): Promise<unknown | null>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  clear?(): Promise<void>;
};

export type SchemaValidator<T> = {
  parse(input: unknown): T;
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: Error };
};

export type RetryConfig = {
  maxAttempts: number;
  initialBackoffMs: number;
  multiplier: number;
  maxBackoffMs: number;
};

export type MultiTabStrategy = 'warn' | 'last-writer-wins' | 'manual' | false;

export type FormDraftOptions<T> = {
  key: string;
  schema: SchemaValidator<T>;
  defaultValues: T;
  storage?: StorageAdapter;
  sync?: (values: T) => Promise<void>;
  syncDebounceMs?: number;
  syncRetry?: Partial<RetryConfig>;
  multiTab?: MultiTabStrategy;
  onConflict?: (local: T, remote: T) => 'local' | 'remote' | T;
  onSyncError?: (error: Error, attempt: number) => void;
  excludeFields?: Array<keyof T>;
  version?: number;
  migrate?: (stored: unknown, fromVersion: number) => T | null;
  disabled?: boolean;
};

export type FormDraftResult<T> = {
  values: T;
  set<K extends keyof T>(field: K, value: T[K]): void;
  patch(partial: Partial<T>): void;
  status: FormDraftStatus;
  lastSavedAt: Date | null;
  pendingChanges: boolean;
  error: Error | null;
  save: () => Promise<void>;
  discard: () => void;
  submit: <R>(handler: (values: T) => Promise<R>) => (e?: { preventDefault?: () => void }) => Promise<R | undefined>;
  onConflictData: T | null;
  resolveConflict: (choice: 'local' | 'remote' | T) => void;
};

export type BroadcastMessage<T = unknown> =
  | { type: 'values-changed'; tabId: string; key: string; values: T; ts: number; version: number }
  | { type: 'submitted'; tabId: string; key: string; version: number }
  | { type: 'discarded'; tabId: string; key: string; version: number };
