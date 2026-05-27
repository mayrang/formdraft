import { useEffect, useRef } from 'react';
import type { UseFormReturn, FieldValues } from 'react-hook-form';
import type { FormDraftOptions } from '../types';
import { useFormDraft } from '../useFormDraft';

/**
 * Reads the current values from a form element's registered inputs.
 * Falls back to form.getValues() when the DOM hasn't yet reflected a change
 * (e.g. after a React-controlled form.reset()).
 */
function readFormValuesFromDOM<T extends FieldValues>(
  form: UseFormReturn<T>,
  changedEvent?: Event,
): T {
  // Prefer the live DOM value for the field that just changed, then merge with
  // whatever RHF thinks the other fields are.
  const current = { ...form.getValues() } as Record<string, unknown>;
  if (changedEvent) {
    const target = changedEvent.target as HTMLInputElement | null;
    if (target && target.name && target.name in current) {
      const type = target.type;
      if (type === 'checkbox') {
        current[target.name] = target.checked;
      } else if (type === 'number' || type === 'range') {
        current[target.name] = target.valueAsNumber;
      } else {
        current[target.name] = target.value;
      }
    }
  }
  return current as T;
}

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

  // Keep a stable ref to the draft so event handlers don't go stale.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const formRef = useRef(form);
  formRef.current = form;

  // Guard: when we call form.reset() to restore draft values, we set this flag
  // so the document-level input listener ignores any residual events.
  const isRestoringRef = useRef(false);

  // Listen to native input/change events on the document (capture phase) so we
  // catch changes even when React's synthetic event system doesn't fire
  // (e.g. jsdom native event dispatch in tests).
  // We also subscribe to RHF's watch() for environments where React synthetic
  // events DO work (real browsers), as a belt-and-suspenders approach.
  useEffect(() => {
    const handleNativeInput = (e: Event) => {
      if (isRestoringRef.current) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Only process events from inputs that belong to a registered RHF field.
      const fieldName = target.getAttribute('name');
      if (!fieldName) return;
      const control = form.control as unknown as { _names?: { mount: Set<string> } };
      if (control._names && !control._names.mount.has(fieldName)) return;
      const vals = readFormValuesFromDOM<T>(formRef.current, e);
      draftRef.current.patch(vals);
    };

    document.addEventListener('input', handleNativeInput, true);
    document.addEventListener('change', handleNativeInput, true);

    // Also subscribe via RHF's watch() for synthetic-event environments.
    const subscription = form.watch((vals) => {
      if (isRestoringRef.current) {
        isRestoringRef.current = false;
        return;
      }
      draftRef.current.patch(vals as Partial<T>);
    });

    return () => {
      document.removeEventListener('input', handleNativeInput, true);
      document.removeEventListener('change', handleNativeInput, true);
      subscription.unsubscribe();
    };
    // form is stable from useForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  // When draft.values changes (e.g. after storage restore on mount),
  // propagate the new values back into RHF via reset().
  useEffect(() => {
    isRestoringRef.current = true;
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
