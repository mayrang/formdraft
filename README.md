# formdraft

> Production-grade form auto-save + offline survival for React. Zero runtime dependencies.

When your user fills out a long form, the form survives:
- Page refresh
- Tab close + reopen
- Going offline mid-typing
- Editing the same form in two tabs
- Failed server saves (with retry)

## Install

```bash
npm install formdraft
# peers (you probably already have these):
npm install react react-hook-form zod
```

`react-hook-form` and `zod` are optional peer dependencies. Use only what you need.

## Quick start

```tsx
import { useFormDraft, zodAdapter, localStorageAdapter } from 'formdraft';
import { z } from 'zod';

const Schema = z.object({ name: z.string(), bio: z.string() });

function ProfileForm() {
  const { values, set, status, save, discard, submit } = useFormDraft({
    key: 'profile-form',
    schema: zodAdapter(Schema),
    defaultValues: { name: '', bio: '' },
    sync: async (v) => api.saveProfile(v),
  });

  return (
    <form onSubmit={submit(async (v) => { await api.submitProfile(v); })}>
      <input value={values.name} onChange={(e) => set('name', e.target.value)} />
      <textarea value={values.bio} onChange={(e) => set('bio', e.target.value)} />
      <span>{status}</span>
      <button type="submit">Save</button>
    </form>
  );
}
```

Refresh the page. Your typing survives.

## React Hook Form integration

```tsx
import { useForm } from 'react-hook-form';
import { useFormDraftRHF } from 'formdraft/rhf';

const form = useForm({ defaultValues: { name: '' } });
const { status } = useFormDraftRHF(form, { key: 'rhf-profile', schema: zodAdapter(Schema), sync: api.save });

return <form>{/* form.register, etc. */}<span>{status}</span></form>;
```

## What it handles

| Production form pain | formdraft |
|---|---|
| Refresh loses 20 minutes of typing | localStorage persist + mount restore |
| Server save fails silently | retry queue with exponential backoff |
| Offline write then reconnect | `online` + `visibilitychange` flush |
| Captive portal (`onLine=true` but no internet) | actual fetch determines success |
| Two tabs editing same draft | BroadcastChannel + `multiTab='warn'` |
| Tab A submits, Tab B keeps stale draft | submit broadcast → all tabs discard |
| Component unmounts mid-sync | guarded; no setState-on-unmounted warnings |
| Password in localStorage | `excludeFields: ['password']` |
| Schema changed between sessions | `version` + `migrate(fn)` |
| Large content (rich text, base64 images) | IndexedDB adapter |
| 4-byte structured-clone class loss | dev-mode warning |

## Storage adapters

```tsx
import { localStorageAdapter, sessionStorageAdapter, indexedDBAdapter } from 'formdraft';

useFormDraft({ ..., storage: indexedDBAdapter() });  // for big forms
```

Or write your own:

```tsx
const customAdapter: StorageAdapter = {
  name: 'custom',
  async read(key) { /* ... */ },
  async write(key, value) { /* ... */ },
  async remove(key) { /* ... */ },
};
```

## Multi-tab strategies

| Strategy | What happens on remote change |
|---|---|
| `'warn'` (default) | Sets `status='conflict'`; you call `resolveConflict('local' \| 'remote' \| merged)` |
| `'last-writer-wins'` | Adopts remote silently; fires `onConflict` if provided |
| `'manual'` | Fires `onConflict`, library does nothing automatic |
| `false` | Disables multi-tab (no BroadcastChannel overhead) |

## Zero runtime dependencies

formdraft has **no** runtime dependencies. Only peer deps (which you'd install anyway): `react`, optionally `react-hook-form`, optionally `zod`.

Bundle target: **≤ 8 KB gzipped** (enforced in CI).

## What this lib is NOT

- Not a form-state manager. Use React Hook Form (or anything else) for that; formdraft wraps your form state with persistence.
- Not a sync engine. Bring your own backend; formdraft calls your `sync(values)` function.
- Not a CRDT. Conflicts are last-writer-wins + warning by default.
- Not React Native compatible. Browser APIs only.

## Migration

- From `react-hook-form-persist`: see [docs/migration-from-react-hook-form-persist.md](docs/migration-from-react-hook-form-persist.md).

## Status (v0.1.0-rc)

- 70+ unit tests across 14 modules
- Bundle: ~3.4 KB brotli (≤ 8 KB target)
- React 18+
- Browser support: Chrome/Edge 88+, Firefox 78+, Safari 15.4+
- iOS Safari: works; multi-tab tested

## License

MIT
