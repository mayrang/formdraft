import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useForm, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { useFormDraftRHF } from '../useFormDraftRHF';
import { zodAdapter } from '../../internal/schemaValidation';
import { localStorageAdapter } from '../../storage/localStorage';

const Schema = z.object({ name: z.string() });

function Probe({ onSync }: { onSync: ReturnType<typeof vi.fn> }) {
  const form = useForm({ defaultValues: { name: '' } });
  const { status } = useFormDraftRHF(form, {
    key: 'rhf-test',
    schema: zodAdapter(Schema),
    storage: localStorageAdapter(),
    sync: onSync,
    syncDebounceMs: 50,
    multiTab: false,
  });
  return (
    <FormProvider {...form}>
      <input data-testid="name" {...form.register('name')} />
      <span data-testid="status">{status}</span>
    </FormProvider>
  );
}

describe('useFormDraftRHF', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('persists RHF values on input change', async () => {
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    const input = screen.getByTestId('name') as HTMLInputElement;
    act(() => {
      input.value = 'Alice';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await vi.advanceTimersByTimeAsync(100);
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
});
