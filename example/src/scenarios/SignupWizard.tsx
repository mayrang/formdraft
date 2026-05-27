import { z } from 'zod';
import { useFormDraft, zodAdapter, localStorageAdapter } from 'formdraft';

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
  email: '',
  password: '',
  name: '',
  bio: '',
  newsletter: true,
  theme: 'light',
  step: 1,
};

export function SignupWizard() {
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

  const next = () => draft.set('step', Math.min(5, draft.values.step + 1) as 5);
  const prev = () => draft.set('step', Math.max(1, draft.values.step - 1) as 1);

  return (
    <section>
      <h2>Step {draft.values.step} of 5</h2>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        Status: <strong>{draft.status}</strong>
        {draft.lastSavedAt && <> · last saved {draft.lastSavedAt.toLocaleTimeString()}</>}
      </div>

      {draft.values.step === 1 && (
        <>
          <label>Email <input value={draft.values.email} onChange={(e) => draft.set('email', e.target.value)} /></label>
          <label>Password <input type="password" value={draft.values.password} onChange={(e) => draft.set('password', e.target.value)} /></label>
        </>
      )}
      {draft.values.step === 2 && (
        <>
          <label>Name <input value={draft.values.name} onChange={(e) => draft.set('name', e.target.value)} /></label>
          <label>Bio <textarea value={draft.values.bio} onChange={(e) => draft.set('bio', e.target.value)} /></label>
        </>
      )}
      {draft.values.step === 3 && (
        <>
          <label><input type="checkbox" checked={draft.values.newsletter} onChange={(e) => draft.set('newsletter', e.target.checked)} /> Newsletter</label>
          <fieldset>
            <legend>Theme</legend>
            <label><input type="radio" checked={draft.values.theme === 'light'} onChange={() => draft.set('theme', 'light')} /> Light</label>
            <label><input type="radio" checked={draft.values.theme === 'dark'} onChange={() => draft.set('theme', 'dark')} /> Dark</label>
          </fieldset>
        </>
      )}
      {draft.values.step === 4 && (
        <div>Step 4 — Notification settings (placeholder)</div>
      )}
      {draft.values.step === 5 && (
        <div>
          <h3>Confirm</h3>
          <pre>{JSON.stringify({ ...draft.values, password: '••••' }, null, 2)}</pre>
          <button onClick={draft.submit(async (v) => {
            console.log('Submitted:', v);
            alert('Signed up! (draft cleared)');
          })}>Submit</button>
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button onClick={prev} disabled={draft.values.step === 1}>Back</button>
        <button onClick={next} disabled={draft.values.step === 5}>Next</button>
        <button onClick={draft.discard} style={{ marginLeft: 'auto' }}>Discard</button>
      </div>
    </section>
  );
}
