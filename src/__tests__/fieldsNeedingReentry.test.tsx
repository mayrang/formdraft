import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { useFormDraft } from '../useFormDraft';
import { zodAdapter } from '../internal/schemaValidation';
import { localStorageAdapter } from '../storage/localStorage';
import { _clearRegistryForTests } from '../internal/registry';

const Schema = z.object({
  email: z.string(),
  password: z.string(),
  step: z.number(),
});
type V = z.infer<typeof Schema>;
const DEFAULTS: V = { email: '', password: '', step: 1 };
const STORAGE_KEY = 'formdraft:reentry-test';

function probeFactory(overrides?: Partial<Parameters<typeof useFormDraft<V>>[0]>) {
  function Inner() {
    const draft = useFormDraft<V>({
      key: 'reentry-test',
      schema: zodAdapter(Schema),
      defaultValues: DEFAULTS,
      storage: localStorageAdapter(),
      multiTab: false,
      excludeFields: ['password'],
      ...overrides,
    });
    return (
      <div>
        <span data-testid="reentry">{draft.fieldsNeedingReentry.join(',')}</span>
        <span data-testid="email">{draft.values.email}</span>
        <span data-testid="password">{draft.values.password}</span>
        <span data-testid="step">{String(draft.values.step)}</span>
        <button data-testid="type-email" onClick={() => draft.set('email', 'a@b.com')} />
        <button data-testid="type-pw" onClick={() => draft.set('password', 'secret')} />
        <button data-testid="clear-pw" onClick={() => draft.set('password', '')} />
        <button data-testid="bump-step" onClick={() => draft.set('step', 3)} />
        <button data-testid="discard" onClick={() => draft.discard()} />
        <button
          data-testid="submit"
          onClick={() =>
            draft.submit(async () => undefined)()
          }
        />
      </div>
    );
  }
  return function Probe() {
    return (
      <StrictMode>
        <Inner />
      </StrictMode>
    );
  };
}

