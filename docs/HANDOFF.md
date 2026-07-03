# TyrePulse - Session Handoff

_Last updated: 2026-07-03 · branch `main` (clean, fully pushed) · migrations V40→V68 live · Master Build Phases A/B/C/D + F(docs) DONE, E deferred (parallel i18n session) · 714 web tests green_

## TL;DR
The Expo/Vite/Supabase stack is being **hardened in place** (no Go/Kotlin/Next.js/DB migration on this track). The **Multi-Country Data Intake Center** (+ its 4 follow-on gaps), most of the `Current issues fixing.md` program (Phases 0-3, plus Phase 5 KPI registry + nav regroup), **the P0/P1 fixes from `docs/PROJECT_AUDIT_2026-07.md`** (mobile accident/offline/sync/logout, web error states, security V57-V59), **per-row-resilient import commits (V60)** and **the 5 real company formats** (`docs/imports/` - auto-recognised profiles, cost-of-record rule, line-item aggregation) are built, **tested, and on `main`**. The Go backend and native Android app stay **off `main`** on their own branches (frozen, not abandoned).

**Running gap scoreboard:** `docs/PROJECT_GAP_ANALYSIS.md` (corrected 2026-07-02 - the morning Copilot draft wrongly listed completed work as missing). Deep findings: `docs/PROJECT_AUDIT_2026-07.md`. Per-change record: `docs/CHANGELOG_ENGINEERING.md`.

## Stack
- **Web:** Vite + React 19 (`src/`) · **Mobile:** Expo React Native (`mobile/`)
- **Backend:** Supabase - Postgres + Auth + Storage + Edge Functions. Project `jhssdmeruxtrlqnwfksc`.

## Working rules (do not violate)
- **Merge-to-main scope:** only current-setup work. **Never** merge the Go backend (`backend/`) or the Android app to `main`.
- **Verify columns/constraints against the live schema** before writing any query/RPC (generated columns, CHECK constraints, status enums are easy to get wrong). Every applied migration here was proven by a self-asserting `BEGIN...ROLLBACK` SQL test first.
- Backward-compatible only; no table drops without migration + reconciliation + rollback.
- **No fabricated values** - actual data only; missing cost/metric → 0 or "-", never a settings default.
- Gate after every change: `npm run test:run` · `npx vite build` · `cd mobile && npm run typecheck`. Currently **714 web tests green**; build green; **mobile typecheck fully clean** (expo-notifications/expo-device now installed). CI runs this gate on every push (`.github/workflows/ci.yml`).
- Country isolation is sacred; files stay private (signed URLs); no service-role/AI/storage keys in web or mobile.
- Push `git push -u origin main`. No PR unless asked.

## DONE and on `main`

### 2026-07-02 late - multi-org, access control, custom fields, multi-delete (V63-V67)
- **Multi-org onboarding (V63-V67):** 3 country organisations (KSA/UAE/Egypt);
  BOTH Admin role and super-admins see/work across ALL orgs (app_is_org_admin()
  on the 38 org-isolation policies); normal org users stay isolated. Assigning a
  user's **country auto-places them in the matching org** (admin_update_profile);
  User Management has a per-user Organisation selector. All rolled-back-verified.
- **Access Control (V64):** the old read-only "Access Matrix" replaced by a real
  editable role x module grid (AccessControlMatrix + moduleCatalog +
  modulePermissions service + Admin-gated set_module_permissions RPC), grouped by
  the 8 workspaces, per-role All/None, search, unsaved-change highlight, Save.
- **Imported custom fields shown (V63):** custom_data columns on all import
  targets; CustomFieldsPanel surfaces reference costs / line items / extra
  headings in Work Orders, Tyre Records, Accidents, Inspections, Fleet detail views.
- **Admin multi-delete:** Work Orders, Accidents, Inspections, Fleet Master -
  select-all-page + per-row checkboxes, confirm dialog, verified/​chunked delete.
- **Batch-delete fix:** AuditTrail "Delete Batch" now removes the upload_history
  entry and never mis-blames "Admin permission" on an empty batch.

