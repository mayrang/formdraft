import { z } from 'zod';
import { useFormDraft, zodAdapter, indexedDBAdapter } from 'formdraft';

const Schema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string(),
  bio: z.string(),
  twitter: z.string(),
  github: z.string(),
  website: z.string(),
  emailNotifications: z.boolean(),
  pushNotifications: z.boolean(),
  digestFrequency: z.enum(['daily', 'weekly', 'never']),
});

type V = z.infer<typeof Schema>;

const DEFAULTS: V = {
  firstName: '', lastName: '', email: '', phone: '',
  bio: '', twitter: '', github: '', website: '',
  emailNotifications: true, pushNotifications: false, digestFrequency: 'weekly',
};

export function ProfileSettings() {
  const draft = useFormDraft<V>({
    key: 'profile-settings',
    schema: zodAdapter(Schema),
    defaultValues: DEFAULTS,
    storage: indexedDBAdapter(),
    sync: async (v) => {
      await new Promise((r) => setTimeout(r, 500));
      console.log('[profile sync]', v);
    },
    syncDebounceMs: 1500,
    multiTab: 'warn',
  });

  return (
    <section>
      <h2>Profile Settings</h2>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        Status: <strong>{draft.status}</strong>
        {draft.lastSavedAt && <> · saved {draft.lastSavedAt.toLocaleTimeString()}</>}
      </div>

      {draft.onConflictData && (
        <div style={{ background: '#fff3cd', padding: 12, marginBottom: 12, borderRadius: 6 }}>
          ⚠ Another tab edited this form. <button onClick={() => draft.resolveConflict('remote')}>Use their version</button> <button onClick={() => draft.resolveConflict('local')}>Keep mine</button>
        </div>
      )}

      <fieldset>
        <legend>Personal</legend>
        <label>First Name <input value={draft.values.firstName} onChange={(e) => draft.set('firstName', e.target.value)} /></label>
        <label>Last Name <input value={draft.values.lastName} onChange={(e) => draft.set('lastName', e.target.value)} /></label>
        <label>Email <input value={draft.values.email} onChange={(e) => draft.set('email', e.target.value)} /></label>
        <label>Phone <input value={draft.values.phone} onChange={(e) => draft.set('phone', e.target.value)} /></label>
        <label>Bio <textarea value={draft.values.bio} onChange={(e) => draft.set('bio', e.target.value)} /></label>
      </fieldset>
      <fieldset>
        <legend>Social</legend>
        <label>Twitter <input value={draft.values.twitter} onChange={(e) => draft.set('twitter', e.target.value)} /></label>
        <label>GitHub <input value={draft.values.github} onChange={(e) => draft.set('github', e.target.value)} /></label>
        <label>Website <input value={draft.values.website} onChange={(e) => draft.set('website', e.target.value)} /></label>
      </fieldset>
      <fieldset>
        <legend>Notifications</legend>
        <label><input type="checkbox" checked={draft.values.emailNotifications} onChange={(e) => draft.set('emailNotifications', e.target.checked)} /> Email notifications</label>
        <label><input type="checkbox" checked={draft.values.pushNotifications} onChange={(e) => draft.set('pushNotifications', e.target.checked)} /> Push notifications</label>
        <label>Digest <select value={draft.values.digestFrequency} onChange={(e) => draft.set('digestFrequency', e.target.value as V['digestFrequency'])}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="never">Never</option>
        </select></label>
      </fieldset>

      <button onClick={draft.discard}>Discard all</button>
    </section>
  );
}
