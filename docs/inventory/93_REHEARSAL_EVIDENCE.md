# 93 - Production-like PG17 rehearsal: evidence (2026-11-20)

Branch `claude/inventory-upgrade-7rxp2t`. Owner approval covered the rehearsal only.
**Nothing was applied to production, merged, deployed or activated.** Production
(`jhssdmeruxtrlqnwfksc`) was read with SELECT only (catalog, aggregates, sanitized rows).
Tooling: `93_rehearsal_tooling/` (README lists every file). Release procedure: `90_RELEASE_PACKAGE.md`.

## Summary

| # | Gate | Result |
|---|---|---|
| 1 | PG17 environment matching production | **PASS** (stubs listed) |
| 2 | Sanitized production-equivalent snapshot, fingerprints = production | **PASS** (sanitized snapshot, not a backup restore) |
| 3 | Apply 16 on copy A; copy B apply -> reverse rollback -> byte-identical -> re-apply = A | **PASS** after 1 rollback fix (2 documented residues) |
| 4 | Real concurrent transactions | **PASS** (10/10) |
| 5 | Ledger immutable for every role incl. owner and superuser; lifecycle tables only via RPCs | **PASS** (21/21) |
| 6 | Valued / unvalued / undecided combinations | **PASS** (14/14) |
| 7 | SECURITY DEFINER review on PG17 | **PASS** after 1 privilege fix (17/17) |
| 8 | Legacy procurement RLS as distinct authenticated users | **PASS** (27/27) |
| 9 | Opening balances | **PASS** (8/8) + 1 data finding (null-country row) |
| 10 | The 7 tyres stay open conflicts; tyre data unchanged | **PASS** after 1 derivation fix (4/4) |
| 11 | History, tyre costs, CPK inputs, ERP expense, permissions preserved | **PASS** after 1 backfill fix (`updated_at` on changed rows only) |
| 12 | Approval-role mapping, Store Keeper refusal, SoD, scope, thresholds | **PASS** (20/20) |
| 13 | Browser test against PostgREST on copy A | **NOT TESTED** (no PostgREST binary obtainable; reason below) |
| 14 | pg_dump copy A -> pg_restore copy C -> fingerprints equal | **PASS** |
| 15 | Package | This file + doc 90 updated |

The rehearsal found **four real defects** that PGlite could not show. All four are fixed in the
pending files (minimal, documented in each file), and every gate was re-run from scratch on a
freshly rebuilt snapshot after the fixes. PGlite suite after the fixes: **104 tests, 103 pass,
0 fail, 1 skipped** (the PG16 staging race, superseded by gate 4).

