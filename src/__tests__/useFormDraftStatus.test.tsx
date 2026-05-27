import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useFormDraftStatus } from '../useFormDraftStatus';
import { registerDraft, _clearRegistryForTests } from '../internal/registry';
import { createStatusMachine } from '../internal/statusMachine';

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
    const m = createStatusMachine();
    registerDraft('k', { statusMachine: m, lastSavedAt: null });
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
