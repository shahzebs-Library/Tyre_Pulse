# 96 - Inventory release: production release record

Production project `jhssdmeruxtrlqnwfksc`, 2026-11-20 (UTC). Executed on the owner's recorded approval
(doc 94 section 16, release commit `aefb9ee0ac6d4cf477b1834ab77f86fd192370d0`).

## 1. Recovery point (taken before any write)

| Item | Value |
|---|---|
| Time / LSN at start | 2026-11-20 22:32:43 UTC, `1A5/DD001FD0` |
| WAL archiving | healthy: 8,363 archived, last `00000001000001A5000000DC` at 22:31:30 UTC, 0 failures |
| Logical snapshot (schema `_bak`, owner-only) | `inv_release_20261120_<table>` for approval_policies 3, custom_roles 33, goods_receipts 0, material_master 22,162, metric_registry 12, metric_versions 12, module_permissions 1,374, purchase_orders 0, report_schedules 7, stock 0, stock_entry_requests 4, stock_movements 78, stock_records 43, suppliers 0, tyre_status_marks 907, user_access_grants 86, work_order_stock_reservation_lines 0, work_order_stock_reservations 0, profiles 772, organisations 5 (every count verified equal to source); `inv_release_20261120_fn` (1,414 function bodies + ACLs, public / private / approval_private); `inv_release_20261120_pol` (4,705 policies) |
| Baseline fingerprints | `_bak.inv_release_20261120_baseline` (phase `pre`, and `post_nhc` for stock_records) |
| Snapshot complete at | 2026-11-20 22:33:19 UTC, LSN `1A5/DD9F77D0` |
| Owner dashboard backup | confirmation as stated in the owner's instruction (doc 94 section 4); not visible to the agent |

## 2. Preflight (doc 94 section 11) - PASS

All baseline values equal the package (doc 94 section 6) except audit_log_v2 +1 row (normal use).
0 inv functions, 0 inventory relations, stock_records 43 / 345, stock_movements 78, material_master tyre 188,
1 NULL-country stock row, last migration `20261119100000`, 1 active session. Every guarded function md5
(section 3) equal, including validate_policy `b76c1c97`; get_fleet_cpk output md5 equal for KSA / UAE / Egypt.

## 3. Apply method

Production fetched each file itself from
`raw.githubusercontent.com/shahzebs-Library/Tyre_Pulse/aefb9ee0.../<path>` via `pg_net` into
`_bak.inv_release_sql` (all 33 files: 16 forward, 16 rollback, NHC correction; HTTP 200). sha256 was computed
IN THE DATABASE and equalled doc 94 section 1.1 for all 33. Each file was executed by
`_bak.inv_release_run(file, expected_sha)` (re-checks the hash, strips the top-level `begin;` / `commit;` lines,
`EXECUTE`), one file per call; the file's verify query (doc 90 section 3) was asserted in the same transaction
and the ledger row written in the same transaction, so a failed verify rolls the file back.

## 4. Files applied

| # | File | Applied (UTC) | Duration | Verify |
|---|---|---|---|---|
| - | 94_prepared/nhc_stock_country_correction.sql | 22:34:50 | 56 ms | row 5a55a635 NHC -> KSA, 35 units, cost NULL, 0 NULL-country rows, 43 / 345 |
| 1 | 20261120100000_inv_p0_ledger_integrity | 22:35:11 | 3,378 ms | pass (0 negative / over-reserved, no client UPDATE, keys + seq on 78 rows, 0 null org) |
| 2 | 20261120101000_inv_item_master_locations | 22:35:22 | 2,580 ms | pass (status set, no client INSERT); 188 tyre items serial_tracked |
| 3 | 20261120102000_inv_physical_audits | 22:35:31 | 2,683 ms | pass (5 tables RLS) |
| 4 | 20261120103000_inv_transfers_procurement | 22:35:35 | 2,909 ms | pass |
| 5 | 20261120104000_inv_valuation | 22:35:40 | 1,903 ms | pass: 33 rows / 302 units unvalued, 33 open cost reconciliations |
| 6 | 20261120105000_inv_tyre_items | 22:35:49 | 2,280 ms | pass: tyre_records + tyre_status_marks hashes unchanged |
| 7 | 20261120106000_inv_oem_fitments | 22:35:53 | 1,670 ms | pass |
| 9 | 20261120108000_inv_approvals | 22:36:00 | 2,390 ms | constraint lists 4 old + 4 inventory types |
| 8 | 20261120107000_inv_api_contract | 22:37:26 | 1,562 ms | pass (see deviation 5.1) |
| 10 | 20261120109000_inv_erp_reconciliation | 22:37:34 | 18 ms | pass, parts_consumption 219,356 |
| 11 | 20261120110000_inv_metric_catalogue | 22:37:40 | 12 ms | 25 inv metrics |
| 12 | 20261120111000_inv_report_schedules | 22:37:46 | 16 ms | 13 previous types + inventory |
| 13 | 20261120112000_inv_source_receipt | 22:37:53 | 22 ms | pass (fingerprint guard on 107000 output passed), snapshot 2 |
| 14 | 20261120113000_inv_approval_roles | 22:38:02 | 1,484 ms | validate_policy changed + contains inv_approver_roles, 3 live policies validate, 2 roles x 5 orgs |
| 15 | 20261120114000_inv_tyre_conflict_investigation | 22:38:10 | 37 ms | pass, tyre hashes unchanged |
| 16 | 20261120115000_inv_hardening | 22:38:18 | 20 ms | pass; doc 90 verify-8 query now returns 0 |