| Fix | File | Defect found on PG17 + production data |
|---|---|---|
| F1 | `20261120105000_inv_tyre_items.sql` | `_inv_tyre_item_sync` matched scrap marks to tyre records by country AND serial. The live scrap mark for the UAE tyre (YMA4*, TM204 RHF1) is stamped **KSA**, so only **6** of the 7 scrapped-but-active tyres became conflicts. A scrap mark is keyed by serial (`unique (serial, mark_type)`), and the `inv_tyre_scrap_flag` trigger already matched by serial. The mark now takes the country of the company's tyre record for that serial (its own country only when no record exists). |
| F2 | `20261120101000_inv_item_master_locations.sql` | The backfill `update material_master ... where base_uom is null or ...` matched **all 22,162** live rows (base_uom is a new, empty column). The live BEFORE UPDATE trigger `set_material_master_updated_at` then overwrote `updated_at` on every row (edit history lost, 22k row rewrites). Now only rows whose values change are updated (live: the 188 tyre items, 0 rows with a uom). |
| F3 | `20261120115000_inv_hardening.sql` | Production default privileges (`pg_default_acl` for role postgres, schema public) grant `authenticated` INSERT / UPDATE / REFERENCES / MAINTAIN on every new view, USAGE / UPDATE on new sequences and EXECUTE on new functions. On PG17 **22 new views** carried client write grants (4 of them auto-updatable), the two new sequences were usable by clients, and `_inv_secure_table` / `_inv_master_allowed_keys` were executable by `authenticated`. Writes through the views were still refused (security_invoker checks the base table: proven), but the rule is no client write privilege on a new relation. 115000 now keeps SELECT and revokes the rest (version-agnostic, runs on PGlite 18 too). |
| F4 | `20261120100000_inv_p0_ledger_integrity_ROLLBACK.sql` | Rollback left `stock_movements.qty_before / qty_change / qty_after` as NUMERIC (and with them `v_stock_balance_reconcile`'s column types), so the catalog was not restored. They now return to INTEGER when every stored value is whole; with a fractional quantity they stay NUMERIC (never truncated) with a notice. |

## Gate 1 - PG17 environment

* Production read: `PostgreSQL 17.6 on aarch64` ; rehearsal: `PostgreSQL 17.6 on x86_64` (embedded-postgres
  npm build 17.6.0-beta.15; the PGDG apt repository is blocked by the network policy).
* Roles recreated from `pg_roles` / `pg_auth_members` / `pg_db_role_setting`: anon, authenticated,
  service_role (BYPASSRLS), authenticator (NOINHERIT, member of the three), dashboard_user,
  supabase_auth_admin, supabase_read_only_user (BYPASSRLS, read-only default), **postgres = NOT
  superuser, CREATEROLE, BYPASSRLS, member of anon/authenticated/service_role/authenticator** (exactly as
  production); bootstrap superuser `supabase_admin`. Role GUCs: anon `statement_timeout 3s`, authenticated
  8s, authenticator 8s / lock_timeout 8s. Server `search_path = "$user", public, extensions`,
  `max_locks_per_transaction = 64` (production value; the 2026-11-15 "out of shared memory" lesson).
* Database owned by `postgres` (production `datdba`), so `create schema if not exists _bak` behaves as live.
* Default privileges recreated from production `pg_default_acl` (postgres in public: authenticated
  `arwdxm` on tables, X on functions, rwU on sequences; PUBLIC execute revoked globally for postgres;
  supabase_admin in public: anon/authenticated/service_role all).
* Extensions: pgcrypto 1.3 and uuid-ossp 1.1 in `extensions` and pg_stat_statements (real).
  **Stubbed** (schemas only, recorded): pg_graphql, supabase_vault, pgmq, pg_cron, pg_net (not in this
  build); vector, hypopg, index_advisor, wrappers not installed. No rehearsed object references them.
  `auth.factor_type` / `auth.factor_status` enums recreated with GoTrue values.
* Migrations applied as role `postgres` with `psql -v ON_ERROR_STOP=1`, each file in its own run.

## Gate 2 - Snapshot (sanitized, production-equivalent; NOT a backup restore)

A true backup restore needs the owner's paid dashboard action (PITR / backup download), so this is a
**sanitized snapshot built from read-only catalog and data reads** (`93_rehearsal_tooling/extract_queries.sql`).

* Scope: 156 functions (closure of everything the 16 files call or rewrite + seed-table triggers +
  policy/default/check/view functions, transitively), 73 relations (27 seed + 46 support tables the
  functions read), their columns, defaults, generated/identity columns, constraints, indexes, policies,
  seed-table triggers, ACLs, column ACLs, owners, RLS flags.
* Data (sanitized; no PII leaves the database): stock_records 43, stock_movements 78, approval_policies 3,
  custom_roles 33, organisations 5, profiles 772 (names, usernames, e-mails, employee ids replaced;
  phones, push tokens, recovery data nulled), module_permissions 1,374, user_access_grants 86, sites 70,
  site_aliases 54, tyre_status_marks 907 (all), tyre_records 1,029 (every row of a serial with a status
  mark, which includes the 7 conflict tyres), parts_consumption 500 (latest), material_master 400,
  metric_registry 12, report_schedules 7 (recipients replaced), system_config 56 (secret-like keys
  excluded), reader_tables 28, plus smaller reference tables; auth.users generated locally for the 772 ids.
* **Fingerprints before apply: all 156 functions byte-identical to production** (md5 of chr(13)-stripped
  `prosrc` AND of `pg_get_functiondef`, plus owner). Guarded / replaced functions, production = snapshot:
  `post_stock_movement 12d9a6a0`, `set_stock_count 28e9e4d6`, `save_stock_entry 964c2e8c`,
  `transfer_stock_entry 34faec25`, `reserve_work_order_stock 91f34acb`, `release_work_order_stock 04ef02db`,
  `private.reserve_work_order_stock_internal f0552081`, `private.release_work_order_stock_internal 91d1c71a`,
  `approval_private.validate_policy b76c1c97` (re-read from production at the end of the rehearsal: unchanged).
  112000-114000's own guards (`_inv_issue`, `_inv_transfer_dispatch`, `_inv_approval_entity`,
  `_inv_approval_cap`, `_inv_tyre_conflict_decide`, `validate_policy`) all passed on PG17 (an abort would have stopped the file).
