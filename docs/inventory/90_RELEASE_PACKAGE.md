# 90 - Inventory Control & Audit: release package (final QA)

Branch `claude/inventory-upgrade-7rxp2t`. Lane: final QA + release (owns `docs/inventory/9*`,
`supabase/tests/inventory_security*`). Date 2026-11-20.

**Nothing in this package has been applied to production, deployed or merged to main.**
Production (`jhssdmeruxtrlqnwfksc`) was read with catalog and aggregate SELECTs only (section 7).
All 16 migrations sit in `supabase/pending_migrations/`.

Binding contract: `07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md`. DB detail: `10_DB_IMPLEMENTATION.md`.
Valuation rule: `20_VALUATION_RULES.md`. Client map: `91_CLIENT_INTEGRATION.md`.

---

## 0. Production-like PG17 rehearsal (2026-11-20) and the production procedure

Evidence: **`93_REHEARSAL_EVIDENCE.md`** (tooling `93_rehearsal_tooling/`). This section supersedes
anything below that says "staging PG16" or "not rehearsed".

### 0.1 Release identity
* Branch `claude/inventory-upgrade-7rxp2t`; rehearsal started from `cb7ee7de`; the rehearsed file set is
  the commit that adds `93_REHEARSAL_EVIDENCE.md` (see 0.10). The sha256 values below pin every file:
  **apply only files whose sha256 matches this table.**
* Rehearsal fixes (four real defects PGlite could not show, all in pending files): F1 105000 scrap mark
  matched by serial, not mark country (7 conflicts, was 6); F2 101000 backfill touches only changed rows
  (`material_master.updated_at` of 22,162 rows was overwritten); F3 115000 removes client write grants
  that production default privileges put on 22 new views, 2 sequences and 2 helpers; F4 100000 ROLLBACK
  restores the integer quantity columns (exact catalog restore).

### 0.2 Files, order, dependencies, hashes

Strictly sequential: every file depends on all earlier ones (100000 creates `_inv_secure_table` /
`inv_can` / `_inv_post` used by all; 112000 guards 107000's `_inv_issue` / `_inv_transfer_dispatch`;
113000 guards live `validate_policy` and 108000's `_inv_approval_block_reason`; 114000 guards 108000 /
105000 functions; 115000 hardens objects of 100000-114000). Never skip or reorder.

| # | Forward file | sha256 | Rollback file sha256 |
|---|---|---|---|
| 1 | 20261120100000_inv_p0_ledger_integrity.sql | 1f88d1df0cf4e8da8fc28e95e4eaa7ccf0704f4105d7f8ac11b6eb356b00bb45 | 2054555b02d9e0131fcca397c254e9ffc86654b82f7a522c3760fc51ee29bb48 |
| 2 | 20261120101000_inv_item_master_locations.sql | 2cfcc19bdd086e8ce5c6429657295a28b95117f5a5d165f7f4d52dd8c6389532 | a929a39ae941b77b13f978ef1eee977bf8ae484963d8f75c0a87b9d7f549819b |
| 3 | 20261120102000_inv_physical_audits.sql | 8fe0e83b1339f02f99b1b4592f12c2825b1b148b079d2d9aea098165e81c0ffa | dfa3518030d9423829fbc75c42e661b85ce2c6089bae7aaa4bfcc65446d76212 |
| 4 | 20261120103000_inv_transfers_procurement.sql | cecfeb5bc97e73fb20dcf1f133591e0d61c4689c0b389ba47945dc22ae9fd5b4 | 1757bb4cc7cf0be21871cc4a82d00f3494dec529beb67d6e5901a52fb9e2ed59 |
| 5 | 20261120104000_inv_valuation.sql | 446569816ed1575b8b2db7e84d0143463fd65d77cdcf887277f41deca96fff8d | 0fc57fa99fabe7c30611f4a9daff6a4e5aa3b24dc45f6130377833005ad4d664 |
| 6 | 20261120105000_inv_tyre_items.sql | e0934823b833867b2ebe1c8fe00398be680be582f000c17d4c4a4da477d49f72 | 61414d34240606dd99e682a00a152558069c35440faf9276316ccdf0a58a8e4f |
| 7 | 20261120106000_inv_oem_fitments.sql | 7380c5cc8dccde4e44e08ec8c04f725d9e062d2bafe13f58e5647857d68ef8de | 649ad940ff174f9c105f5f4747f8cd878c6957ca97cb18fac33b22b7b3488646 |
| 8 | 20261120107000_inv_api_contract.sql | cebc8ba48d278393046acb7616792511d0db0739945976f84d92c2276fc5beec | 6e41ea08cc3ef85e41044750572ccf5420d2625b51d2b64a10ff546db95e7e09 |
| 9 | 20261120108000_inv_approvals.sql | 33e5a644d2c2038335547d953224bad06c7f4f57485bf4413a3b0a01fa47b456 | c31770276a696c6268417dc2170640c8be6d7b806ba10d30b735080db764f349 |
| 10 | 20261120109000_inv_erp_reconciliation.sql | 833da63e377812f0125791d6711a36bc724f703d753f6d7a111cdbb22148513b | 12415a782ecf8b512c0acd14c0c63657e78ae827c1a212972e6e054d4e3c1701 |
| 11 | 20261120110000_inv_metric_catalogue.sql | faa6c7fe87b994edb1b8d0db353d8037093159cfb78c24def06cc50bd0b3e0e8 | 2e41550a0fe6f80af88c6bf4693b70091833def4a1cd73c730a213061ece1d02 |
| 12 | 20261120111000_inv_report_schedules.sql | a918c2ae51a285f0ed91c020e4c83ce54e2006b65c9044664ac40035617a57bf | b3d89352ff859f279bfab0bb533150d7b34ca1c48a54bb76faa1b25a6744e67d |
| 13 | 20261120112000_inv_source_receipt.sql | c11d6d4c12456e88440ea8854a84e1ffc12baa013c0c4a0a056915d5f619cf3c | 98573a25509807766f20c0d7d2c4d398daa96173d03e43193e877e782fbdeee4 |
| 14 | 20261120113000_inv_approval_roles.sql | b4c44de134753f3211956a6893118b376a3427e3fc37cb6f05ec181b590884d9 | 75a6d34bb756e2dd7d52393098d0f4e504e872336ef114e80dbc1646c05e97e0 |
| 15 | 20261120114000_inv_tyre_conflict_investigation.sql | 19713c8bcdf9550bd7245eb4ada56b7681501520bd093e376072c575c70911cd | 97b2ae85f480f9dc60183dd35dee178a0157128ee96a319c0f4d0652f5a7b58f |
| 16 | 20261120115000_inv_hardening.sql | 873fed0154ad5b06569861a6362579974a4844e6cbf181cd5a895370c7d429be | 095bcc23f36fa88eb6d9b7648568ddb4d3fac44e266de6890fa4de418320de4a |

