import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { ConflictResolver } from './ConflictResolver';
import type { FormDraftResult } from '../types';

export type ConflictDialogProps<T extends Record<string, unknown>> = {
  draft: FormDraftResult<T>;
  title?: string;
  fieldLabels?: Partial<Record<keyof T & string, string>>;
  formatValue?: (value: unknown) => string;
};

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  dialog: {
    background: '#fff',
    color: '#111',
    borderRadius: 8,
    padding: 20,
    minWidth: 360,
    maxWidth: 560,
    maxHeight: '80vh',
    overflow: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    outline: 'none',
  },
  title: { margin: '0 0 4px', fontSize: 18, fontWeight: 600 },
  subtitle: { margin: '0 0 16px', fontSize: 13, color: '#555' },
  fieldRow: { padding: '10px 0', borderTop: '1px solid #eee' },
  fieldName: { fontWeight: 600, marginBottom: 6, fontSize: 14 },
  choices: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  choiceBtn: {
    flex: '1 1 0',
    minWidth: 0,
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid #ccc',
    background: '#fafafa',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: 13,
    color: '#111',
  },
  choiceBtnPicked: {
    borderColor: '#1f6feb',
    background: '#e8f0fe',
    color: '#0b3a8a',
  },
  choiceLabel: { fontSize: 11, color: '#666', display: 'block', marginBottom: 2 },
  choiceValue: {
    fontSize: 13,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  footer: {
    marginTop: 16,
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
  bulkBtn: {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid #ccc',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 12,
    color: '#111',
  },
  applyBtn: {
    padding: '8px 14px',
    borderRadius: 6,
    border: '1px solid #1f6feb',
    background: '#1f6feb',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 13,
  },
  applyBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
};

function defaultFormat(v: unknown): string {
  if (v === null || v === undefined) return '(empty)';
  if (typeof v === 'string') return v === '' ? '(empty)' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function sanitizeForTestId(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function ConflictDialog<T extends Record<string, unknown>>({
  draft,
  title = 'Another tab edited this form',
  fieldLabels,
  formatValue = defaultFormat,
}: ConflictDialogProps<T>): ReactNode {
  // The dominant consumer pattern is to mount <ConflictDialog draft={draft} />
  // unconditionally and let it gate on `draft.onConflictData`. If we hang a
  // mount-time useEffect off the outer component, it fires once before a
  // conflict ever exists (dialog returns null) and never re-fires when one
  // arrives. Split the focus-managing subtree into a child that only mounts
  // when there IS a conflict, so its useEffect tracks the dialog lifecycle.
  if (!draft.onConflictData) return null;
  return (
    <ConflictDialogInner<T>
      draft={draft}
      title={title}
      fieldLabels={fieldLabels}
      formatValue={formatValue}
      remote={draft.onConflictData}
    />
  );
}

function ConflictDialogInner<T extends Record<string, unknown>>({
  draft,
  remote,
  title,
  fieldLabels,
  formatValue,
}: {
  draft: FormDraftResult<T>;
  remote: T;
  title: string;
  fieldLabels: Partial<Record<keyof T & string, string>> | undefined;
  formatValue: (value: unknown) => string;
}): ReactNode {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // Focus on mount, restore on unmount. Safe to use [] deps: this inner
  // component only mounts when a conflict actually exists.
  useEffect(() => {
    const prev = (typeof document !== 'undefined' ? document.activeElement : null) as
      | HTMLElement
      | null;
    const firstButton = dialogRef.current?.querySelector<HTMLButtonElement>(
      'button:not([disabled])',
    );
    (firstButton ?? dialogRef.current)?.focus?.();
    return () => {
      if (prev && typeof document !== 'undefined' && document.body.contains(prev)) {
        prev.focus?.();
      }
    };
  }, []);

  return (
    <ConflictResolver<T>
      local={draft.values as T}
      remote={remote}
      onResolve={draft.resolveConflict}
      renderField={({ name, localValue, remoteValue, pickLocal, pickRemote, picked }) => {
        const safe = sanitizeForTestId(name);
        return (
          <div key={name} style={styles.fieldRow} data-testid={`conflict-row-${safe}`}>
            <div style={styles.fieldName}>{fieldLabels?.[name as keyof T & string] ?? name}</div>
            <div style={styles.choices}>
              <button
                type="button"
                style={{
                  ...styles.choiceBtn,
                  ...(picked === 'local' ? styles.choiceBtnPicked : null),
                }}
                onClick={pickLocal}
                aria-pressed={picked === 'local'}
                data-testid={`conflict-pick-local-${safe}`}
              >
                <span style={styles.choiceLabel}>Yours</span>
                <span style={styles.choiceValue} title={formatValue(localValue)}>
                  {formatValue(localValue)}
                </span>
              </button>
              <button
                type="button"
                style={{
                  ...styles.choiceBtn,
                  ...(picked === 'remote' ? styles.choiceBtnPicked : null),
                }}
                onClick={pickRemote}
                aria-pressed={picked === 'remote'}
                data-testid={`conflict-pick-remote-${safe}`}
              >
                <span style={styles.choiceLabel}>Other tab</span>
                <span style={styles.choiceValue} title={formatValue(remoteValue)}>
                  {formatValue(remoteValue)}
                </span>
              </button>
            </div>
          </div>
        );
      }}
    >
      {({ fields, pickAllLocal, pickAllRemote, apply, keepLocal, canApply, pendingCount, totalCount }) => (
        <div
          style={styles.backdrop}
          role="presentation"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              keepLocal();
            }
          }}
        >
          <div
            ref={dialogRef}
            style={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <h2 id={titleId} style={styles.title}>
              {title}
            </h2>
            <p style={styles.subtitle}>
              {totalCount === 0
                ? 'No differences detected.'
                : `Pick which version to keep for each of the ${totalCount} changed field${totalCount === 1 ? '' : 's'}.`}
            </p>
            {fields}
            <div style={styles.footer}>
              <button type="button" style={styles.bulkBtn} onClick={pickAllLocal}>
                Keep all mine
              </button>
              <button type="button" style={styles.bulkBtn} onClick={pickAllRemote}>
                Take all theirs
              </button>
              <button
                type="button"
                style={{
                  ...styles.applyBtn,
                  ...(canApply ? null : styles.applyBtnDisabled),
                }}
                onClick={apply}
                disabled={!canApply}
                aria-disabled={!canApply}
                data-testid="conflict-apply"
              >
                {pendingCount === 0 ? 'Apply' : `Apply (${pendingCount} left)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConflictResolver>
  );
}
