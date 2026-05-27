import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConflictResolver } from '../ui/ConflictResolver';
import { ConflictDialog } from '../ui/ConflictDialog';
import type { FormDraftResult } from '../types';

type Form = { name: string; bio: string; age: number };

function basicRender(
  args: Parameters<Parameters<typeof ConflictResolver<Form>>[0]['renderField']>[0],
) {
  return (
    <div key={args.name} data-testid={`row-${args.name}`}>
      <span data-testid={`picked-${args.name}`}>{args.picked ?? 'none'}</span>
      <button data-testid={`pl-${args.name}`} onClick={args.pickLocal}>
        local: {String(args.localValue)}
      </button>
      <button data-testid={`pr-${args.name}`} onClick={args.pickRemote}>
        remote: {String(args.remoteValue)}
      </button>
    </div>
  );
}

describe('ConflictResolver (headless)', () => {
  it('renders only fields that differ between local and remote', () => {
    const onResolve = vi.fn();
    render(
      <ConflictResolver<Form>
        local={{ name: 'Alice', bio: 'hi', age: 30 }}
        remote={{ name: 'Alice', bio: 'hello', age: 31 }}
        onResolve={onResolve}
        renderField={basicRender}
      />,
    );
    expect(screen.queryByTestId('row-name')).toBeNull();
    expect(screen.getByTestId('row-bio')).toBeTruthy();
    expect(screen.getByTestId('row-age')).toBeTruthy();
  });

  it('records pickLocal / pickRemote per field and applies merged result', () => {
    const onResolve = vi.fn();
    render(
      <ConflictResolver<Form>
        local={{ name: 'Alice', bio: 'hi', age: 30 }}
        remote={{ name: 'Alice', bio: 'hello', age: 31 }}
        onResolve={onResolve}
        renderField={basicRender}
      >
        {({ fields, apply, canApply, pendingCount }) => (
          <div>
            {fields}
            <span data-testid="pending">{pendingCount}</span>
            <span data-testid="can-apply">{String(canApply)}</span>
            <button data-testid="apply" disabled={!canApply} onClick={apply}>
              apply
            </button>
          </div>
        )}
      </ConflictResolver>,
    );

    expect(screen.getByTestId('pending').textContent).toBe('2');
    expect(screen.getByTestId('can-apply').textContent).toBe('false');

    act(() => fireEvent.click(screen.getByTestId('pl-bio')));
    expect(screen.getByTestId('picked-bio').textContent).toBe('local');
    expect(screen.getByTestId('pending').textContent).toBe('1');

    act(() => fireEvent.click(screen.getByTestId('pr-age')));
    expect(screen.getByTestId('picked-age').textContent).toBe('remote');
    expect(screen.getByTestId('can-apply').textContent).toBe('true');

    act(() => fireEvent.click(screen.getByTestId('apply')));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({ name: 'Alice', bio: 'hi', age: 31 });
  });

  it('pickAllLocal / pickAllRemote shortcut resolves every field at once', () => {
    const onResolve = vi.fn();
    render(
      <ConflictResolver<Form>
        local={{ name: 'A', bio: 'b', age: 1 }}
        remote={{ name: 'A', bio: 'B', age: 2 }}
        onResolve={onResolve}
        renderField={basicRender}
      >
        {({ fields, pickAllLocal, pickAllRemote, apply, canApply }) => (
          <div>
            {fields}
            <button data-testid="all-local" onClick={pickAllLocal}>
              all local
            </button>
            <button data-testid="all-remote" onClick={pickAllRemote}>
              all remote
            </button>
            <button data-testid="apply" disabled={!canApply} onClick={apply}>
              apply
            </button>
            <span data-testid="can-apply">{String(canApply)}</span>
          </div>
        )}
      </ConflictResolver>,
    );

    act(() => fireEvent.click(screen.getByTestId('all-remote')));
    expect(screen.getByTestId('can-apply').textContent).toBe('true');
    expect(screen.getByTestId('picked-bio').textContent).toBe('remote');
    expect(screen.getByTestId('picked-age').textContent).toBe('remote');
    act(() => fireEvent.click(screen.getByTestId('apply')));
    expect(onResolve).toHaveBeenLastCalledWith({ name: 'A', bio: 'B', age: 2 });

    onResolve.mockClear();
    act(() => fireEvent.click(screen.getByTestId('all-local')));
    act(() => fireEvent.click(screen.getByTestId('apply')));
    expect(onResolve).toHaveBeenLastCalledWith({ name: 'A', bio: 'b', age: 1 });
  });

  it('keepLocal resolves to "local" (string), keeping the local copy without merging', () => {
    const onResolve = vi.fn();
    render(
      <ConflictResolver<Form>
        local={{ name: 'A', bio: 'b', age: 1 }}
        remote={{ name: 'A', bio: 'B', age: 1 }}
        onResolve={onResolve}
        renderField={basicRender}
      >
        {({ fields, keepLocal }) => (
          <div>
            {fields}
            <button data-testid="keep-local" onClick={keepLocal}>
              keep local
            </button>
          </div>
        )}
      </ConflictResolver>,
    );
    act(() => fireEvent.click(screen.getByTestId('keep-local')));
    expect(onResolve).toHaveBeenCalledWith('local');
  });

  it('resets per-field picks when the diff key set changes (C1 regression)', () => {
    const onResolve = vi.fn();
    function Host({
      local,
      remote,
    }: {
      local: Form;
      remote: Form;
    }) {
      return (
        <ConflictResolver<Form>
          local={local}
          remote={remote}
          onResolve={onResolve}
          renderField={basicRender}
        >
          {({ fields, pendingCount, canApply }) => (
            <div>
              {fields}
              <span data-testid="pending">{pendingCount}</span>
              <span data-testid="can-apply">{String(canApply)}</span>
            </div>
          )}
        </ConflictResolver>
      );
    }
    const { rerender } = render(
      <Host local={{ name: 'A', bio: 'b', age: 1 }} remote={{ name: 'A', bio: 'B', age: 1 }} />,
    );
    act(() => fireEvent.click(screen.getByTestId('pl-bio')));
    expect(screen.getByTestId('picked-bio').textContent).toBe('local');
    expect(screen.getByTestId('can-apply').textContent).toBe('true');

    // New conflict event: now `name` differs instead of `bio`.
    rerender(<Host local={{ name: 'A', bio: 'b', age: 1 }} remote={{ name: 'C', bio: 'b', age: 1 }} />);
    expect(screen.queryByTestId('row-bio')).toBeNull();
    expect(screen.getByTestId('row-name')).toBeTruthy();
    expect(screen.getByTestId('picked-name').textContent).toBe('none');
    expect(screen.getByTestId('pending').textContent).toBe('1');
    expect(screen.getByTestId('can-apply').textContent).toBe('false');
  });

  it('deletion-aware merge: picking "remote" for a key absent from remote drops the key (C2 regression)', () => {
    type LooseForm = { a: number; b?: number };
    const onResolve = vi.fn();
    render(
      <ConflictResolver<LooseForm>
        local={{ a: 1, b: 2 }}
        remote={{ a: 1 }}
        onResolve={onResolve}
        renderField={basicRender}
      >
        {({ fields, apply, canApply }) => (
          <div>
            {fields}
            <button data-testid="apply" disabled={!canApply} onClick={apply}>
              apply
            </button>
          </div>
        )}
      </ConflictResolver>,
    );
    // `b` is diffed because hasOwnProperty differs even though remote[b] is undefined.
    expect(screen.getByTestId('row-b')).toBeTruthy();
    act(() => fireEvent.click(screen.getByTestId('pr-b')));
    act(() => fireEvent.click(screen.getByTestId('apply')));
    const merged = onResolve.mock.calls[0][0];
    expect('b' in merged).toBe(false);
    expect(merged).toEqual({ a: 1 });
  });

  it('deletion-aware merge: picking "local" for a key absent from local drops the key', () => {
    type LooseForm = { a: number; b?: number };
    const onResolve = vi.fn();
    render(
      <ConflictResolver<LooseForm>
        local={{ a: 1 }}
        remote={{ a: 1, b: 9 }}
        onResolve={onResolve}
        renderField={basicRender}
      >
        {({ fields, apply, canApply }) => (
          <div>
            {fields}
            <button data-testid="apply" disabled={!canApply} onClick={apply}>
              apply
            </button>
          </div>
        )}
      </ConflictResolver>,
    );
    expect(screen.getByTestId('row-b')).toBeTruthy();
    act(() => fireEvent.click(screen.getByTestId('pl-b')));
    act(() => fireEvent.click(screen.getByTestId('apply')));
    const merged = onResolve.mock.calls[0][0];
    expect('b' in merged).toBe(false);
  });

  it('diffKeys distinguishes missing key from explicit undefined value (A1)', () => {
    type LooseForm = { a: number; b?: number };
    const onResolve = vi.fn();
    render(
      <ConflictResolver<LooseForm>
        local={{ a: 1, b: undefined }}
        remote={{ a: 1 }}
        onResolve={onResolve}
        renderField={basicRender}
      />,
    );
    // `b` exists on local but not on remote → must show as diffed even though
    // both values read back as `undefined`.
    expect(screen.getByTestId('row-b')).toBeTruthy();
  });

  it('dev warns when apply() is called with unresolved picks (M3)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onResolve = vi.fn();
    render(
      <ConflictResolver<Form>
        local={{ name: 'A', bio: 'b', age: 1 }}
        remote={{ name: 'A', bio: 'B', age: 2 }}
        onResolve={onResolve}
        renderField={basicRender}
      >
        {({ fields, apply }) => (
          <div>
            {fields}
            {/* deliberately ungated to exercise the warning */}
            <button data-testid="force-apply" onClick={apply}>
              force apply
            </button>
          </div>
        )}
      </ConflictResolver>,
    );
    act(() => fireEvent.click(screen.getByTestId('force-apply')));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unresolved'),
    );
    expect(onResolve).toHaveBeenCalledTimes(1);
    // Un-resolved fields default to local; merged equals local.
    expect(onResolve).toHaveBeenCalledWith({ name: 'A', bio: 'b', age: 1 });
    warn.mockRestore();
  });

  it('diff signature is stable across key-order shuffles in input objects (L1)', () => {
    const onResolve = vi.fn();
    function Host({ local, remote }: { local: Form; remote: Form }) {
      return (
        <ConflictResolver<Form>
          local={local}
          remote={remote}
          onResolve={onResolve}
          renderField={basicRender}
        >
          {({ fields, pendingCount }) => (
            <div>
              {fields}
              <span data-testid="pending">{pendingCount}</span>
            </div>
          )}
        </ConflictResolver>
      );
    }
    const { rerender } = render(
      <Host local={{ name: 'A', bio: 'b', age: 1 }} remote={{ name: 'A', bio: 'B', age: 2 }} />,
    );
    act(() => fireEvent.click(screen.getByTestId('pl-bio')));
    expect(screen.getByTestId('pending').textContent).toBe('1');
    // Same diff set ({bio, age}) but the parent reconstructed inputs with
    // different key insertion order. Picks must survive.
    rerender(
      <Host
        local={{ age: 1, bio: 'b', name: 'A' }}
        remote={{ age: 2, bio: 'B', name: 'A' }}
      />,
    );
    expect(screen.getByTestId('picked-bio').textContent).toBe('local');
    expect(screen.getByTestId('pending').textContent).toBe('1');
  });

  it('survives StrictMode double-mount with picks intact', () => {
    const onResolve = vi.fn();
    render(
      <StrictMode>
        <ConflictResolver<Form>
          local={{ name: 'A', bio: 'b', age: 1 }}
          remote={{ name: 'A', bio: 'B', age: 1 }}
          onResolve={onResolve}
          renderField={basicRender}
        >
          {({ fields, apply, canApply }) => (
            <div>
              {fields}
              <button data-testid="apply" disabled={!canApply} onClick={apply}>
                apply
              </button>
              <span data-testid="can-apply">{String(canApply)}</span>
            </div>
          )}
        </ConflictResolver>
      </StrictMode>,
    );
    act(() => fireEvent.click(screen.getByTestId('pl-bio')));
    expect(screen.getByTestId('can-apply').textContent).toBe('true');
    act(() => fireEvent.click(screen.getByTestId('apply')));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenLastCalledWith({ name: 'A', bio: 'b', age: 1 });
  });

  it('no conflict (objects equal): totalCount=0, apply still resolves cleanly', () => {
    const onResolve = vi.fn();
    render(
      <ConflictResolver<Form>
        local={{ name: 'A', bio: 'b', age: 1 }}
        remote={{ name: 'A', bio: 'b', age: 1 }}
        onResolve={onResolve}
        renderField={basicRender}
      >
        {({ fields, apply, canApply, totalCount }) => (
          <div>
            {fields}
            <span data-testid="total">{totalCount}</span>
            <span data-testid="can-apply">{String(canApply)}</span>
            <button data-testid="apply" onClick={apply}>
              apply
            </button>
          </div>
        )}
      </ConflictResolver>,
    );
    expect(screen.getByTestId('total').textContent).toBe('0');
    expect(screen.getByTestId('can-apply').textContent).toBe('true');
    act(() => fireEvent.click(screen.getByTestId('apply')));
    expect(onResolve).toHaveBeenCalledWith('local');
  });

  it('apply produces a fresh object — does not mutate local or remote', () => {
    const onResolve = vi.fn();
    const local: Form = { name: 'A', bio: 'b', age: 1 };
    const remote: Form = { name: 'A', bio: 'B', age: 2 };
    const localBefore = JSON.stringify(local);
    const remoteBefore = JSON.stringify(remote);
    render(
      <ConflictResolver<Form>
        local={local}
        remote={remote}
        onResolve={onResolve}
        renderField={basicRender}
      >
        {({ fields, pickAllRemote, apply }) => (
          <div>
            {fields}
            <button data-testid="all-remote" onClick={pickAllRemote}>
              all remote
            </button>
            <button data-testid="apply" onClick={apply}>
              apply
            </button>
          </div>
        )}
      </ConflictResolver>,
    );
    act(() => fireEvent.click(screen.getByTestId('all-remote')));
    act(() => fireEvent.click(screen.getByTestId('apply')));
    const merged = onResolve.mock.calls[0][0];
    expect(merged).not.toBe(local);
    expect(merged).not.toBe(remote);
    expect(JSON.stringify(local)).toBe(localBefore);
    expect(JSON.stringify(remote)).toBe(remoteBefore);
  });
});

