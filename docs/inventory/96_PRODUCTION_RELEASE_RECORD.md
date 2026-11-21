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

* **KSA tyre custody sync is too slow**: `inv_tyre_item_sync('KSA')` did not finish in 55 s (UAE, 2,087 items:
  10.6 s; Egypt, 500: 1.2 s) because `_inv_tyre_item_sync` builds `_tc_derived` with correlated subqueries over
  unindexed temp tables. A web "Refresh" for KSA will hit the API statement timeout. Needs a follow-up migration
  (index the temp tables or rewrite as joins); the 7 conflicts are therefore not yet materialised in KSA.
* **Follow-up migration awaiting owner approval (NOT applied):**
  `supabase/pending_migrations/20261121100000_inv_reconcile_multi_balance.sql` (+ `_ROLLBACK`). Review
  finding on PR #569: `_inv_audit_reconcile` ties a count line that names no balance to ONE snapshot balance
  (`limit 1`) when an item/location holds several balances (condition / ownership split), so the count is
  credited to an arbitrary balance and the others show false shortages. The fix reconciles such an
  item/location once (sum of expectations, cutoff and the latest round's count lines; discrepancy at
  item/location level, cost only when every balance shares it); in-place anchored patch guarded by the live
  md5 `ba9845b1df32d899ff58bd87d8372bf0` (read from production 2026-11-20), original kept in
  `_bak.inv_121100_snapshot`. PGlite: defect reproduced before, 0 false discrepancies after, short count = one
  item/location shortage, rollback restores the original (`supabase/tests/inventory_reconcile_multi_balance.test.mjs`).
  **Production impact today: none** - read-only check 2026-11-20: 0 item/location groups with more than one
  balance (no `stock_records` row carries an `item_id` yet), 0 audits. **Operational rule until it is applied:**
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
