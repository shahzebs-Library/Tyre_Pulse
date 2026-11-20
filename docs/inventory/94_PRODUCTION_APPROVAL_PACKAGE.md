# 94 - Inventory release: production approval package

Branch `claude/inventory-upgrade-7rxp2t`. Prepared 2026-11-20 (21:10-21:40 UTC).
Architect decision: **CONDITIONAL GO**. This document is the ONE package the owner signs.

**Nothing was applied to production, merged to main, deployed (web / mobile / edge) or activated.
No permission, role, profile or data row was changed.** Production (`jhssdmeruxtrlqnwfksc`) was read
with SELECT only (catalog, aggregates, named people's role/country/sites; no e-mail or phone).
The 14 PG17 rehearsal gates of doc 93 were NOT repeated: no migration file changed since (gate 1).

Related: `93_REHEARSAL_EVIDENCE.md` (rehearsal), `90_RELEASE_PACKAGE.md` (procedure, section 0 and 3),
`31_TYRE_CONFLICT_EVIDENCE.md` (the 7 tyres), `92_MOBILE_DEVICE_TEST_PLAN.md` (device test),
`94_prepared/` (three prepared, not applied SQL files).

---

## 1. Release identity

| Item | Value |
|---|---|
| Rehearsed file set | commit **`17e918da`** (PG17.6 rehearsal, doc 93) |
| Release commit | the commit that adds this file on `claude/inventory-upgrade-7rxp2t` (parent `86a77c14`). It and `86a77c14` change **docs only** on top of `17e918da`; the 32 SQL files are byte-identical (section 3, gate 1). |
| Database files | `supabase/pending_migrations/20261120100000..20261120115000` (16 forward + 16 `_ROLLBACK`) |
| Production at prepare time | PostgreSQL 17.6 (aarch64), project status ACTIVE_HEALTHY, region ap-northeast-1, organisation plan **Pro**, DB 2,681 MB, last migration in ledger `20261119100000 oem_review_items_source_row` (1,115 rows); **0** `inv_*` functions, **0** inventory relations, **0** Inventory Controller / Finance Manager roles = nothing of this release is present |

### 1.1 The 32 hashes (sha256, recomputed at the branch tip, all equal to the rehearsed values)

| # | Forward file | Forward sha256 | Rollback sha256 |
|---|---|---|---|
| 1 | 20261120100000_inv_p0_ledger_integrity | 1f88d1df0cf4e8da8fc28e95e4eaa7ccf0704f4105d7f8ac11b6eb356b00bb45 | 2054555b02d9e0131fcca397c254e9ffc86654b82f7a522c3760fc51ee29bb48 |
| 2 | 20261120101000_inv_item_master_locations | 2cfcc19bdd086e8ce5c6429657295a28b95117f5a5d165f7f4d52dd8c6389532 | a929a39ae941b77b13f978ef1eee977bf8ae484963d8f75c0a87b9d7f549819b |
| 3 | 20261120102000_inv_physical_audits | 8fe0e83b1339f02f99b1b4592f12c2825b1b148b079d2d9aea098165e81c0ffa | dfa3518030d9423829fbc75c42e661b85ce2c6089bae7aaa4bfcc65446d76212 |
| 4 | 20261120103000_inv_transfers_procurement | cecfeb5bc97e73fb20dcf1f133591e0d61c4689c0b389ba47945dc22ae9fd5b4 | 1757bb4cc7cf0be21871cc4a82d00f3494dec529beb67d6e5901a52fb9e2ed59 |
| 5 | 20261120104000_inv_valuation | 446569816ed1575b8b2db7e84d0143463fd65d77cdcf887277f41deca96fff8d | 0fc57fa99fabe7c30611f4a9daff6a4e5aa3b24dc45f6130377833005ad4d664 |
| 6 | 20261120105000_inv_tyre_items | e0934823b833867b2ebe1c8fe00398be680be582f000c17d4c4a4da477d49f72 | 61414d34240606dd99e682a00a152558069c35440faf9276316ccdf0a58a8e4f |
| 7 | 20261120106000_inv_oem_fitments | 7380c5cc8dccde4e44e08ec8c04f725d9e062d2bafe13f58e5647857d68ef8de | 649ad940ff174f9c105f5f4747f8cd878c6957ca97cb18fac33b22b7b3488646 |
| 8 | 20261120107000_inv_api_contract | cebc8ba48d278393046acb7616792511d0db0739945976f84d92c2276fc5beec | 6e41ea08cc3ef85e41044750572ccf5420d2625b51d2b64a10ff546db95e7e09 |
| 9 | 20261120108000_inv_approvals | 33e5a644d2c2038335547d953224bad06c7f4f57485bf4413a3b0a01fa47b456 | c31770276a696c6268417dc2170640c8be6d7b806ba10d30b735080db764f349 |
| 10 | 20261120109000_inv_erp_reconciliation | 833da63e377812f0125791d6711a36bc724f703d753f6d7a111cdbb22148513b | 12415a782ecf8b512c0acd14c0c63657e78ae827c1a212972e6e054d4e3c1701 |
| 11 | 20261120110000_inv_metric_catalogue | faa6c7fe87b994edb1b8d0db353d8037093159cfb78c24def06cc50bd0b3e0e8 | 2e41550a0fe6f80af88c6bf4693b70091833def4a1cd73c730a213061ece1d02 |
| 12 | 20261120111000_inv_report_schedules | a918c2ae51a285f0ed91c020e4c83ce54e2006b65c9044664ac40035617a57bf | b3d89352ff859f279bfab0bb533150d7b34ca1c48a54bb76faa1b25a6744e67d |
| 13 | 20261120112000_inv_source_receipt | c11d6d4c12456e88440ea8854a84e1ffc12baa013c0c4a0a056915d5f619cf3c | 98573a25509807766f20c0d7d2c4d398daa96173d03e43193e877e782fbdeee4 |
| 14 | 20261120113000_inv_approval_roles | b4c44de134753f3211956a6893118b376a3427e3fc37cb6f05ec181b590884d9 | 75a6d34bb756e2dd7d52393098d0f4e504e872336ef114e80dbc1646c05e97e0 |
| 15 | 20261120114000_inv_tyre_conflict_investigation | 19713c8bcdf9550bd7245eb4ada56b7681501520bd093e376072c575c70911cd | 97b2ae85f480f9dc60183dd35dee178a0157128ee96a319c0f4d0652f5a7b58f |
| 16 | 20261120115000_inv_hardening | 873fed0154ad5b06569861a6362579974a4844e6cbf181cd5a895370c7d429be | 095bcc23f36fa88eb6d9b7648568ddb4d3fac44e266de6890fa4de418320de4a |

Prepared (NOT part of the 16; each is its own owner-approved step):

| File | sha256 |
|---|---|
| 94_prepared/nhc_stock_country_correction.sql | 2f928d2d39557e71f28fccfa77463a4a4a2b7172088a3ab4a20080402f95518d |
| 94_prepared/store_keeper_capabilities.sql | c2ea564998bed4baeb7fab9eb085495c0c8b0bf214286e8e5bea873899d32a1a |
| 94_prepared/approver_roles_template.sql | 8338fbe1fa55e126a7e832d9e1b7753775968f1fa3475573dc535a3c45d000a7 |

---

## 2. Gate results

| # | Gate | Result | Evidence (section) |
|---|---|---|---|
| 1 | File integrity vs rehearsal | **PASS** | 32/32 hashes equal; diff since `17e918da` = 1 line in doc 90 (docs only); production guarded functions byte-identical to the rehearsal (3) |
| 2 | Backup / recovery point | **OWNER ACTION** (evidence recorded, backup itself not visible to the agent) | 4 |
| 3 | Web authenticated workflow vs real PostgREST | **NOT TESTED** (PostgREST binary now obtainable; run not performed) - release risk R1 | 5 |
| 4 | Flutter real-device test | **NOT TESTED**; Flutter CI run 44809734181 **passed** on cb7ee7de (Flutter code unchanged since); mobile deploy **HOLD** | 5 |
| 5 | Store Keeper capabilities | **PREPARED** (validated on a disposable PG16 stub, not applied) | 7.1 |
| 6 | Inventory Controller / Finance Manager | **OWNER ACTION** (candidates listed; template prepared, not applied) | 7.2 |
| 7 | Tyre conflicts: no auto-modification, independent PMV approval | **PASS** (text review + rehearsal gate 10); one **OWNER ACTION** (no KSA-scoped PMV Manager) | 7.3 |
| 8 | NHC 35-unit NULL-country line | **PREPARED** (ownership = KSA, evidence below; correction validated on stub, not applied) | 7.4 |
| 9 | Rollback residues | **ACCEPTED LIMITATIONS** (no file change: PG17 revalidation not possible here) | 9 |
| 10 | Production baseline | **PASS** (fingerprints taken 2026-11-20 21:11-21:20 UTC) | 6 |

---

## 3. Gate 1 - integrity

* `sha256sum` of all 32 files at the tip: identical to doc 90 section 0.2 / doc 93 gate 3.
* `git diff --stat 17e918da..86a77c14` -> `docs/inventory/90_RELEASE_PACKAGE.md | 2 +-` (pins the commit id).
  This package adds `docs/inventory/94_*` only. **No code, SQL, web, Flutter or edge path changed after the
  rehearsal**; web + Flutter source is unchanged since `cb7ee7de` (only SQL + docs changed in `17e918da`).
* Production drift check (read-only, now): the functions the release replaces or guards are byte-identical
  to the rehearsal snapshot (md5 of `pg_get_functiondef`; no chr(13) present):

| Function | md5 (functiondef) | Rehearsal |
|---|---|---|
| post_stock_movement | 12d9a6a0116a7135f0aeb2ba65001519 | 12d9a6a0 = |
| set_stock_count | 28e9e4d674d3bebcb6bd9aa80be60873 | 28e9e4d6 = |
| save_stock_entry | 964c2e8c49eeffda12100281ebb3b1dc | 964c2e8c = |
| transfer_stock_entry | 34faec25612caacb61e1826705bba213 | 34faec25 = |
| reserve_work_order_stock | 91f34acbc1ea311ae62529c05f9a6c2f | 91f34acb = |
| release_work_order_stock | 04ef02db1cdaad5db6191e1128ca58e8 | 04ef02db = |
| private.reserve_work_order_stock_internal | f0552081d89302985da96eb2f7df9bcb | f0552081 = |
| private.release_work_order_stock_internal | 91d1c71acbb8c08804cfee55c17bea43 | 91d1c71a = |
| approval_private.validate_policy (113000 guard) | b76c1c97d59bc5b384041b5f8b67c867 | = guard constant in 113000 |

Other functions the release relies on (recorded for post-apply comparison; the release must not change them):
app_user_can 939dbf01a3c9e56d94fe12d1d396cbd0, app_current_org fe910f8c5e4dd20015c43486b3bb97d7,
is_super_admin c3fda7fdb7743fb37f8e0436aea64c56, app_can_see_country 2e30a2fd6212be399e8160cdcb015b3f,
app_can_see_site 189b7ade92ef31858fedcf65cdb4cb4b, get_fleet_cpk(text,date,date,text)
a94b6042000fe17f23bae5a299d3ccde, scrap_tyre_by_serial e434a91c0d667a50200d36dd4bd7621c.
The guards inside 112000 / 114000 fingerprint functions the release itself creates (PGlite outputs, doc 90
section 3) - they cannot drift in production before apply.

---

## 4. Gate 2 - backup and recovery point

What the agent could read (facts, not a backup):

| Fact | Value |
|---|---|
| Organisation plan | Pro (`tier_pro`) |
| Supabase docs (search 2026-11-20) | Pro: automatic **daily** backups, last **7 days** restorable from Dashboard > Database > Backups; restoring is whole-project, project unavailable during restore. PITR is a paid add-on (7/14/28 days, RPO about 2 min); **when PITR is on, daily backups are not taken**. Custom-role passwords are not in daily backups. |
| PITR add-on state | **Unknown** (the MCP cannot read add-ons or list backups) |
| WAL archiving (`pg_stat_archiver`) | archived 8,323 files since 2026-11-09 09:54 (postmaster start), last `00000001000001A5000000B4` at 2026-11-20 21:11:27 UTC, **0 failures** - archiving is healthy (this is consistent with physical backups; it does not prove PITR is enabled) |
| **Pre-write baseline recovery point** | **2026-11-20 21:11:30.03 UTC, `pg_current_wal_lsn()` = 1A5/B5000000** (no inventory object exists at this point) |
| App-level snapshots (`backups.snapshots`, row recovery only, NOT DR) | 14 snapshots; latest nightly 2026-11-20 00:30:00 UTC (8 tables, 15,752 rows, includes stock_records). Last restore test 2026-11-11 passed (stock_records 36/36). Does not cover stock_movements, work_orders, parts_consumption. |

**Owner must confirm in the dashboard immediately before file 1 (write the answers on the approval sheet):**
1. Dashboard > Database > Backups > Scheduled: timestamp of the latest daily backup (must be within 24 h)
   OR, if PITR is on, Dashboard > Database > Backups > Point in Time: earliest / latest recovery point and
   retention (7 / 14 / 28 days).
2. PITR enabled? yes / no.
3. Restore method you will use if needed: rollback files first (rehearsed, section 10); dashboard restore only
   as last resort (loses every write after the chosen point, whole project offline during restore).
4. Recommended extra (free, fast): a logical dump of the affected tables just before file 1, e.g.
   `supabase db dump --data-only -t public.stock_records -t public.stock_movements -t public.material_master
   -t public.approval_policies -t public.custom_roles -t public.purchase_orders -t public.report_schedules
   -t public.metric_registry > pre_inventory_<UTC>.sql` (keep it off-site), plus a schema dump.
5. Note the UTC time and `select pg_current_wal_lsn()` right before file 1 (new recovery point).

The agent did NOT see a backup and does not claim one exists.

---

## 5. Gates 3 and 4 - browser and device

**Gate 3 (web vs real PostgREST): NOT TESTED.** Change since doc 93: a PostgREST binary **is now
obtainable** here (GitHub release `postgrest-v12.2.3-linux-static-x64.tar.xz`, HTTP 200, binary
`PostgREST 12.2.3`, sha256 870a77f49508479bc87c5504b6b0c3715c7220926932d916b0d73952b297c617). The run was
NOT performed in this session: the PG17 rehearsal copy A and its extracts no longer exist (scratch was
cleared), only PG16 is installed locally, there is ~3 GB disk, and rebuilding the production-equivalent
snapshot means repeating rehearsal gates the brief says not to repeat. DB behaviour remains proven on PG17
(doc 93 gates 4-12) and the client contract by the PGlite PostgREST bridge E2E (24 flows).

Steps for the owner / next session (either route):
* **Staging project (preferred, owner-paid action):** create a Supabase branch or staging project from
  production schema; apply the 16 files there; give a test Store Keeper the 4 capabilities
  (`94_prepared/store_keeper_capabilities.sql` with test ids); run the web app with
  `VITE_SUPABASE_URL/ANON_KEY` of staging; as Store Keeper: receive 2 with cost, issue 1, dispatch a
  transfer, receive it, count a bin; as Admin: create + start an audit, finish counting, approve a
  discrepancy; as a second company: confirm no row of the first is visible; open Controls > Approvals and
  Tyre custody (7 conflicts after a sync). Watch the network panel for 4xx/5xx.
* **Local (free):** PG17 + the rebuilt snapshot (`93_rehearsal_tooling/rebuild.sh`), PostgREST 12.2.3
  with `db-anon-role=anon`, `jwt-secret=<local>`, mint JWTs per test user (`sub`, `role=authenticated`),
  point the Vite app at it with a stub auth session. GoTrue is not needed for these flows.

**Gate 4 (Flutter device): NOT TESTED.** Plan unchanged: `92_MOBILE_DEVICE_TEST_PLAN.md` (all cases Not
Tested). Flutter CI run **44809734181** (Flutter CI #633, workflow_dispatch, head `cb7ee7de`) completed
**success** 2026-11-20 20:15-20:38 UTC (confirmed via the GitHub API). Flutter source is unchanged between
`cb7ee7de` and the release commit. **Mobile deploy stays HOLD** (standing owner rule: no build unless asked).

---

## 6. Gate 10 - production baseline (pre-apply), 2026-11-20 21:11-21:20 UTC

Production is live: these values can move with normal use (uploads, inspections) before the window.
**Re-take this table immediately before file 1** (same queries, `93_rehearsal_tooling/hashes.sql` column
sets) and compare the post-apply values to THAT re-take, not to the values below.

| Object | Count / sum | md5 |
|---|---|---|
| stock_records (original columns, as hashes.sql) | 43 rows, 345 units | f79520eaa8e1710fdc7349a4ecebf870 |
| stock_records (id, stock_qty, unit_cost, currency) | 43 (36 with NULL unit_cost) | f96a93ca2203fffbb2660546183c965d |
| stock_movements (original columns, qty as numeric) | 78 rows, sum qty_change 302 | 64715298646f8e1a850cb9234e615eb7 |
| tyre_records (all columns, to_jsonb) | 11,274 | a8e7954f931598742ecd56b8525f061d |
| tyre_records CPK inputs (id, cost_per_tyre, km_at_fitment, km_at_removal, total_km, issue_date, removal_date, status, serial_no, asset_no, tyre_position) | 11,274; sum cost 10,646,334.86; sum total_km 536,169,583 | 1743317707fcabd4194264930f834be4 |
| tyre_status_marks (all columns) | 907 | 7179e8c6519af05fbb6556b6485e1a4f |
| scrapped-but-active serials (status Active + scrap mark by serial) | 7 | - |
| parts_consumption | 219,356 rows, 139,332,010.90 total; KSA 118,785 / 43,115,502.59; UAE 60,020 / 15,054,215.58; Egypt 40,551 / 81,162,292.73 | - |
| work_orders | 97,479 | - |
| material_master (original columns except updated_at) | 22,162 (188 category tyre, 0 with uom) | 3542f7ef4aed64543ac3094f55df01f0 |
| material_master updated_at | 22,162 | ce39d0272e3d2bdd87628255babe8b6f |
| module_permissions | 1,374 | 8e22bd2f93644cfd77e9902104ea5e17 |
| user_access_grants | 86 | 2d0f79499daf41a9ca594c5abe3595f6 |
| custom_roles | 33 | 9c984ef3a86c0c91767aff9f3b29a3c7 |
| approval_policies | 3 | b1fe96b4a43180b9c0c458373e82a8e6 |
| profiles (id, role, country, sites, approved, locked, super, org ids) | 772 | b0cbd53c32d88aea256ce666a6786d51 |
| organisations | 5 | 2a5424f96179b421588a2ffec10f9611 |
| metric_registry | 12 | 6d11900a51facb442c3896ff6736ef2f |
| report_schedules | 7 | 0f9ed58edd0cb820cb076497bdcec639 |
| audit_log_v2 | 583,357 rows (latest 2026-11-20 20:51:35) | - |
| `_bak` schema | 159 tables, none `inv*` | - |

CPK output (super admin impersonated, read-only transaction, rolled back; window 2025-11-01..2026-10-31,
all sites): md5 of `get_fleet_cpk(...)::text` KSA 15610eabae77b141ac7a5fbf8ea15ceb (km cpk_tyre 0.0168,
cpk_total 0.0235, total_km 146,108,554), UAE 9d5cd39c263251673d6ff1a102c56270 (0.0536 / 0.1135),
Egypt a6eca79d40a3eafcebf4b38cd0bae11f (1.1087 / 3.7754). Same inputs => same output; the release writes
no CPK input and no CPK function.

**Post-apply comparison checklist** (expected after all 16, vs the pre-apply re-take):

| Object | Expected |
|---|---|
| stock_records original-column md5 (hashes.sql set) | **identical** (doc 93 gate 11); the release only adds new balance columns beside them |
| stock_records count / sum | 43 / 345 |
| stock_movements original columns (qty as numeric) | identical md5; 78 rows (+ new key/seq columns, types widened to numeric) |
| tyre_records all-column and CPK-input md5 | identical |
| tyre_status_marks md5 | identical |
| parts_consumption count + sums per country | identical |
| work_orders count | identical (normal use aside) |
| material_master original columns | identical md5; `updated_at` md5 **changes for exactly 188 rows** (`select count(*) from material_master where updated_at >= <apply start>` -> 188) |
| module_permissions, user_access_grants, profiles, approval_policies, organisations, report_schedules | identical md5 |
| custom_roles | 33 + 10 (Inventory Controller + Finance Manager in each of 5 organisations); the 33 pre-existing rows identical |
| metric_registry | 12 pre-existing identical + 25 `inv_` rows |
| audit_log_v2 | grows by the P0 backfill (about 78 x 3 + 43 rows) + 188 material_master updates - expected |
| get_fleet_cpk md5 (same window) | identical (unless the window's source data changed through normal use; then compare the input md5 first) |
| guarded function md5 (section 3) | the 8 legacy writers + validate_policy **change by design**; app_user_can, app_current_org, is_super_admin, app_can_see_country/site, get_fleet_cpk, scrap_tyre_by_serial **identical** |

---

## 7. Prepared items (gates 5-8)

### 7.1 Store Keeper capabilities - `94_prepared/store_keeper_capabilities.sql` (PREPARED)

* Capability keys actually checked by the 16 files (`inv_can(cap)` = `app_user_can('stock', cap)`):
  receive, issue, transfer, count, adjustment_approve, discrepancy_review, financial_post, scrap_approve,
  view_value, procure, recount, audit_create, audit_history, engineering_approve, view.
* Grants exactly **receive, issue, transfer, count** to the 7 live Store Keepers as per-person
  `user_access_grants` rows (28 rows, module `stock`, org Default Organisation, tagged note). Everything
  else stays false; unit cost stays hidden (no view_value). 113000 additionally refuses Store Keeper as an
  approver of adjustments / cost reconciliations / opening balances.
* The 7 (production, read-only): Hosham Homeda, MD JAHID, Mohammad Ansari, Mohd Asad, MUHAMMAD NASIR
  HUSSAIN, SOMANATH NAYAK, Wasim khan - all Default Organisation, country KSA, sites ALL, approved, not
  locked, no existing stock grant/revoke. Today they hold only `view` (role matrix) + `create`
  (org override).
* Scope: company = org; country = KSA (profiles.country); site = **ALL today**. There is no per-warehouse
  user assignment in this release (a warehouse/bin is a location under a site), so the narrowest enforceable
  scope is the site; optional narrowing is left to the owner (Console > Users, per person).
* Guards (exact 7, eligible, no revoke row), idempotent insert, verify (impersonated `inv_can` per cap),
  exact rollback (delete by note). Validated on a disposable PG16 stub: 28 rows, re-run idempotent,
  receive/issue/transfer/count true, adjustment_approve/financial_post/view_value false.
* Run only after the 16 files (the guard refuses before).

### 7.2 Inventory Controller / Finance Manager - candidates only (OWNER ACTION)

0 holders today; the roles do not exist until 113000. Approved, unlocked people in the Default
Organisation whose current role is supervisory (production read-only):

| Candidate | Current role | Country / sites | Fits | Caveat |
|---|---|---|---|---|
| VINAY KUMAR T | Workshop Maintenance Area Manager | KSA / ALL | Inventory Controller | already approves stock adjustments and recounts in his current role (inv_approver_roles); a role change would REPLACE his area-manager role (inspection / checklist signing) |
| Lokesh | Maintenance Supervisor | KSA / ALL | Inventory Controller | loses checklist-only supervisor rung if reassigned |
| MAi Yousef | Data Monitor Officer | KSA / ALL | Inventory Controller (data / counts review) | no approval history |
| adnan mohammad alhaj ali | Manager | KSA / ALL | Finance Manager candidate | as Manager he can ALREADY approve every inventory stage incl. cost reconciliation; a separate person improves segregation |
| Ajay Kumar Rana, Firozuddin Kayal, Shahab ud din | Fleet Supervisor | KSA / ALL | Inventory Controller | operational, not stores |

No person in production holds a finance role; the Finance Manager should be named from outside the
current user list (new account) if possible. "Test User" (Manager) and "UAT Workshop Supervisor" are test
accounts - exclude them. Do NOT pick a Store Keeper (SoD) or an Admin.
**profiles.role is single-valued:** assigning a new role replaces the current one. Template
`94_prepared/approver_roles_template.sql` (placeholders fail closed, snapshots the old role, guard trigger
disabled for one UPDATE and re-enabled with assertion, rollback included; validated on a PG16 stub).
Preferred path: Console > Users as super admin. Approvers also need the stock capabilities listed in the
template (adjustment_approve / discrepancy_review / financial_post / view_value ...).

### 7.3 Tyre conflicts (gate 7) - PASS + one owner action

* Text review of all 16 forward files: **0** `update` / `insert into` / `delete from` statements targeting
  `tyre_records` or `tyre_status_marks`. The only object attached to tyre_records is
  `trg_zz_inv_tyre_scrap_flag` (105000), an AFTER trigger that writes the inventory conflict table, not tyre
  data. 114000 header: "No function or trigger in this file writes tyre_records or tyre_status_marks".
* Independence: the approval request carries `conflicts = [investigator_id, proposed_by]`; the approval
  engine refuses those user ids (SoD by id, 108000). Investigator roles: Tire Planning Engineer / Tyre
  Engineer / Tyre/PMV Engineer / PMV Engineer; approver role: PMV Manager only. The direct decide path
  refuses `scrapped_but_active`.
* Rehearsal gate 10 (doc 93): exactly 7 conflicts, all open; tyre_records and tyre_status_marks hashes
  identical before/after. Production now: still 7 scrapped-but-active serials (6 KSA, 1 UAE; doc 31).
* **OWNER ACTION:** the only PMV Manager in production (Abdallah Marwan) is scoped **UAE**. Approval checks
  scope (`_inv_scope_ok` -> `out_of_scope`), so the **6 KSA conflicts have no eligible approver** until a
  KSA-covering PMV Manager exists (or that person's country scope is widened). The single investigator-role
  holder (Tire Planning Engineer) covers KSA/UAE/Egypt. Cases stay open meanwhile; nothing is lost.

### 7.4 NHC NULL-country line (gate 8) - PREPARED

* Row `5a55a635-69f6-4070-8fb1-8f7d81c8bea8`: Default Organisation, site NHC, region 'KSA', country NULL,
  "315/80R22.5 Double coin", 35 units, no cost; created 2026-08-08 by the platform admin from the mobile
  "Initial stock entry"; ledger Initial +35, adjustment -1, adjustment +1 (sum 35 = on hand, no drift).
* Ownership = **KSA**: the row's own region is KSA; `sites` has one NHC row (KSA, CENTRAL); 224 NHC
  vehicles all KSA; the other 17 NHC stock rows all KSA. Source of the NULL: the old mobile entry form did
  not stamp a country.
* `94_prepared/nhc_stock_country_correction.sql`: guard on exact id + values + single KSA site, snapshot
  to `_bak.nhc_stock_country_20261120`, sets only `country = 'KSA'`, asserts quantity unchanged and no NULL
  row left, rollback restores NULL. Validated on a PG16 stub (applies; second run refused by the guard;
  rollback restores). Recommended **before file 1** as its own step, then re-take the stock_records baseline.

---

## 8. Release order

0. Owner signs section 13. Window agreed (low activity; `pg_stat_activity` showed 1 active session at prepare).
1. Backup confirmation (section 4, items 1-5). Record time + LSN.
2. (Optional, owner-approved) `94_prepared/nhc_stock_country_correction.sql`; then re-take section 6.
3. Pre-checks (section 11 STOP list) incl. re-take of section 6 and the section 3 function md5s.
4. Verify each file's sha256 against 1.1; apply files 1..16 **one file per apply**, as `postgres`, each
   followed by its verify query (doc 90 section 3). Never combine files ("out of shared memory" at
   `max_locks_per_transaction` 64, confirmed live).
5. Smoke tests (section 10) + baseline comparison (section 6 checklist).
6. Then, separately approved: `store_keeper_capabilities.sql`; approver roles (template / Console);
   KSA PMV Manager decision; thresholds (inventory_approval_limits) if wanted.
7. Web deploy of the inventory UI (merge to main) - separate owner approval; edge `send-scheduled-reports`
   deploy - separate; Flutter - HOLD.

## 9. Per-file expected changes (production)

| # | File | Expected change |
|---|---|---|
| 1 | P0 ledger integrity | stock_movements append-only (no client UPDATE/DELETE), idempotency keys + sequence, `legacy:` keys on 78 rows, qty types widened to numeric; 4 legacy writers + 2 WO reservation internals replaced (snapshotted to `_bak.inv_p0_snapshot`); stock_records balance columns; audit_log_v2 backfill rows |
| 2 | Item master / locations | material_master new columns; **188 tyre rows** get serial_tracked=true (their updated_at changes); 0 base_uom fills; inventory_locations |
| 3 | Physical audits | 5 audit tables (RLS), blind-count hook |
| 4 | Transfers / procurement | stock_transfers, per-company PO number key |
| 5 | Valuation | 33 rows / 302 units unvalued with 33 open `legacy` cost reconciliations; 7 priced rows valued |
| 6 | Tyre items | tyre item mirror + custody conflict table; tyre data untouched (hash) |
| 7 | OEM fitments | validated-compatibility view over the OEM catalogue |
| 8 | API contract | inv_* RPCs (authenticated only) |
| 9 | Approvals | inventory_approval_requests / decisions; approval_policies entity CHECK widened |
| 10 | ERP reconciliation | read-only view; parts_consumption unchanged |
| 11 | Metric catalogue | 25 `inv_` metrics (draft) |
| 12 | Report schedules | report type `inventory` allowed |
| 13 | Source receipt | `_inv_issue` / `_inv_transfer_dispatch` patched (snapshot 2 rows), v_inv_receipt_sources |
| 14 | Approval roles | 2 custom roles x 5 orgs; validate_policy patched (inventory branch); limits table |
| 15 | Tyre conflict investigation | investigation workflow; CHECK lists 4 old + 5 inventory types |
| 16 | Hardening | client write grants removed from new views/sequences/helpers; lifecycle guard triggers |

No file writes parts_consumption, tyre_records, tyre_status_marks, profiles, module_permissions,
user_access_grants or any CPK object (doc 93 gate 11).

## 10. Post-apply smoke tests (as real users; rolled back where they write)

doc 90 section 3 "Post-apply smoke" + section 0.9, i.e.:
1. Store Keeper (after 7.1 grants, in a rolled-back txn): receive 1 with cost, issue 1 -> balance back,
   2 ledger rows, tyre_records + parts_consumption hashes unchanged.
2. Admin: create + schedule + start an audit; the counter's view has no expected quantity.
3. `inv_tyre_item_sync` per country (rolled back) -> 7 open conflicts.
4. Viewer: `inv_issue` refused "Stock permission "issue" is required."; anon: every `inv_*` refused.
5. `select count(*) from pg_class c where relnamespace='public'::regnamespace and relname like 'v\_inv\_%' and has_table_privilege('authenticated', c.oid, 'INSERT')` -> 0.
6. Section 6 comparison checklist all as expected.
7. First hour: Supabase API error rate and Sentry web issues not above the pre-apply hour.

## 11. STOP conditions (do not continue; roll back what was applied)

* Backup / recovery point not confirmed (section 4).
* Any pre-check differs: inv_* functions != 0; inventory relations != 0; stock_records != 43 / 345;
  stock_movements != 78; material_master tyre != 188; any section 3 function md5 differs; a new
  migration appeared in `supabase_migrations` after `20261119100000` that touches stock / material /
  approval / tyre objects (re-review first).
* A file's sha256 differs from 1.1.
* Any file raises (including "differs from the reviewed definition" or "apply ... first").
* A verify query returns an unexpected value; "out of shared memory".
* tyre_records / tyre_status_marks / parts_consumption / profiles / module_permissions / user_access_grants
  hash or count changes (beyond concurrent normal use proven by audit_log_v2).
* API error rate rises in the hour after.

## 12. Rollback

ROLLBACK files in **reverse** order (115000 first, 100000 last), one per apply, sha256 per 1.1. Each refuses
when the new ledger / cases were already used unless `set local inv.rollback_discard = 'on'` (export
first). If a forward file fails, it rolls itself back; roll back only the files already committed, in
reverse. Rehearsed (doc 93 gate 3): 16/16, catalog identical to the pre-apply snapshot except the two
accepted residues below. Prepared items roll back with their own blocks (7.1 delete by note; 7.2 restore
from `_bak.inv_role_assignment_20261120`; 7.4 restore NULL from `_bak.nhc_stock_country_20261120`).
Dashboard restore / PITR is the last resort only (whole project, loses later writes).

## 13. Accepted limitations

1. **`_bak.inv_p0_snapshot` kept after rollback** - deliberate: it is the restore source (legacy function
   bodies + row snapshot), owner-only, no client grant. Recommendation: KEEP; drop manually only after the
   owner confirms a rollback is final.
2. **188 material_master `updated_at` values not restored by rollback** (rows whose `serial_tracked`
   flipped). Business columns are restored exactly; only the last-edited timestamp shows the apply time.
   Impact: "last changed" sorting / display for those 188 tyre items. A fix (snapshot old updated_at in
   101000, restore with the update trigger suppressed in its rollback) is small, but it changes a rehearsed
   file and could not be revalidated on PG17 in this session (no PG17 server or snapshot available), so per
   the brief the file was NOT changed. The baseline md5 (section 6) detects the change but cannot restore
   values; if exact restore matters, export `select id, updated_at from material_master where category =
   'tyre'` (188 rows) in step 1 and update them back (trigger `set_material_master_updated_at` disabled for
   that one statement) after a rollback.
3. Browser workflow against real PostgREST not run (R1); device test not run (R2).
4. 6 KSA tyre conflicts have no eligible approver until a KSA-scoped PMV Manager exists (R3).
5. Edge `send-scheduled-reports` inventory digest not deployed (scheduled inventory e-mail falls back).
6. Rehearsal volumes were samples (material_master 400 of 22,162, tyre_records 1,029 of 11,274); timings
   on production will be longer (the 101000 update touches 188 rows; P0 backfill 78 + 43 rows).

## 14. Remaining risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Web UI not exercised against a real PostgREST/Auth stack | PGlite bridge E2E 24 flows; PG17 RPC gates as real roles; run section 5 steps on staging before announcing the feature; UI stays behind permissions until grants are given |
| R2 | Flutter not tested on a device | Mobile deploy HOLD; plan doc 92 |
| R3 | No KSA approver for tyre corrections | Owner decision (7.3); cases stay open safely |
| R4 | Approver roles replace current roles | Owner chooses people knowingly; template snapshots old role |
| R5 | PITR state unknown; daily backup up to 24 h old | Owner confirms; take the logical dump of section 4 item 4 |
| R6 | Live data moves between prepare and apply | Re-take baseline at step 3 |

## 15. Owner approval (sign)

I, the owner, have read this package and approve, for production project `jhssdmeruxtrlqnwfksc`:

* [ ] Apply of exactly the 16 forward files in section 1.1 (sha256 as listed), in order, one per apply,
      from release commit ____________ (branch `claude/inventory-upgrade-7rxp2t`).
* [ ] Backup confirmed: latest daily backup ________ UTC / PITR enabled: yes / no, retention ____ days;
      pre-apply time ________ UTC, LSN ________.
* [ ] NHC row correction (7.4) before file 1: yes / no.
* [ ] Store Keeper capabilities (7.1) after the 16 files: yes / no; site narrowing: ____________.
* [ ] Inventory Controller: ______________________  Finance Manager: ______________________ (7.2).
* [ ] KSA PMV Manager for tyre corrections: ______________________ (7.3).
* [ ] I accept the limitations in section 13 and the NOT TESTED items (gate 3 browser, gate 4 device).
* [ ] Web deploy (merge) ____ / edge deploy ____ / Flutter build: HOLD - each approved separately.

Signature: ______________________   Date/time (UTC): ______________________