describe('fieldsNeedingReentry', () => {
  beforeEach(() => {
    localStorage.clear();
    _clearRegistryForTests();
  });

  it('is empty on a fresh mount with no stored draft', () => {
    const Probe = probeFactory();
    render(<Probe />);
    expect(screen.getByTestId('reentry').textContent).toBe('');
  });

  it('persist records __excludedHad only when an excluded field is non-default', async () => {
    const Probe = probeFactory();
    render(<Probe />);
    // Email change persists; password is at default → no __excludedHad
    act(() => fireEvent.click(screen.getByTestId('type-email')));
    await new Promise((r) => setTimeout(r, 120));
    let stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.values).toMatchObject({ email: 'a@b.com' });
    expect(stored.__excludedHad).toBeUndefined();

    // Now password is set → __excludedHad lists it
    act(() => fireEvent.click(screen.getByTestId('type-pw')));
    await new Promise((r) => setTimeout(r, 120));
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.__excludedHad).toEqual(['password']);
    // Value is still excluded from storage (the point of excludeFields)
    expect(stored.values.password).toBeUndefined();
  });

  it('restore populates fieldsNeedingReentry when stored record has __excludedHad', async () => {
    // Simulate a prior session where the user filled the password before refresh
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        __v: 1,
        values: { email: 'a@b.com', step: 3 }, // password stripped
        __excludedHad: ['password'],
      }),
    );
    const Probe = probeFactory();
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('reentry').textContent).toBe('password');
    });
    // Confirm other state restored too — the user lands at step 3, password empty
    expect(screen.getByTestId('email').textContent).toBe('a@b.com');
    expect(screen.getByTestId('step').textContent).toBe('3');
    expect(screen.getByTestId('password').textContent).toBe('');
  });

  it('user re-entering the field clears it from fieldsNeedingReentry', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        __v: 1,
        values: { email: 'a@b.com', step: 1 },
        __excludedHad: ['password'],
      }),
    );
    const Probe = probeFactory();
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('reentry').textContent).toBe('password');
    });
    act(() => fireEvent.click(screen.getByTestId('type-pw')));
    expect(screen.getByTestId('reentry').textContent).toBe('');
  });

  it('clearing the field back to default brings it back into fieldsNeedingReentry', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        __v: 1,
        values: { email: 'a@b.com', step: 1 },
        __excludedHad: ['password'],
      }),
    );
    const Probe = probeFactory();
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('reentry').textContent).toBe('password');
    });
    act(() => fireEvent.click(screen.getByTestId('type-pw')));
    expect(screen.getByTestId('reentry').textContent).toBe('');
    act(() => fireEvent.click(screen.getByTestId('clear-pw')));
    expect(screen.getByTestId('reentry').textContent).toBe('password');
  });

  it('discard clears fieldsNeedingReentry', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        __v: 1,
        values: { email: 'a@b.com', step: 1 },
        __excludedHad: ['password'],
      }),
    );
    const Probe = probeFactory();
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('reentry').textContent).toBe('password');
    });
    act(() => fireEvent.click(screen.getByTestId('discard')));
    expect(screen.getByTestId('reentry').textContent).toBe('');
  });

  it('submit clears fieldsNeedingReentry', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        __v: 1,
        values: { email: 'a@b.com', step: 1 },
        __excludedHad: ['password'],
      }),
    );
    const Probe = probeFactory();
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('reentry').textContent).toBe('password');
    });
    // After typing a password (so submit handler has something), submit
    act(() => fireEvent.click(screen.getByTestId('type-pw')));
    act(() => fireEvent.click(screen.getByTestId('submit')));
    await waitFor(() => {
      expect(screen.getByTestId('reentry').textContent).toBe('');
    });
  });

  it('pre-0.3 records without __excludedHad restore cleanly with empty reentry list (backward compat)', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        __v: 1,
        values: { email: 'old@user.com', step: 2 },
        // no __excludedHad
      }),
    );
    const Probe = probeFactory();
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('email').textContent).toBe('old@user.com');
    });
    expect(screen.getByTestId('reentry').textContent).toBe('');
  });

  it('multiple excludeFields with partial coverage', async () => {
    const apiKeySchema = z.object({ email: z.string(), password: z.string(), apiKey: z.string() });
    type W = z.infer<typeof apiKeySchema>;
    const defs: W = { email: '', password: '', apiKey: '' };
    localStorage.setItem(
      'formdraft:multi-reentry',
      JSON.stringify({
        __v: 1,
        values: { email: 'a@b.com' },
        __excludedHad: ['password'], // user had only password, not apiKey
      }),
    );
    function Inner() {
      const d = useFormDraft<W>({
        key: 'multi-reentry',
        schema: zodAdapter(apiKeySchema),
        defaultValues: defs,
        storage: localStorageAdapter(),
        multiTab: false,
        excludeFields: ['password', 'apiKey'],
      });
      return <span data-testid="reentry">{d.fieldsNeedingReentry.join(',')}</span>;
    }
    render(
      <StrictMode>
        <Inner />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('reentry').textContent).toBe('password');
    });
  });

  it('filters non-string entries from __excludedHad on restore (F4 regression)', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        __v: 1,
        values: { email: 'a@b.com', step: 1 },
        __excludedHad: [42, null, { x: 1 }, 'password'],
      }),
    );
    const Probe = probeFactory();
    render(<Probe />);
    await waitFor(() => {
      // Only the legit string entry should remain
      expect(screen.getByTestId('reentry').textContent).toBe('password');
    });
  });

  it('intersects with current excludeFields, dropping stale keys (F6 regression)', async () => {
    // Prior session had excludeFields: ['password', 'apiKey']. Current session
    // only excludes 'password'. The stale 'apiKey' entry must not appear.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        __v: 1,
        values: { email: 'a@b.com', step: 1 },
        __excludedHad: ['password', 'apiKey'],
      }),
    );
    const Probe = probeFactory(); // current excludeFields: ['password']
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('reentry').textContent).toBe('password');
    });
  });

  it('excludeFields with non-empty defaultValue: needs-reentry uses Object.is(value, default) comparison', async () => {
    const schema = z.object({ note: z.string(), sensitive: z.string() });
    type W = z.infer<typeof schema>;
    const defs: W = { note: '', sensitive: 'placeholder' };
    localStorage.setItem(
      'formdraft:nondefault-reentry',
      JSON.stringify({
        __v: 1,
        values: { note: 'hi' },
        __excludedHad: ['sensitive'],
      }),
    );
    function Inner() {
      const d = useFormDraft<W>({
        key: 'nondefault-reentry',
        schema: zodAdapter(schema),
        defaultValues: defs,
        storage: localStorageAdapter(),
        multiTab: false,
        excludeFields: ['sensitive'],
      });
      return (
        <div>
          <span data-testid="reentry">{d.fieldsNeedingReentry.join(',')}</span>
          <button data-testid="set-same" onClick={() => d.set('sensitive', 'placeholder')} />
          <button data-testid="set-new" onClick={() => d.set('sensitive', 'real')} />
        </div>
      );
    }
    render(
      <StrictMode>
        <Inner />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('reentry').textContent).toBe('sensitive');
    });
    // Setting to the same default value keeps it in needs-reentry
    act(() => fireEvent.click(screen.getByTestId('set-same')));
    expect(screen.getByTestId('reentry').textContent).toBe('sensitive');
    // Setting to a new value clears
    act(() => fireEvent.click(screen.getByTestId('set-new')));
    expect(screen.getByTestId('reentry').textContent).toBe('');
  });

  it('useFormDraftStatus sibling re-renders when fieldsNeedingReentry changes (F1 regression)', async () => {
    const { useFormDraftStatus } = await import('../useFormDraftStatus');
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        __v: 1,
        values: { email: 'a@b.com', step: 1 },
        __excludedHad: ['password'],
      }),
    );
    function Host() {
      const d = useFormDraft<V>({
        key: 'reentry-test',
        schema: zodAdapter(Schema),
        defaultValues: DEFAULTS,
        storage: localStorageAdapter(),
        multiTab: false,
        excludeFields: ['password'],
      });
      return (
        <button data-testid="type-pw" onClick={() => d.set('password', 'real')}>
          set
        </button>
      );
    }
    function Sibling() {
      const s = useFormDraftStatus('reentry-test');
      return <span data-testid="sibling-reentry">{s.fieldsNeedingReentry.join(',')}</span>;
    }
    render(
      <StrictMode>
        <Host />
        <Sibling />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('sibling-reentry').textContent).toBe('password');
    });
    // User fills password — sibling must observe the cleared list WITHOUT
    // waiting for a save or status transition.
    act(() => fireEvent.click(screen.getByTestId('type-pw')));
    await waitFor(() => {
      expect(screen.getByTestId('sibling-reentry').textContent).toBe('');
    });
  });

  it('resolveConflict("remote") clears fieldsNeedingReentry (F2 regression)', async () => {
    // Seed a restore that populates excludedHadOnRestore
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        __v: 1,
        values: { email: 'a@b.com', step: 1 },
        __excludedHad: ['password'],
      }),
    );
    function Inner() {
      const d = useFormDraft<V>({
        key: 'reentry-test',
        schema: zodAdapter(Schema),
        defaultValues: DEFAULTS,
        storage: localStorageAdapter(),
        multiTab: 'warn',
        excludeFields: ['password'],
      });
      return (
        <div>
          <span data-testid="reentry">{d.fieldsNeedingReentry.join(',')}</span>
          <button
            data-testid="resolve-remote"
            onClick={() => d.resolveConflict('remote')}
          />
        </div>
      );
    }
    render(
      <StrictMode>
        <Inner />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('reentry').textContent).toBe('password');
    });
    act(() => fireEvent.click(screen.getByTestId('resolve-remote')));
    expect(screen.getByTestId('reentry').textContent).toBe('');
  });
});
