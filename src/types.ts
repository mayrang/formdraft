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

/**
 * Schema validator interface. The `__formdraft` brand prevents raw Zod
 * schemas (which structurally match `.parse` / `.safeParse`) from silently
 * satisfying this type — users must go through `zodAdapter(schema)` so the
 * adapter can normalize ZodError → Error and add any future shape changes.
 *
 * To write a custom adapter (yup, valibot, hand-rolled), include
 * `__formdraft: true` literally on the returned object.
 */
export type SchemaValidator<T> = {
  readonly __formdraft: true;
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
  // Probe called before each sync attempt to detect captive-portal /
  // lying-network states where navigator.onLine === true but real
  // reachability fails. Return false to defer the sync (it will retry on
  // the next online/visibility event or when save() is called). Throwing
  // is treated as `false`. Keep the probe cheap — it runs on every
  // attempt, including retries.
  connectivityProbe?: () => Promise<boolean>;
};

export type FormDraftResult<T> = {
  /**
   * Current form values. Read-only at the type level — mutate via `set()` or
   * `patch()`. Direct mutation (`draft.values.name = 'X'`) would bypass the
   * persist/sync pipeline and cause silent state drift.
   */
  readonly values: Readonly<T>;
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
