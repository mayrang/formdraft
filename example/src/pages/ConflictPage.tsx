import { useState } from 'react';
import { z } from 'zod';
import { useFormDraft, zodAdapter, localStorageAdapter } from 'formdraft';
import { ConflictDialog, ConflictResolver } from 'formdraft/ui';

const Schema = z.object({
  title: z.string(),
  body: z.string(),
  tags: z.string(),
});
type V = z.infer<typeof Schema>;
const DEFAULTS: V = { title: '', body: '', tags: '' };

export default function ConflictPage() {
  const [variant, setVariant] = useState<'dialog' | 'headless'>('dialog');
  const draft = useFormDraft<V>({
    key: 'conflict-demo',
    schema: zodAdapter(Schema),
    defaultValues: DEFAULTS,
    storage: localStorageAdapter(),
    multiTab: 'warn',
  });

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <h1 className="title">Conflict UI</h1>
          <p className="subtitle">
            Open this page in two tabs, edit the same field in both, then watch the conflict resolve.
          </p>
        </header>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Variant</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={`button ${variant === 'dialog' ? 'button-primary' : 'button-ghost'}`}
                data-testid="variant-dialog"
                onClick={() => setVariant('dialog')}
              >
                Dialog (styled)
              </button>
              <button
                className={`button ${variant === 'headless' ? 'button-primary' : 'button-ghost'}`}
                data-testid="variant-headless"
                onClick={() => setVariant('headless')}
              >
                Resolver (headless)
              </button>
            </div>
          </div>
          <div className="card-body">
            <div className="field">
              <label className="field-label">Title</label>
              <input
                className="input"
                data-testid="title"
                value={draft.values.title}
                onChange={(e) => draft.set('title', e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">Body</label>
              <textarea
                className="input textarea"
                data-testid="body"
                value={draft.values.body}
                onChange={(e) => draft.set('body', e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">Tags</label>
              <input
                className="input"
                data-testid="tags"
                value={draft.values.tags}
                onChange={(e) => draft.set('tags', e.target.value)}
              />
            </div>
            <p data-testid="status" style={{ fontSize: 13, color: '#555' }}>
              Status: <strong>{draft.status}</strong>
              {draft.onConflictData && (
                <span data-testid="has-conflict" style={{ color: '#b8860b' }}>
                  {' '}
                  • Conflict pending
                </span>
              )}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="button button-ghost" onClick={draft.discard} data-testid="discard">
                Discard
              </button>
            </div>
          </div>
        </div>

        {variant === 'dialog' && <ConflictDialog draft={draft} />}
        {variant === 'headless' && draft.onConflictData && (
          <div data-testid="headless-resolver" className="card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <h2 className="card-title">Resolve conflict (headless)</h2>
            </div>
            <div className="card-body">
              <ConflictResolver<V>
                local={draft.values}
                remote={draft.onConflictData}
                onResolve={draft.resolveConflict}
                renderField={({ name, localValue, remoteValue, pickLocal, pickRemote, picked }) => (
                  <div key={name} className="field" data-testid={`headless-row-${name}`}>
                    <label className="field-label">{name}</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="button button-ghost"
                        onClick={pickLocal}
                        data-testid={`headless-pick-local-${name}`}
                        aria-pressed={picked === 'local'}
                        style={picked === 'local' ? { borderColor: '#1f6feb', color: '#0b3a8a' } : undefined}
                      >
                        Yours: {String(localValue)}
                      </button>
                      <button
                        type="button"
                        className="button button-ghost"
                        onClick={pickRemote}
                        data-testid={`headless-pick-remote-${name}`}
                        aria-pressed={picked === 'remote'}
                        style={picked === 'remote' ? { borderColor: '#1f6feb', color: '#0b3a8a' } : undefined}
                      >
                        Theirs: {String(remoteValue)}
                      </button>
                    </div>
                  </div>
                )}
              >
                {({ fields, apply, canApply, pendingCount }) => (
                  <>
                    {fields}
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={apply}
                      disabled={!canApply}
                      data-testid="headless-apply"
                    >
                      {pendingCount === 0 ? 'Apply' : `Apply (${pendingCount} left)`}
                    </button>
                  </>
                )}
              </ConflictResolver>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
