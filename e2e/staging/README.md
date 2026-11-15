# Local browser workflow tests (staging stack)

Runs the real web app in a real browser against a local copy of the staging database. Nothing here can
reach production: every script refuses a non-local database host and refuses to run when any environment
variable names the production project.

## What runs

| Piece | What it is | Real or stand-in |
|---|---|---|
| Database | `tyrepulse_e2e`, a copy of `tyrepulse_staging` (PostgreSQL 16, 127.0.0.1:54329) with the 31 R1 modules set to `live` in `modules` | real schema, synthetic data |
| REST API | PostgREST 12.2.3 static binary on 127.0.0.1:54330, role `authenticator`, production pre-request hook | real |
| Sign-in | `gateway.mjs` `/auth/v1`: checks the bcrypt password in `auth.users`, signs an HS256 JWT (role authenticated, aal1) with a secret generated per run | stand-in for GoTrue |
| `sign-in` edge function | `gateway.mjs` `/functions/v1/sign-in` (username form) | stand-in |
| Storage, other edge functions, realtime | answer 501 | not available |
| Web app | `vite build` of this repository with `VITE_SUPABASE_URL` pointing at the gateway, served by `serve_dist.mjs` on 127.0.0.1:5199 | real production build |

## Requirements

- The staging cluster from `supabase/staging` running (`supabase/staging/local/start.sh`).
- A PostgREST binary. Download the static Linux build of v12.2.3 from the PostgREST GitHub releases and
  unpack it to `$E2E_RUN/dl/postgrest` (or set `POSTGREST_BIN`).
- Node 22, `psql`, Playwright with Chromium.
- The synthetic accounts file written by the staging seed (`E2E_ACCOUNTS_FILE`). Never commit it.

## Commands

```
e2e/staging/start.sh                 # copy database (first time), start PostgREST + gateway, build and serve the app
e2e/staging/start.sh --skip-build    # reuse the existing build
e2e/staging/start.sh --rebuild-db    # drop and recreate the database copy
source e2e/staging/env.sh && cd e2e/staging && node specs/module_workflow.cjs            # all 31 modules
source e2e/staging/env.sh && cd e2e/staging && node specs/module_workflow.cjs warranty   # one module
node e2e/staging/report.cjs          # build the markdown and JSON report from the result files
e2e/staging/stop.sh
```

Generated files (JWT secret, anon key, logs, build, per-module result JSON, most screenshots) are written
to `$E2E_RUN`, outside the repository. One screenshot per module is kept in `e2e/staging/evidence/`.

## What the spec does per module

1. Opens the route as Alpha Manager, Alpha Tyre Man (low role) and Alpha Admin; records the heading, access
   screen, error boundary, console errors and failed API calls.
2. As the highest of Manager or Admin that the route allows: opens the create form, submits it empty
   (error handling), fills every field with generated values carrying a unique marker, saves, checks the
   row in the database belongs to Alpha, reloads and checks the marker is on screen, then edits and saves.
3. Opens the route as Beta (other company) and Gamma (empty company) and checks the marker is not shown.

## Limits (stated)

- Sign-in is a stand-in, so GoTrue behaviour (rate limits, MFA, captcha, refresh rotation) is not tested.
- No storage, edge functions or realtime: photo upload, emails, push and live updates are not exercised.
- The form filler is generic. Where it could not drive a form, the step is recorded as not exercised, not as passed.
- The onboarding tour is dismissed with its own Skip button after sign-in.
