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
