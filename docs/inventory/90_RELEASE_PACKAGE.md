# 90 - Inventory Control & Audit: release package (final QA)

Branch `claude/inventory-upgrade-7rxp2t`. Lane: final QA + release (owns `docs/inventory/9*`,
`supabase/tests/inventory_security*`). Date 2026-11-20.

**Nothing in this package has been applied to production, deployed or merged to main.**
Production (`jhssdmeruxtrlqnwfksc`) was read with catalog and aggregate SELECTs only (section 7).
All 13 migrations sit in `supabase/pending_migrations/`.

Binding contract: `07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md`. DB detail: `10_DB_IMPLEMENTATION.md`.
Valuation rule: `20_VALUATION_RULES.md`. Client map: `91_CLIENT_INTEGRATION.md`.

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
memory" with large combined batches). Rollbacks run in **reverse** order (112000 first).

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

After all 13: `select anum_integration.apply_reader_policies();` already runs inside each file (guarded).

### Production pre-checks (owner)
1. Supabase backup confirmed in the dashboard (PITR tier noted) **before** file 1.
2. Rehearse the 13 files on staging `/var/lib/postgresql/tp-staging` (port 54329, start as postgres with
   `pg_ctl`; disk ~1.8 GB free, drop scratch databases after) on a fresh copy of the production mirror.
3. Guards confirmed against live data (section 7): no negative quantity, no negative cost, no null-org
   movement, no orphan movement, no duplicate PO per company, constraint lists identical.
4. Note: production is **PostgreSQL 17.6**, staging PG 16. The anchored replace in 112000 and the P0
   snapshot read `pg_get_functiondef`; the guard aborts cleanly if the text differs, so a mismatch
   cannot half-apply.

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
| 22 | No inv_* DEFINER function executable by PUBLIC or anon | PASS | security acceptance |
| 23 | No anon privilege on any new table / view; RLS + org RESTRICTIVE policy on every new table; no direct client write | PASS | security acceptance (31 tables, 21 views) |
| 24 | Every new view `security_invoker` | PASS | security acceptance |
| 25 | Rollback restores the pre-inventory catalog exactly (all 13 files) | PASS | `inventory_rollback.test.mjs` |
| 26 | Browser test of the web against a real database | NOT RUN | no test login / no apply; UI proven on fakes (doc 91) |
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
| **Scrapped-but-active tyres** | **7** (KSA 6, UAE 1) | become 7 open `scrapped_but_active` conflicts after the first sync; nothing is corrected |

The 7 tyres (serials truncated): KSA `L520*` MP078 RHF1, `YMM1*` TM589 RHRO, `YMM2*` TM643 RHCI,
`YMM6*` TM619 LHRI, `YMU4*` TM411 LHCI, `YMY4*` TM635 RHCI; UAE `YMA4*` TM204 RHF1. Evidence: for all
six KSA tyres the Active row was **created after** the scrap mark (2026-07-27..29) while its fitment
date is earlier - a re-load of an older fitment, not a new fitment. The UAE row predates its mark
(2026-09-14). Presented for an authorised decision; never auto-corrected.

No guard would abort on this data.

## 8. Owner decisions needed

1. **Approval policy roles.** `approval_private.validate_policy` only lets an inventory stage name
   Admin or a named person. To route stages to Inventory Controller / Finance Manager / Site Manager,
   widen its role list (DB change, owner approval).
2. **Scheduled digest email.** `send-scheduled-reports` has no `inventory` branch; deploy one (edge
   deploy, owner approval). Until then an `inventory` schedule emails the generic fallback.
3. Apply approval for the 13 files (section 3), after backup + staging rehearsal.
4. The 7 tyre conflicts: who decides, and whether the tyre team corrects the re-loaded fitment rows
   in tyre records (inventory never does).
5. Optional hardening: revoke PUBLIC from the four pure anon-executable helpers (section 5).

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
* **B5 - emailed inventory digest** (decision 2).

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
