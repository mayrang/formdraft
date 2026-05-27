import { z } from 'zod';
import { useFormDraft, zodAdapter, sessionStorageAdapter } from 'formdraft';

const Schema = z.object({ note: z.string() });
type V = z.infer<typeof Schema>;
const DEFAULTS: V = { note: '' };

export default function SessionStoragePage() {
  const draft = useFormDraft<V>({
    key: 'session-storage-demo',
    schema: zodAdapter(Schema),
    defaultValues: DEFAULTS,
    storage: sessionStorageAdapter(),
  });

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <h1 className="title">sessionStorageAdapter</h1>
          <p className="subtitle">
            Survives reload, dies when the tab closes. Useful for sensitive drafts you don't want
            persisted across sessions.
          </p>
        </header>
        <div className="card">
          <div className="card-body">
            <div className="field">
              <label className="field-label">Note</label>
              <textarea
                className="input textarea"
                data-testid="note"
                value={draft.values.note}
                onChange={(e) => draft.set('note', e.target.value)}
              />
            </div>
            <p data-testid="status">
              Status: <strong>{draft.status}</strong>
            </p>
            <button className="button button-ghost" data-testid="discard" onClick={draft.discard}>
              Discard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
