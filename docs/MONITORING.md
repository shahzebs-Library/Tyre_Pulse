# Monitoring — Sentry + PostHog (roadmap items 6–7)

Both are wired in `src/lib/monitoring/` and initialised once from
`src/main.jsx` via `initMonitoring()`. **Everything no-ops when the env vars
are unset** — zero bundles-side cost until you configure keys, and a failure
inside monitoring can never block app boot (internally caught).

## Enable

Set in Vercel project env (or `.env.local` for dev):

| Var | Meaning | Default |
|---|---|---|
| `VITE_SENTRY_DSN` | Sentry public DSN — enables error tracking | unset (off) |
| `VITE_SENTRY_TRACES_RATE` | Performance trace sampling 0..1 | `0.1` |
| `VITE_SENTRY_REPLAY` | Session replay (`true` to enable) | off (privacy) |
| `VITE_POSTHOG_KEY` | PostHog project key — enables product analytics | unset (off) |
| `VITE_POSTHOG_HOST` | Ingestion host | `https://eu.i.posthog.com` |
| `VITE_POSTHOG_RECORDING` | Session recording (`true` to enable) | off (privacy) |

These are public client-side identifiers (DSN / project key), not secrets —
they pass the `src/lib/supabase.js` secret-exposure guard.

## Use in app code

```js
import { captureError, capture, identify } from '../lib/monitoring'

captureError(err, { where: 'DataIntakeCenter.commit' })  // Sentry (safe when off)
capture('report_exported', { module: 'tyres' })           // PostHog event
identify(user.id, { role: profile.role })                 // after login
```

All helpers are safe to call unconditionally — they silently no-op when the
SDK isn't initialised.

## Verify

- Sentry: set the DSN, run the app, execute
  `import('./lib/monitoring').then(m => m.captureError(new Error('sentry test')))`
  in the console → event appears in the Sentry project.
- PostHog: set the key, reload → autocaptured `$pageview` events appear in
  PostHog → Activity. DNT (Do Not Track) browsers are respected.

## Privacy defaults

Replay/recording are **off** unless explicitly enabled; PostHog respects
Do Not Track. Review regional-privacy requirements before enabling recording
for GCC tenants.