### Master Build program (owner directive - docs/"Master Build...Instruction.md")
Standards for an enterprise multi-tenant product. Phased plan (see the doc):
- **A. Tenant Branding** — **DONE (V68, pushed).** get_org_branding /
  set_org_branding RPCs storing branding in organisations.settings->'branding'
  (legal/brand name, primary/secondary/accent colours, logo, report theme,
  footer, disclaimer, contact block); admin-gated + server-validated + audited;
  read-scoped to own org for non-admins. `src/lib/api/branding.js` (+5 tests),
  `TenantContext` (app-wide + --brand-primary/--brand-accent CSS vars),
  `OrgBrandingPanel` → **Branding tab in User Management**. Dashboard reports
  use the tenant legal/brand name. **Owner action: open User Management →
  Branding and fill each org's logo/colours/legal name/footer/disclaimer.**
- **C. PowerPoint download fix** — **DONE (pushed).** Root cause was the missing
  caller-side try/catch + no loading feedback (generation itself was verified
  sound). All Dashboard exports now run through a shared runExport() wrapper
  (spinner + success/error toast + concurrency lock).
- **B. Branded PDF/PPTX engine** — **DONE (pushed).** exportUtils generators use
  branding colours + logo + footer/disclaimer on the Executive PPTX and Daily
  PDF; safe helpers brandHex/hexToRgb/fetchImageDataUri; verified valid .pptx
  with the tenant accent embedded.
- **D. Report Center** — **DONE (pushed).** New `/report-center` page:
  on-demand branded generation (Executive PPTX, Daily PDF, Tyre Excel/PDF) with
  date/country filters + spinner/toast, active-branding banner, scheduling
  shortcut, and Delivery History over `report_send_log`. New page — leaves the
  i18n session's Reports.jsx untouched.
- **F. Docs set** — **DONE**: `BRANDING_AND_REPORT_SETTINGS.md`,
  `PROJECT_OVERVIEW.md`, `INTEGRATIONS.md`, and `DATA_DICTIONARY.md` (21 core
  tables / 458 columns, generated from the live schema) added; ARCHITECTURE /
  REPORTING / TESTING have existing equivalents (`ARCHITECTURE_CURRENT_STATE.md`,
  `EXPORT_GUIDE.md`, `TEST_AND_RELEASE_PLAN.md`).
- **E. Design system** (tokens, tenant theme, light default, a11y, states) —
  **DEFERRED**: a global CSS/theme refactor would collide with the parallel i18n
  session actively editing pages/locales. Do this once that session lands.
  Foundation already in place: TenantContext publishes `--brand-primary` /
  `--brand-accent` CSS vars for a future token pass.

