# Authentication hardening - handover (closed 2026-11-16)

Detailed plan and evidence: `AUTH_HARDENING_PLAN.md` (same folder). This file is the closing
summary. Nothing here is live in production.

## 1. PRs and commits
| Item | Where | Commit |
|---|---|---|
| Web, Console, Flutter, sign-in function, CAPTCHA bridge page, staging runner | PR #550 (draft, open), branch `claude/auth-captcha-7rxp2t` | last code commit `89157871a76189d0ff12c4d2737b76971a2b0a62`; head = docs only after that |
| Expo 1.6.0 over-the-air update | Branch `ota/mobile-1.6.0-captcha` (PR #551 CLOSED to stop preview builds; branch kept, never merge into main) | `6d70a78b628823b051a96ee093b596b5eb0d58f1` |
| TEN-9f per-account lockout (already live) | PR #548 | applied as `20261116063833 ten9f_login_lockout_per_account` |
| Multi-company sign-in (separate, not part of this round) | PR #546 | `ee9fc172` |

## 2. Finished implementation
- **Web:** sign-in, sign-up, SSO and Console sign-in send the Turnstile token (on main already). Console
  "Send reset email" sends it (#550). Widget hidden while `VITE_TURNSTILE_SITE_KEY` is empty.
- **Flutter:** Turnstile in a WebView (`webview_flutter ^4.14.1`). The token is sent on password sign-in,
  through the sign-in function and on self sign-up. Key comes from
  `--dart-define=TURNSTILE_SITE_KEY` (empty = unchanged). Messages in en/ar/ur.
- **Sign-in edge function (#550, not deployed):**
  - Fails closed: if the lockout check errors, times out or gives an unexpected answer, the reply is 503
    `unavailable` and no session is issued.
  - Hard timeouts: 8 s on every upstream call, plus one overall deadline on the account lookup.
  - Only a valid `cf-connecting-ip` is ever forwarded, and only when `AUTH_FORWARD_CLIENT_IP` is on (it is off).
    `X-Forwarded-For`, `X-Real-IP` and `True-Client-IP` are ignored.
  - Replies carry only the codes `invalid_credentials`, `locked` (+ wait seconds), `captcha_failed`,
    `unavailable`, `invalid_request`. No internal detail. Web (`loginGuard.js`) and Flutter
    (`sign_in_outcome.dart`) turn these into plain "try again" / "locked, wait" / "check failed" messages.
    A CAPTCHA refusal or an outage is never counted as a wrong password.
- **CAPTCHA bridge page `/captcha-bridge` (#550):** for Expo 1.6.0. Shows Turnstile, then a button to the
  fixed link `tyrepulse-inspector://captcha?state=..&token=..`. The page never takes a redirect from the URL.
- **Expo update (branch above):** on `captcha_failed` the app opens the bridge page in the phone's browser and
  takes the token back by deep link (state match, 5-minute limit, single use, password in memory only).
- **Hosted-staging runner:** `scripts/auth-staging/captcha_matrix.mjs` (refuses the production project).

## 3. Tests that actually passed
- Sign-in function local test `e2e/auth/sign_in_edge_local.mjs`: 32/32. It covers outages, hangs, odd
  answers, recovery, no internal detail and forged IP headers. The function deployed today fails 10 of the 32.
- Bridge page unit tests 4/4. Console tests 78/78.
- Flutter CI on `a0d8600b`: analyze, tests, Android debug build and iOS build without code signing all pass.
  The Flutter source, pubspec and build config are unchanged since then; later commits are web, edge
  function and docs only, so the builds were not rerun.
- Flutter local: 286 auth/login/l10n tests pass (1 known Linux golden diff). A local server shows the token
  reaches Supabase Auth, the sign-in function and sign-up.
- Expo update branch: over-the-air rule check passes (same commands as `eas-update.yml`; descends from
  6c27046; native config identical; 12 of 20 files). `tsc` clean; jest 34 suites / 492 tests.
- TEN-9f on production: verified inside a rolled-back transaction on the demo account. Same-company
  Admin unlock verified on local staging (6a-6l).

## 4. Release blockers (NOT done - do not treat as passed)
1. Expo 1.6.0 on a real phone: the bridge flow, plus Chrome and Samsung Internet handing the link back.
2. Flutter Android sign-in with real Turnstile.
3. Flutter iOS sign-in with real Turnstile.
4. Web CAPTCHA against real Cloudflare and Supabase Auth.
5. Expired, reused and invalid tokens refused (hosted staging, `captcha_matrix.mjs`).
6. Password reset email, OTP/QR sign-in, MFA (TOTP) and invitation sign-up with CAPTCHA on.
7. Recovery and rollback: switch CAPTCHA off, redeploy the old sign-in function, roll back the Expo update.
The network here blocks Cloudflare and direct Supabase calls, and no hosted staging project exists, so none
of these could run from this environment.

## 5. Current production behaviour (unchanged by this round)
- CAPTCHA protection: OFF. IP forwarding: OFF. Single-company mode: ON.
- Sign-in function: version 1 (bundle `5c8ac2b84d11bce6...`, matches main's source sha256 `75c23efd...`).
  If its lockout check errors, it still lets the sign-in continue.
- TEN-9f per-account lockout is live: 5 failures lock the account for 15 minutes, and an admin unlock needs
  a reason. It does not cover direct calls to Supabase Auth (only CAPTCHA closes that).
- Supabase Auth's own per-IP limits apply unchanged.

## 6. Expo compatibility and migration risks
- 134 devices run Expo 1.6.0 (45 seen in 7 days, 79 in 30). Without the update, switching CAPTCHA on locks
  them out of NEW sign-ins. Users already signed in stay signed in, because token refresh has no CAPTCHA.
- Flutter 0.1.x / 1.0.0 (12 active) must update to a build with the key.
- Risks:
  - Some browsers may not open the custom link.
  - Android may have killed the app while the browser was open. The user then signs in again.
  - Another app could claim the same scheme. It gets only a single-use token, never the password. Fixing
    this fully needs a store build with App Links.
- Fallback if the bridge fails on real phones: move those users to Flutter first and keep CAPTCHA off until
  no active client lacks support for 7 days.

## 7. Expo update procedure (when approved)
1. The #550 bridge page must be live on `https://tyrepulse.app/captcha-bridge`.
2. Smoke test on a real 1.6.0 phone against staging with CAPTCHA on.
3. GitHub Actions, run `eas-update.yml` (workflow_dispatch) with `source_ref=ota/mobile-1.6.0-captcha`,
   channel `production`. The workflow refuses the run unless the branch descends from 6c27046, native files
   are byte-identical and no more than 20 mobile files changed.
4. Phones receive it after two app opens. Watch Sentry and sign-in counts.
5. Rollback: in the EAS dashboard, republish the previous update group
   (`ota/mobile-1.6.0-image-picker`, `2e6a3740`).
- Compatibility: runtime version policy is `appVersion`, so only the 1.6.0 binary receives it. Flutter and
  other Expo versions are unaffected. The update is harmless while CAPTCHA is off: the browser path only
  runs on a `captcha_failed` refusal.

## 8. Hosted staging (free, no purchase, opsbrain untouched)
1. Create a NEW free Supabase organisation with its own account or org (the current org already has its 2
   free projects).
2. Create one free project there.
3. Apply the schema needed for sign-in: `profiles`, `system_config`, `login_attempts`,
   `get_email_by_identifier`, the TEN-9f functions. Add synthetic users only.
4. Deploy the #550 sign-in function to that project.
5. Create a test Turnstile widget (or use the documented test keys).
6. Run `scripts/auth-staging/captcha_matrix.mjs` with `STAGING_URL`, `STAGING_ANON_KEY`, `STAGING_REF`,
   `SUPABASE_ACCESS_TOKEN` (for that org only), `TEST_EMAIL` and `TEST_PASSWORD`.
7. Run the manual checklist in `AUTH_HARDENING_PLAN.md` section 5d on web, a real Android phone, a real
   iPhone and an Expo 1.6.0 phone pointed at staging.
Free projects pause after a week of inactivity; that is fine for a test window.

## 9. Production activation sequence (each step needs owner approval)
1. Approve the Expo route and the staging route.
2. Create the Turnstile widget for `tyrepulse.app` and `www.tyrepulse.app`.
3. Hosted staging: pass all section 4 blockers.
4. Flutter build with `TURNSTILE_SITE_KEY`: closed testing, then all staff.
5. Publish the Expo update (section 7). Wait until no active client lacks support for 7 days.
6. Set `VITE_TURNSTILE_SITE_KEY` in Vercel and deploy the web app.
7. Merge #550 and deploy the sign-in function. Smoke test.
8. Switch on CAPTCHA protection in Supabase in a quiet hour. Smoke test, including one direct API call
   without a token, which must be refused.
9. Watch for 48 hours: `captcha_failed`, lockouts, help-desk reports.
- Optional later: the database change that adds `error: true` to the lockout functions, and IP forwarding
  (only after a forged-header check against production, section 5f of the plan).

## 10. Rollback
- Mass sign-in failure: switch CAPTCHA off in the Supabase dashboard. This takes seconds and needs no deploy.
- Sign-in function: redeploy version 1 (main's `supabase/functions/sign-in/index.ts`).
- Web widget: remove `VITE_TURNSTILE_SITE_KEY` and redeploy.
- Flutter: CAPTCHA off first, then a build without the key. Do not raise `flutter_min_version` until then.
- Expo: republish the previous update group (section 7).
- Locked-out admin: a super admin clears the lock in the Console; last resort, set `max_login_attempts` to 0.

## 11. Owner approvals still needed
- Expo route: the bridge update, or moving users to Flutter.
- Hosted staging: a separate free organisation.
- Turnstile widget creation.
- Publishing the Expo update.
- The Flutter release with the key.
- The Vercel site key.
- Merging #550 and deploying the sign-in function.
- Switching on CAPTCHA.
- Optional: the lockout `error` migration, IP forwarding, rate-limit changes.
- Not part of this round, still separate: #549 migrations, #546 / multi-company, the Tyre Exchange
  temporary index, paid upgrades.