* Relations: 43 of 73 structurally identical. The 30 others differ only by what was deliberately not
  copied: triggers of support tables (82, recorded in the manifest), 3 FKs to tables outside the set
  (checklist_template_revisions, corrective_actions, workflow_definitions), 9 policies of support tables
  that call functions outside the set (domain_events, module_permissions, system_config, wo_assignments,
  wo_tasks, workflow_step_events), and PG's re-parse of `varchar = ANY(ARRAY[...])` CHECK text on
  purchase_orders / work_orders (same semantics). **Every seed table the migrations alter is identical**
  except those deparse-only CHECK texts.

## Gate 3 - Apply, rollback, re-apply

Copy A (`rh_a`, from the snapshot), as `postgres`, one file per run:

| # | File | sha256 | Result | Time |
|---|---|---|---|---|
| 1 | 20261120100000_inv_p0_ledger_integrity.sql | 1f88d1df0cf4e8da8fc28e95e4eaa7ccf0704f4105d7f8ac11b6eb356b00bb45 | OK | 0.35 s |
| 2 | 20261120101000_inv_item_master_locations.sql | 2cfcc19bdd086e8ce5c6429657295a28b95117f5a5d165f7f4d52dd8c6389532 | OK | 0.27 s |
| 3 | 20261120102000_inv_physical_audits.sql | 8fe0e83b1339f02f99b1b4592f12c2825b1b148b079d2d9aea098165e81c0ffa | OK | 0.36 s |
| 4 | 20261120103000_inv_transfers_procurement.sql | cecfeb5bc97e73fb20dcf1f133591e0d61c4689c0b389ba47945dc22ae9fd5b4 | OK | 0.28 s |
| 5 | 20261120104000_inv_valuation.sql | 446569816ed1575b8b2db7e84d0143463fd65d77cdcf887277f41deca96fff8d | OK | 0.21 s |
| 6 | 20261120105000_inv_tyre_items.sql | e0934823b833867b2ebe1c8fe00398be680be582f000c17d4c4a4da477d49f72 | OK | 0.26 s |
| 7 | 20261120106000_inv_oem_fitments.sql | 7380c5cc8dccde4e44e08ec8c04f725d9e062d2bafe13f58e5647857d68ef8de | OK | 0.21 s |
| 8 | 20261120107000_inv_api_contract.sql | cebc8ba48d278393046acb7616792511d0db0739945976f84d92c2276fc5beec | OK | 0.26 s |
| 9 | 20261120108000_inv_approvals.sql | 33e5a644d2c2038335547d953224bad06c7f4f57485bf4413a3b0a01fa47b456 | OK | 0.32 s |
| 10 | 20261120109000_inv_erp_reconciliation.sql | 833da63e377812f0125791d6711a36bc724f703d753f6d7a111cdbb22148513b | OK | 0.06 s |
| 11 | 20261120110000_inv_metric_catalogue.sql | faa6c7fe87b994edb1b8d0db353d8037093159cfb78c24def06cc50bd0b3e0e8 | OK | 0.05 s |
| 12 | 20261120111000_inv_report_schedules.sql | a918c2ae51a285f0ed91c020e4c83ce54e2006b65c9044664ac40035617a57bf | OK | 0.05 s |
| 13 | 20261120112000_inv_source_receipt.sql | c11d6d4c12456e88440ea8854a84e1ffc12baa013c0c4a0a056915d5f619cf3c | OK | 0.06 s |
| 14 | 20261120113000_inv_approval_roles.sql | b4c44de134753f3211956a6893118b376a3427e3fc37cb6f05ec181b590884d9 | OK | 0.25 s |
| 15 | 20261120114000_inv_tyre_conflict_investigation.sql | 19713c8bcdf9550bd7245eb4ada56b7681501520bd093e376072c575c70911cd | OK | 0.09 s |
| 16 | 20261120115000_inv_hardening.sql | 873fed0154ad5b06569861a6362579974a4844e6cbf181cd5a895370c7d429be | OK | 0.09 s |