Ledger: 16 rows `20261120100000..20261120115000` in `supabase_migrations.schema_migrations`.
End of apply: 22:38:18 UTC, LSN `1A5/E448D400`.

## 5. Deviations (recorded honestly)

5.1 **Order of files 8 and 9.** The agent sent 107000 and 108000 as two calls at once. 107000's in-transaction
verify failed and rolled 107000 back completely; 108000 committed. Cause of the verify failure: the doc 90
verify-8 query does not exempt `_inv_secure_table` / `_inv_master_allowed_keys`, which production default
privileges make executable by `authenticated` until 115000 revokes them (rehearsal finding F3, doc 93). Both are
SECURITY INVOKER (no privilege gain). Order analysis before continuing: 108000 creates only new functions /
triggers / a view; 107000 renames and grants a disjoint list of functions; both alter `opening_balance_batches`
on different columns / constraints (0 rows). 107000 was then applied with the verify extended by exactly those
two names. Proof the end state matches the rehearsal: 112000's md5 fingerprint guard on 107000's `_inv_issue`
/ `_inv_transfer_dispatch` passed, 113000's guard on 108000's `_inv_approval_block_reason` passed, and after
115000 the original verify-8 query returns 0.

5.2 One smoke transaction was sent without a trailing `rollback;`; nothing persisted (verified: 78 movements,
0 smoke rows, 0 audits / batches / conflicts). One smoke call timed out client-side while the KSA tyre sync ran;
it finished and rolled back (verified 0 rows written).

## 6. Post-apply results

Baseline comparison (vs pre-apply re-take): stock_records original columns, stock_records qty/cost,
stock_movements original columns (78 / 302), tyre_records all columns + CPK inputs, tyre_status_marks,
parts_consumption per country, work_orders, profiles, module_permissions, user_access_grants, approval_policies,
custom_roles (33 pre-existing), metric_registry (12 pre-existing), report_schedules, organisations,
material_master original columns: **all identical**. Expected changes only: material_master `updated_at` on
exactly 188 rows; audit_log_v2 +278 (P0 backfill + 188 + NHC); custom_roles 43; metric_registry 37.
Unchanged function md5: app_user_can, app_current_org, is_super_admin, app_can_see_country / site,
scrap_tyre_by_serial, get_fleet_cpk; get_fleet_cpk output md5 equal for all three countries.
Security: 0 inv functions executable by anon; 0 `v_inv_*` views insertable by authenticated; 0 public tables
without RLS; advisors 0 ERROR, no inventory object in any lint (the release helper `_bak.inv_release_run` had
its search_path pinned after the advisor run).

Smoke (as real users, rolled back): super admin receive 1 with cost + issue 1 -> 6 -> 7 -> 6, 2 ledger rows,
tyre_records + parts_consumption unchanged; Reporter and Store Keeper `inv_issue` refused "Stock permission
"issue" is required."; audit create -> schedule -> start (18 snapshot lines) and the counter's view carries no
expected quantity; opening batches: Company A 36 lines + demo company 7 = 43 lines, 36 without cost (33 rows
with stock unvalued, 3 at zero), 7 `uncertain` legacy-drift lines; tyre sync UAE 1 conflict, Egypt 0.

## 7. Open operational items

