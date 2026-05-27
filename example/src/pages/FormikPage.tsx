import { useFormik } from 'formik';
import { z } from 'zod';
import { zodAdapter, localStorageAdapter } from 'formdraft';
import { useFormDraftFormik } from 'formdraft/formik';

const Schema = z.object({
  fullName: z.string(),
  company: z.string(),
});
type V = z.infer<typeof Schema>;
const DEFAULTS: V = { fullName: '', company: '' };

export default function FormikPage() {
  const formik = useFormik<V>({
    initialValues: DEFAULTS,
    onSubmit: () => {},
  });
  const draft = useFormDraftFormik(formik, {
    key: 'formik-demo',
    schema: zodAdapter(Schema),
    storage: localStorageAdapter(),
  });

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <h1 className="title">Formik adapter</h1>
          <p className="subtitle">Formik owns the form; useFormDraftFormik persists.</p>
        </header>
        <div className="card">
          <div className="card-body">
            <form>
              <div className="field">
                <label className="field-label">Full name</label>
                <input className="input" data-testid="fullName" {...formik.getFieldProps('fullName')} />
              </div>
              <div className="field">
                <label className="field-label">Company</label>
                <input className="input" data-testid="company" {...formik.getFieldProps('company')} />
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