All doc-90 section-3 verify queries on copy A return the expected values (`93_rehearsal_tooling/verify.sql`):
0 negative / over-reserved balances, `authenticated` UPDATE on stock_movements = f, 0 null key / seq /
org movements, 0 null material status, 5 audit tables with RLS, per-company PO key present, 0 unvalued
balance without an open reconciliation (33 `legacy`, 302 units), 0 `_inv_*` helpers executable by
authenticated outside the allowlist (was 2 before F3), approval type CHECK with the 4 old + 5 inventory
types, ERP view runs, 25 `inv_` metrics, report type CHECK contains `inventory`, source receipt in
`_inv_issue` / `_inv_transfer_dispatch`, `_bak.inv_112000_snapshot` 2 rows, validate_policy changed and
contains `inv_approver_roles`, the 3 live inspection policies validate, 2 new roles in each of 5
companies, 0 conflicts not open, the 4 helpers not executable by anon, 3 lifecycle-guard triggers.

Copy B (`rh_b`): forward 16/16 OK; reverse rollback (115000 ... 100000, sha256 in doc 90) 16/16 OK.
Whole-catalog fingerprint (`catalog_fp.sql`: 1,655 objects - functions with ACL and owner, relations
with columns / defaults / column ACLs / view text / options, constraints, indexes, policies, triggers,
types, schemas, default ACLs, business-data hashes; ACL items sorted):

* **Snapshot vs copy B after rollback: identical** (0 missing, 0 extra, 0 changed catalog objects),
  except two documented residues:
  1. `_bak.inv_p0_snapshot` (139 rows) is kept by the P0 rollback (the restore source, no client grant).
  2. `material_master.updated_at` of rows whose `serial_tracked` changed (5 in the sample, 188 live)
     is not restored; their business columns are identical.
* Before F4 the comparison showed 16 differences: 4 legacy writers + stock_movements (ACL item order
  only: same privileges), 9 `anum_reader_select_scope` policies (snapshot fidelity: reader_tables data was
  not yet copied; fixed in the snapshot), stock_movements column types and v_stock_balance_reconcile (F4).
* Copy B re-applied vs copy A: **identical catalog (2,461 objects)**; data differs only in generated
  ids and timestamps (custom_roles ids / created_at, metric_registry created_at, material_master
  updated_at); with those excluded the hashes are equal.

## Gate 4 - Concurrency (separate psql connections, real roles)

Store Keepers (real, sanitized profiles, given the stock capabilities on the copy: production gives
Store Keeper only `view` + `create` today) posting in parallel, each call its own connection
(`begin; set local role authenticated; request.jwt.claims; select fn(payload); commit`):

| Race | Result |
|---|---|
| 8 parallel issues of 2 from 10, two users | 5 posted, 3 `refused_shortage`, balance 0, ledger sum 0 |
| Same idempotency key from 6 connections | 1 posted, 5 `replayed: true`, 1 ledger row, balance +3 once; replay after commit `replayed: true`; same key, other payload refused (23505) |
| 6 parallel reservations of 3 against 10 | 3 active, 3 refused, reserved 9 <= 10 |
| issue / release / issue on a reserved balance | never below reserved, never negative, ledger = balance |
| 2 transfer dispatches of 6 + 1 issue of 2 from 10 | 1 dispatch + the issue posted, second dispatch refused (23514), item quantity conserved |
| 2 full receipts of the same transfer line | received once; second refused (22023) |
| 2 reversals of one movement | exactly one reversal row, balance back to 0 |
| Global after all races | 0 negative, 0 over-reserved, 0 unvalued > on hand; only the 7 pre-existing legacy drift rows differ from their ledger |

