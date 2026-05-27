import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import type { StorageAdapter } from '../../types';
import { useFormDraftTanstack } from '../useFormDraftTanstack';
import { zodAdapter } from '../../internal/schemaValidation';
import { localStorageAdapter } from '../../storage/localStorage';
import { _clearRegistryForTests } from '../../internal/registry';

const Schema = z.object({ name: z.string() });

function Inner({ onSync }: { onSync: ReturnType<typeof vi.fn> }) {
  const form = useForm({
    defaultValues: { name: '' as string },
    onSubmit: () => {},
  });
  const { status, discard } = useFormDraftTanstack(form, {
    key: 'tanstack-test',
    schema: zodAdapter(Schema),
    storage: localStorageAdapter(),
    sync: onSync,
    syncDebounceMs: 50,
    multiTab: false,
  });
  return (
    <div>
      <form.Field name="name">
        {(field) => (
          <input
            data-testid="name"
            name={field.name}
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
          />
        )}
      </form.Field>
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

describe('useFormDraftTanstack', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    _clearRegistryForTests();
  });
  afterEach(() => vi.useRealTimers());

  it('persists TanStack form values on input change', async () => {
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    fireEvent.change(screen.getByTestId('name'), { target: { value: 'Alice' } });
    await vi.advanceTimersByTimeAsync(200);
    const stored = JSON.parse(localStorage.getItem('formdraft:tanstack-test')!);
    expect(stored.values).toMatchObject({ name: 'Alice' });
  });

  it('restores into TanStack form on mount when storage has a valid draft', async () => {
    localStorage.setItem(
      'formdraft:tanstack-test',
      JSON.stringify({ __v: 1, values: { name: 'Restored' } }),
    );
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    await waitFor(() => {
      expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('Restored');
    });
  });

  it('discard clears storage AND resets the visible form', async () => {
    localStorage.setItem(
      'formdraft:tanstack-test',
      JSON.stringify({ __v: 1, values: { name: 'WillBeCleared' } }),
    );
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    await waitFor(() => {
      expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('WillBeCleared');
    });
    fireEvent.click(screen.getByTestId('discard'));
    await vi.advanceTimersByTimeAsync(100);
    expect(localStorage.getItem('formdraft:tanstack-test')).toBeNull();
    expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('');
  });

  it('deleting input back to default still persists the deletion', async () => {
    // F2-equivalent: typing then clearing back to defaults must persist
    // the cleared state, not let stale storage survive.
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    const input = screen.getByTestId('name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Alice' } });
    await vi.advanceTimersByTimeAsync(200);
    expect(JSON.parse(localStorage.getItem('formdraft:tanstack-test')!).values.name).toBe('Alice');
    fireEvent.change(input, { target: { value: '' } });
    await vi.advanceTimersByTimeAsync(200);
    expect(JSON.parse(localStorage.getItem('formdraft:tanstack-test')!).values.name).toBe('');
  });

  it('restore does NOT trigger redundant sync (no flicker on page load)', async () => {
    // F1-equivalent: restore must not push values through the persist
    // pipeline, otherwise every page load triggers an unnecessary sync.
    localStorage.setItem(
      'formdraft:tanstack-test',
      JSON.stringify({ __v: 1, values: { name: 'Stored' } }),
    );
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<Probe onSync={onSync} />);
    await waitFor(() => {
      expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('Stored');
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(onSync).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('restore survives across re-renders when form.Field has defaultValue prop (D2 regression)', async () => {
    // Round-3 audit (D2): TanStack's FieldApi.update runs on every render
    // and reseeds the field to `opts.defaultValue` when `!isTouched`. Our
    // initial implementation passed `dontUpdateMeta: true` to setFieldValue,
    // which kept isTouched=false → reseed condition matched → restored
    // values silently wiped on next render. Fix: drop dontUpdateMeta so
    // setFieldValue marks isTouched=true and the reseed condition fails.
    localStorage.setItem(
      'formdraft:reseed-test',
      JSON.stringify({ __v: 1, values: { name: 'Restored' } }),
    );

    function ReseedInner() {
      const form = useForm({
        defaultValues: { name: '' as string },
        onSubmit: () => {},
      });
      useFormDraftTanstack(form, {
        key: 'reseed-test',
        schema: zodAdapter(Schema),
        storage: localStorageAdapter(),
        syncDebounceMs: 50,
        multiTab: false,
      });
      return (
        // Idiomatic TanStack usage — defaultValue prop on form.Field.
        // Before the D2 fix, this would silently reseed restored 'Restored'
        // back to '' on every render after restore.
        <form.Field name="name" defaultValue="">
          {(field) => (
            <input
              data-testid="name"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
      );
    }

    render(
      <StrictMode>
        <ReseedInner />
      </StrictMode>,
    );
    await waitFor(() => {
      expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('Restored');
    });
    // Force additional re-renders and verify restore still holds
    await vi.advanceTimersByTimeAsync(500);
    expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('Restored');
  });

  it('restore handles nested defaultValues (replaces top-level subtree)', async () => {
    // Pin behavior for non-flat defaults: setFieldValue replaces the entire
    // subtree at the top-level key, so nested objects are restored atomically.
    const NestedSchema = z.object({
      user: z.object({ name: z.string(), email: z.string() }),
    });
    localStorage.setItem(
      'formdraft:nested-test',
      JSON.stringify({
        __v: 1,
        values: { user: { name: 'Stored Name', email: 'stored@x.com' } },
      }),
    );

    function NestedInner() {
      const form = useForm({
        defaultValues: { user: { name: '', email: '' } },
        onSubmit: () => {},
      });
      useFormDraftTanstack(form, {
        key: 'nested-test',
        schema: zodAdapter(NestedSchema),
        storage: localStorageAdapter(),
        syncDebounceMs: 50,
        multiTab: false,
      });
      return (
        <>
          <form.Field name="user.name">
            {(field) => <input data-testid="u-name" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />}
          </form.Field>
          <form.Field name="user.email">
            {(field) => <input data-testid="u-email" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />}
          </form.Field>
        </>
      );
    }

    render(
      <StrictMode>
        <NestedInner />
      </StrictMode>,
    );
    await waitFor(() => {
      expect((screen.getByTestId('u-name') as HTMLInputElement).value).toBe('Stored Name');
    });
    expect((screen.getByTestId('u-email') as HTMLInputElement).value).toBe('stored@x.com');
  });

  it('restore does NOT trigger field-level validators (no errors on un-typed data)', async () => {
    // Round-2 audit (B5): setFieldValue's dontUpdateMeta only suppresses
    // meta writes; validation still runs unless dontValidate is also true.
    // A form with onChange validators would otherwise paint errors against
    // restored text the user never typed.
    localStorage.setItem(
      'formdraft:validate-test',
      JSON.stringify({ __v: 1, values: { name: 'Hi' } }),
    );

    let capturedErrors: unknown[] = [];
    function ValidInner() {
      const form = useForm({
        defaultValues: { name: '' as string },
        onSubmit: () => {},
      });
      useFormDraftTanstack(form, {
        key: 'validate-test',
        schema: zodAdapter(z.object({ name: z.string() })),
        storage: localStorageAdapter(),
        syncDebounceMs: 50,
        multiTab: false,
      });
      return (
        <form.Field
          name="name"
          validators={{
            onChange: ({ value }: { value: string }) =>
              value.length < 5 ? 'too short' : undefined,
          }}
        >
          {(field) => {
            capturedErrors = field.state.meta.errors;
            return (
              <input
                data-testid="name"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            );
          }}
        </form.Field>
      );
    }

    render(
      <StrictMode>
        <ValidInner />
      </StrictMode>,
    );
    await waitFor(() => {
      expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('Hi');
    });
    // No validation error painted — user hasn't typed anything yet
    expect(capturedErrors).toEqual([]);
  });

  it('restores even when useForm omits defaultValues (empty-defaults fallback)', async () => {
    // Round-2 audit (B1): when defaults is `{}` (user didn't pass any),
    // validKeys was empty and restore became a silent no-op. Fall back to
    // the restored keys in that case so the restore still works.
    localStorage.setItem(
      'formdraft:no-defaults',
      JSON.stringify({ __v: 1, values: { name: 'FromStorage' } }),
    );

    function NoDefaultsInner() {
      // Intentionally no defaultValues passed to useForm
      const form = useForm({
        defaultValues: {} as { name?: string },
        onSubmit: () => {},
      });
      useFormDraftTanstack(form, {
        key: 'no-defaults',
        schema: zodAdapter(z.object({ name: z.string() })),
        storage: localStorageAdapter(),
        syncDebounceMs: 50,
        multiTab: false,
      });
      return (
        <form.Field name="name">
          {(field) => (
            <input
              data-testid="name"
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
      );
    }

    render(
      <StrictMode>
        <NoDefaultsInner />
      </StrictMode>,
    );
    await waitFor(() => {
      expect((screen.getByTestId('name') as HTMLInputElement).value).toBe('FromStorage');
    });
  });

  it('user-types-before-restore race: user input wins (deferred storage)', async () => {
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
      const form = useForm({
        defaultValues: { name: '' as string },
        onSubmit: () => {},
      });
      useFormDraftTanstack(form, {
        key: 'slow-tanstack',
        schema: zodAdapter(Schema),
        storage: slowAdapter,
        syncDebounceMs: 50,
        multiTab: false,
      });
      return (
        <form.Field name="name">
          {(field) => (
            <input
              data-testid="name"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
      );
    }

    render(
      <StrictMode>
        <SlowInner />
      </StrictMode>,
    );

    const input = screen.getByTestId('name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'User-typed' } });
    expect(input.value).toBe('User-typed');

    releaseRead!(JSON.stringify({ __v: 1, values: { name: 'Stored' } }));
    await vi.advanceTimersByTimeAsync(200);
    expect(input.value).toBe('User-typed');
  });
});
