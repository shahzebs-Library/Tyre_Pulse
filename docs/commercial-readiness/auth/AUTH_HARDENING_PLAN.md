# Authentication hardening plan (direct Supabase Auth)

Status: draft. Nothing enabled or deployed. Every production switch below needs the owner's
separate approval. TEN-9f (applied 2026-11-16) protects our own sign-in flow only. It does
NOT stop scripts that call Supabase Auth directly.

## 1. Facts measured on production (2026-11-16, read only)
- Accounts: 781 in total; 773 sign in through a username, 8 with a real email.
- 762 of the 773 username accounts have the email `<username>@users.tyrepulse.app`.
  - So hiding the username-to-email lookup protects almost nothing: anyone can build the
    address from the username.
  - The protection has to sit at Supabase Auth itself, which is what CAPTCHA does.
- Traffic is very low:
  - 46 web sign-ins in 30 days; peak 6 a day; peak 3 in one hour.
  - At most 2 sign-ins from one IP address in an hour, across 33 addresses.
  - Supabase logs keep 24 hours. In that window there was 1 password sign-in, 93 token
    refreshes from 43 addresses, and 115 user reads.
  - Flutter sign-ins are not in our audit log, so phone volume is not measured yet. See step 4.
- Two-factor (TOTP) is enrolled by 2 accounts. 30 accounts signed in within the last 30 days.
- Supabase Auth limits, from the Supabase docs (not visible to read from here):
  - `/auth/v1/token`: 1,800 requests per hour per IP, bursts of 30. Sign-in and token
    refresh share this limit.
  - 2FA verify: 15 per minute per IP.
  - `/auth/v1/verify`: 360 per hour per IP.
  - Read the real values in Dashboard > Authentication > Rate Limits before changing anything.

## 2. What closes the direct bypass
- **Supabase CAPTCHA protection with Cloudflare Turnstile (free):**
  - When switched on, Supabase Auth itself rejects password sign-in, sign-up, password-reset
    email and OTP requests that carry no valid token.
  - Supabase verifies the token with Cloudflare on its own server. A token is single use and
    expires after about 5 minutes, so a replayed, expired or invented token is refused there.
  - This applies to direct API calls too. It is the only free control that does.
- What it does not cover:
  - token refresh (needs an existing session)
  - `/auth/v1/verify`, which the QR sign-in uses after a server-minted, single-use code
  - 2FA code checks (rate-limited by Supabase at 15 per minute per IP)
- Tighter rate limits stay per IP only. That helps against one noisy address, not against many.

## 3. Code changes (draft PRs, nothing deployed)
| Change | Where | State |
|---|---|---|
| Web sign-in, sign-up and SSO send the token | `src/pages/Login.jsx`, `AuthContext.jsx`, `loginGuard.js` | Already on main (widget off while `VITE_TURNSTILE_SITE_KEY` is empty) |
| Console sign-in sends the token | `src/console/*` | Already on main |
| Console "Send reset email" sends the token | `src/console/pages/ConsoleUsers.jsx` | This branch. Without it, admin reset emails would fail once CAPTCHA is on. |
| Invitation sign-up sends the token | `src/pages/InviteSignup.jsx` | On #546 |
| Flutter Android/iOS Turnstile (WebView, `webview_flutter ^4.14.1`), token on password sign-in, sign-in function and self sign-up; key from `--dart-define=TURNSTILE_SITE_KEY` (empty = unchanged) | `tyre_pulse_flutter/` | This branch. analyze clean; auth/login/extras/l10n tests 286 pass, 1 known Linux golden diff; config/router 173 pass. Not run on a real phone yet. |
| `sign-in` edge function forwards `captcha_token` to Supabase Auth | `supabase/functions/sign-in` | On main; not redeployed |
| `sign-in` edge function refuses (503) when the lockout check errors, instead of proceeding | `supabase/functions/sign-in` | On #546 (local test 13/13); not deployed |
| Expo app | `mobile/` | Retired. It cannot send a token, so it stops signing in once CAPTCHA is on. Confirm no one still uses it. |

## 4. Fail-open review
- Browser and app pre-checks: keep fail-open. They are advisory; the real gates are Supabase
  Auth and the `sign-in` function.
