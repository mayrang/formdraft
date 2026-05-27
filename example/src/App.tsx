import { z } from 'zod';
import { useFormDraft, zodAdapter, localStorageAdapter } from 'formdraft';
import './App.css';

const Schema = z.object({
  email: z.string(),
  password: z.string(),
  name: z.string(),
  bio: z.string(),
  newsletter: z.boolean(),
  theme: z.enum(['light', 'dark']),
  step: z.number().min(1).max(5),
});

type V = z.infer<typeof Schema>;

const DEFAULTS: V = {
  email: '', password: '', name: '', bio: '',
  newsletter: true, theme: 'light', step: 1,
};

const STEP_LABELS = ['Account', 'Profile', 'Preferences', 'Notifications', 'Confirm'];

export default function App() {
  const draft = useFormDraft<V>({
    key: 'signup-wizard',
    schema: zodAdapter(Schema),
    defaultValues: DEFAULTS,
    storage: localStorageAdapter(),
    sync: async (v) => {
      await new Promise((r) => setTimeout(r, 800));
      console.log('[sync]', v);
    },
    syncDebounceMs: 1500,
    excludeFields: ['password'],
  });

  const next = () => draft.set('step', Math.min(5, draft.values.step + 1) as V['step']);
  const prev = () => draft.set('step', Math.max(1, draft.values.step - 1) as V['step']);

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <h1 className="title">formdraft</h1>
          <p className="subtitle">
            Fill out the form, then <strong>refresh the page</strong>. Your typing survives.
          </p>
        </header>

        <StepIndicator current={draft.values.step} />

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              Step {draft.values.step}: {STEP_LABELS[draft.values.step - 1]}
            </h2>
            <StatusPill status={draft.status} savedAt={draft.lastSavedAt} />
          </div>

          <div className="card-body">
            {draft.values.step === 1 && (
              <>
                <Field label="Email">
                  <input
                    className="input"
                    type="email"
                    placeholder="you@example.com"
                    value={draft.values.email}
                    onChange={(e) => draft.set('email', e.target.value)}
                  />
                </Field>
                <Field label="Password" hint="Excluded from localStorage for security.">
                  <input
                    className="input"
                    type="password"
                    placeholder="••••••••"
                    value={draft.values.password}
                    onChange={(e) => draft.set('password', e.target.value)}
                  />
                </Field>
              </>
            )}

            {draft.values.step === 2 && (
              <>
                <Field label="Name">
                  <input
                    className="input"
                    placeholder="Your name"
                    value={draft.values.name}
                    onChange={(e) => draft.set('name', e.target.value)}
                  />
                </Field>
                <Field label="Bio">
                  <textarea
                    className="input textarea"
                    placeholder="A short bio…"
                    value={draft.values.bio}
                    onChange={(e) => draft.set('bio', e.target.value)}
                  />
                </Field>
              </>
            )}

            {draft.values.step === 3 && (
              <>
                <Field label="Newsletter">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={draft.values.newsletter}
                      onChange={(e) => draft.set('newsletter', e.target.checked)}
                    />
                    <span>Send me product updates monthly</span>
                  </label>
                </Field>
                <Field label="Theme">
                  <div className="radio-group">
                    {(['light', 'dark'] as const).map((t) => (
                      <label
                        key={t}
                        className={`radio-option ${draft.values.theme === t ? 'active' : ''}`}
                      >
                        <input
                          type="radio"
                          checked={draft.values.theme === t}
                          onChange={() => draft.set('theme', t)}
                          style={{ display: 'none' }}
                        />
                        <span style={{ textTransform: 'capitalize' }}>{t}</span>
                      </label>
                    ))}
                  </div>
                </Field>
              </>
            )}

            {draft.values.step === 4 && (
              <div className="placeholder">
                <span style={{ fontSize: 28 }}>🔔</span>
                <p>Notification settings placeholder (extend as you wish).</p>
              </div>
            )}

            {draft.values.step === 5 && (
              <>
                <Field label="Review your draft">
                  <pre className="preview">
                    {JSON.stringify(
                      { ...draft.values, password: draft.values.password ? '••••••' : '' },
                      null,
                      2,
                    )}
                  </pre>
                </Field>
                <button
                  className="button button-primary"
                  onClick={draft.submit(async (v) => {
                    console.log('Submitted:', v);
                    alert('Signed up! Draft cleared.');
                  })}
                >
                  Submit
                </button>
              </>
            )}
          </div>

          <div className="card-footer">
            <button
              className="button button-ghost"
              onClick={prev}
              disabled={draft.values.step === 1}
            >
              ← Back
            </button>
            <button className="button-destructive" onClick={draft.discard}>
              Discard
            </button>
            <button
              className="button button-primary"
              onClick={next}
              disabled={draft.values.step === 5}
              style={{ marginLeft: 'auto' }}
            >
              Next →
            </button>
          </div>
        </div>

        <footer className="footer">
          <p>
            Built with <a className="link" href="https://www.npmjs.com/package/formdraft">formdraft</a>
            {' · '}zero runtime deps · 3.4 KB brotli
          </p>
        </footer>
      </div>
    </div>
  );
}

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="stepper">
      {STEP_LABELS.map((label, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === current;
        const isDone = stepNum < current;
        return (
          <div key={label} className="stepper-item">
            <div
              className={`stepper-dot ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
            >
              {isDone ? '✓' : stepNum}
            </div>
            <span className={`stepper-label ${isActive ? 'active' : ''}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

function StatusPill({ status, savedAt }: { status: string; savedAt: Date | null }) {
  const labels: Record<string, { text: string; cls: string }> = {
    idle: { text: 'Idle', cls: 'pill-idle' },
    saving: { text: 'Saving…', cls: 'pill-saving' },
    saved: {
      text: savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : 'Saved',
      cls: 'pill-saved',
    },
    offline: { text: 'Offline', cls: 'pill-error' },
    error: { text: 'Error', cls: 'pill-error' },
    conflict: { text: 'Conflict', cls: 'pill-saving' },
  };
  const cfg = labels[status] ?? labels.idle;
  return <span className={`pill ${cfg.cls}`}>{cfg.text}</span>;
}
