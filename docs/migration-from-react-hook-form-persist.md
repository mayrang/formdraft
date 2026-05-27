# Migration from `react-hook-form-persist`

`react-hook-form-persist` was the de-facto leader for React form persistence at 35k weekly downloads. It hasn't shipped a release since 2022-05 and is missing modern needs: no server sync, no offline queue, no multi-tab support, no IndexedDB. This guide migrates your app to `formdraft` in 5 minutes.

## Side-by-side

### Before (`react-hook-form-persist`)

```tsx
import { useForm } from 'react-hook-form';
import useFormPersist from 'react-hook-form-persist';

function ProfileForm() {
  const { register, watch, setValue, handleSubmit } = useForm({
    defaultValues: { name: '', bio: '' },
  });
  useFormPersist('profile-form', { watch, setValue, storage: window.localStorage });

  return (
    <form onSubmit={handleSubmit((v) => api.save(v))}>
      <input {...register('name')} />
      <textarea {...register('bio')} />
      <button type="submit">Save</button>
    </form>
  );
}
```

### After (`formdraft`)

```tsx
import { useForm } from 'react-hook-form';
import { useFormDraftRHF } from 'formdraft/rhf';
import { zodAdapter } from 'formdraft';
import { z } from 'zod';

const Schema = z.object({ name: z.string(), bio: z.string() });

function ProfileForm() {
  const form = useForm({ defaultValues: { name: '', bio: '' } });
  const { status, lastSavedAt, discard } = useFormDraftRHF(form, {
    key: 'profile-form',
    schema: zodAdapter(Schema),
    sync: async (v) => api.save(v),  // NEW: server sync
  });

  return (
    <form onSubmit={form.handleSubmit(async (v) => {
      await api.save(v);
      discard();  // clear draft on success
    })}>
      <input {...form.register('name')} />
      <textarea {...form.register('bio')} />
      <span>{status === 'saved' && `Saved ${lastSavedAt?.toLocaleTimeString()}`}</span>
      <button type="submit">Save</button>
    </form>
  );
}
```

## What you gain

- **Server sync** with retries + exponential backoff
- **Offline queue** — drafts buffered, sync flushes on `online`
- **Multi-tab coordination** — opt-in with `multiTab: 'warn'`
- **Schema validation on restore** — invalid drafts discarded safely
- **Status indicator** — `status` field exposed for UI
- **IndexedDB storage** — for large drafts (markdown bodies, base64 images)

## What you give up

- A 4-year-stale dependency.
- ~3.4 KB additional bundle (formdraft is ~3.4 KB brotli).

## Storage migration

If your existing localStorage has drafts keyed by `react-hook-form-persist`'s scheme, they live at e.g. `react-hook-form-persist:<key>` while formdraft uses `formdraft:<key>`. You can migrate manually on first mount:

```tsx
useEffect(() => {
  const old = localStorage.getItem('react-hook-form-persist:profile-form');
  if (old) {
    try {
      const values = JSON.parse(old);
      localStorage.setItem('formdraft:profile-form', JSON.stringify({ __v: 1, values }));
      localStorage.removeItem('react-hook-form-persist:profile-form');
    } catch {}
  }
}, []);
```

Or just discard old drafts; users will start fresh.
