import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '@tanstack/react-form';
import type { FormDraftOptions } from '../types';
import { useFormDraft } from '../useFormDraft';

/**
 * TanStack Form adapter — wraps a `useForm(...)` instance with formdraft's
 * persistence, sync queue, and multi-tab coordination. Mirrors the
 * `useFormDraftRHF` / `useFormDraftFormik` shape.
 *
 *   const form = useForm({ defaultValues: { name: '' }, onSubmit });
 *   const { status, lastSavedAt, discard } = useFormDraftTanstack(form, {
 *     key: 'profile-form',
 *     schema: zodAdapter(Schema),
 *     sync: api.saveProfile,
 *   });
 *
 * Restore happens once on mount when storage has a valid draft AND the user
 * hasn't already started typing. Restore writes use `dontValidate: true` (to
 * skip onChange validators against text the user never typed) but DO update
 * field meta — see the long comment on the restore effect for why
 * `dontUpdateMeta` would silently wipe restored data on the next render.
 */
// We intentionally accept the form via a loose interface here —
// `ReactFormExtendedApi`'s 12 generic parameters are not worth surfacing
// through this adapter. Internal type-safety is recovered by `T`.
type TanstackUpdateMetaOptions = { dontUpdateMeta?: boolean; dontValidate?: boolean };
type TanstackFormApi<T> = {
  options: { defaultValues?: T };
  store: unknown;
  setFieldValue: (field: string, value: unknown, opts?: TanstackUpdateMetaOptions) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reset: (values?: T, opts?: any) => void;
};

export function useFormDraftTanstack<T extends Record<string, unknown>>(
  form: TanstackFormApi<T>,
  options: Omit<FormDraftOptions<T>, 'defaultValues'>,
): {
  status: ReturnType<typeof useFormDraft<T>>['status'];
  lastSavedAt: ReturnType<typeof useFormDraft<T>>['lastSavedAt'];
  pendingChanges: ReturnType<typeof useFormDraft<T>>['pendingChanges'];
  error: ReturnType<typeof useFormDraft<T>>['error'];
  save: ReturnType<typeof useFormDraft<T>>['save'];
  discard: ReturnType<typeof useFormDraft<T>>['discard'];
  onConflictData: ReturnType<typeof useFormDraft<T>>['onConflictData'];
  resolveConflict: ReturnType<typeof useFormDraft<T>>['resolveConflict'];
} {
  const defaultValues = (form.options.defaultValues ?? ({} as T)) as T;
  const draft = useFormDraft<T>({
    ...options,
    defaultValues,
  });

  // TanStack Form holds state in a TanStack Store. useStore subscribes to a
  // selector slice and re-renders the consuming component when it changes.
  // Reference is stable until the underlying slice changes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formValues = useStore(form.store as any, (s: any) => s.values) as T;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isDirty = useStore(form.store as any, (s: any) => s.isDirty) as boolean;

  // Sticky "user has touched the form" flag — sticky for the same reason
  // as the Formik adapter: form.isDirty flips false again when the user
  // deletes their input back to defaults, but the deletion still needs to
  // be persisted (otherwise stale stored draft survives forever).
  const userTouchedRef = useRef(false);

  // Set by the restore effect right before pushing values into the form.
  // The value-watcher effect runs next, sees this flag, skips its patch
  // (the restore is not user input), and resets the flag.
  const ignoreNextRef = useRef(false);

  const hasRestoredRef = useRef(false);
  const initialDraftValuesRef = useRef(draft.values);
  const originalDefaultsRef = useRef<T>(defaultValues);
  const formRef = useRef(form);
  formRef.current = form;

  // Watch form values + isDirty; patch the draft for persistence.
  useEffect(() => {
    if (ignoreNextRef.current) {
      ignoreNextRef.current = false;
      return;
    }
    if (isDirty) userTouchedRef.current = true;
    if (!userTouchedRef.current) return;
    draft.patch(formValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formValues, isDirty]);

  // When draft.values changes from its initial reference, storage has been
  // asynchronously restored. Push the stored values into the form exactly
  // once, but only if the user hasn't already started typing.
  useEffect(() => {
    if (hasRestoredRef.current) return;
    if (draft.values === initialDraftValuesRef.current) return;
    if (isDirty) {
      // User typed before restore landed — useFormDraft's own
      // userTouchedRef prevents the stored data from reaching draft.values
      // in this case, so we never need to restore. Latch hasRestoredRef so
      // subsequent draft.patch updates don't re-enter this branch.
      hasRestoredRef.current = true;
      return;
    }
    hasRestoredRef.current = true;
    ignoreNextRef.current = true;
    // Push each top-level key via setFieldValue. `dontValidate: true` skips
    // field-level onChange validators (we don't want errors painted on the
    // restored value just for being non-default at mount).
    //
    // We INTENTIONALLY do NOT pass `dontUpdateMeta`. With dontUpdateMeta,
    // per-field `isTouched` stays false → on the next render, TanStack's
    // FieldApi.update overwrites the value back to `opts.defaultValue`
    // (the field's own defaultValue prop) because the reseed condition
    // `!isTouched && opts.defaultValue !== undefined` matches. The
    // common idiomatic `<form.Field name="x" defaultValue="">` would then
    // silently wipe the restored data on every render.
    // setFieldValue replaces the entire subtree at that key, so nested
    // objects are handled by passing the whole sub-object as the value.
    //
    // Filter against originalDefaults so a stored draft from a previous
    // schema version with extra keys can't be forwarded to setFieldValue.
    // Exception: when defaults are an empty object (user omitted
    // defaultValues from useForm), fall back to the restored keys.
    const restored = draft.values as Record<string, unknown>;
    const defaultKeys = Object.keys(originalDefaultsRef.current as object);
    const validKeys =
      defaultKeys.length > 0 ? new Set(defaultKeys) : new Set(Object.keys(restored));
    Object.keys(restored).forEach((key) => {
      if (!validKeys.has(key)) return;
      formRef.current.setFieldValue(key, restored[key], {
        dontValidate: true,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.values]);

  // Wrap discard so the visible form also clears AND so per-field meta
  // (dirty/touched/errors) resets. We pass the originalDefaults captured
  // at mount via the ref so that:
  //   - a future `form.update({ defaultValues: ... })` call by the user
  //     doesn't make discard revert to the new defaults instead of the
  //     original ones the user expected.
  //   - restore (which uses setFieldValue, NOT form.reset) doesn't change
  //     options.defaultValues, but we'd still be insulated if it ever did.
  const discard = useCallback(() => {
    draft.discard();
    formRef.current.reset(originalDefaultsRef.current);
    userTouchedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.discard]);

  return {
    status: draft.status,
    lastSavedAt: draft.lastSavedAt,
    pendingChanges: draft.pendingChanges,
    error: draft.error,
    save: draft.save,
    discard,
    onConflictData: draft.onConflictData,
    resolveConflict: draft.resolveConflict,
  };
}
