# TEN-9f approval package: sign-in lockout per account

Status: ready for owner approval. Nothing applied to production.

## The defect (live today)
- The "lock after 5 failed sign-ins" counter is keyed on the text typed, not the account.
- One account answers to several texts: username, employee id, email, `<company code>/<name>`, and any spacing or backslash variant of that last form.
- Reproduced on production 2026-11-16 in a rolled-back transaction, demo account only:
  - after 5 failures on `demo.manager` the account read LOCKED
  - `PLAY-DEMO-MGR`, `demo.manager@users.tyrepulse.app`, `demo/demo.manager`, `demo / demo.manager` each still read 5 fresh attempts
  - spacing variants are unlimited, so a guesser never hits the lock
- Second defect found while testing: unknown names never lock and answer without a `remaining` key, real names lock and answer with it. An anonymous caller can tell which usernames exist.

## The fix (one standalone migration)
- `supabase/pending_migrations/20261116100000_ten9f_login_lockout_per_account.sql`
  - one counter per account (`u:<profile id>`), resolved with the same function sign-in already uses
  - unknown names get their own hashed counter and lock the same way; the typed text is not stored
  - neither RPC returns `remaining` (no screen on web, Expo or Flutter shows it)
  - failures are recorded with one `INSERT .. ON CONFLICT` (hardening; the old race did not reproduce)
  - new `admin_login_lock_status` / `admin_clear_login_lock`: super admin, or an Admin of the same company; reason required; every clear written to `access_audit` with the before state
- Independent of TEN-9d, TEN-9e, ten9c and the multi-company switch. Only reads functions already live.
- Unchanged for users: 5 attempts, 15-minute window, 15-minute lock, reset on successful sign-in, same response keys the apps read.

## Console (ships with the app, separate from the migration)
- Reset password window in Console > Users shows "Sign-in is locked after N failed attempts" with a reason box and "Clear lockout now".
- Hidden until the migration is applied, and hidden for accounts that are not locked.

## Evidence (local staging, production-identical functions)
- `bash supabase/tests/ten9f_lockout/run_staging.sh`
- Check 0: the six lockout functions in staging have the same md5 as production.
- Before the fix: 8/8 bypass and oracle checks reproduce.
- After the fix: 48 passed, 0 failed:
  - every spelling locks together; rotating spellings lock on the 5th
  - unchanged experience for one spelling; 15-minute expiry; fresh window after expiry
  - real and unknown names give identical responses and lock on the same attempt
  - account switching: locking one account leaves other accounts on the device and in other companies open
  - successful sign-in clears the account counter and legacy rows
  - admin recovery: anon, Driver and another company's Admin refused; same-company Admin needs a reason, clears, audited; super admin clears any company
  - `max_login_attempts = 0` never locks
  - grants as intended
  - 20 simultaneous failures all counted; a burst locks at exactly 5
  - rollback restores the production bodies byte for byte and removes the new objects
- Web: `src/test/loginLockPanel.render.test.jsx` 4/4.

## Not covered (decide separately)
- A script that calls the Supabase Auth API directly with an account's email never touches this counter. Today that path is bounded only by Supabase Auth's per-IP rate limits.
  - Full server-side lock needs the Password Verification Attempt hook (Supabase Teams plan, paid) or CAPTCHA on web and both apps.
- One-time codes:
  - TOTP two-factor codes are checked by Supabase Auth after a correct password and are not counted here. Per-account limits need the MFA Verification hook (Teams plan).
  - QR sign-in uses single-use server-minted codes with number matching; no password is guessed there.
- Anyone can still lock an account for 15 minutes by failing 5 times on purpose. This was true before too; the new admin unlock is the remedy.

## Apply (after approval)
1. Pre-check (read only): md5 of `login_attempt_status` = `bda4f978f7404a86aa650f9aab6f3f14`, `record_login_failure` = `c8a5b4a419e567262e6620c3fb16bbed`, `reset_login_attempts` = `32867f65d8493dd864f2d00c9e29dc71`. Locked rows now: 0.
2. Apply the migration file as one transaction.
3. Verify:
   - run `supabase/tests/ten9f_lockout/production_verify.sql` (rolled back, demo account only)
   - expect every spelling `true`, `remaining_key=false`
4. Expected md5 after apply:
   - `login_attempt_status` ca2a4834fee66968374b0a4027538cd4
   - `record_login_failure` 68098e70df5ce1c09d984de0df07e30b
   - `reset_login_attempts` 6224b66424145d192d1acfa85b89fe36
   - `_login_attempt_key` a597250b250bf361341e419761adcd59
   - `_login_lock_admin_ok` 747373f1e7db909edaaa6f1e3e297f29
   - `admin_login_lock_status` 035131787fe6136a14dc1e8e4e3ec69c
   - `admin_clear_login_lock` a43074e635b38db1d1d96cca6a769535
5. Rollback if needed: `20261116100000_ten9f_login_lockout_per_account.ROLLBACK.sql` (restores the three production bodies exactly; keeps audit rows).
6. Note: the migration text contains `delete`, so the Supabase tool asks a person to confirm at apply time.
