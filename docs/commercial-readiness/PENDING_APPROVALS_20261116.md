# Pending production approvals (2026-11-16)

> SUPERSEDED 2026-11-16 by `COMPLETION_DASHBOARD.md` (TEN-9f below is now applied).

Nothing below is applied. Each item needs the owner's explicit approval. Order = recommended order.

## 1. TEN-9f sign-in lockout per account (live gap inside our own sign-in flow; not complete auth protection, see package)
- PR #548, `supabase/pending_migrations/20261116100000_ten9f_login_lockout_per_account.sql` (+ROLLBACK)
- Full package: `docs/commercial-readiness/ten9f/APPROVAL_PACKAGE.md` (on PR #548)
- Bypass reproduced on production (rolled back, demo account). Staging 52/52 (adds timing, flood and retention), rollback byte-identical.
- Not covered: direct Supabase Auth API calls (needs a paid Teams hook or CAPTCHA on all clients).

## 2. #545 company-scoped job card joins (before any second company imports data)
- `20261117110000_by_number_org_joins.sql` (+ROLLBACK), 9 live objects.
- Staging (2026-11-16):
  - all 11 objects md5-identical to production before the test
  - applies and rolls back byte-identical
  - outputs identical with one company's data (6 reports hashed before/after)
  - a synthetic second company with the same job card and asset numbers no longer leaks into Company A (7 cases)
  - no slowdown (6.6-7.1 ms before, 6.2-6.4 ms after)
- Production today: 0 job card numbers and 0 asset codes shared between companies. The join keys are indexed.
- Production impact today: none (one real company).

## 3. #545 complaints import row-level reject (useful now)
- `20261117112000_complaints_missing_in_date_reject.sql` (+ROLLBACK). Apply after item 2.
- Today a single blank Vehicle In Date aborts the whole complaints upload. After: that row is skipped with a clear reason, the rest land.
- Revised on this branch: re-uploading a file no longer logs the same rejected row twice.
- Staging: `staging_complaints_in_date.sh` ALL OK; re-run no-op; rollback restores the by-number text.
- Re-verified on a fresh staging copy (joins + complaints together): 8/8 PASS including "same file uploaded twice keeps one reject per row" (the previous draft logged 4 rows, now 2); owner report snapshots unchanged; all 7 two-company leak cases closed; both rollbacks restore the 11 objects byte for byte.

## 4. Recall number unique per company
- `20261117102000_recalls_number_unique_per_org.sql` (rollback in the file).
- Duplicate check on production 2026-11-16: `recalls` holds 0 rows, so 0 duplicates. Existing key `(recall_number, country)` is global across companies.
- Staging: applies, gives `UNIQUE NULLS NOT DISTINCT (organisation_id, recall_number, country)`, rollback restores the old key.
- Note: the key is exact text; "R-1" and "r-1 " are different numbers.

## 5. Temporary Tyre Exchange index (KEEP for now)
- `tyre_status_marks_serial_mark_type_bridge` stays.
- No database function, Expo or Flutter path needs it, and the live web build uses the new key.
- Usage counters cannot tell old and new browser tabs apart: both unique indexes are checked on every insert (16 vs 8 scans, same last-use time).
- Removal file `20261117111000_drop_tyre_status_marks_bridge.sql` was tested on staging (drop and recreate).
- Recommend removal after 2026-11-22 (7 days after the #541 deploy) and before a second company records marks.

## 6. Multi-company sign-in (#546, NOT for now)
- TEN-9d (company code guard), TEN-9e (invitation sign-up refuses cleanly) and TEN-9g (new: a username containing "/" can no longer take over the company-code form).
- Staging: 202 passed, 0 failed; Flutter auth 192/193 (one known Linux golden image difference).
- Production exposure today: low. Single-company mode is on, no company has a sign-in code, and 0 usernames contain "/" or "\".
- Before turning single-company mode off, these must also happen:
  - deploy the sign-in function
  - set company codes
  - test on a hosted staging copy
  - ship a new Flutter build
  - set `tp.import_org` in the import runbook
- ten9c (per-company usernames) stays on HOLD.

## Still pending from earlier (unchanged, separate decisions)
- eng1-6 cost per km drafts (change displayed numbers)
- `cur_kpi_targets_org_scoped_key`
- ops webhook/backup/exec-money drafts
- atr user_view_prefs + carbon_offsets
- `profiles_pii_read`
- `replace_open_work_orders_rpc`