### 2026-07-02 night - export work + P2 wave (see CHANGELOG_ENGINEERING.md)
- **Export libs lazy-loaded:** xlsx/jspdf/pptxgenjs are async chunks loading on
  the first export/parse click (31 pages + exportUtils/parseWorkbook/
  emailService; manualChunks unpinned - pinning dragged helpers back into
  every page's initial load). Verified in dist/.
- **Scheduled report delivery (V61):** pg_cron every 15 min →
  `send-scheduled-reports` edge fn (secret-gated via service-role-only
  cron_config); live KPI digest email; report_send_log tracks every outcome;
  1h backoff on failure. Verified end-to-end live. OWNER ACTION: set
  RESEND_API_KEY edge-function secret for mail to actually leave.
- **P2 backlog CLOSED (multi-agent wave):** currency/date sweep across 33
  pages (activeCurrency everywhere, Rand/U4 fixed); confirm dialogs on all
  destructive deletes; V62 localStorage→DB (tyre_disposals, tyre_status_marks,
  procurement budget → settings, Settings schedules → report_schedules);
  mobile H8 (online photo re-upload) + M4 (queue pruning).
- Remaining backlog is P3/P4 only - see PROJECT_GAP_ANALYSIS.md.

### 2026-07-02 session (see CHANGELOG_ENGINEERING.md for detail)
- **Security V57-V59:** work_orders/PO write policies approval-gated; definer
  views → invoker; fn search_path pinned; deny-all cache tables readable;
  **anon accident-photo read leak closed**; bucket size/mime limits. Advisors: 0 ERROR.
- **Delete integrity V58:** cleaning_log FK → CASCADE (tyre deletes work again,
  Admin-only via RLS); rca/gate_passes FKs → SET NULL; all silent-fail delete
  buttons now verify + surface the real reason (TyreRecords, AuditTrail,
  FleetMaster, DataCleaning, WorkOrders - WO delete added, Admin-only).
- **Import commit V60:** per-row sub-transactions - one bad value fails ONE row
  with its DB reason recorded (`COMMIT_FAILED`), not the whole batch; RPC
  returns per-row errors; V56 defaults let all 10 modules commit.
- **Mobile P0:** accident submit fixed (tp-storage:// refs); offline photos
  never lost (queued + re-uploaded); unified sync banner/Sync Now; logout wipes
  queues + push token.
- **Web P0:** error+retry on 7 core pages; AssetManagement localStorage
  masking removed; ErpSync honest; multi-file intake queue; `.xlsm/.xlsb/.ods`.
- **Real company formats (`docs/imports/`):** XML Spreadsheet 2003 + Ramco
  HTML-grid parsing; footer stripping; fingerprint **auto-applied mapping
  profiles** (5 seeded); cost-of-record rule (tyre cost ONLY from Work Order
  Details `Trye`, summed per WO via line-item aggregation, lines kept in
  custom_data); 8 CI regression tests on the real files.

### Data Intake Center (`Data correction.md`) - complete
Controlled pipeline Upload→Map→Validate→Approve→Commit, country-scoped, private files, server-side RPC commit, preserves every original row/file.
- **DB:** V45 (10 `import_*` tables + private bucket + RLS), V46 (`import_commit_batch`/reverse/reprocess, column-intersection, custom_data carry), V47 (work-order cost buckets + generic custom_data), V48 (`import_master_aliases`), V49 (`currency_rates`).
- **Engine** `src/lib/import/*` - parse (xlsx/csv, header detect, Excel serial dates), synonyms (EN+Arabic, 10 modules), mapping (confidence bands), transform (tyre spend qty×cost; currency conversion trail), validate (+ `classifyDuplicates`, `countryConflict`), aliases.
- **Service** `src/lib/api/imports.js` (the only import_* boundary) · **UI** `DataIntakeCenter.jsx` wizard + `DataIntakeHistory.jsx` (Imports / Data Quality / Mapping Profiles / Custom Fields / **Aliases** / **FX Rates**).
- All 10 modules (fleet/tyre/stock/accident/inspection/workorder/warranty/gatepass/supplier/driver) map to real tables and commit.
- **4 gaps done:** country-scope conflict guard (rule #1); rich Import Control Dashboard; post-import automation (tyre-risk alerts + corrective actions); master-data alias control; approval-gated currency conversion (never silent - converts only with an approved `currency_rates` row).

### Hardening (`Current issues fixing.md`)
- **Phase 0** - 8 audit docs in `docs/`.
- **Phase 1** - org-scope RLS (V42/V43) + isolation test, `file_metadata` (V44), PWA hardening + logout cache clear + auth-remount fix, secret guard, service-layer foundation.
- **Phase 2 (data integrity)** - **V50** `apply_tyre_change` + `record_audit_event` (atomic tyre change → close removed + fit + one canonical audit; `fitment_date` is generated, omitted); **V52** `post_stock_movement` ledger (atomic, row-locked, negative-guarded, audited; extended `movement_type` CHECK; `current_stock_balance` + `v_stock_balance_reconcile`). Both wired into UI. Self-asserting SQL tests passed.
- **Phase 1 #1 service layer** - `assets/tyres/stock/workOrders/inspections/accidents/gatePasses` modules + tests (additive; pages not migrated yet).
- **Phase 3** - **V53** `gate_pass_blockers` + `gatePasses` service + GatePass UI (blocks release with open High CA / Critical tyre / Critical inspection; inspection status is Done/Cancelled); supplier scorecard (`src/lib/analytics/supplierScorecard.js` + SupplierManagement "Scorecard" tab).
- **Phase 5** - central KPI registry (`src/lib/kpi/registry.js`, 12 KPIs, compute names verified against engines); **sidebar regrouped into Overview + 8 workspaces** (every route preserved, access carried down per item; verified old/new route sets identical).
- Earlier: fabricated-metric removal (actual cost only, no `1200` default); mobile **typed offline commands** (`recordQueue` no longer writes arbitrary tables - `COMMANDS` allow-list + idempotency/backoff).

## OFF `main` (frozen - do NOT merge)
- `claude/mobile-kotlin-app` - native Kotlin app (PR #15).
- Go backend `claude/backend-step2-assets` (`backend/`) - Go API (PR #16). Targets `Roadmap_latest.Md`, parked.

## Migrations reference (live + repo `MIGRATIONS_V*.sql`, all with rollback headers)
V42/43 org scope · V44 file_metadata · V45 import center · V46 import commit · V47 work-order costs · V48 aliases · V49 currency_rates · V50 tyre-change+audit · V52 stock ledger · V53 gate-pass blockers. Self-asserting tests in `tests/rpc_*.sql`.

### Session 7 - Import commit P1 blocker fixed
QA (`QA_DATA_INTAKE_REPORT.md`) flagged Work-Order commit failing for everyone with an opaque 400; verified still live.
- **Root cause 1 (all modules):** `import_commit_batch` built its INSERT column list without excluding DB-computed columns, so a mapped field colliding with a generated column (`work_orders.total_cost` = `GENERATED ALWAYS AS (labour_cost + parts_cost)`) raised `428C9` and failed the whole batch. **V54** redefines the RPC to exclude `is_generated='ALWAYS'` + identity columns (`tests/rpc_import_commit_generated.sql`, applied live + proven).
- **Root cause 2:** no CHECK/enum validation client-side → bad values (e.g. `Asset Type`=PUMPS → `work_type`) marked "ready", rejected en masse at commit. New `src/lib/import/enums.js` holds the live CHECK domains (fleet.status; accident type/severity/status; inspection status/type; workorder work_type/status/priority). `transform.js` canonicalises casing/separators to exact DB spelling; `validate.js` flags out-of-domain values as per-row `ENUM_INVALID` errors (excluded from commit) with the allowed list. +10 tests (573 total, build green).
- **P2 auto-mapping (QA "semantically wrong"):** (a) `mapping.js` `scoreHeader` now takes `opts{fieldType,sampleValues}` and applies a -45 identifier→currency penalty (whole-word tokens center/code/id/no/number/ref, or code-like sample values) so `Cost Center`/`Store Code` no longer map to money; legit `Total Cost`/`Parts Cost` untouched. (b) `DataIntakeCenter.jsx` no longer pre-selects `'review'` (<60%) guesses - target defaults to null (preserve-as-custom), guess kept as a click-to-accept "Suggested: X (28%)" hint. +3 tests (576 total, build green).
- **P3 cleanups:** (a) **Wrong-module / granularity guard** - new pure `src/lib/import/granularity.js` (`wrongModuleWarning`/`duplicateRatio`/`naturalKeyLabel`, threshold 0.6; `NATURAL_KEY_FIELDS` kept in lockstep with `validate.NATURAL_KEY`); `runValidation` tallies a `keyed` count and the Validate step shows a non-blocking amber banner when >60% of keyed rows collapse to existing keys (line-item data staged as the wrong module). (b) `index.html` adds the standard `mobile-web-app-capable` meta (keeps the Apple one). (c) `App.jsx` `BrowserRouter future={{ v7_startTransition, v7_relativeSplatPath }}` silences the RR v7 warnings. +13 tests (589 total, build green). Re-upload 409 dead-end was already fixed (`uploadOriginalFile` reuses orphans / blocks committed).

### Session 7 (cont.) - Service-layer page migration started (pending #3)
- **StockManagement.jsx → `stock.js`** and **WorkOrders.jsx → `workOrders.js`**: every direct `supabase.from()/rpc()` call replaced with service functions (`listStockRecords`/`insert`/`update`/`insertStockMovement`/`postStockMovement`/`listStockMovements`/`listTyreIssuesSince`/`listTyreIssuesInRange`; `listWorkOrdersForPage`/`insertWorkOrder`/`updateWorkOrderById`/`generateWorkOrderNo`). `supabase` import removed from both pages. Behaviour preserved exactly: strict-country `.eq` (not null-inclusive) on these reads; error-surfacing calls wrapped in try/catch since `unwrap` throws `ServiceError`; audit-movement insert kept best-effort. `PAGE_COLS`/`COLS` verified to cover every field each page renders. 589 tests + build green. **~200 direct `from()` sites remain across other pages - continue module by module.**
- **NEW service `correctiveActions.js`** + `CorrectiveActions.jsx` migrated onto it (list/get/create/update; STRICT country `.eq` to match the page; least-privilege `COLS` omits `organisation_id`/legacy `photos`). `corrective_actions` is read by ~8 pages, so this service unblocks their future migration. +4 api tests (593 total), build green.
- **3 more pages (parallel multi-agent pass, integrated + full-gated here):** `RcaRecords.jsx` → new `rca.js` (rca_records; preserves the `corrective_action:corrective_action_id(...)` embed; reuses `correctiveActions` service for CA writes), `WarrantyTracker.jsx` → new `warranty.js` (warranty_claims incl. delete + two tyre_records read helpers), `RecallTracker.jsx` → new `recalls.js` (recalls incl. delete + a paged tyre_records helper). Each: least-privilege COLS (omit organisation_id), country scoping matched to the page's ACTUAL behaviour (rca=strict eq; warranty/recalls=none), `supabase`/`fetchAllPages` imports removed, throwing `unwrap` wrapped to preserve setError/alert/silent paths, name-collisions handled (rca param rename; `recallsApi` alias vs the page's `recalls` state). All new services added to the barrel. +12 api tests (**605 total**), build green.
- **Batch 3 (parallel multi-agent, integrated + full-gated):** `AlertThresholds.jsx` → new `alertThresholds.js` (per-user scoping; supabase fully removed), `RotationSchedule.jsx` → new `rotations.js` (tyre_rotations null-inclusive scoping + strict-eq tyre_records helper; `supabase.auth.getUser()` kept inline so the `supabase` import stays for auth only), `KpiScorecard.jsx` → new `kpiTargets.js` (kpi_targets list-by-year + `upsert onConflict:'metric,year,month,site'`; `flt()` country predicate + `fetchAllPages{max:200000}` replicated; supabase+fetchAllPages removed). +16 api tests (**621 total**), build green.
- **Batch 4 (parallel multi-agent, integrated + full-gated):** `StockReplenishment.jsx` → new `purchaseOrders.js` (purchase_orders + `generate_po_number` RPC + `stock`/tyre_records read helpers, 90-day window + fetchAllPages cap preserved), `CustomData.jsx` → new `customData.js` (field_synonyms CRUD + `get_extra_field_stats` RPC + generic dynamic-key `updateTyreRecordFields` backfill), `KnowledgeBase.jsx` → new `knowledgeDocuments.js` (knowledge_documents CRUD; reads EXCLUDE the embedding vector - `d.embedding` truthiness preserved via a lightweight id-only presence query; `supabase` import kept solely for `reindexMissingEmbeddings`). +16 api tests (**637 total**), build green.
- **Migrated so far (12 pages):** StockManagement, WorkOrders, CorrectiveActions, RcaRecords, WarrantyTracker, RecallTracker, AlertThresholds, RotationSchedule, KpiScorecard, StockReplenishment, CustomData, KnowledgeBase (+ 12 services, all in the barrel).
- **Batch 5 (4 parallel agents, integrated + full-gated):** `Accidents.jsx` → `accidents.js` (added RLS-gated **PII-aware** page fns - PAGE_COLS incl claim/insurer/police; existing PII-free COLS untouched - + fleet_master read), `UserManagement.jsx` → new `users.js` (profiles/audit_log + `admin_update_profile` RPC forwarded verbatim; every RLS/fallback branch preserved), `Budgets.jsx` → new `budgets.js` (flt strict-country + upsert `onConflict:'site,region,year,month'` + tyre date-window read), `Inspections.jsx` → `inspections.js` (heavy: PAGE_COLS superset + generic patch/insert/insertReturning/delete + vehicle_fleet helpers; `supabase` kept for `syncPendingInspections`+`send-email` invoke; corrective_actions reused). +31 api tests (**668 total**), build green.
- **Migrated so far (16 pages):** + Accidents, UserManagement, Budgets, Inspections (services: + users, budgets; accidents/inspections extended with page fns). The two previously-deferred sensitive pages (Accidents PII, Inspections) are now DONE.
- **Read-only analytics tail (~160 sites, Dashboard/DailyOps/ExecutiveReport/FleetIntelligence/etc.):** deliberately deferred - each reads `tyre_records`/`inspections` with a DIFFERENT column subset (~15 distinct shapes), so forcing them through fixed-column service fns is low-value / risks silently dropping a needed column. Best done later by first enriching `tyres.js`/`inspections.js` with a small set of analytics read fns, then migrating pages onto them. **Deliberately NOT auto-migrated:** `Inspections.jsx` (1600+ lines, 14 sites, multi-table + richer columns / different list semantics than `inspections.js` - needs bespoke page functions) and `Accidents.jsx` (**`accidents.js` intentionally excludes PII** - police_report_no/insurer/policy_no; the owner page needs a PII-aware page function, a security decision to confirm before exposing those columns).

### Session 7 - RLS / data-security audit
Ran Supabase security advisors + a direct RLS review (the real "can others reach our data" boundary - the JS service layer is NOT a security boundary; the anon key is public).
- **Baseline good:** RLS enabled on all 68 tables; core operational tables (tyre_records/inspections/accidents/corrective_actions/budgets/stock_records) are role/country-scoped. **Single-tenant today: 1 org, 4 users, `profiles.organisation_id` all NULL.**
- **FIXED - `MIGRATIONS_V55_ANON_READ_LOCKDOWN.sql` (applied live + verified):** `drivers` (PII), `suppliers`, `knowledge_documents` were readable by the **unauthenticated `anon`** role (`USING(true)` policy targeting PUBLIC + `GRANT ALL TO anon`). Restricted SELECT to `authenticated` and revoked all anon grants. `vehicle_fleet` anon SELECT left intentionally (pre-auth registration lookup).
- **DEFERRED - multi-tenant landmine (BLOCKING pre-req before onboarding any 2nd org):** ~30 tables use `authenticated USING(true)` (work_orders ALL/UPDATE, purchase_orders ALL, warranty_claims, tyre_rotations, import staging, etc.) and `profiles.organisation_id` is unpopulated. Harmless at 1 tenant; **instant cross-tenant leak the moment a 2nd org exists.** Do NOT onboard a second organisation until org_id is populated and these policies are org-scoped.
- **Still open (lower sev, not yet fixed):** 8 SECURITY DEFINER views (`v_*_secure`, `vehicles`, `tyre_changes`) bypass caller RLS - review; Supabase leaked-password protection is OFF (dashboard toggle); 4 functions with mutable search_path; an extension in `public`; `inspection_audit_log` has an INSERT `USING(true)` public policy (low sev). Broader anon-grant hygiene: other tables may carry `GRANT ALL TO anon` - only the 3 exploitable ones were fixed.

## Still PENDING (larger, deliberate work)
1. **Phase 4 mobile** - Expo SQLite offline store + conflict handling (mobile rearchitecture; can't runtime-test in this env).
2. **Phase 6 UX** - light/dark consistency, RTL/Arabic layout, universal chart drill-downs.
3. **Service-layer page migration** - move the ~276 web + ~86 mobile direct `supabase.from()` call sites onto the new services, module by module.
4. **Phase 5 follow-on (optional, low-risk)** - 8 workspace landing/hub pages summarising each section.

## Working method
Verify every spec against the live schema before writing queries or RPCs, gate (test + build + typecheck), commit, push. RPCs are proven by rolled-back live SQL tests before being trusted.