* **KSA tyre custody sync is too slow - RESOLVED 2026-11-21 (section 11: `20261121110000_inv_tyre_sync_perf` applied, KSA 2.4 s, 7 conflicts materialised, doc 99).** Before the fix: `inv_tyre_item_sync('KSA')` did not finish in 55 s (UAE, 2,087 items:
  10.6 s; Egypt, 500: 1.2 s) because `_inv_tyre_item_sync` builds `_tc_derived` with correlated subqueries over
  unindexed temp tables. A web "Refresh" for KSA will hit the API statement timeout. Needs a follow-up migration
  (index the temp tables or rewrite as joins); the 7 conflicts are therefore not yet materialised in KSA.
* **Follow-up migration 20261121100000 - APPLIED 2026-11-21 on owner approval (see section 9):**
  `supabase/migrations/20261121100000_inv_reconcile_multi_balance.sql` (+ `_ROLLBACK`). Review
  finding on PR #569: `_inv_audit_reconcile` ties a count line that names no balance to ONE snapshot balance
  (`limit 1`) when an item/location holds several balances (condition / ownership split), so the count is
  credited to an arbitrary balance and the others show false shortages. The fix reconciles such an
  item/location once (sum of expectations, cutoff and the latest round's count lines; discrepancy at
  item/location level, cost only when every balance shares it); in-place anchored patch guarded by the live
  md5 `ba9845b1df32d899ff58bd87d8372bf0` (read from production 2026-11-20), original kept in
  `_bak.inv_121100_snapshot`. PGlite: defect reproduced before, 0 false discrepancies after, short count = one
  item/location shortage, rollback restores the original (`supabase/tests/inventory_reconcile_multi_balance.test.mjs`).
  **Production impact today: none** - read-only check 2026-11-20: 0 item/location groups with more than one
  balance (no `stock_records` row carries an `item_id` yet), 0 audits. **Operational rule (obsolete since 2026-11-21, kept for history):**
  before starting an audit, check that no item/location in its scope has more than one balance
  (`select item_id, location_id from stock_records where item_id is not null group by 1,2 having count(*) > 1`);
  if one does, count those items by scanning the balance label (`TP:STK:<id>`, which names the balance) or
  leave them out of the audit scope.
* Client fixes from the same review, shipped with this PR: blind-count "found item" lines are resolved to
  item / location ids (codes were dropped before and the line was refused); rejected lines stay on screen with
  the server's reason and the screen closes only when every line is saved; line `client_uuid`s are allocated
  once so a retry resends the identical payload; the reviewer comparison sums every line of the latest round
  per item/location like the server.
* Store Keeper capabilities NOT granted (owner: real sites first; all 7 hold `{ALL}`).
* No Inventory Controller / Finance Manager / KSA PMV Manager assigned; Admin / Manager / Director approve.
* Map the 18 NHC legacy lines through opening batches before the first full count (doc 94 section 16).
* Rollback files are in `supabase/rollbacks/` and also stored in `_bak.inv_release_sql`.
* Mobile: HOLD (no build).

## 8. Web, edge and mobile

