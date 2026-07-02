# TyrePulse — Full Project Audit (2026-07-02)

Method: 3 parallel code sweeps (web quality, mobile, product/UX) + a direct live-database audit
(security advisors, real anon-role probe, RLS policy inspection, performance advisors, data counts).
Every DB claim below was verified against the live project, not inferred from code.

Baseline at audit time: `main` @ `c3d4adf` · 671 web tests green · build green · mobile typecheck
has 4 pre-existing errors (see M1) · live DB nearly empty (5 tyre records, 4 profiles) — pre-launch.

---

## A. CRITICAL — broken functionality (fix first)

| # | Where | Issue |
|---|-------|-------|
| C1 | `mobile/app/(app)/accident/report.tsx:618` (+133,171,615) | **Accident reports can never be submitted.** Submit is gated on `photoUrls.filter(u => u?.startsWith('http'))`, but `uploadAccidentPhoto` now returns `tp-storage://…` refs (private-bucket change) — count is always 0 → button permanently disabled, and captured photos are filtered out of the insert. Regression never caught because the screen wasn't updated. |
| C2 | `mobile/components/PhotoCapture.tsx:46` | **Photos cannot be attached offline** (Tyre Change / RCA / Report Issue). Offline upload returns null → "Upload failed" → image lost. Field inspectors offline in yards is the core use case. Also uploads module photos to the `accident-photos` bucket regardless of module. |
| C3 | `mobile/components/SyncBanner.tsx:15-30` + profile "Sync Now" | **Offline tyre-change/RCA/issue records are invisible** — banner count and manual sync only cover the inspection queue, not the typed record queue (only a 10s background poller flushes it). Users believe everything synced when it hasn't. |
| C4 | `src/pages/ErpSync.jsx:20,83,111,131-135` | **Entire ERP Sync page is fabricated** — hardcoded systems/mappings/failures and `Math.random()` sync history. No Supabase query at all. Needs a real table or an honest "not configured" state. |
| C5 | `mobile/contexts/AuthContext.tsx:126-128` | **No account-switch isolation on logout** — offline queues (`tp_record_queue_v2`, `tp_inspection_queue_v1`) and push_token are not cleared; user B on a shared device flushes/owns user A's pending records. |
| C6 | `src/pages/AssetManagement.jsx:414-432` | **Failed saves silently fall back to localStorage and report success.** Record exists only in that browser; invisible to other users; lost on cache clear. Load path (621-2) silently merges these orphans. |

## B. HIGH — security & data integrity

| # | Where | Issue |
|---|-------|-------|
| H1 | live DB: `work_orders` (`auth_all_work_orders` ALL, `work_orders_update_all` UPDATE), `purchase_orders` (`auth_all_purchase_orders` ALL) | RLS policies are unrestricted-true for any authenticated user — any logged-in user can update/delete anyone's work orders / POs (org-scoped only). Should require `is_approved_and_unlocked()` + role for updates/deletes. |
| H2 | live DB: 3 ERROR advisors | `v_accidents_secure`, `v_inspections_secure`, `v_tyre_records_secure` are SECURITY DEFINER views (bypass caller RLS). Convert to `security_invoker = true` or justify + document. |
| H3 | live DB: anon grants | `anon` retains SELECT grants on ~73 tables. **Verified NOT an active leak** (real anon-role probe returned 0 rows everywhere; only `system_config` intentionally exposes 10 login-page flags) — but it's one always-true policy away from a breach. Revoke anon grants on all business tables (defense-in-depth; V55 started this for 3 tables). |
| H4 | Business data in localStorage only | Procurement budget (`Procurement.jsx:36`), tyre returns/write-offs (`TyreExchange.jsx:474`), scrap disposals (`TyreScrapManagement.jsx:133`), scheduled reports + alert thresholds (`Settings.jsx:159,277`). Per-browser, unshared, unaudited, lost on clear. Persist to Supabase. |
| H5 | `mobile/app/(app)/admin/approvals.tsx:89` | Inserts into a **server-supplied `target_table`** with arbitrary rows — the one mobile write path bypassing the typed COMMANDS allow-list. Validate against an explicit table allow-list + strip fields. |
| H6 | `mobile/eas.json` + `app.json` | **No environment isolation** — dev/preview/production builds all point at the production Supabase project. Test data lands in prod. Provision a second project for dev/preview. |
| H7 | Core web pages swallow errors → infinite spinner or silent-empty | `FleetAnalytics:39-48`, `CountryComparison:76-88`, `SiteComparison:120-136`, `BrandPerformance:49-57`, `KpiScorecard:55-73`, `Analytics:64-79`, `Dashboard:197-223`; same pattern on mobile (`rca:68`, `stock:60`, `vehicles:54`, `history:61`, `index:191`, `records/index:80`). Offline/RLS-denied looks identical to "no data". Template to copy: `PerformanceBenchmark.jsx:145-168` (web), `overview.tsx:47-62` (mobile). |
| H8 | `mobile/app/(app)/inspection/new.tsx:278` | Online submit inserts `tyre_conditions` containing dead `file://` URIs when eager photo upload failed; offline path re-uploads but online path doesn't. Run `uploadAllPositionPhotos` on the online path too. |
| H9 | live DB auth setting | Leaked-password protection (HaveIBeenPwned) disabled — one-click enable in Auth settings. |
| H10 | 4 functions with mutable `search_path` | `touch_updated_at`, `jsonb_key_count`, `import_target_table`, `stock_movement_direction` — add `SET search_path = public`. |

