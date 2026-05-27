import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useFormDraftStatus } from '../useFormDraftStatus';
import {
  registerDraft,
  _clearRegistryForTests,
  notifySubscribers,
  type RegistryEntry,
} from '../internal/registry';
import { createStatusMachine } from '../internal/statusMachine';

function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    statusMachine: overrides.statusMachine ?? createStatusMachine(),
    saveRef: { current: async () => {} },
    discardRef: { current: () => {} },
    submitRef: { current: () => async () => undefined },
    valuesRef: { current: {} },
    pendingChangesRef: { current: false },
    errorRef: { current: null },
    lastSavedAtRef: { current: null },
    ...overrides,
  };
}

describe('useFormDraftStatus', () => {
  beforeEach(() => _clearRegistryForTests());

  it('returns idle when draft is not registered yet', () => {
    function Probe() {
      const s = useFormDraftStatus('missing');
      return <span data-testid="status">{s.status}</span>;
    }
    render(<Probe />);
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('reflects status from registered draft', () => {
    // In real usage, useFormDraft wires its status machine to fire
    // notifySubscribers on transitions. For this unit test we wire it
    // manually so useFormDraftStatus (which now only subscribes to the
    // registry channel) gets notified.
    const m = createStatusMachine();
    m.subscribe(() => notifySubscribers('k'));
    registerDraft('k', makeEntry({ statusMachine: m }));
    function Probe() {
      const s = useFormDraftStatus('k');
      return <span data-testid="status">{s.status}</span>;
    }
    render(<Probe />);
    expect(screen.getByTestId('status').textContent).toBe('idle');
    act(() => m.send('SAVE_START'));
    expect(screen.getByTestId('status').textContent).toBe('saving');
  });
});
