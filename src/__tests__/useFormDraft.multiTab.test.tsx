import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useFormDraft } from '../useFormDraft';
import { zodAdapter } from '../internal/schemaValidation';
import { localStorageAdapter } from '../storage/localStorage';
import { _clearRegistryForTests } from '../internal/registry';

// Multi-tab integration: two useFormDraft instances on the same key act as
// two tabs. They share a BroadcastChannel (the test setup shim dispatches
// asynchronously via queueMicrotask, matching real browsers).
//
// We DON'T use fake timers here — broadcast delivery hops microtasks and
// hides under fake-timer machinery; the broadcast debounce in the hook is
// 200ms which we wait through with real timers.

const Schema = z.object({ name: z.string() });
type V = z.infer<typeof Schema>;
const DEFAULTS: V = { name: '' };

type Strategy = 'warn' | 'last-writer-wins' | 'manual';

function makeProbe(
  testId: string,
  strategy: Strategy,
  onConflict?: (local: V, remote: V) => 'local' | 'remote' | V,
) {
  function Inner() {
    const draft = useFormDraft<V>({
      key: 'mt-key',
      schema: zodAdapter(Schema),
      defaultValues: DEFAULTS,
      storage: localStorageAdapter(),
      syncDebounceMs: 50,
      multiTab: strategy,
      onConflict,
    });
    return (
      <div data-testid={`tab-${testId}`}>
        <span data-testid={`${testId}-status`}>{draft.status}</span>
        <span data-testid={`${testId}-name`}>{draft.values.name}</span>
        <span data-testid={`${testId}-conflict`}>
          {draft.onConflictData ? draft.onConflictData.name : ''}
        </span>
        <button data-testid={`${testId}-set`} onClick={() => draft.set('name', `from-${testId}`)} />
        <button
          data-testid={`${testId}-resolve-local`}
          onClick={() => draft.resolveConflict('local')}
        />
        <button
          data-testid={`${testId}-resolve-remote`}
          onClick={() => draft.resolveConflict('remote')}
        />
        <button
          data-testid={`${testId}-resolve-merged`}
          onClick={() => draft.resolveConflict({ name: 'merged' } as V)}
        />
        <button
          data-testid={`${testId}-submit`}
          onClick={() =>
            draft
              .submit(async () => undefined)({ preventDefault: () => {} })
              .catch(() => {})
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

// Wait long enough for: broadcast debounce (200ms) + microtask dispatch.
const waitForBroadcast = (ms = 250) =>
  new Promise<void>((r) => setTimeout(r, ms));

describe('useFormDraft multi-tab', () => {
  beforeEach(() => {
    localStorage.clear();
    _clearRegistryForTests();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("'warn': remote change moves local to 'conflict' with onConflictData populated", async () => {
    const ProbeA = makeProbe('A', 'warn');
    const ProbeB = makeProbe('B', 'warn');
    const { rerender } = render(
      <>
        <ProbeA />
        <ProbeB />
      </>,
    );

    act(() => screen.getByTestId('B-set').click());
    await waitForBroadcast();
    rerender(
      <>
        <ProbeA />
        <ProbeB />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('A-status').textContent).toBe('conflict');
    });
    expect(screen.getByTestId('A-conflict').textContent).toBe('from-B');
  });

  it("'warn' + resolveConflict('remote') adopts remote values and clears conflict", async () => {
    const ProbeA = makeProbe('A', 'warn');
    const ProbeB = makeProbe('B', 'warn');
    render(
      <>
        <ProbeA />
        <ProbeB />
      </>,
    );

    act(() => screen.getByTestId('B-set').click());
    await waitForBroadcast();
    await waitFor(() => expect(screen.getByTestId('A-status').textContent).toBe('conflict'));

    act(() => screen.getByTestId('A-resolve-remote').click());
    await waitFor(() => expect(screen.getByTestId('A-name').textContent).toBe('from-B'));
    expect(screen.getByTestId('A-status').textContent).toBe('idle');
  });

  it("'warn' + resolveConflict('local') keeps local values and clears conflict", async () => {
    const ProbeA = makeProbe('A', 'warn');
    const ProbeB = makeProbe('B', 'warn');
    render(
      <>
        <ProbeA />
        <ProbeB />
      </>,
    );

    act(() => screen.getByTestId('A-set').click()); // A types 'from-A' first
    await waitForBroadcast();
    act(() => screen.getByTestId('B-set').click());
    await waitForBroadcast();

    await waitFor(() => expect(screen.getByTestId('A-status').textContent).toBe('conflict'));
    act(() => screen.getByTestId('A-resolve-local').click());

    expect(screen.getByTestId('A-name').textContent).toBe('from-A');
    expect(screen.getByTestId('A-status').textContent).toBe('idle');
  });

  it("'warn' + resolveConflict(merged) accepts a custom merged object", async () => {
    const ProbeA = makeProbe('A', 'warn');
    const ProbeB = makeProbe('B', 'warn');
    render(
      <>
        <ProbeA />
        <ProbeB />
      </>,
    );

    act(() => screen.getByTestId('B-set').click());
    await waitForBroadcast();
    await waitFor(() => expect(screen.getByTestId('A-status').textContent).toBe('conflict'));

    act(() => screen.getByTestId('A-resolve-merged').click());
    expect(screen.getByTestId('A-name').textContent).toBe('merged');
    expect(screen.getByTestId('A-status').textContent).toBe('idle');
  });

  it("'last-writer-wins' silently adopts remote values (no conflict state)", async () => {
    const ProbeA = makeProbe('A', 'last-writer-wins');
    const ProbeB = makeProbe('B', 'last-writer-wins');
    render(
      <>
        <ProbeA />
        <ProbeB />
      </>,
    );

    act(() => screen.getByTestId('B-set').click());
    await waitForBroadcast();

    await waitFor(() => expect(screen.getByTestId('A-name').textContent).toBe('from-B'));
    expect(screen.getByTestId('A-status').textContent).not.toBe('conflict');
  });

  it("'last-writer-wins' with onConflict can return 'local' to keep current", async () => {
    const onConflict = vi.fn().mockReturnValue('local');
    const ProbeA = makeProbe('A', 'last-writer-wins', onConflict);
    const ProbeB = makeProbe('B', 'last-writer-wins');
    render(
      <>
        <ProbeA />
        <ProbeB />
      </>,
    );

    act(() => screen.getByTestId('A-set').click());
    await waitForBroadcast();
    act(() => screen.getByTestId('B-set').click());
    await waitForBroadcast();

    await waitFor(() => expect(onConflict).toHaveBeenCalled());
    // 'local' wins, A's value stays
    expect(screen.getByTestId('A-name').textContent).toBe('from-A');
  });

  it("'manual' fires onConflict callback but does not auto-adopt", async () => {
    const onConflict = vi.fn();
    const ProbeA = makeProbe('A', 'manual', onConflict);
    const ProbeB = makeProbe('B', 'manual');
    render(
      <>
        <ProbeA />
        <ProbeB />
      </>,
    );

    act(() => screen.getByTestId('B-set').click());
    await waitForBroadcast();

    await waitFor(() => expect(onConflict).toHaveBeenCalled());
    // Library did NOT change A's values
    expect(screen.getByTestId('A-name').textContent).toBe('');
    expect(screen.getByTestId('A-status').textContent).not.toBe('conflict');
  });

  it("'last-writer-wins' onConflict throwing does not escape as an uncaught exception", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ProbeA = makeProbe('A', 'last-writer-wins', () => {
      throw new Error('boom');
    });
    const ProbeB = makeProbe('B', 'last-writer-wins');
    render(
      <>
        <ProbeA />
        <ProbeB />
      </>,
    );

    // B writes; A's onConflict throws. A must NOT crash and must NOT adopt
    // the remote value (since the resolver bailed).
    act(() => screen.getByTestId('B-set').click());
    await waitForBroadcast();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('onConflict threw'),
      expect.any(Error),
    );
    expect(screen.getByTestId('A-name').textContent).toBe('');
    warn.mockRestore();
  });

  it('submit in tab A broadcasts; tab B resets to defaults and clears storage', async () => {
    localStorage.setItem(
      'formdraft:mt-key',
      JSON.stringify({ __v: 1, values: { name: 'pre-existing' } }),
    );

    const ProbeA = makeProbe('A', 'warn');
    const ProbeB = makeProbe('B', 'warn');
    render(
      <>
        <ProbeA />
        <ProbeB />
      </>,
    );

    // Both tabs restore 'pre-existing'
    await waitFor(() => expect(screen.getByTestId('A-name').textContent).toBe('pre-existing'));
    await waitFor(() => expect(screen.getByTestId('B-name').textContent).toBe('pre-existing'));

    act(() => screen.getByTestId('A-submit').click());
    await waitForBroadcast();

    // Tab B observes the submit broadcast and resets
    await waitFor(() => expect(screen.getByTestId('B-name').textContent).toBe(''));
    expect(localStorage.getItem('formdraft:mt-key')).toBeNull();
  });
});
