import { useCallback, useEffect, useRef } from 'react';
import type { UseFormReturn, FieldValues } from 'react-hook-form';
import type { FormDraftOptions } from '../types';
import { useFormDraft } from '../useFormDraft';

export function useFormDraftRHF<T extends FieldValues>(
  form: UseFormReturn<T>,
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
  fieldsNeedingReentry: ReturnType<typeof useFormDraft<T>>['fieldsNeedingReentry'];
} {
  // RHF returns undefined when no defaultValues were passed to useForm(). Fall
  // back to an empty object so set()/patch() spreads don't blow up downstream.
  const defaultValues = (form.formState.defaultValues ?? ({} as T)) as T;
  const draft = useFormDraft<T>({
    ...options,
    defaultValues,
  });

  // Track whether we've already done the one-time storage restore into RHF.
  // After mount, RHF is the source of truth; draft is only the persistence layer.
  const hasRestoredRef = useRef(false);

  // Keep a stable ref to the initial draft.values so we can detect when
  // draft.values changes for the first time (storage restore async callback).
  const initialDraftValuesRef = useRef(draft.values);

  // Set by the restore + discard paths right before they call form.reset.
  // The watch subscriber consumes and clears it, skipping the patch so the
  // library-initiated reset doesn't round-trip back through the persistence
  // pipeline (re-storing the just-cleared draft on discard, or echoing the
  // restored draft back to itself on initial mount).
  const ignoreNextWatchRef = useRef(false);

  // Watch RHF for user changes and patch the draft for persistence.
  useEffect(() => {
    const subscription = form.watch((vals) => {
      if (ignoreNextWatchRef.current) {
        ignoreNextWatchRef.current = false;
        return;
      }
      draft.patch(vals as Partial<T>);
    });
    return () => subscription.unsubscribe();
    // form is stable from useForm(); draft.patch is a stable useCallback ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  // When draft.values changes from its initial value, it means storage has been
  // asynchronously restored. Push the stored values into RHF exactly once.
  // After that, ignore further draft.values changes (they come from our own patches).
  useEffect(() => {
    if (hasRestoredRef.current) return;
    if (draft.values === initialDraftValuesRef.current) return;
    hasRestoredRef.current = true;
    ignoreNextWatchRef.current = true;
    form.reset(draft.values, { keepDefaultValues: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.values]);

  // Refify the form so `discard` doesn't churn identity across renders. RHF's
  // `UseFormReturn` is stable in practice but the ref makes the wrapper safe
  // regardless of consumer wiring.
  const formRef = useRef(form);
  formRef.current = form;

  // Wrap discard so the visible RHF form also clears. Without this, the
  // underlying draft.discard() empties storage but form.values still shows
  // the user's text — and the next keystroke would re-persist that stale
  // text back into storage via the form.watch subscription, effectively
  // undoing the discard. Mirrors the Formik / TanStack adapters' behavior.
  const discard = useCallback(() => {
    draft.discard();
    // Mark the upcoming form.reset() as library-initiated so the watch
    // subscriber skips its patch — otherwise the empty defaults that the
    // reset emits would be patched back into the just-cleared draft and
    // re-persisted, undoing the discard.
    ignoreNextWatchRef.current = true;
    formRef.current.reset(defaultValues, { keepDefaultValues: true });
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
    fieldsNeedingReentry: draft.fieldsNeedingReentry,
  };
}
