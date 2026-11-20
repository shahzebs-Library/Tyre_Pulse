# Phase 2 status: #546 (company code sign-in) + #550 (CAPTCHA), reconciled 2026-11-17

Both PRs are DRAFT. Nothing is deployed, enabled or applied. #550's branch now contains #546 and current main.
Allowed statuses: In Progress / Blocked / Ready for Release / Released / Verified.

## Reconciliation decisions
- `supabase/functions/sign-in/index.ts`: identity is resolved through `resolve_sign_in_user` (code/username, #546), inside #550's single `withDeadline`. Any resolver error other than "function missing" returns 503 (fails closed). The old exact lookup remains only for a missing function. Lockout gate, 8 s timeouts, cf-connecting-ip-only forwarding (OFF) and Turnstile handling are #550's, unchanged.
- Flutter `AuthRepository.signIn`: `normalizeSignInIdentifier` (#546) AND `captchaToken` (#550) both apply. The lockout counter, the made-up-email lookup and the function body all receive the normalised identifier.
- ARB parity pin = 2523 (2514 base + 8 captcha + 1 `loginCompanyCodeHelp`). Verified against the real en/ar/ur ARB files (2523 each).
- `20261116100000_ten9f_login_lockout_per_account.sql` is in both branches (byte-identical, no conflict). It is already applied in production.
- No reserved Flutter wiring file touched.

## Requirements
| Requirement | Status | Evidence / owner action |
|---|---|---|
| Web sign-in accepts `code/username` (#546) | Ready for Release | `signInIdentifier` tests pass (vitest, this merge). Single-company mode stays on. |
| `/invite/:token` page + invite panel (#546) | Ready for Release | `inviteSignup.render`, `orgInvitations` pass. No hosted-staging run. |
| Flutter `code/username` + help text (#546) | In Progress | Not run here (no Flutter SDK, disk full). CI on the pushed head decides. |
| `sign-in` fn resolves via `resolve_sign_in_user` (#546) | Blocked | Not deployed. Owner action: authenticated `supabase functions deploy sign-in` (CLI login). Local deno run not possible here (no deno, 181 MB disk). |
| `sign-in` fn fails closed, timeouts, IP forwarding OFF (#550) | In Progress | Reported 32/32 locally on the old base. The merged function was NOT re-run (needs deno + psql harness `e2e/auth/sign_in_edge_local.mjs`). Re-run on a machine with `npx deno@2`. |
| Turnstile on Flutter sign-in, sign-up, Console reset (#550) | Blocked | Needs a real Turnstile site key, a real device test, and CAPTCHA switched on in Supabase Auth (owner decision). Off today. |
| Expo 1.6.0 phones keep working with CAPTCHA | Blocked | Needs #551 (closed on purpose, branch `ota/mobile-1.6.0-captcha`) smoke-tested on a real phone. |
| `/captcha-bridge` page | Verified | `captchaBridge` tests pass in this merge. |
| Hosted-staging CAPTCHA matrix runner | Blocked | The free Supabase organisation has 2 projects. Owner: pause opsbrain, or use a separate free org, or approve a paid plan. |
| Each company needs a sign-in code | Blocked | Owner: run `admin_set_org_sign_in_code` per organisation (0 have one today). |
| Import runbook sets `tp.import_org` | Blocked | Owner/runbook step before any second company imports. |
| `single_tenant_mode = false` | Blocked | All items above plus staging E2E and a Flutter build. ten9c per-company usernames stays HOLD. |
| Flutter company isolation review | Verified (read-only) | See PHASE2_BACKLOG.md: no leak in touched code; unpinned by-number reads are listed there. |
| Web checks on this head | Verified | vitest 156/157 (8 files); the one failure is `consoleModuleCoverage` on route `/parts-catalog/oem-preview`, which fails identically on origin/main (not from these PRs). eslint clean on changed files. `vite build` clean. |
| Flutter analyze and tests | In Progress | Could not run (no SDK, 181 MB free disk). Rely on CI. Known Linux-vs-Windows golden noise (`login_wide_ar`). |
