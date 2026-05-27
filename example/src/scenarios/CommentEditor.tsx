import { z } from 'zod';
import { useFormDraft, zodAdapter, indexedDBAdapter } from 'formdraft';

const Schema = z.object({
  title: z.string(),
  body: z.string(),
});

type V = z.infer<typeof Schema>;

export function CommentEditor() {
  const draft = useFormDraft<V>({
    key: 'comment-editor',
    schema: zodAdapter(Schema),
    defaultValues: { title: '', body: '' },
    storage: indexedDBAdapter(),
    sync: async (v) => {
      await new Promise((r) => setTimeout(r, 600));
      console.log('[comment sync]', v);
    },
    syncDebounceMs: 2000,
  });

  return (
    <section>
      <h2>Comment Editor (offline-friendly)</h2>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        Status: <strong>{draft.status}</strong>
        {draft.error && <span style={{ color: 'red' }}> · {draft.error.message}</span>}
        {draft.lastSavedAt && <> · saved {draft.lastSavedAt.toLocaleTimeString()}</>}
      </div>
      <label>Title <input value={draft.values.title} onChange={(e) => draft.set('title', e.target.value)} /></label>
      <label>Body <textarea rows={10} value={draft.values.body} onChange={(e) => draft.set('body', e.target.value)} /></label>
      <p style={{ fontSize: 12, color: '#888' }}>
        Try going offline in DevTools, typing, then going back online. The draft will sync automatically.
      </p>
      <button onClick={draft.submit(async (v) => { console.log('Posted:', v); alert('Posted!'); })}>Post</button>
      <button onClick={draft.discard} style={{ marginLeft: 8 }}>Discard</button>
    </section>
  );
}
