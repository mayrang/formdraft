import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { zodAdapter, localStorageAdapter } from 'formdraft';
import { useFormDraftTanstack } from 'formdraft/tanstack-form';

const Schema = z.object({
  fullName: z.string(),
  role: z.string(),
});
type V = z.infer<typeof Schema>;
const DEFAULTS: V = { fullName: '', role: '' };

export default function TanstackPage() {
  const form = useForm({
    defaultValues: DEFAULTS,
    onSubmit: () => {},
  });
  // TanStack's `ReactFormExtendedApi` typing for `setFieldValue` narrows the
  // field key to a literal union of the form's keys, but our adapter uses a
  // broader `(field: string, ...)` signature. Both are runtime-compatible —
  // the cast just bridges the variance gap.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draft = useFormDraftTanstack<V>(form as any, {
    key: 'tanstack-demo',
    schema: zodAdapter(Schema),
    storage: localStorageAdapter(),
  });

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <h1 className="title">TanStack Form adapter</h1>
          <p className="subtitle">@tanstack/react-form owns the form; useFormDraftTanstack persists.</p>
        </header>
        <div className="card">
          <div className="card-body">
            <form>
              <form.Field name="fullName">
                {(field) => (
                  <div className="field">
                    <label className="field-label">Full name</label>
                    <input
                      className="input"
                      data-testid="fullName"
                      name={field.name}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>
              <form.Field name="role">
                {(field) => (
                  <div className="field">
                    <label className="field-label">Role</label>
                    <input
                      className="input"
                      data-testid="role"
                      name={field.name}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>
            </form>
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
