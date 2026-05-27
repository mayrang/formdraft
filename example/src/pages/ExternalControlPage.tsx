import { useState } from 'react';
import { z } from 'zod';
import {
  useFormDraft,
  zodAdapter,
  localStorageAdapter,
  getFormDraft,
  useFormDraftStatus,
} from 'formdraft';

const Schema = z.object({
  subject: z.string(),
  message: z.string(),
});
type V = z.infer<typeof Schema>;
const DEFAULTS: V = { subject: '', message: '' };

const KEY = 'external-control-demo';

export default function ExternalControlPage() {
  const draft = useFormDraft<V>({
    key: KEY,
    schema: zodAdapter(Schema),
    defaultValues: DEFAULTS,
    storage: localStorageAdapter(),
    sync: async () => {
      await new Promise((r) => setTimeout(r, 600));
    },
  });

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <h1 className="title">External control</h1>
          <p className="subtitle">
            Sibling components read status and call save/discard via <code>getFormDraft(KEY)</code> + <code>useFormDraftStatus(KEY)</code>.
          </p>
        </header>
        <div className="card">
          <div className="card-body">
            <div className="field">
              <label className="field-label">Subject</label>
              <input
                className="input"
                data-testid="subject"
                value={draft.values.subject}
                onChange={(e) => draft.set('subject', e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">Message</label>
              <textarea
                className="input textarea"
                data-testid="message"
                value={draft.values.message}
                onChange={(e) => draft.set('message', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <h2 className="card-title">Status reader (sibling)</h2>
          </div>
          <div className="card-body">
            <StatusReader />
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <h2 className="card-title">Action panel (sibling)</h2>
          </div>
          <div className="card-body">
            <ActionPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusReader() {
  const s = useFormDraftStatus(KEY);
  return (
    <p data-testid="reader-status" style={{ fontSize: 13 }}>
      Status from <code>useFormDraftStatus</code>: <strong data-testid="reader-status-value">{s.status}</strong>
      {' · '}lastSavedAt: <span data-testid="reader-saved-at">{s.lastSavedAt ? s.lastSavedAt.toISOString() : 'null'}</span>
    </p>
  );
}

function ActionPanel() {
  const [lastValues, setLastValues] = useState<string>('—');
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button
        className="button button-ghost"
        data-testid="external-save"
        onClick={async () => {
          const h = getFormDraft<V>(KEY);
          if (!h) return;
          await h.save();
        }}
      >
        save()
      </button>
      <button
        className="button button-ghost"
        data-testid="external-discard"
        onClick={() => {
          const h = getFormDraft<V>(KEY);
          h?.discard();
        }}
      >
        discard()
      </button>
      <button
        className="button button-ghost"
        data-testid="external-read"
        onClick={() => {
          const h = getFormDraft<V>(KEY);
          if (!h) {
            setLastValues('handle missing');
            return;
          }
          setLastValues(JSON.stringify(h.getValues()));
        }}
      >
        getValues()
      </button>
      <span data-testid="last-values" style={{ fontFamily: 'monospace', fontSize: 12 }}>
        {lastValues}
      </span>
    </div>
  );
}
