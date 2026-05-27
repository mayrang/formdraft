import { useEffect, useRef } from 'react';
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
} {
  const defaultValues = form.formState.defaultValues as T;
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

  // Watch RHF for user changes and patch the draft for persistence.
  useEffect(() => {
    const subscription = form.watch((vals) => {
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
    form.reset(draft.values, { keepDefaultValues: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.values]);

  return {
    status: draft.status,
    lastSavedAt: draft.lastSavedAt,
    pendingChanges: draft.pendingChanges,
    error: draft.error,
    save: draft.save,
    discard: draft.discard,
    onConflictData: draft.onConflictData,
    resolveConflict: draft.resolveConflict,
  };
}
