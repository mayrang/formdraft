import { describe, expect, it } from 'vitest';
import { createStatusMachine } from '../statusMachine';

describe('createStatusMachine', () => {
  it('starts at idle', () => {
    const m = createStatusMachine();
    expect(m.getStatus()).toBe('idle');
  });

  it('transitions idle → saving → saved', () => {
    const m = createStatusMachine();
    m.send('SAVE_START');
    expect(m.getStatus()).toBe('saving');
    m.send('SAVE_SUCCESS');
    expect(m.getStatus()).toBe('saved');
  });

  it('transitions saving → error on SAVE_FAIL', () => {
    const m = createStatusMachine();
    m.send('SAVE_START');
    m.send('SAVE_FAIL');
    expect(m.getStatus()).toBe('error');
  });

  it('OFFLINE during saving moves to offline', () => {
    const m = createStatusMachine();
    m.send('SAVE_START');
    m.send('OFFLINE');
    expect(m.getStatus()).toBe('offline');
  });

  it('ONLINE from offline restores to idle', () => {
    const m = createStatusMachine();
    m.send('OFFLINE');
    expect(m.getStatus()).toBe('offline');
    m.send('ONLINE');
    expect(m.getStatus()).toBe('idle');
  });

  it('CONFLICT can be triggered from any state', () => {
    const m = createStatusMachine();
    m.send('SAVE_START');
    m.send('CONFLICT');
    expect(m.getStatus()).toBe('conflict');
  });

  it('RESOLVE moves conflict → idle', () => {
    const m = createStatusMachine();
    m.send('CONFLICT');
    m.send('RESOLVE');
    expect(m.getStatus()).toBe('idle');
  });

  it('subscribe() fires on transition', () => {
    const m = createStatusMachine();
    const seen: string[] = [];
    const unsub = m.subscribe(() => seen.push(m.getStatus()));
    m.send('SAVE_START');
    m.send('SAVE_SUCCESS');
    expect(seen).toEqual(['saving', 'saved']);
    unsub();
    m.send('SAVE_START');
    expect(seen).toEqual(['saving', 'saved']);
  });

  it('SAVE_FAIL from idle transitions to error (storage quota etc.)', () => {
    // Persist failures happen outside of saving — previously dropped, leaving
    // error state set while status indicator still showed idle.
    const m = createStatusMachine();
    m.send('SAVE_FAIL');
    expect(m.getStatus()).toBe('error');
  });

  it('conflict cannot be silently exited by SAVE_START — only RESOLVE/RESET', () => {
    // Regression: in-flight sync would mask multi-tab conflict warning before
    // user acknowledged it. Now SAVE_START is dropped from conflict state.
    const m = createStatusMachine();
    m.send('CONFLICT');
    m.send('SAVE_START');
    expect(m.getStatus()).toBe('conflict');
    m.send('RESET');
    expect(m.getStatus()).toBe('idle');
  });

  it('idle → idle does not notify subscribers', () => {
    const m = createStatusMachine();
    const seen: string[] = [];
    m.subscribe(() => seen.push(m.getStatus()));
    m.send('SAVE_SUCCESS');
    expect(seen).toEqual([]);
  });
});
