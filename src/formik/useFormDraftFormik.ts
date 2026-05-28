import { useCallback, useEffect, useRef } from 'react';
import type { FormikProps, FormikValues } from 'formik';
import type { FormDraftOptions } from '../types';
import { useFormDraft } from '../useFormDraft';

/**
 * Formik adapter — wraps a `useFormik(...)` instance with formdraft's
 * persistence, sync queue, and multi-tab coordination. Mirrors the
 * `useFormDraftRHF` shape so the docs and ergonomics are consistent.
 *
 *   const formik = useFormik({ initialValues: { name: '' }, onSubmit });
 *   const { status, lastSavedAt, discard } = useFormDraftFormik(formik, {
 *     key: 'profile-form',
 *     schema: zodAdapter(Schema),
 *     sync: api.saveProfile,
 *   });
 *
 * Restore happens once on mount when storage has a valid draft AND the user
 * hasn't already started typing (`formik.dirty`). After that, formik is the
 * source of truth and every `formik.values` change patches the draft for
 * persistence.
 */
export function useFormDraftFormik<T extends FormikValues>(
  form: FormikProps<T>,
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
  const defaultValues = form.initialValues;
  const draft = useFormDraft<T>({
    ...options,
    defaultValues,
  });

  // Tracks the one-time "storage restore landed and we pushed it into formik"
  // transition. After it flips true, draft.values is downstream of formik.
  const hasRestoredRef = useRef(false);

  // Stable snapshot of the draft.values reference at construction time. Used
  // to detect the async storage-restore swap (any non-initial reference =
  // restore happened).
  const initialDraftValuesRef = useRef(draft.values);

  // Sticky "user has touched the form at least once" flag. We can't use
  // `form.dirty` directly as the gate — dirty flips BACK to false when the
  // user deletes their input down to initialValues, and that deletion must
  // still be persisted (otherwise stale stored draft survives forever).
  // We can't use a first-run ref either — StrictMode's double-effect cycle
  // makes its second invocation patch initialValues before async restore
  // lands, racing the restore into a no-op.
  // Instead: flip touched=true the first time we observe form.dirty=true,
  // then patch on EVERY subsequent form.values change. Reset to false on
  // discard so the post-discard form.resetForm() event doesn't re-patch.
  const userTouchedRef = useRef(false);

  // Set by the restore effect right before it calls form.setValues. The
  // value-change-watcher effect runs next, sees this flag, skips its patch
  // (the restore is not user input), and resets the flag.
  const ignoreNextFormChangeRef = useRef(false);

  // Watch formik.values for user changes and patch the draft for persistence.
  // (Formik doesn't have a subscriber API like RHF's `watch()` — we observe
  // values via the effect dep instead.)
  useEffect(() => {
    if (ignoreNextFormChangeRef.current) {
      // form.values changed because OUR restore called setValues. Skip — the
      // draft already has these values; patching would round-trip a sync.
      ignoreNextFormChangeRef.current = false;
      return;
    }
    if (form.dirty) userTouchedRef.current = true;
    if (!userTouchedRef.current) return;
    draft.patch(form.values);
    // form.values + form.dirty are the deps; draft.patch is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.values, form.dirty]);

  // When draft.values changes from its initial reference, storage has been
  // asynchronously restored. Push the stored values into formik exactly once,
  // BUT only if the user hasn't already started typing — otherwise we'd
  // clobber their input. After that, ignore further draft.values changes
  // (they originate from our own patches).
  useEffect(() => {
    if (hasRestoredRef.current) return;
    if (draft.values === initialDraftValuesRef.current) return;
    if (form.dirty) {
      // User typed before restore landed — useFormDraft's own
      // userTouchedRef prevents the stored data from ever reaching
      // draft.values in this case, so we never need to restore. Latch
      // hasRestoredRef so subsequent draft.patch updates don't re-enter
      // this branch on every keystroke.
      hasRestoredRef.current = true;
      return;
    }
    hasRestoredRef.current = true;
    // Mark the upcoming form.values change as "ours", not user input. The
    // value-watcher effect runs next and skips its patch. We don't use
    // resetForm({ values }) here because that would update Formik's
    // internal initialValues to the restored data — and then a later
    // discard() would resetForm() back to the restored value (not the
    // user's original empty form).
    ignoreNextFormChangeRef.current = true;
    // shouldValidate=false: restore is not user input, painting validation
    // errors on text the user never typed is a UX regression.
    void form.setValues(draft.values, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.values]);

  // Refify the form so `discard` doesn't churn identity when Formik recreates
  // its handlers (which happens whenever the consumer passes inline
  // `initialErrors` / `onReset` props). Keeps consumers' useEffect deps and
  // memo'd buttons stable.
  const formRef = useRef(form);
  formRef.current = form;

  // Wrap discard so the visible formik form also clears. Without this, the
  // underlying draft.discard() empties storage but formik.values still
  // shows the discarded text — and the next keystroke would re-persist
  // that stale text back into storage, effectively undoing the discard.
  //
  // Also resets `userTouchedRef` so the post-discard `form.resetForm` event
  // doesn't trigger an immediate patch of the empty initial values back
  // into the just-cleared storage.
  const discard = useCallback(() => {
    draft.discard();
    formRef.current.resetForm();
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
    fieldsNeedingReentry: draft.fieldsNeedingReentry,
  };
}
