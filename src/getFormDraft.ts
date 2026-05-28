import { getDraft } from './internal/registry';
import type { FormDraftStatus } from './types';

/**
 * Imperative handle to a mounted `useFormDraft` instance, addressable by key
 * from anywhere — including code outside React (event listeners, route
 * guards, etc.) and components that didn't call the hook themselves.
 *
 * Action methods (`save`, `discard`, `submit`) trigger the hook's behavior.
 * Getter methods return CURRENT snapshots, not subscriptions — if you want
 * to re-render on changes inside a component, use `useFormDraftStatus(key)`
 * instead. The handle becomes stale (and `getFormDraft` returns `undefined`)
 * when the host component unmounts.
 */
export type FormDraftHandle<T = unknown> = {
  save: () => Promise<void>;
  discard: () => void;
  submit: <R>(
    handler: (values: T) => Promise<R>,
  ) => (e?: { preventDefault?: () => void }) => Promise<R | undefined>;
  getStatus: () => FormDraftStatus;
  getLastSavedAt: () => Date | null;
  getValues: () => T;
  getPendingChanges: () => boolean;
  getError: () => Error | null;
  /**
   * Snapshot of `excludeFields` that need re-entry after a restore. See
   * `FormDraftResult.fieldsNeedingReentry` for semantics.
   */
  getFieldsNeedingReentry: () => ReadonlyArray<keyof T & string>;
};

/**
 * Look up a live `useFormDraft` instance by its `key` for imperative use.
 * Returns `undefined` if no instance with that key is currently mounted.
 *
 *   const handle = getFormDraft<MyFormValues>('profile-form');
 *   if (handle?.getPendingChanges()) {
 *     // ... show "unsaved changes" warning
 *   }
 *   await handle?.save();
 *
 * Typical use cases: nav guards (beforeunload), header buttons outside the
 * form, auto-discard timers, dev-tools panels.
 */
export function getFormDraft<T = unknown>(
  key: string,
): FormDraftHandle<T> | undefined {
  const entry = getDraft(key);
  if (!entry) return undefined;
  return {
    save: () => entry.saveRef.current(),
    discard: () => entry.discardRef.current(),
    submit: <R>(handler: (values: T) => Promise<R>) =>
      entry.submitRef.current(handler as (v: unknown) => Promise<R>),
    getStatus: () => entry.statusMachine.getStatus(),
    getLastSavedAt: () => entry.lastSavedAtRef.current,
    getValues: () => entry.valuesRef.current as T,
    getPendingChanges: () => entry.pendingChangesRef.current,
    getError: () => entry.errorRef.current,
    getFieldsNeedingReentry: () =>
      entry.fieldsNeedingReentryRef.current as ReadonlyArray<keyof T & string>,
  };
}
