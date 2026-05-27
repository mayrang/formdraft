# Changelog

## 0.1.0-rc.1 — 2026-05-27

README polish only — no code changes. Added badges, "Why this exists" section, "Compared to alternatives" table, FAQ, Contributing section. Identical bundle and API.

## 0.1.0-rc.0 — 2026-05-27

Initial release candidate.

### Core
- `useFormDraft` headless hook with persist + restore + server sync + offline queue + multi-tab coordination + status state machine + IndexedDB backend
- `useFormDraftStatus` cross-component status subscription via useSyncExternalStore
- `useFormDraftRHF` adapter for React Hook Form
- Storage adapters: localStorage (default), sessionStorage, IndexedDB (~50 LOC native wrapper)
- Multi-tab strategies: warn (default), last-writer-wins, manual, off
- Schema versioning via `version` + `migrate(fn)`
- Sensitive field exclusion via `excludeFields`
- AI-trap defenses: captive-portal-aware sync, structuredClone prototype-loss warning, mobile Safari visibilitychange recovery, async storage normalization

### Distribution
- Zero runtime dependencies
- ~3.4 KB brotli (≤ 8 KB target, CI-enforced)
- Three peer deps (all optional): react, react-hook-form, zod
- Vite-based example app with 3 scenarios: signup wizard, profile settings, comment editor

### Known limitations
- React only (Vue/Svelte/Solid: v0.2+ community PR welcome)
- Full field-level merge UI deferred to v0.2 (v0.1 ships callback + warning)
- `navigator.onLine` is consulted but consumer can plug a custom heartbeat in v0.2
- Service Worker integration intentionally out of scope
- No first-class TanStack Form or Formik adapters in v0.1 (community PR welcome)