## Gate 5 - Immutability

`stock_movements` UPDATE / DELETE / TRUNCATE refused for: authenticated Store Keeper and super admin
(42501 permission), owner `postgres` with BYPASSRLS (trigger: "append-only; post a reversal"),
service_role, and superuser `supabase_admin` (trigger). `tyre_item_events` (910 rows after sync) and
`inventory_approval_decisions` refuse UPDATE / DELETE for the owner and the superuser.
`inventory_cost_reconciliations`: owner DELETE refused, owner status jump outside the RPC refused
(CHECK), authenticated UPDATE refused; `inventory_approval_requests` direct INSERT and
`tyre_custody_conflicts` direct UPDATE refused for an authenticated super admin.

## Gate 6 - Valuation

Receipt without cost -> `unvalued`, unit cost and value NULL (never 0), opens a cost reconciliation;
no posted movement carries a zero cost. Mixed issue (4 valued + 2 unvalued, issue 5): 3 move at value
(-30), 1 unvalued, 1 undecided -> `issue_allocation`, decided by a second person (proposal -> Admin
approval -> post). Cost reconciliation: proposal with evidence by Finance Manager; posting before approval
refused; the proposer cannot approve (`segregation_of_duties: requester`); independent approval;
second approval refused (`not_pending`), exactly one decision row; post once, second post refused
("already resolved"). Transfer of 6 from (6 valued + 1 unvalued) with a partial receipt: undecided unit
travels with no value, carried value <= cost. Every balance with unvalued units keeps them separate.

## Gate 7 - SECURITY DEFINER review (PG17)

114 inventory DEFINER functions: 0 without a pinned `search_path`, 0 executable by anon, 0 by PUBLIC.
No inventory function of any kind executable by anon; no anon privilege on any new table / view;
**no client write privilege on any new table or view** (after F3; 22 views before); anon calling
`inv_issue` -> permission denied; writes through auto-updatable views refused at the base table.
Cross-company id injection by a Manager of the second company holding every stock capability, one per
family: post onto / issue from / reserve a company-A balance, reverse a company-A movement, transfer
from a company-A location, location under a company-A parent, company-A cost reconciliation, company-A
item onto a company-B location, company-A tyre conflict: **all refused** (42501 / P0002 / 22023);
company-A balances hash unchanged; company B reads no company-A row (table or view).

## Gate 8 - Legacy procurement RLS (live policies)

Rows inserted for company A (and the same PO number for company B: allowed, per-company key). For
suppliers, purchase_orders, goods_receipts, requisitions, materials as distinct authenticated users:
company B reads 0, updates 0, deletes 0 and cannot insert into company A (RLS / privilege); the UAE-scoped
PMV Manager updates nothing in KSA; a KSA Manager cannot delete a PO (admin-only guard) but still reads it.

## Gate 9 - Opening balances

43 rows (345 units) preserved; 33 rows / 302 units unvalued, each tracked by one open `legacy` cost
reconciliation; 7 rows drift from their ledger. The 7 drift rows all belong to the **second company**
(DEMO YARD / DEMO PLANT, 43 units of drift); seeding that company's batch records all 7 as `uncertain`
with `legacy_drift`, nothing posted. Company A's KSA seed: 35 lines, unpriced lines keep a NULL cost, no
zero cost anywhere, no line points at another company's row. Source rows hash (stock_records incl. new
balance columns + stock_movements) identical before and after seeding.

**Finding (data, owner):** one company-A row has `country` NULL (NHC, 35 units, unvalued). Every
opening batch is per country, so this row is in no batch. Set its country before the opening count.

## Gate 10 - The 7 tyres

