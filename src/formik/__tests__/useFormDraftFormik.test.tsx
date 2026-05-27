import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFormik } from 'formik';
import { z } from 'zod';
import type { StorageAdapter } from '../../types';
import { useFormDraftFormik } from '../useFormDraftFormik';
import { zodAdapter } from '../../internal/schemaValidation';
import { localStorageAdapter } from '../../storage/localStorage';
import { _clearRegistryForTests } from '../../internal/registry';

const Schema = z.object({ name: z.string() });

function Inner({ onSync }: { onSync: ReturnType<typeof vi.fn> }) {
  const formik = useFormik({
    initialValues: { name: '' },
    onSubmit: () => {},
  });
  const { status, discard } = useFormDraftFormik(formik, {
    key: 'formik-test',
    schema: zodAdapter(Schema),
    storage: localStorageAdapter(),
    sync: onSync,
    syncDebounceMs: 50,
    multiTab: false,
  });
  return (
    <div>
      <input
        data-testid="name"
        name="name"
        value={formik.values.name}
        onChange={formik.handleChange}
      />
      <span data-testid="status">{status}</span>
      <button data-testid="discard" onClick={discard}>
        Discard
      </button>
    </div>
  );
}

function Probe(props: { onSync: ReturnType<typeof vi.fn> }) {
  return (
    <StrictMode>
      <Inner {...props} />
    </StrictMode>
  );
}