### 0.3 Rehearsal and rollback results
PG 17.6, production role model (postgres not superuser, BYPASSRLS; production default privileges;
`max_locks_per_transaction` 64), sanitized snapshot whose 156 functions are byte-identical to production.
16/16 forward OK as `postgres` (total 3.2 s on the sample); doc-90 verify queries all as expected;
reverse rollback 16/16 OK; catalog after rollback identical to the snapshot (residues: `_bak.inv_p0_snapshot`
kept; `updated_at` of the 188 tyre items whose `serial_tracked` flipped); re-apply identical to the first
apply. Gates 4-12: 121 checks, 121 pass. Gate 13 (browser) NOT TESTED (no PostgREST obtainable).

### 0.4 Role / permission diff (what changes for people)
* No profile role, module_permissions row or user_access_grants row is changed.
* New custom roles in every company: `Inventory Controller`, `Finance Manager` (0 holders).
* New RPCs callable by `authenticated` only (never anon / PUBLIC); every write is capability-gated by the
  existing stock module capabilities. **Today only Admin / super admin hold the stock posting
  capabilities**: Store Keeper has `view` + `create` only (measured with the production `app_user_can` on
  the snapshot). Store Keepers cannot receive, issue, transfer or count until the owner grants
  receive / issue / transfer / count in Access Control; approvers need adjustment_approve /
  discrepancy_review / financial_post / scrap_approve.
* Direct client writes removed: stock_movements (append-only for everyone), stock_records quantities
  (only through RPCs), the legacy procurement tables keep their live restrictive policies.
* `authenticated` keeps SELECT on the new views (RLS / security_invoker decide rows); no write privilege
  on any new relation (F3).

### 0.5 Data reconciliation expected on production
stock_records 43 rows / 345 units unchanged in quantity; 33 rows / 302 units become unvalued with 33 open
`legacy` cost reconciliations; 7 priced rows valued at their recorded cost; 7 drift rows (all in the
second company: DEMO YARD / DEMO PLANT) recorded as `uncertain` when that company seeds its batch;
stock_movements 78 rows keep their values (types widened to numeric), get `legacy:` keys and sequence
numbers; audit_log_v2 receives the backfill updates (sample: 274 rows; production about 78 x 3 + 43);
material_master: 188 tyre items get `serial_tracked = true` (and a new `updated_at`), no other row is
written; tyre_records, tyre_status_marks, parts_consumption, CPK inputs, permissions unchanged.
After the first `inv_tyre_item_sync`: 7 open `scrapped_but_active` conflicts.
**Owner data action:** one stock row (NHC, 35 units) has no country and joins no opening batch: set it.

### 0.6 Backup / restore evidence
pg_dump of the applied copy (custom format) restored into a new database with 0 errors; catalog and
business-data fingerprints identical (owner-only ACLs restored as the equivalent default). This proves
the dump/restore path of the new objects; it is **not** the production backup: confirm a Supabase backup
/ PITR point in the dashboard (paid action, owner) before file 1.

### 0.7 Blockers before production
* B-R1 Owner approval of this exact file set (0.2) - **required**.
* B-R2 Backup / PITR confirmed in the Supabase dashboard immediately before file 1 - **required**.
* B-R3 No browser test against a real database (gate 13). Recommended on a Supabase branch / staging
  project; not a data-safety blocker (DB behaviour proven by gates 4-12).
* B-R4 Capability grants for the people who will post / approve (0.4) - needed before use, not before apply.
* B-R5 The null-country stock row (0.5) - before the opening count, not before apply.

### 0.8 Exact production procedure (owner-approved window)
1. Confirm backup / PITR point (dashboard). Note the time.
2. Read-only pre-checks (all must hold, else STOP):
   `select count(*) from pg_proc where proname like 'inv\_%' or proname like '\_inv\_%';` -> 0;
   `select count(*), sum(stock_qty) from stock_records;` -> 43, 345; `select count(*) from stock_movements;` -> 78;
   function fingerprints (md5 of `pg_get_functiondef`, chr(13) stripped, first 8): post_stock_movement 12d9a6a0,
   set_stock_count 28e9e4d6, save_stock_entry 964c2e8c, transfer_stock_entry 34faec25, reserve_work_order_stock
   91f34acb, release_work_order_stock 04ef02db, private.reserve_work_order_stock_internal f0552081,
   private.release_work_order_stock_internal 91d1c71a, approval_private.validate_policy b76c1c97;
   `select count(*) from material_master where category = 'tyre';` -> 188.
3. Verify each file's sha256 against 0.2.
4. Apply files 1..16 **one per apply**, as `postgres`, each followed by its verify query (section 3). Each
   file is one transaction; a failed file rolls itself back completely.
5. After 16: smoke tests 0.9.
6. Record each apply in `supabase_migrations` naming (the MCP `apply_migration` auto-timestamps; keep the
   repo file names in the description).

### 0.9 Smoke tests (as real users, rolled back where they write)
Section 3 "Post-apply smoke", plus: `select count(*) from tyre_custody_conflicts where status='open'` after
one sync per country -> 7; `select count(*) from pg_class c where relnamespace='public'::regnamespace and
relname like 'v\_inv\_%' and has_table_privilege('authenticated', c.oid, 'INSERT')` -> 0;
`select count(*) from material_master where updated_at > <apply start>` -> 188; tyre_records /
parts_consumption hashes equal to the values taken in step 2.