## C. HIGH — product/UX correctness

| # | Where | Issue |
|---|-------|-------|
| U1 | Whole web app | **No Arabic/RTL** — no i18n framework, no `dir="rtl"`, all hardcoded English. Mobile ships `ar.json`/`ur.json`; web is the outlier for Gulf users. |
| U2 | 54 charting pages | **Zero chart drill-down** (0 click handlers found) — a stated directive requirement ("every chart must support drill-down to source records"). |
| U3 | ~80 of 85 pages | **Light theme effectively broken** — literal `bg-gray-900`/`text-white` classes without `dark:` variants; only QrLabels does it right. Chart tick/grid hexes hardcoded dark too. |
| U4 | `KpiCommandCenter.jsx:38-46`, `PerformanceBenchmark.jsx:47` | CPK displayed in **"R" (South African Rand)** and benchmarks labeled "Southern Africa" — wrong currency and fabricated-provenance targets for a Gulf product. Make benchmarks org-configurable; use `activeCurrency`. |
| U5 | ~30 pages | Duplicated local `fmtCurrency` with hardcoded `'SAR'` default (AdvancedAnalytics, CostCenter, DriverManagement, ExecutiveReport, FleetIntelligence, EngineeringKpi:165, AiAnalytics:348 …) — wrong symbol in UAE/Qatar. Consolidate on `formatters.formatCurrency(v, activeCurrency)`. |
| U6 | Mixed date locales | `en-GB` vs `en-US` vs bare `toLocaleDateString()` across pages (even mixed within Data Intake screens). Standardise on `formatters.formatDate`. |
| U7 | Unconfirmed destructive deletes | `SupplierManagement.jsx:1471` (contracts), `InspectionPlanner.jsx:1390` (schedules), `CustomData.jsx:559` (synonyms) delete immediately. Reuse the existing "type DELETE" confirm pattern. |
| U8 | `src/components/ui/DataTable.jsx` used by 0 pages | 71 raw `<table>`s with inconsistent search/filter/pagination; standardise on DataTable for unbounded datasets (AuditTrail, Inspections, FleetMaster, UserManagement). |
| U9 | Native `alert()` for validation | Procurement, WorkOrders, RecallTracker, WarrantyTracker — replace with inline field errors (pattern exists in AlertThresholds). |

## D. MEDIUM — platform & performance

