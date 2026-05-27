export { useFormDraft } from './useFormDraft';
export { useFormDraftStatus } from './useFormDraftStatus';
export { getFormDraft } from './getFormDraft';
export type { FormDraftHandle } from './getFormDraft';
export { zodAdapter } from './internal/schemaValidation';
export { localStorageAdapter } from './storage/localStorage';
export { sessionStorageAdapter } from './storage/sessionStorage';
export { indexedDBAdapter } from './storage/indexedDB';
export { autoAdapter } from './storage/auto';
export { createHeartbeatDetector } from './internal/heartbeatDetector';

export type {
  FormDraftStatus,
  StorageAdapter,
  SchemaValidator,
  RetryConfig,
  MultiTabStrategy,
  FormDraftOptions,
  FormDraftResult,
} from './types';
export type { AutoAdapterOptions } from './storage/auto';
export type {
  OnlineDetector,
  HeartbeatDetectorOptions,
} from './internal/heartbeatDetector';