| Item | Result |
|---|---|
| PR | #569 squash-merged to main as `fd85a466` (head `48454c19`, all CI green: web lint + tests + build, database tests, Flutter analyze / test / Android / iOS builds, CodeQL) |
| Vercel | `tyre-pulse` production deployment `dpl_2PDzxvEBaXKQScRwsiFoMZD6QJGZ` READY on `fd85a466` (alias app.tyrepulse.app); 0 runtime errors in the 30 minutes after |
| CI fix on the way | `reportCorrections` test: the PDF stream extractor dropped a page whenever the compressed bytes ended in 0x0D (date-dependent; it failed locally with main's code too) |
| Edge `send-scheduled-reports` | **NOT deployed.** Live v28 (verify_jwt false) predates main's money.ts / delivery.ts / inventory.ts. The only route available to the agent was hand-inlining ~116 KB of source through MCP in one call, which the project rule forbids (truncation / transcription risk to every scheduled e-mail; a restore would need the same 73 KB inline). Owner step: `supabase functions deploy send-scheduled-reports --project-ref jhssdmeruxtrlqnwfksc --no-verify-jwt` from main, then compare with `supabase functions download`. Until then a scheduled `inventory` report e-mails the fallback digest; "Generate now" works in the app. |
| Mobile | HOLD (no build) |

## 9. Follow-up 20261121100000_inv_reconcile_multi_balance - applied 2026-11-21

Owner approval recorded 2026-11-21. Same method as section 3 (one file, one call).

| Item | Value |
|---|---|
| Recovery point | 2026-11-21 05:48:31 UTC, LSN `1A6/BB012000`; WAL archiving healthy (8,585 archived, last `00000001000001A6000000BA` 05:48:19, 0 failures) |
| Snapshot | `_bak.inv_121100_pre` (function definition + ACL + fingerprints); `_bak.inv_121100_snapshot` (definition replaced, written by the file itself) |
| Preflight | live md5 of `_inv_audit_reconcile(uuid)` = `ba9845b1df32d899ff58bd87d8372bf0` (= the file's guard); last migration `20261120115000` |
| Fetch | `raw.githubusercontent.com/.../fd85a466a2806a7ab0007200bb0cd79f8d82e525/supabase/pending_migrations/20261121100000_inv_reconcile_multi_balance.sql` (HTTP 200), sha256 in the database `5b7ea51349d0b2d8b53d5fa72decbe6d405790020ed27940ead43e88f6c9f6a1` = repo (rollback fetched too, `2cc2b8e0...`) |
| Applied | 05:48:59 UTC, 39 ms, `_bak.inv_release_run`; verify in the same transaction: `amb_counted` present, not executable by authenticated or anon, snapshot 1 row; ledger `20261121100000 inv_reconcile_multi_balance` |
| After | new md5 `0f22d82014e1651e171b76b4eaac4ddf`; ACL unchanged `{postgres=X, service_role=X}`, SECURITY DEFINER kept; LSN `1A6/BB01C000` |
| Baseline | stock_records 43 (md5 equal), stock_movements 78 (equal), inventory_audits / count lines / snapshot lines 0 (equal): no data row touched |
| PGlite | `inventory_reconcile_multi_balance.test.mjs` 5/5 (now reads the file from `supabase/migrations` / `supabase/rollbacks`) |
| Smoke (rolled back, super admin Admin `d2d43a5f` + second Admin as counter, aal2) | location NHC warehouse + bin; one item (`290581-O`) received 6 good + 4 damaged = **two balances**; audit create -> schedule -> start (2 snapshot lines); counter submits ONE line of 5 naming no balance; complete; reconcile -> `matched 0, discrepancies 1`: **one item/location shortage, stock_id NULL, expected 10, counted 5, variance -5, value -25**. Afterwards audits 0, movements 78, stock_records 43, smoke locations 0, discrepancies 0 |
| Advisors | security: 0 ERROR |

The file in the repo carries an updated STATUS header; the executed body is the one at `fd85a466` (sha above).

## 10. Edge function `send-scheduled-reports` deployed (2026-11-21, owner authorised)

Supersedes the "NOT deployed" row in section 8.

| Item | Result |
|---|---|
| Rollback point | Live **v28** (single file `index.ts`, 73,085 chars, verify_jwt false, ezbr `e9189806...`) saved before the deploy in the agent scratchpad (`rollback_v28/index.ts`). Restore = redeploy that file as `index.ts` with verify_jwt false. |
| Deployed | **v29** from main `3f5134ff` (same function source as `fd85a466`): `index.ts`, `money.ts`, `inventory.ts`, `delivery.ts`, entrypoint `index.ts`, ezbr `ee671eb8...` |
| Byte check | All four deployed files fetched back and compared with `cmp` against the repo files: **identical** (sha256 equal). No backslash-u escapes in the source; the non-ASCII characters in `index.ts` comments / `asciiSafe` survived intact. |
| verify_jwt | Kept **false**, as v28. Evidence that the function authenticates every path itself: the cron path needs `x-cron-secret` equal (constant-time) to `cron_config.cron_secret` (service-role-only table); every other request goes to Send now, which needs a Bearer JWT validated with `auth.getUser`, an approved, unlocked profile with role Admin / Manager / Director, and reads the schedule through the caller's RLS client (a schedule the caller cannot see is a 404). `true` would add nothing for Send now and the pg_cron caller sends no user JWT. |
| Security review | No gap found, no source change. Every service-role read is filtered by the schedule's `org_id` (`requireOrg` / `requireInventoryOrg`, refused when blank); inventory money only when the schedule creator is an approved, unlocked Admin of that org or a super admin; currencies never added together; recipients regex-filtered; Send now has a 300 s per-schedule cooldown that fails closed; provider errors stay in `report_send_log`. Existing types route unchanged (claims, executive, dataset digests, builder:*, tyre_stock_alert, fallback). |
| Schema check | Live columns used by the function exist (`report_schedules.created_by/last_status/last_error/period*`, `report_send_log.*`, `stock_records.ownership/valued_value`, `v_inv_report_snapshot`); the report_type CHECK allows `inventory`. `report_exec_money_by_country` is not installed, so the executive digest uses its labelled legacy money fallback (handled by `isMissingRpc`). |
| Tests after deploy | pg_net calls: no auth = **401** `Missing bearer token`; wrong cron secret + fake JWT = **401** `Invalid session`; correct cron secret = **200** `{"processed":0,"sent":0,"failed":0,"skipped":0}` (boots, imports resolve; no schedule was due, so no e-mail went out). Inventory digest rendered from the live production snapshot (4 KSA sites, 302 unvalued units, 4 critical lines, 33 open cost reconciliations) with the deployed `inventory.ts`: ASCII-only HTML and a 5-line CSV, values withheld or shown per rule. Vitest: scheduledReportInventory / scheduledReportMoney / scheduledReports.api 51/51. |
| Not verified | No customer e-mail was sent. Only one schedule is active (`inspection`, next run 2026-11-22 05:00 UTC); its `report_send_log` row after that tick is the first live check of the new build. No `inventory` schedule exists yet; the first one created will be the first live inventory e-mail. |

## 11. Follow-up 20261121110000_inv_tyre_sync_perf - applied 2026-11-21, first real tyre sync

Owner approval recorded 2026-11-21 (PR #574 @ `39fa57f6`, CI green, review threads resolved). One file, one call.

| Item | Value |
|---|---|
| Recovery point | 2026-11-21 07:21:24 UTC, LSN `1A6/EB01CFA0`; WAL archiving healthy (8,633 archived, last `00000001000001A6000000EA` 07:20:41, 0 failures) |
| Snapshot | `_bak.inv_121110_pre` (old function definition + ACL + 19 fingerprints, 07:22:15 UTC, LSN `1A6/EB04C000`); `_bak.inv_121110_pre_tyre_items` / `_pre_conflicts` / `_pre_item_events` (all 0 rows before); `_bak.inv_121110_snapshot` (written by the file) |
| Preflight | live md5 of `_inv_tyre_item_sync(text)` = `92e69b6622a88dddc3358ddea0ff1276` (= the file's guard); signature unchanged |
| Fetch | pg_net from `raw.githubusercontent.com/.../39fa57f6.../supabase/pending_migrations/20261121110000_inv_tyre_sync_perf.sql` (HTTP 200, req 8345); sha256 in the database `abff81a32b73065a9b986fd2c80e70f0e82e6cf734004e3c6cb394d95dbf269f` = repo. Rollback req 8346, `2731a776...` = repo |
| Applied | 07:23:11 UTC, 2,292 ms, DO/EXECUTE of the stored body; ledger `20261121110000 inv_tyre_sync_perf` |
| After | new md5 `909a2379fd7fa97e1c34d971e2fca9ff`; ACL `{postgres=X, service_role=X}`, SECURITY DEFINER, search_path `public, pg_temp`. `inv_tyre_sync_runs` private (no grant to authenticated/anon; only the restrictive anum_reader policies). LSN `1A6/EC85F880` |
| Advisors | security: 6 lints (5 WARN, 1 INFO), 0 ERROR |

First real sync, through the web entry point `inv_tyre_item_sync({country})` as the owner super admin (aal2):

| Run | Items | Written | New conflicts | Weak-serial rows | Duration |
|---|---|---|---|---|---|
| KSA first | 6,032 | 6,032 | 6 | 1,791 | 2,365 ms |
| UAE first | 2,087 | 2,087 | 1 | 44 | 998 ms |
| Egypt first | 500 | 500 | 0 | 7 | 658 ms |
| KSA re-run (fingerprint changed by the UAE conflict, so rescan) | 6,032 | 0 | 0 | - | 1,274 ms |
| KSA immediate repeat | - | 0 | - | - | cached, about 39 ms |
| KSA concurrent pair (two pg_cron jobs started 07:28:00) | B rescanned 1,448 ms, wrote 0; A waited on the advisory lock and returned `cached=true` (last_run_at = B's run) | | | | no duplicates |

Old function on the same data: KSA timed out above 55 s (doc 97). The temporary cron jobs were removed after the test.

| tyre_items (8,619) | fitted | removed_pending | scrapped | unknown (conflict) |
|---|---|---|---|---|
| KSA | 2,401 | 2,724 | 901 | 6 |
| UAE | 1,358 | 726 | 2 | 1 |
| EGYPT | 411 | 89 | 0 | 0 |

Conflicts: exactly 7 open, all `scrapped_but_active`, one row each (no duplicates): KSA L52043311, YMM18886, YMM22455, YMM68731, YMU41519, YMY44573; UAE YMA44467. Not corrected; evidence and recommendations in docs/inventory/99.

Data unchanged (recomputed with the snapshot expressions after the sync): tyre_records (11,274; column and full-row md5), tyre_status_marks (907), tyre_price_provenance (428), tyre_cost_corrections (2,246), tyre_replacement_log (56), parts_consumption (219,356), engine_hours_logs, stock_records, stock_movements, tyre_store_holdings, tyre_dispositions: all equal. odometer_logs 2,999 -> 3,001 and vehicle_fleet km changed for exactly WL040 and TM369: two Mobile readings by field users at 09:28 and 09:58 UTC (normal use, the existing odometer trigger); nothing written by the sync.

## 12. Physical inventory release - applied 2026-11-21 (owner-approved)

Method as section 1: each file fetched by pg_net from its merged/pushed commit into `_bak.inv_release_sql`, sha256 checked in the database against the repo, run by `_bak.inv_release_run(file, sha)`, recorded in `supabase_migrations.schema_migrations`.

| Version | Commit | sha256 | Applied (UTC) |
|---|---|---|---|
| 20261122100000_inv_physical_inventory_master | 9e17a1a7 | 4898c971f96a3523fc14f6136fecd3612665adff531c7ff026281902017becbe | 21:25:12 |
| 20261122110000_inv_transfer_return_remaining_fix | fe0af9d5 | d36001a1964dd95d22d79d87186993da4ea7e93d5f8ee7e00dd8ecf7063c070a | 21:32:13 |
| 20261122120000_inv_location_setup | 93d03d90 | e3c97f231f9b7aa56da587c938d4143f5bec4d2c34d8cab42f174d2f605296bb | 21:35:27 |

- Backup: WAL recovery position 1A8/927E8000 at 21:24:10 UTC (archiver healthy: 0 failed, last archive 21:24:29); logical snapshot `_bak.physinv_20261121_{material_aliases,fn,pol,baseline}` (1,506 function bodies, 4,929 policies, fingerprints) and `_bak.xferfix_20261121_fn` (the three pre-fix transfer bodies).
- Staging: the local staging clusters have no inventory baseline, so the rehearsal ran on production inside rolled-back transactions plus the PGlite suite (inventory 14 files, all pass). Apply rehearsal 3.2 s; rollback rehearsal removed all 9 tables and 7 RPCs, 0 function bodies changed, material_aliases byte-identical, item_id NOT NULL restored.
- Data preserved: material_master (22,166), material_aliases (0), stock_records (50), stock_movements (86), opening_balance_lines (0), inventory_locations (4), tyre_records (11,274) full-row md5 identical before and after.
- Security after apply: 0 tables without RLS, authenticated cannot INSERT captures, anon cannot execute `inv_pi_*` or `inv_location_bulk_create`, `_inv_pi_*` helpers not executable by authenticated.
- Web workflow verified live as two super admins (rolled back): location, canonical propose (self-approve refused 42501, second person approves), variant, ERP link, session, identified capture (replay returns the same row), unidentified capture (UNK- reference), mapping, correction request and approval, search by normalised OEM number, close, opening batch (NHC held needs_review: 18 unmapped legacy balances; AMAALA mapped), approval request, approval by the other person, post: qty +4, one ledger row, line posted.
- Transfer fix verified on the Demo Fleet in-transit transfer (rolled back): before the fix an empty return flipped the status to partially_received with 0 ledger rows; after it returned all 3 remaining units (2 ledger rows, Demo stock total unchanged), a replay returned `replayed=true`, a second call with nothing left was refused 22023 with status unchanged.
- Location bulk setup verified (rolled back): dry run wrote 0 rows, real run created rack/shelf/bin under DEMO YARD, an unregistered store refused. No production bins were created.
- Demo Fleet: the three acceptance sign-ins were created through the app's own public sign-up (pending Reporter), then `supabase/fixtures/demo_fleet_inventory_accounts.sql` (sha d69d0d7d) bound them to the Demo company (Store Keeper A/B, no-stock account) and `demo_fleet_inventory_verify.sql` passed. 0 real staff in the Demo company.