- **M1 (mobile)**: `expo-notifications` + `expo-device` are in package.json but **absent from node_modules** → the 4 standing typecheck errors; notifications code IS used (`_layout.tsx:38,41`, `profile.tsx:58,73`). Reinstall/lock; also fix the deprecated `shouldShowAlert` mix, and pass `channelId` (tuned Android channels currently dead).
- **M2 (mobile)**: stock adjustments + work-order/CA status updates are direct writes with **no offline queue** — lost when offline (`stock.tsx:76`, `work-orders.tsx:109`, `workorders/index.tsx:97`).
- **M3 (mobile)**: `fetchProfile` swallows errors → offline cold start shows a stripped role-less app; cache last-known profile.
- **M4 (mobile)**: synced records never pruned from `tp_record_queue_v2` (SecureStore grows unbounded); `PhotoCapture` stale-closure on rapid captures; stale doc-comments that caused C1.
- **M5 (web)**: service-layer migration remaining — **22 pages / ~138 direct `supabase.from()` calls** (top: DataCleaning 22, UploadData 13, Dashboard 9, TyreSpecifications 8, TyreRecords 8). `analyticsReads.js` institutionalises `.data`-only consumption — should surface errors.
- **M6 (web)**: heavy export libs (`xlsx`, `jspdf`, `pptxgen`) statically imported in ~32-40 pages → bundled into every page chunk. Lazy-import inside export handlers.
- **M7 (DB perf, matters at scale)**: 207 `multiple_permissive_policies` warnings (e.g. announcements/console_sessions/kpi_targets/system_config have ~20 stacked policies each — consolidate duplicates); 82 `auth_rls_initplan` (wrap `auth.uid()` in `(select auth.uid())`); 56 unindexed FKs; 129 unused indexes; 1 duplicate index.
- **M8 (DB)**: `document_chunks`, `kpi_snapshots`, `ai_response_cache` have RLS enabled with **no policy** (deny-all) — RAG/knowledge + KPI snapshot features will silently return nothing for users; add intended policies.
- **M9 (web)**: duplicated `applyCountry` (countryFilter.js vs api/_client.js) and duplicated `COUNTRY_CURRENCY` map (CountryComparison vs SettingsContext); hardcoded country lists in UserManagement/AssetManagement; region defaults `?? 'KSA'` mis-scope non-KSA data.
- **M10 (web)**: `key={index}` on data-backed lists (~110 occurrences); 2 suppressed exhaustive-deps effects to re-verify.

## E. What is genuinely in good shape
Org-isolation RLS held under a real anon probe (0 rows leaked); import pipeline commit RPC proven live end-to-end; atomic tyre-change/stock-ledger/audit RPCs tested; typed mobile command queue is sound (re-sanitises on flush); no dead routes; engines (analytics/kpi) are single-source and tested; 671-test suite; no TODO/FIXME debt markers.

---

## Improvement plan (recommended order)

**P0 — Broken-now fixes (small, immediate):** C1 accident submit gate + C2 offline photo queuing + C3 unified sync banner + C5 logout queue clear (one mobile PR); C6 remove localStorage masking + C4 honest ErpSync empty state + H7 error states on the 7 core pages (one web PR).

**P1 — Security hardening (one migration + settings):** H1 tighten work_orders/purchase_orders policies; H3 revoke anon grants on business tables; H2 fix 3 SECURITY DEFINER views; H10 pin search_path; H9 enable leaked-password protection; M8 add policies to the 3 deny-all tables; H5 allow-list mobile approvals insert. All backward-compatible, each provable with the established BEGIN/ROLLBACK test pattern.

**P2 — Product correctness:** U4/U5/U6 one formatters sweep (currency + dates via settings, kill 'SAR'/'R' hardcodes, Gulf-configurable benchmarks); U7 confirm dialogs; H4 move localStorage business data into tables; H8 online inspection photo re-upload.

**P3 — Platform debt:** M5 finish service-layer migration (batches, as started); M6 lazy-load export libs; M7 RLS policy consolidation + FK indexes (before data volume grows); M1 mobile deps; M2 offline update commands.

**P4 — Bigger product investments:** U1 web i18n + RTL (reuse mobile ar.json); U2 chart drill-down (shared helper + adopt per page); U3 theme via CSS vars; U8 DataTable adoption; H6 dev/preview Supabase project; Expo SQLite offline store; workspace hub pages.
