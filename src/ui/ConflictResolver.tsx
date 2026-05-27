import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ConflictFieldRenderArgs = {
  name: string;
  localValue: unknown;
  remoteValue: unknown;
  pickLocal: () => void;
  pickRemote: () => void;
  picked: 'local' | 'remote' | null;
};

export type ConflictResolverChildrenArgs = {
  fields: ReactNode;
  pickAllLocal: () => void;
  pickAllRemote: () => void;
  apply: () => void;
  /**
   * Resolve immediately with the local copy, discarding remote without merge.
   * Destructive — clears `onConflictData` upstream. Use for "close = keep mine"
   * shortcuts (Esc, explicit "Keep mine" button), not as a generic dismiss.
   */
  keepLocal: () => void;
  canApply: boolean;
  pendingCount: number;
  totalCount: number;
};

export type ConflictResolverProps<T extends Record<string, unknown>> = {
  local: T;
  remote: T;
  onResolve: (choice: 'local' | 'remote' | T) => void;
  renderField: (args: ConflictFieldRenderArgs) => ReactNode;
  children?: (args: ConflictResolverChildrenArgs) => ReactNode;
};

function diffKeys(local: Record<string, unknown>, remote: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const obj of [local, remote]) {
    for (const k of Object.keys(obj)) {
      if (seen.has(k)) continue;
      seen.add(k);
      const lHas = Object.prototype.hasOwnProperty.call(local, k);
      const rHas = Object.prototype.hasOwnProperty.call(remote, k);
      if (lHas !== rHas) {
        out.push(k);
        continue;
      }
      if (!Object.is(local[k], remote[k])) out.push(k);
    }
  }
  return out;
}

export function ConflictResolver<T extends Record<string, unknown>>({
  local,
  remote,
  onResolve,
  renderField,
  children,
}: ConflictResolverProps<T>): ReactNode {
  const diffed = useMemo(() => diffKeys(local, remote), [local, remote]);
  // Stringify (not join) so the signature is robust against key-order changes
  // upstream and against pathological key characters (NUL, separators). Two
  // diff sets with the same content but different orders should produce the
  // same signature so we don't wipe in-progress picks.
  const diffSignature = useMemo(() => JSON.stringify([...diffed].sort()), [diffed]);

  const [picks, setPicks] = useState<Record<string, 'local' | 'remote'>>({});

  // Round-2 fix (C1): when the conflict set itself changes (new conflict event,
  // remote re-broadcast with different fields), the stale per-field picks must
  // not leak into the new resolution. We key on the diff-key signature rather
  // than `local`/`remote` identity so unrelated re-renders (same conflict,
  // different parent state) don't wipe in-progress picks.
  useEffect(() => {
    setPicks({});
  }, [diffSignature]);

  const pickField = useCallback((name: string, side: 'local' | 'remote') => {
    setPicks((p) => ({ ...p, [name]: side }));
  }, []);

  const pickAllLocal = useCallback(() => {
    setPicks(() => {
      const next: Record<string, 'local' | 'remote'> = {};
      for (const k of diffed) next[k] = 'local';
      return next;
    });
  }, [diffed]);

  const pickAllRemote = useCallback(() => {
    setPicks(() => {
      const next: Record<string, 'local' | 'remote'> = {};
      for (const k of diffed) next[k] = 'remote';
      return next;
    });
  }, [diffed]);

  const apply = useCallback(() => {
    if (diffed.length === 0) {
      onResolve('local');
      return;
    }
    if (process.env.NODE_ENV !== 'production') {
      const unresolved = diffed.filter((k) => !picks[k]);
      if (unresolved.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[formdraft] ConflictResolver.apply() called with ${unresolved.length} unresolved field${unresolved.length === 1 ? '' : 's'} (${JSON.stringify(unresolved)}). These will keep the local value. Gate apply() on \`canApply\` to surface unresolved picks to the user.`,
        );
      }
    }
    const merged: Record<string, unknown> = { ...local };
    for (const k of diffed) {
      const side = picks[k];
      // Round-2 fix (C2 + A1): handle deletion symmetrically. If the chosen
      // side does not have the key, drop it from the merged result rather than
      // leaving `undefined` behind. Otherwise round-tripping through e.g.
      // setValues leaves the key present-with-undefined, which diverges from
      // post-JSON.stringify storage state.
      if (side === 'remote') {
        if (Object.prototype.hasOwnProperty.call(remote, k)) {
          merged[k] = remote[k];
        } else {
          delete merged[k];
        }
      } else if (side === 'local') {
        if (!Object.prototype.hasOwnProperty.call(local, k)) {
          delete merged[k];
        }
      }
    }
    onResolve(merged as T);
  }, [diffed, local, remote, onResolve, picks]);

  const keepLocal = useCallback(() => {
    onResolve('local');
  }, [onResolve]);

  const fieldNodes = diffed.map((name) =>
    renderField({
      name,
      localValue: local[name],
      remoteValue: remote[name],
      pickLocal: () => pickField(name, 'local'),
      pickRemote: () => pickField(name, 'remote'),
      picked: picks[name] ?? null,
    }),
  );

  const pendingCount = diffed.reduce((n, k) => (picks[k] ? n : n + 1), 0);
  const canApply = pendingCount === 0;

  if (children) {
    return children({
      fields: <>{fieldNodes}</>,
      pickAllLocal,
      pickAllRemote,
      apply,
      keepLocal,
      canApply,
      pendingCount,
      totalCount: diffed.length,
    });
  }
  return <>{fieldNodes}</>;
}
