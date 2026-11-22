# TEN-9f approval package: sign-in lockout per account

Status: ready for the owner's decision. Nothing applied to production.

## What TEN-9f is, and what it is not
- It IS: the "lock after 5 failed sign-ins" rule, counted per ACCOUNT instead of per typed text,
  for every sign-in made through the web app, the Flutter app, the Expo app and the `sign-in`
  edge function.
- It is NOT complete authentication protection. Someone who scripts calls straight to the
  Supabase Auth API (`/auth/v1/token`) with an account's email never touches this counter
  (details below). Treat TEN-9f as closing a bypass inside our own sign-in flow, not as a
  brute-force wall.

## The defect (live today)
- The counter is keyed on the typed text. One account answers to username, employee id,
  email, `<company code>/<name>`, and unlimited spacing/backslash variants of that form.
- Reproduced on production 2026-11-16 (rolled back, demo account only): after 5 failures on
  `demo.manager` the account read LOCKED while `PLAY-DEMO-MGR`,
  `demo.manager@users.tyrepulse.app`, `demo/demo.manager` and `demo / demo.manager` each
  still allowed 5 fresh attempts. Spacing variants are unlimited.
- Oracle: unknown names never lock and answer without `remaining`; real names lock and
  answer with it.

## The fix (one standalone migration, independent of #546 / TEN-9d/9e/9g / ten9c)
- `supabase/pending_migrations/20261116100000_ten9f_login_lockout_per_account.sql`
  - one counter per account (`u:<profile id>`) via the resolver sign-in already uses
  - unknown names get a hashed counter and lock the same way; typed text never stored
  - both lookups always run, so real and unknown names cost the same time
  - `remaining` removed from both responses (no screen shows it)
  - failures counted with one `INSERT .. ON CONFLICT` (concurrency hardening)
  - idle counters purged after window + lock (30 min), so a flood of made-up names cannot
    grow the table without limit
  - new `admin_login_lock_status` / `admin_clear_login_lock`: super admin, or an Admin of the
    same company; reason of 5+ characters required; each clear written to `access_audit`
    with the before state
- Unchanged for users: 5 attempts, 15-minute window, 15-minute lock, reset on successful
  sign-in, response keys the apps read (`enabled`, `locked`, `retry_after_seconds`).

## Check results (local staging, production-identical functions)
Run: `bash supabase/tests/ten9f_lockout/run_staging.sh`. Result: bypass reproduced 8/8 before;
after the fix 52 passed, 0 failed.

| Ask | Result |
|---|---|
| 3. Every alias shares one counter | PASS: username, case/space variant, employee id, email, code/name, spaced code/name, backslash form all lock together; one row per account; rotating spellings lock on the 5th (1a-1k) |
| 4. Enumeration | PASS: identical status and failure responses for real and unknown names; both lock on the same attempt; no `remaining` key (3a-3e) |
| 4. Timing | PASS: per call, status 0.10-0.12 ms and failure 0.19-0.25 ms for real and unknown names alike (before: unknown failures were about half the cost of real ones). Network jitter is milliseconds, so this is not usable. |
| 4. Denial of service | Unchanged risk: anyone who knows a username can lock that account for 15 minutes by failing 5 times. True before, now also via any alias. Remedy: the new audited admin unlock. |
| 4. Resource exhaustion | PASS: 2000 made-up names make 2000 hashed rows, no text stored; rows idle past 30 minutes are purged within a few dozen calls; a live lock survives the purge (12a-12d) |
| 5. Admin unlock | PASS: anon, Driver and another company's Admin refused; blank reason refused; same-company Admin clears and is audited with the before state; super admin clears any company (6a-6l) |
| 6. Successful sign-in | PASS: reset clears the account counter and legacy text rows (5a); another account on the same device and accounts in other companies stay open (4a-4b) |
| Concurrency | PASS: 20 simultaneous failures all counted; a burst of 12 locks at exactly 5 (9a-9b) |
| Rollback | PASS: production bodies restored byte for byte; new functions removed (10-11) |
| 8. Web and Flutter | PASS by code review: both call status with the typed text before sign-in, record a failure with the same text, and call reset after success. Web reads `locked` and `retry_after_seconds`; Flutter decodes `remaining` as optional and never shows it. Admin panel: `src/test/loginLockPanel.render.test.jsx` 4/4. |

