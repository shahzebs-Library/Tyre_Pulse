# TyrePulse — Interactive QA Test & Fix Log
**Date:** 10 July 2026
**Method:** Playwright-driven interactive testing against the live app (dev server on the production Supabase, Admin session), plus a whole-app code↔live-schema diff. Test data tagged `QA-TEST` and deleted after each check.
**Build:** ✅ green after every fix. **DB migrations:** additive/reversible, applied live.

---

## Summary
| # | Area | Bug | Severity | Status |
|---|------|-----|----------|--------|
| 1 | Auth / Security Center / Audit | `audit_log_v2` missing `session_id` + `record_count` columns → login-audit writes, Security Center login history, Audit KPI all 400 | High | ✅ Fixed (migration) |
| 2 | Settings | `JSON.parse` on a bare-string setting (`KSA`) threw and aborted the whole settings load → config never populated | High | ✅ Fixed (code) |
| 3 | Navigation (EN+AR) | 6 nav items rendered raw i18n keys (`nav.items./display`, `/security-center`, `/permission-matrix`, `/system-health`, `/tenant-health`, `/billing`) | Medium | ✅ Fixed (locales) |
| 4 | Settings API | `getAlertThresholds` used `.single()` → 406 when the row is absent | Low | ✅ Fixed (`.maybeSingle()`) |
| 5 | Anomaly Scan | Page read a `public.anomalies` table that never existed / is never written → hard error + Retry loop | High | ✅ Fixed (derive from `tyre_records`) |
| 6 | Accidents | Wrote `created_by`; table has `reported_by` → every insert 400 | High | ✅ Fixed (code) |
| 7 | Accidents | `site`/`photos` NOT NULL, form sent `null` → 400 | High | ✅ Fixed (code) |
| 8 | Accidents | severity/status vocabulary violated DB CHECK constraints → no save ever succeeded | High | ✅ Fixed (migration + write reverse-map) |
| 9 | Accidents | status/severity counts + funnel filters compared raw lowercase vs label keys → all chips 0 | Medium | ✅ Fixed (canonicalize on load) |
| 10 | Inspections / Accidents | delete-audit trigger inserted into FK-bound audit table on DELETE → deletion blocked | High | ✅ Fixed (migration) |
| 11 | API/Webhooks + Display platform | **pgcrypto extension never installed** → `gen_random_bytes()`/`digest()`/`hmac()` missing → `create_api_key`, `api_key_authenticate`, `create_display_token`, `get_display_snapshot`, `deliver_pending_webhooks` all fail at runtime (API-key minting returned a masked 404 hiding `function gen_random_bytes does not exist`) | High | ✅ Fixed (install pgcrypto in `extensions` + add to the 5 functions' search_path) |
| 12 | Warranty Tracker | React "unique key prop" warning — `key` was on the inner `<tr>` not the returned `<Fragment>` | Low (cosmetic) | ✅ Fixed (`<Fragment key={c.id}>`) |
| 13 | Knowledge Base / RAG | `generate-embedding` 500s → docs land unindexed. Root cause: **no valid `OPENAI_API_KEY`** (0 embeddings have ever succeeded; embeddings use OpenAI while chat uses Anthropic). Function code is correct; write path + cron `embed-worker` backfill self-heal once the key is set. | Config | ⏳ Owner action: set `OPENAI_API_KEY` |
| 15 | Fleet Master | "Save Vehicle" stayed enabled at the plan cap → silent no-op on click | Low (UX) | ✅ Fixed (proactive `canAddResource` check on open → disable button + inline reason) |
| 16 | Cost Center | Rendered `NaN%` (CPK-delta badge missed non-finite) and `NaN` (`{fleetAvgCpk && …}` renders literal NaN when the value is NaN — React falsy-number footgun) | Low | ✅ Fixed (finite guards in `cpkDeltaBadge` + `Number.isFinite` render gate) |

| 17 | Work Orders → approval | Starting an approval **crashed** the detail drawer: `WorkOrders.jsx` used `<Lock>` in 3 places but never imported it → JSX resolved to the browser global `window.Lock` → `TypeError: Illegal constructor` when the WO locked under approval | High | ✅ Fixed (import `Lock` from lucide-react) |

**Approval workflow verified end-to-end:** Work Order → select chain → Start approval → **Approve** → instance `status='approved'` (RPC path works). The only defect was #17. A codebase-wide scan for undefined JSX components (all pages/components) found no other real cases (remaining hits are prop-renamed `<Icon>`, destructured locals, and JSDoc examples).

| 18 | Tyre Records + RCA edit/create | Payload spread `...form` sent `issue_date`/`failure_date` as `""` → Postgres `22007 invalid input syntax for type date` → **editing/saving any record with an empty date 400'd**. Widespread since much data has no date. | High | ✅ Fixed (coerce empty date → null in TyreRecords + RcaRecords; scanned all forms — others coerce/guard) |

**In-page interactions verified:** Dashboard exports (Excel/PDF/PPTX all download OK); Work Order detail drawer + approval panel; Tyre Record edit (update persists after #18 fix, verified + reverted).

| 19 | Dashboard PPTX export | Executive deck came out **all-zero** (0 vehicles/tyres, SAR 0, every chart "No data") because `pptxExportTask` passed the dashboard's default **"This Month"** range (`Dashboard.jsx:216`) to `report_tyre_summary`, but the tyre data is historical (2025/`null` dates) → 0 for July. The headline KPIs are all-time (1,419) → screen-vs-export mismatch. | High | ✅ Fixed (exec PPTX now uses all-time/fleet-wide data; regenerated deck shows 412 vehicles / 1,419 tyres / SAR 1.30M + 7 populated charts) |

| 20 | Tyre Records export (Excel/PDF) | `listAllRecords` did a plain `.select('*')` with no pagination → hit PostgREST's **1000-row cap**, silently exporting only 1000 of 1419 records (PDF title even said "1,419 records"). | High | ✅ Fixed (route through the existing `fetchAllPages` helper; verified export now = 1419 rows). Only `tyre_records` exceeds 1000 today; other export-fetchers already use `fetchAllPages`. |

| 21 | Inspections | "Site Observation / Safety Training / Training Session" types violated `inspections_inspection_type_check` (allows only Routine/Pressure/Visual/Full/Pre-Trip) → those saves 400'd (dead-on-arrival: only `Routine` rows exist). | High | ✅ Fixed (write a CHECK-valid type, carry the true display type in `custom_data.record_type`; 27 tests pass) — via CHECK-constraint audit agent |
| 22 | Security (RLS) | `public.vehicles` view was **SECURITY DEFINER** (no `security_invoker`) → bypassed `vehicle_fleet` RLS (advisor ERROR); sibling `tyre_changes` was correct. | Medium (security) | ✅ Fixed (migration `vehicles_view_security_invoker`; view honors RLS, still returns 604 rows; Vehicle 360 + search verified) |

**Mobile runtime (Android emulator):** launched Pixel_7 AVD, `npm install`, `expo start` → app bundled (1656 modules) and ran in Expo Go. **Login screen renders correctly** (multi-identifier login + EN/ع/اردو i18n). No app runtime errors in Metro — only Expo-Go env warnings (remote push needs a dev build; `newArchEnabled:false` forced-on in Expo Go but respected by the production APK). Full flow test needs mobile login credentials.

**Function search_path hardening:** advisor `function_search_path_mutable` — the bulk are pgvector extension functions (not ours). Pinned `search_path=public` on our 8 helpers (`import_*`, `rule_condition_passes`, `validate_business_rule/workflow_steps`) via migration `harden_helper_function_search_path` (behaviour-preserving).

**Multi-tenant RLS — investigated, NOT changed (data-governance decision required):** all 1419 tyres + 604 vehicles belong to **one** organisation, but the 14 users split across org A (8), org B (2), and 4 with no org. Tightening the always-true RLS policies to `organisation_id = app_current_org()` would **lock out 6 of 14 users** (org-B + org-less see nothing, since all data is org-A's). Safe tenant isolation first needs an ownership decision (are these one company or separate tenants?) + backfilling users' `organisation_id`, then per-table policy changes with a rollback plan. Left for a dedicated, owner-confirmed pass — see [[rls_security_audit]].

**Security advisor pass:** 1 ERROR (vehicles view, #22 — fixed). The many always-true RLS policies + authenticated/anon function exposure are the **known, deferred multi-tenant landmine** ([[rls_security_audit]]) — the app runs effectively single-tenant (org-NULL data); tightening RLS is a risky architectural decision, left for a dedicated pass, not touched here. Also latent: 8 `function_search_path_mutable`, leaked-password-protection off (auth config).

**Additional executive/module exports verified:** Daily PDF (all-time, 412 vehicles / 1419 tyres / predictive spend — correct); Executive Report page PDF ("All Time", full KPI table — correct); Tyre Records Excel (now full 1419 after #20).

**Export-content verification (opened the files):** **Excel** correct (Summary + 1000 data rows, site % sum to 100). **PDF** correct data (200-row table/KPI export; no charts by design). **PPTX** was broken (#19), now correct with real data + 7 charts. Charts degrade gracefully to "No data" on empty periods (good). NOT bugs: "confidinetial" = PDF text-extraction artifact; "all are fied" = the tenant's own configured branding disclaimer (`brand.disclaimer`). Minor nit: the three exports use different row scopes (Excel 1000 / PDF 200 / PPTX all-time) — each internally consistent.

**Data-integrity pass:** all ~26 analytics/intelligence pages scanned for NaN/Infinity/undefined/broken-chart while loaded. Only Cost Center showed defects (#16, both fixed). Clean: Dashboard, Analytics, Advanced Analytics, Position/Pressure/Predictive/Fleet Intelligence, Benchmark, Tyre Lifecycle/Size/Specs, Rotation, KPI, Site/Country/Period Comparison, Fleet Analytics, Vendor Intelligence, Forecasting, Budget Planner, Fuel Efficiency, Downtime, Workshop, Compliance, Safety & Compliance, Inspection Intelligence, Smart Analytics.
| 14 | Inspections → raise action | `raiseAction()` inserted `source:'Observation'` into `corrective_actions` (no such column) → silent 400 in an empty catch; "raise action from inspection" never created a linked action | High | ✅ Fixed (removed `source`; found by audit agent) |

**Column-drift audit (agent):** every fixed-shape `.insert()/.update()/.upsert()` payload in `src/` was diffed against the live schema. Only the Inspections `source` defect surfaced (#14). Verified clean: vehicle_fleet, work_orders, stock_records/movements, purchase_orders, inspections, recalls, corrective_actions (other sites), gate_passes, rca_records, budgets, tyre_rotations/disposals/status_marks/specifications, alert_thresholds, business_rules, inspection/report_schedules, sites, country_addresses, supplier_contracts/ratings. Bulk-import inserts (uploads.js, imports.js) use dynamic column maps — not statically verifiable, no NOT-NULL-null defects observed.

**Non-bug findings**
- Fleet Master create is correctly **server-gated** by plan limits (`org_can_add`); minor UX: the Save button stays enabled at the cap (message only at top of a tall modal).
- **Data quality:** tyre records largely missing brand/serial/date; cost uniform `SAR 900`. Anomaly scan now surfaces **54 duplicate serials**.
- **Whole-app schema diff:** across every `.from()` table and `.rpc()` call, `anomalies` was the *only* missing table and all 46 RPCs exist live — no other page hard-fails on a missing DB object.

---

## Access-control clarification (answer to "which one is live")
- **Live/enforced source of truth:** `module_permissions` table (read by `get_user_module_permissions` on login; 518 rows, all global org_id=NULL).
- **Permission Matrix** (`/permission-matrix`) and **User Management → Access Control tab** both edit that same table — twin front-ends, both effective (View/module-open only).
- **Platform Console** (`/console`) writes the same table **per-org**; org rows override global → the real conflict, currently **latent** (no per-org rows yet).
- **Not enforced:** the Create/Edit/Delete/Export/Approve toggles on the Permission Matrix (stored in `app_settings.permission_overrides`, read only by the not-yet-wired `useCan` engine — the page banner says so). **Settings has no access editor.**
- **Gap vs spec:** module gating is frontend-only; backend RLS enforces org+country isolation, not per-module/per-action. Deny-by-default *backend* model per `Master Access Control and Approval Permissions.md` is not built yet.

---

## Migrations applied (live, reversible)
1. `audit_log_v2_restore_session_id_record_count` — add `session_id text`, `record_count integer` + `(action, created_at)` index.
2. `accidents_expand_chk_status_vocabulary` — widen `chk_status` to `reported, under_review, repair_in_progress, awaiting_parts, awaiting_approval, insurance_claim, closed`.
3. `fix_audit_triggers_skip_delete_insert` — `log_inspection_change()` / `log_accident_change()` skip the DELETE-branch insert.
4. `reload_api_schema_cache` — COMMENT on create/revoke_api_key to force PostgREST reload (diagnostic).
5. `install_pgcrypto_fix_key_token_functions` — `CREATE EXTENSION pgcrypto` in `extensions` + `SET search_path = public, extensions` on the 5 crypto-dependent functions.

## Files changed
- `src/pages/Settings.jsx` — defensive JSON.parse.
- `src/lib/api/settings.js` — `.maybeSingle()` (+ test mock updated).
- `src/locales/en/nav.json`, `src/locales/ar/nav.json` — 6 missing nav labels.
- `src/pages/Anomalies.jsx` — derive anomalies from `tyre_records` (`deriveTyreAnomalies`).
- `src/pages/Accidents.jsx` — `reported_by`, site/photos defaults, `toDbSeverity/toDbStatus`, extended `STATUS_ALIAS`, canonicalize on load.

## Coverage
- **Interactive create verified:** Corrective Actions, Work Orders, Stock, Procurement, Inspections, Accidents, Automation Rules, API Keys (create+revoke), Scheduled Reports, Warranty Claims. Gate Pass clearance. Fleet Master (plan-gated). Recalls form validates (tag-input needs a keypress; not saved in test).
- **Loaded clean (first sweep + admin/analytics):** Dashboard, Tyre Records, Asset Management, RCA, Daily Ops, Live Fleet, Serial Tracker, QR Labels, Vehicle History, Maintenance Calendar, ERP Sync, Analytics, Advanced Analytics, Fleet Intelligence, Brand Performance, Approvals, Workflow Settings, Automation Rules, Integrations, Reports, Executive Report, Knowledge Base, AI Command Center, AI Cost Monitor, Permission Matrix, Tenant Health, Billing, Users, Data Intake, Upload Approvals, Data Cleaning, Security Center, System Health.

## Remaining (task 4 — in progress)
Deep interactive/action pass on Reports / Automation / Admin write & action flows: Approvals approve/reject/return, Automation Rules create, API-key create/revoke, Scheduled Reports create, Knowledge Base upload, Custom Data, Event Stream, Display tokens.

## Notes
- All changes uncommitted on `main`. DB migrations already live + reversible.
- Session idle-timeout (30 min) logs the test user out during long passes — dispatch a `touchstart` keep-alive.