describe('ConflictDialog (styled)', () => {
  function fakeDraft(overrides?: Partial<FormDraftResult<Form>>): FormDraftResult<Form> {
    const resolve = vi.fn();
    return {
      values: { name: 'Alice', bio: 'hi', age: 30 },
      set: vi.fn(),
      patch: vi.fn(),
      status: 'conflict',
      lastSavedAt: null,
      pendingChanges: false,
      error: null,
      save: vi.fn(),
      discard: vi.fn(),
      submit: vi.fn(),
      onConflictData: { name: 'Alice', bio: 'hello', age: 31 },
      resolveConflict: resolve,
      ...overrides,
    } as FormDraftResult<Form>;
  }

  it('renders nothing when there is no onConflictData', () => {
    const { container } = render(
      <ConflictDialog draft={fakeDraft({ onConflictData: null })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders only diffed fields with default markup; clicking apply calls resolveConflict with merged values', () => {
    const draft = fakeDraft();
    render(<ConflictDialog draft={draft} />);

    expect(screen.queryByTestId('conflict-row-name')).toBeNull();
    expect(screen.getByTestId('conflict-row-bio')).toBeTruthy();
    expect(screen.getByTestId('conflict-row-age')).toBeTruthy();

    const applyBtn = screen.getByTestId('conflict-apply') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);

    act(() => fireEvent.click(screen.getByTestId('conflict-pick-remote-bio')));
    act(() => fireEvent.click(screen.getByTestId('conflict-pick-local-age')));
    expect(applyBtn.disabled).toBe(false);

    act(() => fireEvent.click(applyBtn));
    expect(draft.resolveConflict).toHaveBeenCalledWith({
      name: 'Alice',
      bio: 'hello',
      age: 30,
    });
  });

  it('Esc keydown resolves with local (H1 regression)', () => {
    const draft = fakeDraft();
    render(<ConflictDialog draft={draft} />);
    const dialog = screen.getByRole('dialog');
    act(() => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(draft.resolveConflict).toHaveBeenCalledWith('local');
  });

  it('moves focus into the dialog when conflict arrives AFTER mount (H1 deferred-show)', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const draftBefore = fakeDraft({ onConflictData: null });
    const { rerender } = render(<ConflictDialog draft={draftBefore} />);
    // No dialog yet; focus stays on trigger.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // Conflict arrives in a later render.
    const draftAfter = fakeDraft();
    rerender(<ConflictDialog draft={draftAfter} />);
    const dialog = screen.getByRole('dialog');
    expect(
      dialog.contains(document.activeElement) || document.activeElement === dialog,
    ).toBe(true);
    document.body.removeChild(trigger);
  });

  it('moves focus into the dialog on mount and restores it on unmount', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const draft = fakeDraft();
    const { unmount } = render(<ConflictDialog draft={draft} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement) || document.activeElement === dialog).toBe(true);

    unmount();
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });
});
