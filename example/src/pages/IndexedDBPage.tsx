import { z } from 'zod';
import { useFormDraft, zodAdapter, indexedDBAdapter } from 'formdraft';

const Schema = z.object({ note: z.string() });
type V = z.infer<typeof Schema>;
const DEFAULTS: V = { note: '' };

export default function IndexedDBPage() {
  const draft = useFormDraft<V>({
    key: 'indexeddb-demo',
    schema: zodAdapter(Schema),
    defaultValues: DEFAULTS,
    storage: indexedDBAdapter(),
  });

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <h1 className="title">indexedDBAdapter</h1>
          <p className="subtitle">
            Async storage with quota headroom. Browser keeps the data across reloads, tabs, and
            sessions (until explicitly cleared).
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