describe('useFormDraftFormik', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    _clearRegistryForTests();
  });
  afterEach(() => vi.useRealTimers());

  it('persists Formik values on input change', async () => {
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    const input = screen.getByTestId('name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Alice' } });
    await vi.advanceTimersByTimeAsync(200);
    const stored = JSON.parse(localStorage.getItem('formdraft:formik-test')!);
    expect(stored.values).toMatchObject({ name: 'Alice' });
  });

  it('restores into Formik on mount when storage has a valid draft', async () => {
    localStorage.setItem(
      'formdraft:formik-test',
      JSON.stringify({ __v: 1, values: { name: 'Restored' } }),
    );
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    await waitFor(() => {
      expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('Restored');
    });
  });

  it('does NOT clobber user input that arrived before restore lands', async () => {
    // Race the storage read with a user keystroke. The user wins — the
    // adapter must skip the restore when form.dirty is true.
    localStorage.setItem(
      'formdraft:formik-test',
      JSON.stringify({ __v: 1, values: { name: 'Stored' } }),
    );
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    // Type before the async restore can land
    const input = screen.getByTestId('name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'User-typed' } });
    await vi.advanceTimersByTimeAsync(200);
    expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('User-typed');
  });

  it('discard clears storage AND resets the visible Formik form', async () => {
    // Round-1 audit (F3): discard used to clear storage but leave the
    // visible input untouched, so the next keystroke would re-persist the
    // stale text — effectively undoing the discard.
    localStorage.setItem(
      'formdraft:formik-test',
      JSON.stringify({ __v: 1, values: { name: 'WillBeCleared' } }),
    );
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    await waitFor(() => {
      expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('WillBeCleared');
    });
    act(() => screen.getByTestId('discard').click());
    await vi.advanceTimersByTimeAsync(100);
    expect(localStorage.getItem('formdraft:formik-test')).toBeNull();
    expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('');
  });

  it('restore does NOT trigger Formik validation (no spurious errors on un-typed draft)', async () => {
    // Round-2 audit (F1): restore used to setValues(value) which defaults
    // to shouldValidate=true, painting errors against text the user never
    // typed. Now setValues(value, false).
    const StrictSchema = z.object({
      name: z.string().min(5, 'too short'), // restored value 'Hi' fails this
    });
    localStorage.setItem(
      'formdraft:formik-validation',
      JSON.stringify({ __v: 1, values: { name: 'Hi' } }),
    );

    function ValidInner() {
      const formik = useFormik({
        initialValues: { name: '' },
        validate: (vals) => {
          const r = StrictSchema.safeParse(vals);
          return r.success ? {} : { name: r.error.issues[0]?.message };
        },
        validateOnChange: true,
        validateOnMount: false,
        onSubmit: () => {},
      });
      useFormDraftFormik(formik, {
        key: 'formik-validation',
        schema: zodAdapter(z.object({ name: z.string() })),
        storage: localStorageAdapter(),
        syncDebounceMs: 50,
        multiTab: false,
      });
      return (
        <div>
          <input data-testid="vname" value={formik.values.name} onChange={formik.handleChange} name="name" />
          <span data-testid="verror">{formik.errors.name ?? ''}</span>
        </div>
      );
    }

    render(
      <StrictMode>
        <ValidInner />
      </StrictMode>,
    );
    await waitFor(() => {
      expect((screen.getByTestId('vname') as HTMLInputElement).value).toBe('Hi');
    });
    // No validation error painted — user hasn't typed anything yet
    expect(screen.getByTestId('verror').textContent).toBe('');
  });

  it('submit pattern: calling discard in onSubmit clears storage + broadcasts', async () => {
    // Documents and pins the recommended Formik integration pattern: in
    // formik's onSubmit, after the user's API call succeeds, call discard.
    let capturedDiscard: (() => void) | null = null;

    function SubmitInner() {
      const formik = useFormik({
        initialValues: { name: '' },
        onSubmit: async () => {
          // Pretend API succeeded
          capturedDiscard?.();
        },
      });
      const { discard } = useFormDraftFormik(formik, {
        key: 'formik-submit',
        schema: zodAdapter(Schema),
        storage: localStorageAdapter(),
        syncDebounceMs: 50,
        multiTab: false,
      });
      capturedDiscard = discard;
      return (
        <form data-testid="form" onSubmit={formik.handleSubmit}>
          <input
            data-testid="sname"
            value={formik.values.name}
            onChange={formik.handleChange}
            name="name"
          />
          <button type="submit" data-testid="submit">Submit</button>
        </form>
      );
    }

    render(
      <StrictMode>
        <SubmitInner />
      </StrictMode>,
    );

    // Type and let it persist
    fireEvent.change(screen.getByTestId('sname'), { target: { value: 'Alice' } });
    await vi.advanceTimersByTimeAsync(200);
    expect(localStorage.getItem('formdraft:formik-submit')).not.toBeNull();

    // Submit
    fireEvent.submit(screen.getByTestId('form'));
    await vi.advanceTimersByTimeAsync(200);

    // After successful submit + discard, storage is cleared
    expect(localStorage.getItem('formdraft:formik-submit')).toBeNull();
    expect((screen.getByTestId('sname') as HTMLInputElement).value).toBe('');
  });

  it('deleting input back to initial value still persists the deletion', async () => {
    // Round-3 audit (F2): with the old `if (!form.dirty) return` gate,
    // typing then deleting back to initialValues left stored data alive
    // (dirty flips false → patch skipped). Next mount restored the deleted
    // text. Now we use a sticky userTouchedRef.
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    const input = screen.getByTestId('name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Alice' } });
    await vi.advanceTimersByTimeAsync(200);
    expect(JSON.parse(localStorage.getItem('formdraft:formik-test')!).values.name).toBe('Alice');
    // Delete back to empty (the initialValue)
    fireEvent.change(input, { target: { value: '' } });
    await vi.advanceTimersByTimeAsync(200);
    expect(JSON.parse(localStorage.getItem('formdraft:formik-test')!).values.name).toBe('');
  });

  it('restore does NOT flip pendingChanges or trigger a redundant sync', async () => {
    // Round-3 audit (F1): setValues(value, false) leaves dirty=true after
    // restore, which would unblock the persist effect → patch redundantly
    // → sync round-trip on every page load. Now the value-watcher effect
    // checks ignoreNextFormChangeRef and skips the post-restore patch.
    localStorage.setItem(
      'formdraft:formik-test',
      JSON.stringify({ __v: 1, values: { name: 'Stored' } }),
    );
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    await waitFor(() => {
      expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('Stored');
    });
    // Give the persist + sync debounces plenty of time to fire if they were going to
    await vi.advanceTimersByTimeAsync(2000);
    // No sync was fired — restore alone shouldn't round-trip the data
    expect(onSync).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('type → clear → late-restore: does NOT resurrect cleared user input', async () => {
    // Round-4 audit (D5 trace): once the user typed and useFormDraft's own
    // userTouchedRef latched, the stored data is gated from ever reaching
    // draft.values. The adapter's restore-effect then only ever sees the
    // user's cleared state, never the stored snapshot.
    let releaseRead: (raw: string | null) => void;
    const readGate = new Promise<string | null>((r) => { releaseRead = r; });
    const slowAdapter: StorageAdapter = {
      name: 'slow',
      async read() {
        const raw = await readGate;
        return raw === null ? null : JSON.parse(raw);
      },
      async write() {},
      async remove() {},
    };

    function SlowInner() {
      const formik = useFormik({
        initialValues: { name: '' },
        onSubmit: () => {},
      });
      useFormDraftFormik(formik, {
        key: 'slow-type-clear',
        schema: zodAdapter(Schema),
        storage: slowAdapter,
        syncDebounceMs: 50,
        multiTab: false,
      });
      return (
        <input
          data-testid="name"
          value={formik.values.name}
          onChange={formik.handleChange}
          name="name"
        />
      );
    }

    render(
      <StrictMode>
        <SlowInner />
      </StrictMode>,
    );

    const input = screen.getByTestId('name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'TypedA' } });
    expect(input.value).toBe('TypedA');
    // User clears the input back to empty
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    // Now let the stored draft land
    releaseRead!(JSON.stringify({ __v: 1, values: { name: 'StoredShouldNotShow' } }));
    await vi.advanceTimersByTimeAsync(200);
    // The user's clear must stick
    expect(input.value).toBe('');
  });

  it('user-types-before-restore race: skips restore via form.dirty (deferred storage)', async () => {
    // Round-1 audit (F4): the previous race test was timing-dependent on
    // localStorage being effectively-synchronous. Use a deferred storage
    // adapter so the race is explicit and platform-independent.
    let releaseRead: (raw: string | null) => void;
    const readGate = new Promise<string | null>((r) => { releaseRead = r; });
    const slowAdapter: StorageAdapter = {
      name: 'slow',
      async read() {
        const raw = await readGate;
        return raw === null ? null : JSON.parse(raw);
      },
      async write() {},
      async remove() {},
    };

    function SlowInner({ onSync }: { onSync: ReturnType<typeof vi.fn> }) {
      const formik = useFormik({
        initialValues: { name: '' },
        onSubmit: () => {},
      });
      useFormDraftFormik(formik, {
        key: 'slow-formik',
        schema: zodAdapter(Schema),
        storage: slowAdapter,
        sync: onSync,
        syncDebounceMs: 50,
        multiTab: false,
      });
      return (
        <input
          data-testid="name"
          name="name"
          value={formik.values.name}
          onChange={formik.handleChange}
        />
      );
    }

    render(
      <StrictMode>
        <SlowInner onSync={vi.fn()} />
      </StrictMode>,
    );

    // Type BEFORE the deferred read resolves
    const input = screen.getByTestId('name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'User-typed' } });
    expect(input.value).toBe('User-typed');

    // Now let restore land
    releaseRead!(JSON.stringify({ __v: 1, values: { name: 'Stored' } }));
    await vi.advanceTimersByTimeAsync(200);

    // User input wins; restore was correctly skipped
    expect(input.value).toBe('User-typed');
  });
});
