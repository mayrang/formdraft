import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerDraft,
  getDraft,
  subscribeRegistry,
  _clearRegistryForTests,
} from '../registry';
import { createStatusMachine } from '../statusMachine';

describe('registry', () => {
  beforeEach(() => _clearRegistryForTests());

  it('register + get returns the same instance', () => {
    const entry = { statusMachine: createStatusMachine(), lastSavedAt: null };
    registerDraft('k1', entry);
    expect(getDraft('k1')).toBe(entry);
  });

  it('get returns undefined for unknown key', () => {
    expect(getDraft('k-missing')).toBeUndefined();
  });

  it('register twice with same key overwrites', () => {
    const e1 = { statusMachine: createStatusMachine(), lastSavedAt: null };
    const e2 = { statusMachine: createStatusMachine(), lastSavedAt: null };
    registerDraft('k', e1);
    registerDraft('k', e2);
    expect(getDraft('k')).toBe(e2);
  });

  it('subscribeRegistry fires when entry registered', () => {
    const fn = vi.fn();
    const unsub = subscribeRegistry('k', fn);
    const e = { statusMachine: createStatusMachine(), lastSavedAt: null };
    registerDraft('k', e);
    expect(fn).toHaveBeenCalled();
    unsub();
  });
});
