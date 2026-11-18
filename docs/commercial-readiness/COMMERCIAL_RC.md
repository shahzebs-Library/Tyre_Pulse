# Commercial release candidate (branch claude/commercial-rc-7rxp2t)

One branch from origin/main 5b5f7e3b containing #546 (company code sign-in, invite, company isolation client),
#550 (CAPTCHA, hardened `sign-in` function; it already contained #546) and #548 (TEN-9f lockout: staging test
suite, console unlock panel, approval package). Multi-company mode and CAPTCHA stay OFF. Nothing deployed or applied.

## Consolidation decisions
- #550 already contained #546: merged once, no duplicate sign-in function or Flutter sign-in (see PHASE2_STATUS.md).
- #548: the migration `20261116100000_ten9f_login_lockout_per_account.sql` is byte-identical to the file already applied
  to production (md5 973ed89a784ffb3a8325cd6d5a121395). Added from #548: `supabase/tests/ten9f_lockout/*`,
  `LoginLockPanel` (admin unlock in Console > Users), `adminLoginLockStatus/adminClearLoginLock`, its render test,
  `ten9f/APPROVAL_PACKAGE.md`. `vercel.json` conflict resolved by keeping both entries (+ this branch).
- New in the RC: Flutter by-number reads (scan lookup, meter log, checklist hours, tyre fitment, inspection previous
  meters) now filter on the caller's `organisation_id` (null = row-level security only, as before).
  Test: `src/test/flutterCompanyPinnedReads.test.js`.

## Required migrations (all in supabase/pending_migrations, NONE applied; order matters)
Applied already in production: TEN-1..13, COM, TEN-9f. Needed before `single_tenant_mode = false`:
| Order | File | Impact | Rollback |
|---|---|---|---|
| 1 | 20261115168000_ten9d_company_code_guard_and_admin_set | company Admin can no longer set its own sign-in code directly | revert function/guard (header) |
| 2 | 20261115168500_ten9e_invitation_signup_refuses_cleanly | refused invitation no longer leaves an orphan account | header |
| 3 | 20261115168800_ten9g_code_form_cannot_be_squatted | usernames containing / or \ refused (0 exist) | sibling ROLLBACK |
| 4 | 20261117110000_by_number_org_joins | 9 live functions also match company on job card / asset number | sibling ROLLBACK |
| 5 | 20261117112000_complaints_missing_in_date_reject | needs #4 first; blank in-date rejected, not batch-aborting | sibling ROLLBACK (before #4's) |
| 6 | 20261117113000_company_pinned_lookups | per-asset / per-serial readers stay in one company for super admins | sibling ROLLBACK |
| 7 | 20261117102000_recalls_number_unique_per_org | recall number unique per company (0 rows today) | header |
| 8 | 20261117111000_drop_tyre_status_marks_bridge | owner approval only; remove after ~2026-11-22 and before a second company records marks | recreate index (header) |
`sign-in` edge function must be redeployed (authenticated `supabase functions deploy sign-in`, verify_jwt=false).

## Test results (this RC head)
See the final report; Flutter analyze/tests and deno e2e could not run here (no SDK / no deno): they are release blockers.

## Release blockers (named, owner/CI)
1. Flutter CI on the pushed head (analyze, tests, ARB parity 2523, golden noise `login_wide_ar`).
2. Deno + psql run of `e2e/auth/sign_in_edge_local.mjs` and `e2e/multi_company/sign_in_edge_local.mjs` against the merged `sign-in`.
3. Staging E2E of company sign-in, invite and cross-company matrix (`supabase/tests/multi_company_auth/run_staging.sh`, `staging_company_pinned_lookups.sh`).
4. Real device test of Flutter sign-in with company code; Turnstile real site key and Expo 1.6.0 phones (#551) before CAPTCHA is ever switched on.
5. Each organisation needs a sign-in code (`admin_set_org_sign_in_code`); import runbook must set `tp.import_org`.
6. ten9c (per-company usernames) stays HOLD. Flutter has no invitation screen (web page only).
7. Subscription enforcement stays `entitlement_enforcement = off` (TEN-6/6b preflight applied; plan limits grandfathered by V313); needs billing go-live decision.

## Deployment sequence
1. Merge RC. 2. Apply migrations 1-7 one batch at a time on staging, then production with a rollback file ready.
3. Deploy `sign-in` function. 4. Build Flutter + web. 5. Set sign-in codes per company. 6. Staging E2E.
7. Only then `single_tenant_mode = false` (owner decision). CAPTCHA last, separately.