After `inv_tyre_item_sync` (KSA, UAE): exactly **7** `scrapped_but_active` conflicts, all open
(KSA L520* YMM1* YMM2* YMM6* YMU4* YMY4*, UAE YMA4*); **6 before F1**. tyre_records and
tyre_status_marks hashes identical before and after; the direct decision is refused for this conflict
type ("decided through its investigation"); records unchanged afterwards.

## Gate 11 - Preservation (snapshot vs copy A)

Identical: stock_records (original columns), stock_movements (original columns), tyre_records (all
columns) and the cost / CPK inputs (cost_per_tyre, km, dates, status, serial, asset, position),
tyre_status_marks, parts_consumption sample (500 rows, line_cost 105,265.84), profiles (role, country,
sites, approved, locked, super admin, org), module_permissions, user_access_grants, approval_policies,
custom_roles (pre-existing), metric_registry (pre-existing), report_schedules, organisations,
material_master (all original columns except `updated_at`). Changed by design: `updated_at` of the
material_master rows whose `serial_tracked` flips (F2: 188 live rows, was 22,162). Of the 156 closure
functions, 149 are byte-identical after apply; the 7 replaced are the intended ones (4 legacy writers,
2 private work-order reservation internals, validate_policy). The P0 backfill writes 274 rows to
`audit_log_v2` on the sample (231 stock_movements + 43 stock_records updates by the live audit trigger):
expected, audited system change. No migration writes parts_consumption, tyre_records or any CPK object.

## Gate 12 - Approvals

Inventory Controller + Finance Manager exist in all 5 companies; the 3 live inspection policies still
validate. validate_policy refuses Store Keeper (role or named person) on an inventory stage; refuses
Inventory Controller while nobody holds it (production: 0 holders) and accepts it once a person holds
it; accepts Manager. Opening batch prepared by a Store Keeper: another Store Keeper with every approval
capability refused; preparer refused (SoD by user id); UAE-scoped PMV Manager refused (`out_of_scope`);
second-company Manager refused (not found); Workshop Maintenance Area Manager refused on the default
route (not in the contract list for opening balances) and a limit for that role refused; KSA Manager
approves. Thresholds (Manager 100 SAR / 5 units, Admin unlimited): 60 SAR approved, 1,200 SAR refused
(`above_threshold`) and escalated to Admin, unpriced batch refused ("value is not known"); non-admin
cannot set limits; a Store Keeper limit refused.

## Gate 13 - Browser test: NOT TESTED

PostgREST could not be obtained in this environment: not in Ubuntu or conda-forge, GitHub release
downloads 403, Docker Hub `postgrest/postgrest` 429 Too Many Requests, ECR Public
`supabase/postgrest` "Data limit exceeded". Without PostgREST (and GoTrue) the Vite app cannot talk
to copy A. The client contract remains covered by the PGlite PostgREST bridge E2E (24 flows,
doc 90 section 6), and gates 4-12 exercise the same RPCs on PG17 as real roles. Owner / next session:
run a browser pass on a Supabase branch or staging project after the apply decision.

## Gate 14 - Backup / restore

`pg_dump -Fc` of copy A (client 18.7, 2.0 MB, sha256 78eed992..., 1 s) -> `pg_restore --exit-on-error`
into new database copy C (3 s, 0 errors). Catalog fingerprint A vs C: 2,461 vs 2,461 objects, 0
missing / extra; 8 differ only because an explicit owner-only ACL (`{postgres=UC/postgres}`,
`{postgres=arwdDxtm/postgres}`) is restored as the equivalent default (NULL) on `_bak`,
`approval_private` and their 6 tables. Business-data hashes (gate 11 set) identical. Functions identical.

## What this rehearsal does not prove

* Not a backup restore of production (gate 2); support-table triggers and 9 support policies were not
  copied; extensions listed in gate 1 are stubs.
* Volume: production has 22,162 material_master rows (sample 400), 11,274 tyre_records (sample 1,029),
  219,356 parts_consumption rows (sample 500). Timings above are on the sample.
* No browser or device test (gate 13; device test stays a standing no-build rule).
* Edge function `send-scheduled-reports` not deployed or tested here.