### 0.10 Reverse rollback
ROLLBACK files in reverse order (115000 first ... 100000 last), one per apply. Files refuse when the new
ledger / cases were used unless `set local inv.rollback_discard = 'on'` (export first). Rehearsed: 16/16,
catalog restored identical to the pre-apply snapshot except `_bak.inv_p0_snapshot` (kept) and the 188
material_master `updated_at` values. If a forward file fails mid-way, roll back only the files already
committed, in reverse.

### 0.11 STOP conditions
Stop and do not continue (roll back what was applied) if: any pre-check in 0.8 differs; a file's sha256
differs; any file raises (including a fingerprint guard "differs from the reviewed definition"); a verify
query returns an unexpected value; "out of shared memory" (do not combine files); tyre_records /
tyre_status_marks / parts_consumption hash changes; any API error rate rise in the hour after.

### 0.12 Owner approval required
Apply of the 16 files (0.2) to production; backup confirmation; capability grants; deploy of
`send-scheduled-reports`; Flutter reserved patch + builds. None of these was done by the rehearsal.

---

## 1. Verdict

**Audited inventory control is ready for owner approval to apply on staging, then production.**
Every end-to-end and security acceptance criterion in section 5 passed, with three items NOT RUN
that cannot be run from here (device test, browser test against a real database, production apply).
It is **not** "live": nothing runs in production until the owner approves the apply (section 3).

Readiness per area:

| Area | Readiness | Why |
|---|---|---|
| Ledger integrity, no negative stock (P0) | Ready | DB suites + client E2E + real two-connection race on PG16 staging |
| Physical audits, blind count, recount, adjustments (P1) | Ready (web) / Ready after patch (Flutter) | Client E2E end to end; Flutter now finishes counting (B3 resolved, section 9); background sync of count lines still needs the reserved patch (B4) |
| Tyre custody + the 7 conflicts | Ready | Derivation read-only (hash unchanged); conflicts now decidable on the web |
| Procurement, receiving, issue, transfers (P2) | Ready | Client E2E incl. the Flutter payloads |
| Valuation, unknown cost, undecided splits | Ready | Client E2E: never zero, never invented, decided by another person |
| Serial / lot tracked issue on a mixed balance | Ready after 112000 | New migration + picker; impossible before (section 2) |
| Approvals / separation of duties | Ready, with an owner decision | DB-enforced; policy editor role list needs widening (section 8) |
| ERP reconciliation | Ready | Read-only, every status, expense figures unchanged |
| Opening balances (43 live rows) | Ready | Batch + independent approval; 7 rows drift from their ledger (section 7) |
| Reports / scheduled digest | Partial | "Generate now" works; emailed digest needs an edge deploy (owner) |
| KPI catalogue (metric registry) | Ready | Seeded as draft, insert-only |

---

## 2. What this lane changed

Closed the known client gaps (doc 91 section 9) and the defects the new client-to-database test found.

