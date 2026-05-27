import { useState } from 'react';
import { z } from 'zod';
import { useFormDraft, zodAdapter, autoAdapter } from 'formdraft';

const Schema = z.object({
  note: z.string(),
  padding: z.string(),
});
type V = z.infer<typeof Schema>;
const DEFAULTS: V = { note: '', padding: '' };

const KEY = 'auto-storage-demo';
const SMALL_THRESHOLD = 5_000;

export default function AutoStoragePage() {
  const [migrationLog, setMigrationLog] = useState<Array<{ key: string; reason: string }>>([]);

  const draft = useFormDraft<V>({
    key: KEY,
    schema: zodAdapter(Schema),
    defaultValues: DEFAULTS,
    storage: autoAdapter({
      thresholdBytes: SMALL_THRESHOLD,
      onMigration: (key, reason) => setMigrationLog((l) => [...l, { key, reason }]),
    }),
  });

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <h1 className="title">autoAdapter</h1>
          <p className="subtitle">
            Stays on localStorage until the serialized payload crosses {SMALL_THRESHOLD} chars,
            then transparently migrates the key to IndexedDB.
          </p>
        </header>
        <div className="card">
          <div className="card-body">
            <div className="field">
              <label className="field-label">Note (any size)</label>
              <textarea
                className="input textarea"
                data-testid="note"
                value={draft.values.note}
                onChange={(e) => draft.set('note', e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">Padding (auto-grow)</label>
              <p className="field-hint">Used to push the payload past the threshold quickly.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="button button-ghost"
                  data-testid="bloat"
                  onClick={() => draft.set('padding', 'A'.repeat(10_000))}
                >
                  Bloat to 10k
                </button>
                <button
                  className="button button-ghost"
                  data-testid="trim"
                  onClick={() => draft.set('padding', '')}
                >
                  Trim
                </button>
              </div>
              <p data-testid="padding-size" className="field-hint">
                Padding size: {draft.values.padding.length} chars
              </p>
            </div>
            <p data-testid="status">
              Status: <strong>{draft.status}</strong>
            </p>
            <p data-testid="migration-count" style={{ fontSize: 13 }}>
              Migrations seen: <strong>{migrationLog.length}</strong>
            </p>
            {migrationLog.length > 0 && (
              <ul data-testid="migration-log" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                {migrationLog.map((m, i) => (
                  <li key={i}>
                    {m.key} → {m.reason}
                  </li>
                ))}
              </ul>
            )}
            <button className="button button-ghost" onClick={draft.discard} data-testid="discard">
              Discard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