## 7. Direct Supabase Auth sign-in paths (not covered)
| Path | Our lockout | What still applies |
|---|---|---|
| Web/Flutter/Expo login screens | Enforced by the app before and after sign-in | Supabase Auth per-IP rate limits |
| `sign-in` edge function (real-email accounts) | Enforced server-side | Supabase Auth per-IP rate limits |
| Script calling `/auth/v1/token?grant_type=password` directly | BYPASSED: never calls our RPCs | Supabase Auth limit on `/auth/v1/token`: per IP, 1800 requests per hour with bursts of 30 (Supabase docs). That is about 43,000 password guesses per day per IP address, and more with several addresses. 2FA only for accounts that enrolled it. |
| Usernames | `get_email_by_identifier` gives anyone the account's sign-in email, which feeds the direct path above | Same as above |
| TOTP two-factor codes | Not counted (checked by Supabase Auth after a correct password) | Supabase Auth limits |
| QR sign-in | Not applicable: single-use server codes with number matching, no password guessed | Code expiry and single use |
- Real server-side enforcement options:
  - Password Verification Attempt hook: Supabase Teams plan, paid, not allowed.
  - Cloudflare Turnstile CAPTCHA: free, but web, Flutter and Expo must all send a token first,
    or every phone sign-in breaks.
  - Tighter Auth rate limits in the Supabase dashboard: free, per IP only.

## Production fingerprints
- Re-read from production on 2026-11-16 (read only), all as expected:
  - 18 counter rows, 0 locked, `max_login_attempts` 5, `single_tenant_mode` true
  - none of the new functions exist yet
  - `_resolve_sign_in_profile` 1ee66847b3d067fd171305fa7de11233
  - the three lockout functions:
  - `login_attempt_status` bda4f978f7404a86aa650f9aab6f3f14
  - `record_login_failure` c8a5b4a419e567262e6620c3fb16bbed
  - `reset_login_attempts` 32867f65d8493dd864f2d00c9e29dc71
- Staging check 0 confirms the same hashes. Re-read them at apply time (step 1). If any
  differ, stop: production changed and the rollback file no longer matches.
- Files:
  - migration md5 `973ed89a784ffb3a8325cd6d5a121395`
  - rollback md5 `f35b0bddedcf9989607ec29774325ee8`

## Apply procedure (only after final approval)
1. Pre-check (read only): the three hashes above; count rows and locked rows in
   `login_attempts`.
2. Apply the migration file as one transaction. The text contains `delete`, so the Supabase
   tool asks a person to confirm.
3. Verify:
   - functions and grants (query at the end of the migration file). Expected:
     - `_login_attempt_key` 0e70a58eeb9c5cf5b3daafd8e9ee396e, anon no, signed-in no
     - `_login_lock_admin_ok` 747373f1e7db909edaaa6f1e3e297f29, anon no, signed-in no
     - `admin_clear_login_lock` a43074e635b38db1d1d96cca6a769535, anon no, signed-in yes
     - `admin_login_lock_status` 035131787fe6136a14dc1e8e4e3ec69c, anon no, signed-in yes
     - `login_attempt_status` ca2a4834fee66968374b0a4027538cd4, anon yes, signed-in yes
     - `record_login_failure` acb3e29535e30d3b3a9b6fdc02f702a6, anon yes, signed-in yes
     - `reset_login_attempts` 6224b66424145d192d1acfa85b89fe36, anon no, signed-in yes
   - `supabase/tests/ten9f_lockout/production_verify.sql` (rolled back, demo account only):
     expect every spelling `true` and `remaining_key=false`.
4. Real sign-in smoke test (owner or tester): one wrong then one correct password on web and
   Flutter; the correct one signs in.
5. Rollback if needed: `20261116100000_ten9f_login_lockout_per_account.ROLLBACK.sql` restores
   the three production bodies exactly and removes the new functions and index. Audit rows
   are kept.

## Expected impact
- Users see no change unless they fail 5 times across any spellings of their account.
- Existing text-keyed rows keep counting down and age out.
- The Console Users reset-password window gains a "Clear lockout now" panel. It stays hidden
  until the migration is applied, and hidden for accounts that are not locked.
