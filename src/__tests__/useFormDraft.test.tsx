import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useFormDraft } from '../useFormDraft';
import { zodAdapter } from '../internal/schemaValidation';
import { localStorageAdapter } from '../storage/localStorage';
import { _clearRegistryForTests } from '../internal/registry';
import { setOnline } from '../../vitest.setup';

const Schema = z.object({ name: z.string(), age: z.number() });
type V = z.infer<typeof Schema>;

const DEFAULTS: V = { name: '', age: 0 };

function setup(props: Partial<Parameters<typeof useFormDraft<V>>[0]> = {}) {
  const sync = props.sync ?? vi.fn().mockResolvedValue(undefined);
  function Probe() {
    const draft = useFormDraft<V>({
      key: 'test-key',
      schema: zodAdapter(Schema),
      defaultValues: DEFAULTS,
      storage: localStorageAdapter(),
      sync,
      syncDebounceMs: 50,
      multiTab: false,
      ...props,
    });
    return (
      <div>
        <span data-testid="status">{draft.status}</span>
        <span data-testid="name">{draft.values.name}</span>
        <button data-testid="set-name" onClick={() => draft.set('name', 'Alice')} />
        <button data-testid="save" onClick={() => draft.save()} />
        <button data-testid="discard" onClick={() => draft.discard()} />
      </div>
    );
  }
  return { sync, Probe };
}

describe('useFormDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    _clearRegistryForTests();
    setOnline(true);
  });
  afterEach(() => vi.useRealTimers());

  it('mounts with defaultValues when no stored draft', () => {
    const { Probe } = setup();
    render(<Probe />);
    expect(screen.getByTestId('name').textContent).toBe('');
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('persists to storage on set()', async () => {
    const { Probe } = setup();
    render(<Probe />);
    act(() => screen.getByTestId('set-name').click());
    await vi.advanceTimersByTimeAsync(100);
    expect(JSON.parse(localStorage.getItem('formdraft:test-key')!)).toMatchObject({ values: { name: 'Alice' } });
  });

  it('restores from storage on remount', async () => {
    localStorage.setItem(
      'formdraft:test-key',
      JSON.stringify({ __v: 1, values: { name: 'Stored', age: 5 } }),
    );
    const { Probe } = setup();
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('Stored'));
  });

  it('discards stored draft that fails schema, falls back to defaults', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(
      'formdraft:test-key',
      JSON.stringify({ __v: 1, values: { name: 123 } }),
    );
    const { Probe } = setup();
    render(<Probe />);
    await vi.advanceTimersByTimeAsync(50);
    expect(screen.getByTestId('name').textContent).toBe('');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('fires sync after debounce, transitions saving → saved', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const { Probe } = setup({ sync });
    render(<Probe />);
    act(() => screen.getByTestId('set-name').click());
    await vi.advanceTimersByTimeAsync(100);
    expect(sync).toHaveBeenCalledWith({ name: 'Alice', age: 0 });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('saved'));
  });

  it('queues sync when offline; flushes on online', async () => {
    setOnline(false);
    const sync = vi.fn().mockResolvedValue(undefined);
    const { Probe } = setup({ sync });
    render(<Probe />);
    act(() => screen.getByTestId('set-name').click());
    await vi.advanceTimersByTimeAsync(200);
    expect(sync).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('offline'));
    setOnline(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(sync).toHaveBeenCalled();
  });

  it('discard() clears storage and resets to defaults', async () => {
    localStorage.setItem(
      'formdraft:test-key',
      JSON.stringify({ __v: 1, values: { name: 'Stored', age: 5 } }),
    );
    const { Probe } = setup();
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('name').textContent).toBe('Stored'));
    act(() => screen.getByTestId('discard').click());
    expect(screen.getByTestId('name').textContent).toBe('');
    expect(localStorage.getItem('formdraft:test-key')).toBeNull();
  });

  it('honors excludeFields: sensitive fields not persisted but kept in values', async () => {
    const PwdSchema = z.object({ email: z.string(), password: z.string() });
    function Probe() {
      const draft = useFormDraft({
        key: 'pwd',
        schema: zodAdapter(PwdSchema),
        defaultValues: { email: '', password: '' },
        storage: localStorageAdapter(),
        excludeFields: ['password'],
        syncDebounceMs: 50,
        multiTab: false,
      });
      return (
        <div>
          <span data-testid="email">{draft.values.email}</span>
          <span data-testid="password">{draft.values.password}</span>
          <button data-testid="set" onClick={() => { draft.patch({ email: 'a@b.com', password: 'secret' }); }} />
        </div>
      );
    }
    render(<Probe />);
    act(() => screen.getByTestId('set').click());
    await vi.advanceTimersByTimeAsync(100);
    expect(screen.getByTestId('password').textContent).toBe('secret');
    const stored = JSON.parse(localStorage.getItem('formdraft:pwd')!);
    expect(stored.values).toEqual({ email: 'a@b.com' });
    expect(stored.values.password).toBeUndefined();
  });

  it('restores non-excluded fields after refresh even when excludeFields strips required-by-schema fields', async () => {
    // Reproduces the bug from v0.1.0-rc.1 where excludeFields broke the entire restore:
    // - Schema requires `password`
    // - excludeFields strips it from persist
    // - On remount, restore validates stored data → fails (password missing) → all data lost
    const PwdSchema = z.object({ email: z.string(), password: z.string(), name: z.string() });

    // Seed storage as if user typed earlier and password was stripped on persist.
    localStorage.setItem(
      'formdraft:pwd-restore',
      JSON.stringify({ __v: 1, values: { email: 'a@b.com', name: 'Alice' } }),
    );

    function Probe() {
      const draft = useFormDraft({
        key: 'pwd-restore',
        schema: zodAdapter(PwdSchema),
        defaultValues: { email: '', password: '', name: '' },
        storage: localStorageAdapter(),
        excludeFields: ['password'],
        syncDebounceMs: 50,
        multiTab: false,
      });
      return (
        <div>
          <span data-testid="email">{draft.values.email}</span>
          <span data-testid="password">{draft.values.password}</span>
          <span data-testid="name">{draft.values.name}</span>
        </div>
      );
    }

    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('email').textContent).toBe('a@b.com');
    });
    expect(screen.getByTestId('name').textContent).toBe('Alice');
    expect(screen.getByTestId('password').textContent).toBe(''); // not restored (correct)
  });

  it('persists and restores when wrapped in React.StrictMode (mountedRef regression)', async () => {
    // StrictMode mounts → unmounts → remounts in dev. Earlier mountedRef pattern only
    // set false in cleanup, never re-set true on remount, so persist/restore silently
    // no-op'd. This test guards that regression.
    const { Probe } = setup();
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    act(() => screen.getByTestId('set-name').click());
    await vi.advanceTimersByTimeAsync(200);
    const stored = localStorage.getItem('formdraft:test-key');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toMatchObject({ values: { name: 'Alice' } });
  });

  it('disabled=true skips persist and sync', async () => {
    const sync = vi.fn();
    const { Probe } = setup({ sync, disabled: true });
    render(<Probe />);
    act(() => screen.getByTestId('set-name').click());
    await vi.advanceTimersByTimeAsync(200);
    expect(sync).not.toHaveBeenCalled();
    expect(localStorage.getItem('formdraft:test-key')).toBeNull();
  });
});