| # | Change | Files |
|---|---|---|
| 1 | **Serial / lot tracked issue and dispatch could not be posted by anyone.** `_inv_post` refuses such an item on a mixed balance until a `source_receipt_movement_id` is named, but `inv_issue` and `inv_transfer_dispatch` never forwarded that key. New migration `20261120112000_inv_source_receipt.sql` (+ ROLLBACK) patches both in place from their live definition (anchored replace, aborts unless the anchor occurs once; originals kept in `_bak.inv_112000_snapshot`, the rollback executes them verbatim) and adds the read-only `v_inv_receipt_sources` (security_invoker; mirrors `_inv_post`'s receipt checks and remaining-quantity rule; unit cost NULL without `stock:view_value`). | `supabase/pending_migrations/20261120112000_*` |
| 2 | Source-receipt picker on the web issue form and on each transfer dispatch line (shown only when the balance has receipts with units left; blank lets the server decide). Service `listReceiptSources`, `issueStock({sourceReceiptMovementId})`, dispatch line `source_receipt_movement_id`. | `StockFlows.jsx`, `inventory.js` |
| 3 | "Open evidence" honours the tab: `?tab=` kept by `StockManagement`, passed by the hub, read by Controls and Valuation (`useHubTab`); an unknown tab falls back to the default. | `StockManagement.jsx`, `InventoryHub.jsx`, `InvUi.jsx`, `ControlsSection.jsx`, `ValuationPanels.jsx` |
| 4 | `inventory_approval_requests` readability: confirmed under RLS (section 5, E2E): the requester and the approver read the status line; another company reads nothing. No change needed. | - |
| 5 | **Wrong stock posted from a discrepancy (data defect).** The form asked for the *correct quantity* but sent it as the *signed correction* the server posts: 6 on hand, 4 counted, "4" entered -> **+4 posted, stock 10**. Now converted (`targetToCorrection` / `correctionToTarget`) with a preview "Stock change on approval: -2". | `auditView.js`, `DiscrepanciesSection.jsx` |
| 6 | **The web could not end counting**, so an audit never reached reconciliation (no client called `inv_audit_complete_counting`). "Finish counting" action for counter / recounter / creator / `audit_create`. | `auditView.js`, `AuditsSection.jsx`, `inventory.js` |
| 7 | **Start on a new (draft) audit always failed** ("Assign a counter before starting"). The screen now schedules, then starts. | `AuditsSection.jsx` |
| 8 | **An issue never consumed its reservation from the web**: `inv_reserve` answers `{id}`, the form read `reservation_id`. The service now returns both. | `inventory.js` |
| 9 | Tyre custody had no web path to refresh (`inv_tyre_item_sync`) or to decide a conflict (`inv_tyre_conflict_decide`) although doc 91 listed it. Added both; a decision needs a reason and changes no tyre record. | `TyreInventorySection.jsx`, `inventory.js` |
| 10 | PostgREST-compatible PGlite bridge + client E2E (24 flows) + security acceptance test. | `supabase/tests/fixtures/postgrest_pglite_bridge.mjs`, `src/test/inventoryClientE2e.test.js`, `supabase/tests/inventory_security_acceptance.test.mjs` |

en / ar keys added for every new string (parity kept; `webI18nKeyCoverage` green).

---

## 3. Migration apply order (production), with verify and rollback

Apply each file in its **own** apply, in this order (the 2026-11-15 rollout hit "out of shared
memory" with large combined batches). Rollbacks run in **reverse** order (115000 first).

| # | File | Verify (expected) | Rollback |
|---|---|---|---|
| 1 | `20261120100000_inv_p0_ledger_integrity.sql` | `select count(*) from stock_records where qty_on_hand < 0 or qty_reserved > qty_on_hand;` -> 0. `select has_table_privilege('authenticated','public.stock_movements','UPDATE');` -> f. `select count(*) from stock_movements where idempotency_key is null or movement_seq is null;` -> 0. `select count(*) from stock_movements where organisation_id is null;` -> 0 | `..._ROLLBACK.sql` (executes the captured `_bak.inv_p0_snapshot` definitions) |
| 2 | `20261120101000_inv_item_master_locations.sql` | `select count(*) from material_master where status is null;` -> 0. `select has_table_privilege('authenticated','public.inventory_locations','INSERT');` -> f | `..._ROLLBACK.sql` |
| 3 | `20261120102000_inv_physical_audits.sql` | `select relrowsecurity from pg_class where relname in ('inventory_audits','inventory_audit_snapshot_lines','inventory_count_lines','inventory_discrepancies','inventory_adjustments');` -> all t | `..._ROLLBACK.sql` |
| 4 | `20261120103000_inv_transfers_procurement.sql` | `select conname from pg_constraint where conname='purchase_orders_org_po_number_key';` -> 1 row (P0); `select to_regclass('public.stock_transfers') is not null;` -> t | `..._ROLLBACK.sql` |
| 5 | `20261120104000_inv_valuation.sql` | `select count(*) from stock_records s where s.unvalued_qty > 0 and not exists (select 1 from inventory_cost_reconciliations r where r.stock_id = s.id and r.status='open');` -> 0 (every unvalued unit tracked; expect 33 `legacy` records) | `..._ROLLBACK.sql` |
| 6 | `20261120105000_inv_tyre_items.sql` | tyre_records hash before = after: `select md5(string_agg(to_jsonb(t)::text, ',' order by id)) from tyre_records t;` | `..._ROLLBACK.sql` |
| 7 | `20261120106000_inv_oem_fitments.sql` | `select to_regclass('public.v_validated_compatibility') is not null;` -> t | `..._ROLLBACK.sql` |
| 8 | `20261120107000_inv_api_contract.sql` | `select count(*) from pg_proc where proname like '\_inv\_%' and has_function_privilege('authenticated', oid, 'EXECUTE') and proname not in ('_inv_audit_can_see_expected','_inv_approval_block_reason','_inv_audit_open_for_counter','_inv_posting_on','_inv_cap_for');` -> 0 | `..._ROLLBACK.sql` |
| 9 | `20261120108000_inv_approvals.sql` | `select pg_get_constraintdef(oid) from pg_constraint where conname='approval_policies_entity_type_check';` lists the 4 old + 4 inventory types | `..._ROLLBACK.sql` |
| 10 | `20261120109000_inv_erp_reconciliation.sql` | `select count(*) from v_inv_erp_reconciliation;` runs; `parts_consumption` row count unchanged (219,356 at measurement) | `..._ROLLBACK.sql` (drop view) |
| 11 | `20261120110000_inv_metric_catalogue.sql` | `select count(*) from metric_registry where metric_id like 'inv\_%';` -> 25 | `..._ROLLBACK.sql` |
| 12 | `20261120111000_inv_report_schedules.sql` | constraint contains `'inventory'` and all 13 previous types (live definition verified identical, section 7) | `..._ROLLBACK.sql` |
| 13 | `20261120112000_inv_source_receipt.sql` | `select position('source_receipt_movement_id' in pg_get_functiondef('public._inv_issue(jsonb)'::regprocedure)) > 0;` -> t (same for `_inv_transfer_dispatch(jsonb)`); `select count(*) from _bak.inv_112000_snapshot;` -> 2 | `..._ROLLBACK.sql` (re-executes the 2 snapshots, drops the view) |

| 14 | `20261120113000_inv_approval_roles.sql` | `select md5(replace(pg_get_functiondef('approval_private.validate_policy(approval_policies)'::regprocedure), chr(13), ''));` differs from `b76c1c97d59bc5b384041b5f8b67c867` and contains `inv_approver_roles`; the 3 live inspection policies still validate (`select approval_private.validate_policy(p) from approval_policies p;` no error); `select count(*) from custom_roles where name in ('Inventory Controller','Finance Manager');` -> 2 per organisation | `..._ROLLBACK.sql` (re-executes the snapshot; removes the two roles only while nobody holds them) |
| 15 | `20261120114000_inv_tyre_conflict_investigation.sql` | `select count(*) from tyre_custody_conflicts where investigation_status <> 'open';` -> 0; tyre_records + tyre_status_marks hash unchanged | `..._ROLLBACK.sql` (refuses once a case has started unless discard is set) |
| 16 | `20261120115000_inv_hardening.sql` | `select has_function_privilege('anon','public.inv_canon_serial(text)','EXECUTE');` -> f (same for `_inv_posting_on()`, `_inv_cap_for(text)`, `inv_movement_kind(text)`); triggers `trg_inv_lifecycle_guard` on 3 tables | `..._ROLLBACK.sql` |

**Fingerprint guards.** Every in-place rewrite checks an md5 of `pg_get_functiondef` (chr(13) stripped)
before the anchor check and aborts cleanly on any mismatch: 112000 (`_inv_issue` 761664c2..., `_inv_transfer_dispatch`
f79392c7..., PGlite output of 100000..111000), 113000 (live `approval_private.validate_policy` b76c1c97...,
read from production 2026-11-20; `_inv_approval_block_reason` 4fc26414...), 114000 (`_inv_approval_entity`
183d8b9d..., `_inv_approval_cap` 19fab589..., `_inv_tyre_conflict_decide` 290fad63...). P0 replaces the
legacy stock writers wholesale (not by anchor) after snapshotting them; their live fingerprints on
2026-11-20 are recorded for the rehearsal: post_stock_movement 12d9a6a0, set_stock_count 28e9e4d6,
save_stock_entry 964c2e8c, transfer_stock_entry 34faec25, reserve_work_order_stock 91f34acb,
release_work_order_stock 04ef02db, private.reserve_work_order_stock_internal f0552081,
private.release_work_order_stock_internal 91d1c71a. If any differs at apply time, re-review P0 first.

After all 16: `select anum_integration.apply_reader_policies();` already runs inside each file (guarded).

### Production pre-checks (owner)
1. Supabase backup confirmed in the dashboard (PITR tier noted) **before** file 1.
2. ~~Rehearse on staging PG16~~ **Done on PG17.6 (2026-11-20), section 0 and doc 93.**
3. Guards confirmed against live data (section 7): no negative quantity, no negative cost, no null-org
   movement, no orphan movement, no duplicate PO per company, constraint lists identical.
4. Production is **PostgreSQL 17.6**; the rehearsal ran on 17.6 and every fingerprint guard passed.

### Post-apply smoke (as real users, rolled back where it writes)
1. Keeper: receive 1 unit with a cost, issue 1 -> balance back, ledger has 2 rows, `parts_consumption` and `tyre_records` hashes unchanged.
2. Reviewer: create + schedule + start an audit; counter's `inv_audit_counter_view` has no expected quantity.
3. `select count(*) from v_inv_custody_conflicts where status = 'open';` after one `inv_tyre_item_sync` -> 7 (section 7).
4. Viewer: `inv_issue` refused with "Stock permission "issue" is required."; anon: every `inv_*` refused.
5. Web: hub sections leave "not set up yet" and show data; Controls > Approvals empty.

---

## 4. Reconciliation behaviour (owner rules, as built and tested)

* **Unknown cost is never zero and never invented.** An unpriced receipt is `unvalued`, opens a cost
  reconciliation, and is valued only by an approved `inv_cost_reconcile` (proposal + evidence by one
  person, decision by another, posting consumes the approval). The client never sends a blank cost.
* **No silent choice of which units leave.** On a balance with known and unknown cost, only what
  arithmetic proves moves at a value; the rest is `pending_allocation` with no value and an
  `issue_allocation` record a person decides from evidence. Serial / lot tracked items must name
  their receipt (112000 + picker).
* **ERP reconciliation is read-only**: `v_inv_erp_reconciliation` compares inventory issues with
  `parts_consumption` (+ store issues not already in it); it posts nothing (E2E: expense hash unchanged).
* **No accounting postings**: supplier invoices match three-way and answer `posting: 'none'`.
* **CPK, tyre costs and historic financials unchanged**: every E2E flow that could touch them
  asserts the `tyre_records` and `parts_consumption` hashes before and after.

---

## 5. Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Purchase receipt -> availability (rejected units never enter stock) | PASS | E2E `purchase receipt -> ...` |
| 2 | Reservation -> issue to a work order (reservation consumed; shortage refused, not negative) | PASS | E2E; found + fixed defect #8 |
| 3 | Count -> discrepancy -> recount by another user -> approval -> adjustment posted | PASS | E2E audit block; found + fixed defects #5, #6, #7 |
| 4 | Multiple counters on one location (only the assigned counter accepted) | PASS | E2E |
| 5 | Duplicate offline submit (same `client_uuid` from another device = duplicate; same key = `replayed: true`) | PASS | E2E (web + Flutter payload) |
| 6 | Delayed offline submit (after cutoff rejected, before cutoff accepted) | PASS | E2E (Flutter payload) |
| 7 | Blind count: counter view (web + Flutter) and every readable relation leak no expected quantity | PASS | E2E leak scan over all selectable relations through the client path |
| 8 | Tyre fit / removal / transfer / scrap custody; `tyre_records` hash unchanged | PASS | E2E tyre block |
| 9 | Scrapped-but-active conflict closed only by a person with a reason | PASS | E2E |
| 10 | Supplier-owned vs company-owned (owned value excludes supplier stock) | PASS | E2E |
| 11 | Missing cost -> unvalued -> reconciliation (approved by another person) | PASS | E2E |
| 12 | Mixed-balance issue -> issue_allocation -> decided by another user | PASS | E2E |
| 13 | Serial / lot tracked issue + dispatch with a named receipt | PASS | E2E (new 112000) |
| 14 | Opening batch: preparer cannot approve; posting needs an approved request | PASS | E2E |
| 15 | ERP reconciliation: all six statuses, money hidden without view_value, other company sees nothing | PASS | E2E |
| 16 | Reversal exactly once; ledger append-only for user, admin, super admin and the DB owner | PASS | E2E |
| 17 | Company / country / site / role restrictions (incl. cross-org reads return nothing of company A, anon refused) | PASS | E2E restriction block |
| 18 | `inventory_approval_requests` readable by requester and approver, not by another company | PASS | E2E |
| 19 | Flutter payloads: `inv_audit_counter_view`, `inv_count_submit {p_payload}`, transfer dispatch by `TP:STK:` label, receive line shape, list embed | PASS | E2E (exact maps from the Dart repositories) |
| 20 | Two simultaneous postings cannot oversell; double submit posts once (real connections) | PASS | `inventory_concurrency.test.mjs` on PG16 staging, 2/2 |
| 21 | Every inv_* DEFINER function pins `search_path` | PASS | security acceptance (104 functions) |
| 22 | No inv_* DEFINER function executable by PUBLIC or anon | PASS | security acceptance; re-proved on PG17 with production default privileges (doc 93 gate 7) |
| 23 | No anon privilege on any new table / view; RLS + org RESTRICTIVE policy on every new table; no direct client write | PASS | security acceptance (31 tables, 21 views); **on PG17 the production default privileges added client write grants on 22 views: fixed in 115000 (F3), re-proved** |
| 24 | Every new view `security_invoker` | PASS | security acceptance |
| 25 | Rollback restores the pre-inventory catalog exactly (all 13 files) | PASS | `inventory_rollback.test.mjs` |
| 26 | Browser test of the web against a real database | NOT RUN | no PostgREST obtainable in the PG17 rehearsal (doc 93 gate 13); UI proven on fakes (doc 91) |
| 27 | Device test of the Flutter screens | NOT RUN | standing rule: no mobile builds |
| 28 | Production apply + smoke | NOT RUN | needs owner approval |

Two deliberate exceptions in criterion 22-23 (documented in the test): `_inv_audit_can_see_expected`
and `_inv_approval_block_reason` are executable by `authenticated` because RLS policies and
security_invoker views evaluate them as the caller; they return a boolean / refusal code for the
caller's own company only. Four pure helpers (`_inv_posting_on`, `_inv_cap_for`, `inv_movement_kind`,
`inv_canon_serial`) are executable by anon; they read no table. Low-priority hardening: revoke them
from PUBLIC in a follow-up.

## 6. Test evidence

| Suite | Result |
|---|---|
| **Controls completion round (2026-11-20)**: DB PGlite `inventory_*.test.mjs` (16 migrations, incl. `inventory_controls_completion.test.mjs` 9 tests / 25 checks, rollback proof for all 16) | **104 tests, 103 pass, 0 fail, 1 skipped** (staging race, not re-run this round) |
| Vitest inventory + ratchets + scheduled reports + `scheduledReportInventory.test.js` (11) | **307 / 307 pass, 22 files** |
| ESLint (changed web files) / `vite build` | 0 errors / exit 0 |
| DB PGlite `node --test --test-concurrency=1 supabase/tests/inventory_*.test.mjs` (13 migrations) | **79 tests, 78 pass, 0 fail, 1 skipped** (the staging race, run separately) |
| Staging race `inventory_concurrency.test.mjs` on PG16 port 54329 (cluster started, test, stopped) | **2 / 2 pass** |
| Security acceptance `inventory_security_acceptance.test.mjs` | **10 / 10 pass** (included in the 79) |
| Client E2E `src/test/inventoryClientE2e.test.js` (real service functions over PGlite, distinct users) | **24 / 24 pass** |
| Vitest `src/test/inventory*` + ratchets (rowCapGuard, migrationTimestampsUnique, webI18nKeyCoverage, commandSearchCoverage, designSystemRatchet) + scheduledReports | **267 / 267 pass, 20 files** |
| ESLint on every changed file | 0 errors (2 pre-existing warnings in `LocationsSection.jsx`) |
| `vite build` | exit 0 |
| Flutter reserved patch `git apply --check` on this branch head | clean |

The E2E bridge: every `.from()` / `.rpc()` runs `set role authenticated` with
`request.jwt.claims = {sub, role}`; `auth.uid()` / `auth.role()` read the claims as on Supabase. It
does not reproduce HTTP, PostgREST's own error codes for missing objects, the 1,000-row cap, or
connection concurrency (covered by the staging race).

## 7. Production data impact (read-only measurement, 2026-11-20)

| Measure | Value | Effect on apply |
|---|---|---|
| `stock_records` rows | 43 | Backfilled to `qty_on_hand = stock_qty`; none negative, none null quantity -> CHECKs pass |
| rows with negative cost / null org | 0 / 0 | value CHECKs and org NOT NULL pass |
| unpriced rows with quantity | 33 rows, 302 units | become **unvalued** + 33 `legacy` cost reconciliations (never valued at 0) |
| priced rows with quantity | 7 | valued at their recorded unit cost |
| rows with null currency | 36 | currency filled on first posting from `currency_for_country`; one currency in use |
| rows whose quantity differs from their own ledger | 7 | not posted; recorded as `legacy_drift` in the opening batch for review (owner correction 2) |
| `stock_movements` rows | 78 (all integer qty, 0 orphans, 0 org unresolvable) | `organisation_id` NOT NULL can be set; `movement_seq` / `legacy:` keys backfilled |
| `purchase_orders` rows / duplicates per company | 0 / 0 | per-company `po_number` key creates cleanly |
| `goods_receipts`, `material_issues`, work-order reservations, legacy `stock` | 0 each | nothing to migrate |
| `material_master` rows | 22,162 | new columns only; barcode unique index on an empty column |
| `approval_policies` | 3, all `inspection`, none published | widening the type CHECK keeps all 3 valid; inventory requests route by the default route until a policy is published |
| live CHECK definitions (`approval_policies`, `report_schedules`) | identical to the lists the migrations re-create | no allowed value is lost |
| existing `inv_*` objects in production | 0 functions, 0 tables, none of the new columns | clean first apply |
| legacy writers / helpers the migrations wrap or call | all 12 present | P0 snapshot captures them |
| `parts_consumption` rows | 219,356 | never written by inventory |
| **Scrapped-but-active tyres** | **7** (KSA 6, UAE 1) | become 7 open `scrapped_but_active` conflicts after the first sync (PG17 rehearsal: 6 before fix F1, because the UAE tyre's scrap mark is stamped KSA); nothing is corrected |

The 7 tyres (serials truncated): KSA `L520*` MP078 RHF1, `YMM1*` TM589 RHRO, `YMM2*` TM643 RHCI,
`YMM6*` TM619 LHRI, `YMU4*` TM411 LHCI, `YMY4*` TM635 RHCI; UAE `YMA4*` TM204 RHF1. Evidence: for all
six KSA tyres the Active row was **created after** the scrap mark (2026-07-27..29) while its fitment
date is earlier - a re-load of an older fitment, not a new fitment. The UAE row predates its mark
(2026-09-14). Presented for an authorised decision; never auto-corrected.

No guard would abort on this data.

## 8. Owner decisions (2026-11-20) and how they were built

### 8.1 Approval roles (113000)

Role records mapped from the live catalog (read-only, 2026-11-20):

| Contract role | Live role record | Holders today | May approve (inv_approver_roles) |
|---|---|---|---|
| Admin | profiles.role `Admin` (built in) | 2 | adjustment, recount, opening balance, cost reconciliation |
| Director / Manager | built in | 0 / 3 | adjustment, recount, opening balance, cost reconciliation |
| Inventory Controller | **missing** -> added to `custom_roles` | 0 | adjustment, recount, opening balance |
| Finance Officer / Manager | **missing** -> `Finance Manager` added to `custom_roles` | 0 | adjustment, opening balance, cost reconciliation |
| Site Manager | `Workshop Area Manager`, `Workshop Maintenance Area Manager` (custom) | 0 / 1 | adjustment, recount |
| Tyre / PMV Engineer | `Tire Planning Engineer` (custom) | 1 | investigates tyre conflicts (never approves) |
| PMV Manager | `PMV Manager` (custom) | 1 | adjustment, recount, **tyre conflict correction (only role)** |
| Store Keeper | `Store Keeper` (custom) | 7 | **nothing** (prepares receipts, counts, stock requests) |

No module_permissions row or capability was changed. Approving still needs the stock capability of
the stage (adjustment_approve / discrepancy_review / financial_post / scrap_approve): a new
Inventory Controller, Finance Manager or the PMV Manager needs those granted in Access Control
(owner action) before they can decide.

Enforced in the database: `validate_policy` only accepts the roles above for an `inventory_*` stage
(named people included); at decision time `_inv_approval_block_reason` keeps all its checks and then
calls `_inv_approval_extra_block`: Store Keeper refused for adjustments, opening balances and cost
reconciliations, role list, company / country / site scope (`_inv_scope_ok`), and thresholds from
`inventory_approval_limits` (per company, type, role, optional country / site / currency; max value and
max quantity; a role with no limit or a larger request waits for a higher-limit approver; an unknown
value never passes a value cap). Separation of duties stays keyed on user id: the preparer, counter,
recounter, proposer or investigator is refused whatever roles or capabilities they hold.

### 8.2 The seven tyre conflicts (114000, doc 31)
Investigation workflow, evidence pack in `31_TYRE_CONFLICT_EVIDENCE.md`. Web service functions exist
(`assignConflictInvestigator`, `recordConflictFinding`, `proposeConflictCorrection`, `closeConflictCase`,
`listConflictCases`); the web screen shows the rule and no longer offers the direct decision for this
conflict type. A full assign / findings / propose screen is not built yet (see section 9).

### 8.3 Four anon-executable helpers (115000)
`_inv_posting_on()`, `_inv_cap_for(text)`, `inv_movement_kind(text)`, `inv_canon_serial(text)`: SECURITY
INVOKER, read no table, called only by definer functions or the definer scrap trigger. anon reads no
inventory table and calls no inventory RPC, so nothing needs them: **revoked from PUBLIC and anon**,
granted explicitly to authenticated and service_role. Test: anon refused, authenticated works, the
scrap flag trigger still fires on an authenticated insert.

### 8.4 Scheduled inventory e-mail (edge code, NOT deployed)
`send-scheduled-reports`: `inventory.ts` (pure builder, org-filtered reads, one block per currency,
valued / unvalued / pending separate, money only when the schedule creator is an Admin or super admin,
honest empty state, CSV attachment in the Resend shape) and `delivery.ts` (the cron step for every
type, extracted unchanged: failure logged to report_send_log and retried after one hour). Deno is not
available here, so the modules are tested with vitest (`src/test/scheduledReportInventory.test.js`, 11):
build, empty, org isolation, attachment, failure logged and retried. **Deploy is an owner step.**

### 8.5 Architect review items (a to d)
* **(a) Fingerprints**: section 3. A changed function aborts the file before anything is applied (test).
* **(b) Mutability by table**: ledgers (stock_movements, tyre_item_events, inventory_approval_decisions)
  append-only for every role. `inventory_cost_reconciliations`, `inventory_approval_requests` and
  `tyre_custody_conflicts`: no API role may write them (privilege), and a trigger (115000) enforces the
  status graph, makes terminal rows immutable and refuses DELETE for every role including the owner.
  Tested as authenticated, Admin and super admin, and as the owner.
* **(c) Legacy procurement RLS**: the harness now carries the live restrictive country / site write
  policies and the admin-only delete guard on purchase_orders, goods_receipts, requisitions,
  suppliers and materials (read from production). Direct-SQL tests as distinct users: another company
  sees, inserts, updates and deletes nothing; an out-of-country or out-of-site user updates and deletes
  nothing (suppliers carry no site, as live).
* **(d) Id injection**: one cross-company test per definer family (ledger, reversal, reserve, issue,
  source receipt, transfer both ways, audit start / count / reviewer / counter, PO line, receive, supplier
  invoice, location parent / responsible person, approval request, approval limit scope, cost
  reconciliation, tyre case). It found and fixed six gaps, all in pending files: `inv_receive_goods`
  stored a foreign `po_id` / `supplier_id` (103000), `inv_supplier_invoice_create` a foreign `po_id`,
  PO line or item (103000), `inv_location_upsert` a foreign parent or responsible person (101000),
  `inv_audit_create` a foreign reviewer / approver and `inv_audit_schedule` a foreign counter (102000),
  `inv_opening_batch_add_line` a foreign supplier (101000).

### 8.6 Still the owner's
1. Apply approval for the 16 files (section 3), after backup + staging rehearsal.
2. Grant stock approval capabilities to the people who will hold Inventory Controller, Finance
   Manager and PMV Manager; set `inventory_approval_limits` if thresholds are wanted.
3. Deploy `send-scheduled-reports`.

## 9. Remaining blockers (genuine)

* **B1 - not applied anywhere but PGlite/staging.** Production apply is the owner's step.
* **B2 - no browser test against a real database** (no test login available to this lane).
* ~~**B3 - Flutter cannot finish counting.**~~ **Resolved 2026-11-20** (commit `1ab838c6`, non-reserved
  files only). The count screen offers "Finish counting" while the audit is `in_progress` or `recount`
  and calls `inv_audit_complete_counting` with the web's `p_payload {audit_id, idempotency_key}`
  (`InventoryAuditRepository.completeCounting`, payload pinned by `inventory_contract_test.dart`).
  It refuses, without calling the server, while any line on the phone is unsent (draft, incomplete
  or rejected) or when the device is offline (a call that loses the connection also reads as
  offline); it asks for confirmation first and mints ONE idempotency key per confirmed press (none
  for a cancelled press). Copy: 10 entries in the packed `inventoryCopyCatalog` (en / ar / ur;
  catalog pinned at 135 entries; top-level ARB key count unchanged at 2515). Files:
  `lib/features/inventory/domain/finish_counting.dart`, `data/count_finisher.dart`,
  `data/inventory_audit_repository.dart`, `data/inventory_backend.dart`, `inventory_providers.dart`,
  `presentation/blind_count_screen.dart`. Evidence: `flutter analyze` (whole project) no issues;
  `flutter test test/features/inventory` 61 / 61, `test/features/stock_count` 12 / 12,
  `test/app/localization` 46 / 46 (new: `count_finisher_test.dart` 10, `finish_counting_screen_test.dart`
  5, contract 1, copy 1). Not run: device test (standing no-mobile-build rule).
* **B4 - Flutter background sync of count lines** is in the reserved patch (section 10), not applied.
* **B5 - emailed inventory digest**: code + tests done (8.4); deploy is the owner's.
* **B6 - tyre investigation screen**: service layer and DB done; the web form to assign, record findings and propose is not built.

## 10. Flutter reserved patch (human)

From the repository root:

```bash
git apply --check tyre_pulse_flutter/docs/inventory_reserved.patch   # clean on this branch head
git apply tyre_pulse_flutter/docs/inventory_reserved.patch
cd tyre_pulse_flutter && flutter analyze lib test
flutter test test/core/sync test/app/router test/features/inventory test/features/stock_count test/app/localization
```

It adds the `/stock/counts`, `/stock/counts/<audit>` and `/stock/transfers` routes, the
`INVENTORY_COUNT_LINE` queued command (`inv_count_submit` with the line's `client_uuid` as key), and
retires the last-write-wins `STOCK_ADJUST`. Detail: `tyre_pulse_flutter/docs/inventory_reserved_patch.md`.
No mobile build is made without the owner's request.

## 11. Screenshots

UI proof from the client lane (fake server, real components):
`/tmp/claude-0/-home-user-Tyre-Pulse/f5f47d6f-b333-5be3-b15d-8e39da2bbfea/scratchpad/inventory_screens_v2/`
(session scratchpad, not committed) - 30 files: `01-audit-create-form`, `02-blind-count`, `03-reconcile`,
`03b-recount-approval`, `04-discrepancy-refusal`, `05-receive-form`, `05b-receive-result`,
`06-reserve-issue-shortage`, `07-transfers-list`, `08-transfer-receive`, `09-opening-batch`,
`10-approvals-queue`, `10b-approval-decide`, `11-valuation` (4 variants), `12-cost-reconciliation`,
`12b-issue-allocation`, `13-erp-reconciliation` (3 variants), `20-*` layout sweep (8).

### Round 3 (2026-11-20): the web UI added in the last round

`/tmp/claude-0/-home-user-Tyre-Pulse/f5f47d6f-b333-5be3-b15d-8e39da2bbfea/scratchpad/inventory_screens_v3/`
(session scratchpad, not committed; harness `inv_harness_v3` = the v2 harness plus receipt sources, an
in-progress audit, a correction-signed discrepancy and scripted answers for
`inv_audit_complete_counting` / `inv_tyre_conflict_decide`). Real components, fake server. 31 files,
each in dark and light at 1440 and 390, plus Arabic:

| Surface | Files |
|---|---|
| Source-receipt picker on issue | `01-issue-source-receipt-{dark,light}-{1440,390}-en` |
| Source-receipt picker on a transfer dispatch line | `02-dispatch-source-receipt-{dark,light}-{1440,390}-en` |
| "Finish counting" | `03-finish-counting-{dark,light}-{1440,390}-en`, `03-finish-counting-dark-1440-ar` |
| Discrepancy correction preview (counted vs book, and the change) | `04-correction-preview-{dark,light}-{1440,390}-en`, `04-correction-preview-light-390-ar` |
| Tyre conflict decision form | `05-tyre-conflict-decision-{dark,light}-{1440,390}-en`, `05-tyre-conflict-decision-dark-390-ar` |
| Cost reconciliation drawer | `06-cost-reconciliation-{dark,light}-{1440,390}-en` |
| `issue_allocation` drawer | `07-issue-allocation-{dark,light}-{1440,390}-en` |

Checks per shot (Playwright): no sideways overflow (document width AND every visible element, in the
open drawer or the page, inside the viewport unless it sits in an intentional horizontal scroller),
no page error, and what the UI sent: `inv_issue` / `inv_transfer_dispatch` line carry
`source_receipt_movement_id`; `inv_audit_complete_counting {audit_id, idempotency_key}`; a stored
correction of -2 shows as correct quantity 24 and entering 25 previews and saves -1;
`inv_tyre_conflict_decide {conflict_id, status, note, idempotency_key}` enabled only once a reason is
written; the allocation drawer offers no write-off. Result: 111 of 112 checks pass; the one failure
is a 404 for a resource on the very first cold page load of the run (not reproducible on a warm
load, no 4xx in the app's own requests; harness artifact, most likely the favicon).

Defect found by these screenshots and fixed (`src/components/inventory/inventory.css`): on a transfer
dispatch line the source-receipt picker was squeezed into a third narrow grid cell (receipt text cut
to "#1102 | receipt | GRN", labels misaligned). `.inv-line .inv-full` now spans the whole line; the
`02-*` shots are after the fix.

Not in a screenshot: tyre "Refresh custody" (button only; behaviour proven by the client E2E).