- `sign-in` function: now fails closed on an error (#546). Supabase Auth uses the same
  database, so when the check is down a sign-in would fail anyway. Staff lose nothing extra.
- Database functions: `login_attempt_status` / `record_login_failure` still turn any internal
  error into "not locked". The function cannot tell "lockout switched off" from "something
  broke". Proposal, not TEN-9f work: add an `error: true` key on that path so the `sign-in`
  function can refuse with 503 while the apps stay fail-open. Small migration, owner approval.

## 5. Tests
- Done:
  - Web Console tests 78/78.
  - Flutter: analyze clean; 286 auth/login/extras/l10n tests pass (1 known Linux golden diff); a local test server proves the token reaches Supabase Auth, the `sign-in` function and sign-up, and a CAPTCHA refusal is never counted as a failed login.
  - #546 local `sign-in` function test 13/13: lockout error gives 503 and no session; recovery
    signs in again.
- Not possible from this environment:
  - Real token checks against Cloudflare: the network proxy blocks challenges.cloudflare.com.
  - A local Supabase Auth server: no Docker daemon.
  - These need a hosted staging project.
- Hosted staging test matrix, using Turnstile's documented test keys:
  - site key `1x00000000000000000000AA` always passes
  - site key `2x00000000000000000000AB` always fails
  - secret `2x0000000000000000000000000000000AA` always fails
  - secret `3x0000000000000000000000000000000AA` reports a reused (already spent) token

| Case | Expected |
|---|---|
| Web/Flutter sign-in with a valid token | signs in |
| No token / invented token (direct API call) | `captcha_failed` |
| Token used twice | second call refused |
| Token older than 5 minutes | refused; the widget renews and sign-in works |
| Sign-up, invitation sign-up, Console reset email | work with a token, refused without one |
| OTP / magic link (QR sign-in) | unaffected (no CAPTCHA on verify) |
| 2FA (TOTP) after password | unaffected |
| Password reset request (`request_password_reset`, admin-handled) | unaffected (a database function, not Supabase Auth) |
| Wrong password 5 times through the app | TEN-9f lock, admin unlock with reason |
| Lockout check down | `sign-in` function returns 503, apps show "try again" |

## 6. Rollout order (each step needs owner approval)
1. Create a free Turnstile widget in Cloudflare. Allowed hostnames: `tyrepulse.app`,
   `www.tyrepulse.app`, plus the Flutter WebView base URL host.
2. Hosted staging (a second free Supabase project, or the owner's choice):
   - run the matrix above with test keys, then with the real keys
   - real people sign in on web, Android and iOS
3. Ship a Flutter build with `--dart-define=TURNSTILE_SITE_KEY=...` to closed testing (the release workflow must build with Flutter 3.47 or newer; webview_flutter's iOS part needs it).
   Measure phone sign-ins for 2 weeks; add Flutter sign-ins to the audit log first.
4. Set `VITE_TURNSTILE_SITE_KEY` in Vercel and deploy. The web widget appears; Supabase still
   ignores tokens.
5. When the Flutter build is the one staff actually use, switch on CAPTCHA protection in
   Supabase (Dashboard > Authentication > Bot and Abuse Protection, provider Turnstile, secret
   key).
6. Watch for 48 hours:
   - `captcha_failed` counts in the Auth logs
   - TEN-9f lock counts
   - staff reports
7. Optional, later: lower the sign-in rate limit only after step 3 shows peak phone traffic per
   site IP. Current measured peak is 2 per hour per IP. Keep at least 10x headroom for shared
   site Wi-Fi.
8. Deploy the fail-closed `sign-in` function only with the #546 rollout.

## 7. Rollback
- CAPTCHA:
  - switch it off in the Supabase dashboard (instant)
  - clear `VITE_TURNSTILE_SITE_KEY` and redeploy web; the widget disappears
  - Flutter builds with a key keep working, because a token sent to Supabase with CAPTCHA off
    is ignored
- Rate limits: restore the values recorded before the change.
- `sign-in` function: redeploy the previous version (keep its source hash before deploying).

## 8. Limits under the current (free) plan
- No server hook can count failed passwords for direct API calls. That needs the Teams plan,
  which is excluded. CAPTCHA plus Supabase's IP limits is the ceiling.
- Rate limits are per IP. Someone with many addresses still gets about 1,800 attempts per hour
  per address, but each attempt now needs a solved CAPTCHA.
- Anyone who knows a username can still lock that account for 15 minutes through our apps. The
  admin unlock is the remedy.
