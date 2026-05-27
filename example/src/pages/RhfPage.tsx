import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodAdapter, localStorageAdapter } from 'formdraft';
import { useFormDraftRHF } from 'formdraft/rhf';

const Schema = z.object({
  username: z.string(),
  email: z.string(),
});
type V = z.infer<typeof Schema>;
const DEFAULTS: V = { username: '', email: '' };

export default function RhfPage() {
  const form = useForm<V>({ defaultValues: DEFAULTS });
  const draft = useFormDraftRHF(form, {
    key: 'rhf-demo',
    schema: zodAdapter(Schema),
    storage: localStorageAdapter(),
  });

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <h1 className="title">React Hook Form adapter</h1>
          <p className="subtitle">RHF owns the form; useFormDraftRHF persists.</p>
        </header>
        <div className="card">
          <div className="card-body">
            <form>
              <div className="field">
                <label className="field-label">Username</label>
                <input className="input" data-testid="username" {...form.register('username')} />
              </div>
              <div className="field">
                <label className="field-label">Email</label>
                <input className="input" data-testid="email" {...form.register('email')} />
              </div>
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
