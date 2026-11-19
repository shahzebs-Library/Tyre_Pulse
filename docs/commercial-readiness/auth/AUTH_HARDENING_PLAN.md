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
| `sign-in` edge function fails closed: 503 when the lockout check errors, times out (8 s per upstream call, one overall deadline on the account lookup) or answers in an unexpected shape | `supabase/functions/sign-in` | This branch (also on #546). Local test `e2e/auth/sign_in_edge_local.mjs`: 32/32. The function on main fails 10 of the same 32 (a session is issued while the lockout check is down; hangs up to 15 s). Not deployed. |
| `sign-in` edge function forwards only a valid `cf-connecting-ip`, never `X-Forwarded-For` / `X-Real-IP` / `True-Client-IP` | `supabase/functions/sign-in` | This branch. Forwarding switch stays OFF (see 5f). |
| Public `/captcha-bridge` page for the Expo app (Turnstile in the phone browser, then a fixed `tyrepulse-inspector://captcha` return link) | `src/pages/CaptchaBridge.jsx`, `src/lib/captchaBridge.js` | This branch. Tests 4/4. Shows a plain note while the site key is unset. |
| Expo app 1.6.0 over-the-air update: opens the bridge page, reads the token back, signs in | `mobile/` on branch `ota/mobile-1.6.0-captcha` | Separate draft. NOT published to EAS. |

## 4. Fail-open review
- Browser and app pre-checks: keep fail-open. They are advisory; the real gates are Supabase
  Auth and the `sign-in` function.
- `sign-in` function: now fails closed on an error, a timeout or an odd answer (#550, #546). Supabase Auth uses the same
  database, so when the check is down a sign-in would fail anyway. Staff lose nothing extra.
- Database functions: `login_attempt_status` / `record_login_failure` still turn any internal
  error into "not locked". The function cannot tell "lockout switched off" from "something
  broke". Proposal, not TEN-9f work: add an `error: true` key on that path so the `sign-in`
  function can refuse with 503 while the apps stay fail-open. Small migration, owner approval.

## 5. Tests
- Done:
  - Web Console tests 78/78.
  - Flutter: analyze clean; 286 auth/login/extras/l10n tests pass (1 known Linux golden diff); a local test server proves the token reaches Supabase Auth, the `sign-in` function and sign-up, and a CAPTCHA refusal is never counted as a failed login.
  - Local `sign-in` function test 32/32 (#550): lockout function missing, erroring, hanging,
    answering an odd shape, account lookup hanging, Supabase Auth hanging or down; every case
    gives 503 `unavailable` and no session, no internal detail in any response body, and the
    next call after recovery signs in. Forged `X-Forwarded-For`, `X-Real-IP`, `True-Client-IP`
    and a malformed `cf-connecting-ip` are never forwarded. The function on main fails 10.
  - Bridge page 4/4: odd `state` values refused, the return link is fixed, a `return=` URL
    parameter is ignored.
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

## 5b. Measured blockers (2026-11-16, read only)
- **The Expo app is still the main phone client.** From `user_devices`:

  | Client | Version | Devices | Users | Seen 7 days | Seen 30 days |
  |---|---|---|---|---|---|
  | Expo | 1.6.0 | 134 | 114 | 45 | 79 |
  | Expo | 1.3.2 / 1.5.0 | 7 | 5 | 0 | 0 |
  | Flutter | 1.0.0 | 5 | 5 | 2 | 5 |
  | Flutter | 0.1.1 | 7 | 7 | 4 | 7 |
  | Flutter | 0.1.0 | 1 | 1 | 0 | 0 |

  - Expo 1.6.0 signs in with `supabase.auth.signInWithPassword({ email, password })` and no
    token. Switching CAPTCHA on today would lock out about 79 active phone users.
  - The 1.6.0 build has no `react-native-webview` and no `expo-web-browser`, so an
    over-the-air update cannot add an in-app Turnstile.
  - Over-the-air route that IS possible: open `https://tyrepulse.app/captcha` in the system
    browser and return the token through the app's `tyrepulse-inspector://` link (expo-linking
    is in the binary). It is clumsy but needs no store build.
  - The other routes are a new Expo store build (Expo builds are retired by owner rule) or
    moving those users to Flutter first.
  - **Decision for the owner.** Until it is made, CAPTCHA activation is blocked.
- **Hosted staging is blocked on the free plan.** This Supabase organisation already has 2
  active projects (Tyre_pulse and opsbrain), the free limit. Options:
  - pause opsbrain while testing
  - use a separate free organisation
  - get owner approval for anything paid
- **Mobile sign-in traffic** (Supabase's own `auth.audit_log_entries`, last 30 days, all
  clients):
  - 121 logins, peak 4 in one hour across the whole company
  - IP addresses are not recorded usefully there (one value), so per-site measurement
    needs Flutter/Expo to log sign-ins
  - Do not tighten rate limits until that exists
  - Never trust a client-sent IP: the `sign-in` function forwards the caller IP to Supabase
    only from Supabase's own edge header and only with the secret key
    (`AUTH_FORWARD_CLIENT_IP`, off today)

## 5c. Client compatibility matrix (CAPTCHA switched ON)
| Client | Password sign-in | Sign-up | Reset email | Notes |
|---|---|---|---|---|
| Web app (main) | works when `VITE_TURNSTILE_SITE_KEY` is set | works | admin Console: works (#550) | Users ask an admin for resets (database function, no CAPTCHA) |
| System Console | works | n/a | works (#550) | |
| Invitation page | n/a | works (#546) | n/a | |
| Flutter with key (#550 build) | works | works | n/a (admin-handled) | Needs a new build with `TURNSTILE_SITE_KEY` |
| Flutter 0.1.x / 1.0.0 (current) | BLOCKED | BLOCKED | n/a | 12 active users: must update first |
| Expo 1.6.0 | BLOCKED | BLOCKED | n/a | 79 active users in 30 days: see 5b |
| Already signed-in sessions (all clients) | stay signed in | | | Token refresh has no CAPTCHA |
| QR sign-in | works | | | Server-minted single-use code, no CAPTCHA on verify |
| 2FA (TOTP) | works | | | Checked after the password; no CAPTCHA |

## 5d. Device and hosted staging checklist (to run once 5b is decided)
- Automated, direct API: `scripts/auth-staging/captcha_matrix.mjs` with Turnstile test
  secrets. It refuses the production project. Checks:
  - no token is refused
  - a valid token signs in
  - valid token with a wrong password gives invalid credentials
  - sign-up, reset email and OTP without a token are refused
  - token refresh still works
  - an invalid token is refused
  - a reused token is refused
  - CAPTCHA is switched off again at the end
- Manual, with the real keys:

  | Test | Web | Android | iOS |
  |---|---|---|---|
  | Sign in (username, employee ID) | | | |
  | Wrong password x5 then admin unlock | | | |
  | Leave the check open more than 5 minutes, then sign in (expired token renews) | | | |
  | Airplane mode during the check: clear message and Retry | | | |
  | Slow 3G profile: check loads within 20 s | | | |
  | 10 phones on one site Wi-Fi signing in within a minute | | | |
  | Self registration | | | |
  | QR sign-in | | | |
  | 2FA account sign-in | | | |
  | Arabic and Urdu, text size 200% | | | |

## 5e. Support instructions (for the help desk, once CAPTCHA is on)
- "Security check failed" or "could not load": check the internet connection, then tap
  Try again. On site Wi-Fi that blocks Cloudflare, switch to mobile data.
- "Update required": install the latest Tyre Pulse app from the Play Store.
- Locked after 5 attempts: wait 15 minutes, or an Admin clears it in Console > Users >
  Reset password with a reason.
- Nothing works for many users at once: tell the owner. The emergency rollback is below.

## 5f. Client IP trust model
- Supabase per-IP limits only help if the IP is real. A header that the caller can type
  (`X-Forwarded-For`, `X-Real-IP`, `True-Client-IP`) is never trusted.
- The production proxy chain in front of Supabase Edge Functions could not be verified from
  here: the sandbox network blocks direct calls to `supabase.co`, so it is unknown whether
  `cf-connecting-ip` is always set by Cloudflare and stripped from client input.
- So `AUTH_FORWARD_CLIENT_IP` stays OFF. With it off the function sends no client IP and Supabase
  sees the function's own address, which is the current behaviour.
- To switch it on later (owner approval): from a phone, call the deployed function with a forged
  `cf-connecting-ip` and check in the Auth logs that the forged value never appears.

## 6. Rollout order (each step needs owner approval)
1. Owner decides the Expo route (5b) and the hosted staging route.
2. Create a free Turnstile widget in Cloudflare. Allowed hostnames: `tyrepulse.app` and
   `www.tyrepulse.app` (the Flutter WebView loads under `https://tyrepulse.app/`).
3. Hosted staging:
   - run `captcha_matrix.mjs`
   - run the manual checklist on web, a real Android phone and a real iPhone
4. Flutter build with `--dart-define=TURNSTILE_SITE_KEY=...` (Flutter 3.47 or newer):
   - closed testing first, then all staff
   - raise `flutter_min_version` only after the build is live
5. Expo users moved or updated (per the 5b decision). Proceed only when the device table shows
   no active client without CAPTCHA support for 7 days.
6. Set `VITE_TURNSTILE_SITE_KEY` in Vercel and deploy. The widget shows; Supabase still
   ignores tokens.
7. Deploy the `sign-in` function from #550 (fail-closed lockout). Smoke test web and Flutter.
8. Switch on CAPTCHA protection in Supabase (Dashboard > Authentication > Bot and Abuse
   Protection, provider Turnstile, secret key), in a quiet hour. Smoke test straight after:
   web, Android, iOS, plus one direct API call without a token, which must be refused.
9. Watch for 48 hours:
   - `captcha_failed` counts in the Auth logs
   - TEN-9f lock counts
   - help-desk reports
10. Later and optional: tighter rate limits, only after 2 weeks of logged phone sign-ins.

## 7. Rollback and emergency recovery
- Mass sign-in failure after step 8: switch CAPTCHA protection off in the Supabase dashboard.
  It takes effect within seconds and needs no deploy. Clients that send a token keep working,
  because Supabase ignores tokens when CAPTCHA is off.
- Web widget problem: remove `VITE_TURNSTILE_SITE_KEY` in Vercel and redeploy. The widget
  disappears.
- Flutter widget problem: CAPTCHA off first, then ship a build without the key. Do NOT raise
  `flutter_min_version` until the fix is live.
- `sign-in` function problem: redeploy the previous version. Record its source hash before
  step 7.
- `sign-in` function deployed today: version 1, bundle hash `5c8ac2b84d11bce6...` (code matches
  main's `supabase/functions/sign-in/index.ts`, sha256 `75c23efd...`). Redeploy that source to
  roll back step 7.
- Expo over-the-air update problem: republish the previous update group from the EAS dashboard
  (rollback), then CAPTCHA off if it was on.
- Locked-out admin: the super admin clears it in the Console, or switches
  `max_login_attempts` to 0 in system_config (lockout off) as a last resort.

## 8. Limits under the current (free) plan
- No server hook can count failed passwords for direct API calls. That needs the Teams plan,
  which is excluded. CAPTCHA plus Supabase's IP limits is the ceiling.
- Rate limits are per IP. Someone with many addresses still gets about 1,800 attempts per hour
  per address, but each attempt now needs a solved CAPTCHA.
- Anyone who knows a username can still lock that account for 15 minutes through our apps. The
  admin unlock is the remedy.
