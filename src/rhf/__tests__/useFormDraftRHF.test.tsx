import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useFormDraftRHF } from '../useFormDraftRHF';
import { zodAdapter } from '../../internal/schemaValidation';
import { localStorageAdapter } from '../../storage/localStorage';
import { _clearRegistryForTests } from '../../internal/registry';

const Schema = z.object({ name: z.string() });

function Inner({ onSync }: { onSync: ReturnType<typeof vi.fn> }) {
  const form = useForm({ defaultValues: { name: '' } });
  const { status, discard } = useFormDraftRHF(form, {
    key: 'rhf-test',
    schema: zodAdapter(Schema),
    storage: localStorageAdapter(),
    sync: onSync,
    syncDebounceMs: 50,
    multiTab: false,
  });
  return (
    <div>
      <input data-testid="name" {...form.register('name')} />
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

describe('useFormDraftRHF', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    _clearRegistryForTests();
  });
  afterEach(() => vi.useRealTimers());

  it('persists RHF values on input change', async () => {
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    const input = screen.getByTestId('name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Alice' } });
    await vi.advanceTimersByTimeAsync(200);
    const stored = JSON.parse(localStorage.getItem('formdraft:rhf-test')!);
    expect(stored.values).toMatchObject({ name: 'Alice' });
  });

  it('restores into RHF on mount when storage has valid draft', async () => {
    localStorage.setItem(
      'formdraft:rhf-test',
      JSON.stringify({ __v: 1, values: { name: 'Restored' } }),
    );
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    await waitFor(() => {
      expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('Restored');
    });
  });

  it('discard clears storage AND resets the visible RHF form, without re-persisting', async () => {
    // Round-1 audit (v0.2 e2e pass): discard used to clear storage but leave
    // the visible RHF input populated. Worse, RHF's watch subscription would
    // then fire (because form.reset emits a change event), patch the empty
    // defaults back into the draft, and re-persist — silently undoing the
    // discard. This test locks in the fix.
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    const input = screen.getByTestId('name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'about-to-discard' } });
    await vi.advanceTimersByTimeAsync(200);
    expect(localStorage.getItem('formdraft:rhf-test')).not.toBeNull();

    fireEvent.click(screen.getByTestId('discard'));
    await vi.advanceTimersByTimeAsync(300);

    expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('');
    expect(localStorage.getItem('formdraft:rhf-test')).toBeNull();
  });
});
