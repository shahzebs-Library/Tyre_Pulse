# TyrePulse - Developer Handoff
**Last updated:** 12 July 2026 (Session 16)
**Branch:** `main` (auto-deploys to Vercel). Session 16 shipped the accident-detail crash fix, intake diagnostics, the 3 remaining approval modules, and the whole **Checklist system** (builder → runtime → approval → schedules → mobile), all committed + pushed to `main`.
**Web build status:** ✅ Clean - builds with zero errors (`vite build` green); full suite **1775 tests green**, auto-deploys to Vercel.
**Mobile build status:** ✅ Expo SDK 54 / RN 0.81.5. Session 16 added **checklist fill + submit** (offline-safe via the typed record queue) and its screens; `tsc --noEmit` clean. Build the distribution APK from `main` with the `production-apk` EAS profile.
**DB migrations applied to live Supabase:** through **V125** (project `jhssdmeruxtrlqnwfksc`). Session 16 applied **V122** (niche approval chains), **V123** (checklist templates/submissions + chain), **V124/V124b** (checklist schedules/assignments + daily pg_cron + scoring columns), **V125** (checklist_submissions.client_uuid for mobile idempotency) — all verified live.
**Live URL under test:** tyre-pulse-peach.vercel.app
**Active branches:** `main` · dev `claude/multi-agent-work-an6f1h` (Session 16 work; == `main`) · dev `claude/erp-sync-hub-roles-od8m1k` (holds 2 **table-standardization** commits deliberately kept OFF `main` — see Session 12 → Held) · frozen `claude/backend-step2-assets` (Go) · frozen `claude/mobile-kotlin-app` (Kotlin).

---

## Session 16 (12 July 2026) — Accident fix, intake diagnostics, remaining approvals, full Checklist system

**Theme:** A large multi-agent session (7 waves): fixed a reported crash, deepened Data Intake, closed the last approval-engine gaps, and built an entire configurable **Checklist** product (web + mobile) with scheduling, scoring, conditional logic, and live-data reference fields. Every wave committed + pushed to `main`; all migrations applied live via the Supabase connector.

**Gate:** web `vite build` ✅ · **1775 tests green** (was 1694; +81) · mobile `tsc --noEmit` ✅ · migrations **V122→V125 applied + verified live**. Commits `baed34f → bb3e442` on `main`.

### 1. Accident detail — crash fix + deepening (`baed34f`)
- **Fixed a ReferenceError** (`formatCurrency is not defined`, reported as "currency is not defined"): the Overview/Claim/Parts tabs of `src/components/AccidentDetailModal.jsx` called a bare `formatCurrency` that was only imported under an alias → `/accidents/:id` crashed on open. Threaded the currency-aware `fmtCurrency` through the tabs. Regression test `src/test/accidentDetailPage.test.jsx`.
- Added **Download Case PDF** (`exportAccidentCasePdf`), a **Site dropdown** + datalist pickers (case stage/damage/status), and editable incident date/site. (Detail was already a full page with a back button — the "popup" was the pre-fix crash fallback.)

### 2. Data Intake diagnostics + force (`947911c`)
- `src/lib/import/diagnostics.js` (validation/commit/batch-health analysis), `src/lib/api/importDiagnostics.js` (read-back), `src/components/intake/IntakeDiagnosticsPanel.jsx`, wired into the Validate step, commit Result, and a **Diagnose** action per Recent-imports row, with one-click **Force-include / Skip / Reset** + downloadable reports.

### 3. The 3 remaining approval modules (`e52b922`, V122)
- **Vehicle handover** was already covered by `gate_pass`. Wired **goods_receipt** (Procurement PO drawer), **tyre_return** + **tyre_transfer** (Stock movement/transfer flows). `MIGRATIONS_V122` seeds the org-NULL chains (applied live). Per-module workflow tests.

### 4. Checklist system — core (`c20c329`, V123)
- **Builder** (`/checklist-builder`, elevated), **Checklists** list (`/checklists`), **Run** (`/checklists/:id/run`), **Submission** (`/checklists/submission/:id`) + approval panel (`checklist_submission`). Engine `src/lib/checklist/fieldTypes.js`, API `src/lib/api/checklists.js`. `MIGRATIONS_V123` = `checklist_templates` + `checklist_submissions` (org/country RLS) + approval chain (applied live). Signature reuses `src/components/SignaturePad.jsx`; photos to the shared media bucket.

### 5. Checklist PDF + Insights (`49ed42e`)
- `exportChecklistSubmissionPdf` (Download PDF on a submission) + `ChecklistInsights` page (`/checklist-insights`): completion/approval KPIs, submissions-per-week, by-template/site, boolean pass-rates.

### 6. Compliance program — schedules, scoring, conditional logic (`001f82b`, V124/V124b)
- **Schedules** (`/checklist-schedules`) + **My Checklists** (`/my-checklists`) worklist. `MIGRATIONS_V124` = `checklist_schedules` + `checklist_assignments` + `generate_checklist_assignments()` (**daily pg_cron**, verified). Runtime completes the linked assignment on submit.
- **Conditional visibility** (`visibleWhen`) + **weighted scoring** (`weight`/`passValues`, template `pass_threshold`, submission `score_pct`/`score_passed` — V124b columns). Builder editors + runtime honour both; submission shows a pass/fail badge.

### 7. Mobile checklists + advanced builder (`aca1f0d` V125, `bb3e442`)
- **Mobile:** `mobile/lib/checklistFields.ts` (TS port), `mobile/lib/checklists.ts`, `mobile/app/(app)/checklists/{index,[templateId]}.tsx` (fill all field types, conditional visibility, photo, scoring, typed signature; submit online or **offline-queued** via `recordQueue` `CHECKLIST_SUBMISSION`/`CHECKLIST_ASSIGNMENT_STATUS`). `MIGRATIONS_V125` adds `checklist_submissions.client_uuid` (mobile idempotency, applied live). Home-menu entry added.
- **Advanced builder:** reference field types **asset / site / user** that resolve **real data** at fill time (`ReferencePicker` loads live Sites/Assets/Users), a curated **FIELD_LIBRARY** ("Add from library" one-click suggestions), and production polish (unsaved indicator, richer empty states, preview pickers).

### Notes / follow-ups (owner action)
- **Mobile reference pickers** (asset/site/user) render as text fallback on mobile for now — a live-picker port is the one deferred checklist item.
- **Handoff-sweep result:** the two most-cited latent bugs are already fixed — `normalize_country` else-KSA (V121) and `DataCleaning` count-exact (Session 9). Remaining handoff items are **owner-action only**: set notification/RESEND/Twilio secrets, create a dedicated Sentry RN project + swap DSN, delete the ~24 stale remote branches, and import UAE/Egypt/retread data to light up Country Comparison + Retread intelligence.

---

## Session 15 (11 July 2026) — Comparison + Retread correctness, Accident deepen, app-wide modal→page conversion

**Theme:** Three reported problems (Country/Site comparison "not working", Retread numbers wrong, Accident page too thin) plus an app-wide UX directive — LARGE modals must become proper routed pages; only small things stay popups. Executed via a swarm of ~14 disjoint-ownership general-purpose/Explore agents (one module each, no shared-file writes — App.jsx wiring done by hand) + integration.

**Gate:** web `vite build` ✅ zero errors (41s) · full suite **1694 tests green** (128 files, was 1685) · **committed + pushed to `main`** (`b206ce3` app work, `f378aaa` V121) · **V121 applied live + verified**.

### Live-data verification (ran against prod via Supabase MCP this session)
- **`normalize_country` fix confirmed live:** `'Saudi Arabia'→KSA`, `'dubai'→UAE`, **`'Qatar'→Qatar` (preserved, no longer coerced to KSA)**, blank/null→null; `tyre_records.country` DEFAULT is now null.
- **Comparison "not working" is largely a DATA reality, not just the code bug:** `tyre_records` = **1419 rows, ALL `country='KSA'`, 8 sites**. So Country Comparison inherently shows a single country until UAE/Egypt data is imported — the code fix (row-cap removal) is correct but there is only one country of data. **Site** Comparison works (8 sites; use country = All or KSA).
- **Retread page will render empty against current data:** `category` is null on 1418/1419 rows (1 blank), **0 retread + 0 scrap** rows, no `retread_count` column. The 5 formula fixes are correct but there is no retread data to show — capture retreads as `category` `'Retread'`/`'Retread xN'` (or add a `retread_count` field) to populate it.
- **Accident intelligence — partially populated (11 accidents, 1 country):** `accident_type` 11/11 and `driver_name` 11/11 → root-cause-by-type + repeat-driver analytics work; but **`liable_party`/`responsible_party` only 1/11** → the at-fault % reads mostly "unknown" (the new data-quality strip surfaces exactly this).

### 1. Comparison "not working" — root cause found + fixed
- **CountryComparison.jsx (rewritten):** real bug was a **1000-row cap** — the country-list `useEffect` queried `tyre_records` with no `.range()`/`fetchAllPages`, so with per-country import batches the selector often surfaced one country and auto-selected it → nothing to compare. Now pages the full dataset via `fetchAllPages`, reuses the tested `computeCountryMetrics()` (was hand-rolling inferior math), applies `.eq('country', activeCountry)` scope like every other analytics page, and fixes a wrong i18n key + dead "best value" math. Proper loading/error/empty states.
- **Comparison.jsx (`/comparison`, generic period-vs-period): 4 real bugs fixed** — (a) `activeCountry` never applied → admins saw cross-country data on this page only; (b) cost summed raw `cost_per_tyre` ignoring `qty` → now uses canonical `recordCost` from analyticsEngine; (c) Overall view bucketed by year only, letting Period A count Period B's selected months; (d) query error was swallowed → added error card + retry.
- **SiteComparison.jsx:** audited, structurally sound (mirrors working BrandPerformance), left unchanged.
- **Deeper root cause investigated & CLOSED:** hypothesised country-value mismatch (`.eq('country', activeCountry)` returning zero rows) **cannot happen** — `MASTER_ENGINE.sql` has a `BEFORE INSERT OR UPDATE` trigger `normalize_country()` + a backfill that canonicalises `country` to `KSA`/`UAE`/`Egypt` on every write from every source. No query-time aliasing added (would be dead code). **Latent trap (separate, low sev):** `normalize_country`'s `else 'KSA'` fallback silently misfiles any *unknown* country → `KSA`; revisit before any 4th-country expansion.

### 2. Retread correctness (RetreadManagement.jsx) — 5 formula bugs fixed
- Retread detection was `category === 'retread'` (dropped `"Retreaded"`/`"Retread x2"`); now `/retread/i` matching the rest of the app → counts no longer under-report.
- "New tyre" CPK baseline was polluted by `Scrap` casings → now excluded (matches kpiEngine).
- **Savings KPI over-counted** — multiplied an averaged per-km delta by avg life *and* total retread count; replaced with per-tyre `Σ(newCpk×km_life − cost)`.
- Vendor CPK score used a dead magic constant (`100 − avgCpk*10000`) that zeroed the 40% CPK weight for real currency; replaced with min-max scaling.
- ROI break-even was dimensionally incoherent; now "km a retread must survive to recover its cost."
- **Added:** retread-cycle counting (multi-retread casings) + color-coded cycle column + deep-cycle blow-out risk, and a data-driven Retread Engineering Intelligence panel. 4/4 retread tests green.

### 3. Accident module deepened + modal→page (Accidents.jsx, AccidentDetailModal.jsx, api/accidents.js)
- Was thin (4 KPIs, modal detail). Now **6 KPI cards** (incl. at-fault %, per-100-vehicles, unrecovered $) + severity-mix strip + an **Engineering & Ops Intelligence panel** (repeat-offender assets/drivers, cost hotspots by site, root-cause groupings, recovery-leakage, data-quality flags, prioritised recommendations) — all data-driven, no mocks. Row-click navigation + global filter added; real skeleton/error states.
- Detail **modal → page** at `/accidents/:id` (7 tabs preserved verbatim; `EntityApprovalPanel` moved onto the page as a sticky rail; approval lock now enforced end-to-end there). 26/26 accident tests green.

### 4. App-wide modal→page conversion pass
- Read-only inventory classified ~38 modals (SMALL keep vs LARGE→page). **7 LARGE converted to routed pages** (all features/approval workflows preserved, dead drawer code + orphaned imports removed, self-fetch by param, loading/error/not-found states):
  - `AssetDrawer` → **`/assets/:assetNo`** (biggest — 3 call sites: AssetManagement/FleetHealthBoard/LiveFleetStatus; the two map/health quick-looks kept + given an "Open Full Asset Profile" button)
  - `SupplierDrawer` → **`/suppliers/:supplierId`** · `DriverDrawer` → **`/driver-management/:driverId`** · `JobDrawer` → **`/workshop/:jobId`** · Recall drawer → **`/recalls/:recallId`**
  - `WorkflowSettings` BuilderModal → **`/workflow-settings/builder/:defId?`** · `AutomationRules` RuleModal → **`/automation-rules/builder[/:ruleId]`**
- **Correctly kept as modals** (verified compact/wizard, per the rule): RotationSchedule drawer, UploadApprovals IntakeRows + EditBatch, InspectionPlanner Bulk + Schedule, Console2FA, Approvals detail drawer, and all confirm/quick-edit/chart-zoom/email/upload dialogs.
- Routes wired into `App.jsx` (grouped block). New i18n namespaces added: `driver`, `workflow`, `workshop` (auto-loaded via `import.meta.glob`). Asset/Supplier keys added to existing namespaces.

### Notes / follow-ups (owner action)
- **COMMIT PENDING:** nothing committed. `git status` = 19 modified + 7 new `src/pages/*Detail|*Builder.jsx` + 6 new `src/locales/*/{driver,workflow,workshop}.json`. Review then commit/push (auto-deploys to Vercel).
- **Live-data smoke tests** (couldn't run here): set country switcher to **All** and confirm CountryComparison lists all countries + renders; confirm Retread counts/cycle (needs a `retread_count` field or `"Retread xN"` category to unlock cycle intelligence); Accident at-fault %/root-cause depend on `liable_party`/`accident_type`/`driver_name` being populated (a data-quality strip surfaces gaps).
- **Deliberate behaviour changes:** transient row-level approval locks in the Asset registry and Recall list were dropped when their drawers were removed — the authoritative lock now lives on each detail page; **RLS remains the real enforcement boundary** (consistent with prior audit notes).
- **Thin-page audit (next-session deepen targets):** `EngineeringKpi`, `StockManagement`, `Billing`, `ComplianceDashboard` flagged borderline; everything else audited is solid (400+ lines, real data, filters, states). Several converted detail pages duplicate small pure helper fns (per strict file-ownership) — optional later extraction to `src/lib/`.
- **Remaining modal-sweep item deferred:** none LARGE outstanding; the queue is closed. Any future create/edit modal that grows multiple sections should follow the same →page pattern.

---

## Session 14 (11 July 2026) — Brand & design-system pass: logo studio, illustration/icon system, copy cleanup

**Theme:** A complete visual-identity layer for the web app — a placeable logo library, a theme-aware SVG illustration + custom icon system, and the branding/theme fixes to make it all read correctly. Built via multiple swarms of general-purpose agents (disjoint file ownership, purely additive → conflict-free) plus hand integration. All merged to `main`.

**Gate:** web `vite build` ✅ zero errors · full suite **1685 tests green** · **V120 applied live** · every piece merged to `main` and pushed. Commit range `0237b66 → 5a4e426`.

### 1. Brand Logo Studio + logo library (V120 live)
- **21 curated Tyre Pulse logo variants** processed from source PNGs (flood-filled white→transparent preserving interior whites, auto-trimmed, downscaled, optimised): **`public/brand/library/*.png` (~1.3 MB total)** + generated manifest `src/lib/brand/library.generated.json`. Do NOT re-add the ~19 MB source zip.
- `src/lib/brand/library.js`: variants + **7 placement slots** (app_icon, login, favicon, report_cover, email_header, mobile_splash, pdf_watermark) + resolver `resolveBrandLogo(branding, slot)` (asset id | URL | /path → src) + a pre-auth localStorage cache (`tp.brandLogos.v1`).
- Admin UI **`BrandLogoStudio.jsx`** in **User Management → Branding** tab: pick org, pick slot, assign a variant or custom URL, live preview, save.
- **`MIGRATIONS_V120_BRAND_LOGO_PLACEMENTS.sql` — APPLIED LIVE.** Rewrites `set_org_branding` to validate + persist a `logos` map (helper `_clean_brand_logos`, 7-slot allow-list) and **preserve it when a caller omits the key** (the old fn full-replaced branding → would have wiped placements when the colour editor saved). Mirrors `report_cover` → legacy `logo_url`.

### 2. Enterprise illustration system (74 illustrations) + custom icon set (87 icons)
- **`src/components/illustrations/`**: `tokens.js` (palette → CSS vars, Light/Dark + tenant-brand aware), `primitives.jsx` (a11y/motion-safe `IllustrationBase` shell + `BrandDefs` gradients with per-instance `useId` namespacing), **glob auto-discovery registry** (`import.meta.glob('./**/*.illustration.jsx')` — no central index, add-a-file = registered), `_CONTRACT.md`. **74** across `state/ error/ module/ brand/ badge/ marker/ widget/ vehicle/ marketing/ report/`.
- **`src/components/icons/`**: `IconBase.jsx` (24×24, `currentColor` = theme-aware for free, stroke 1.75), glob registry, `TpIcon`, `_CONTRACT.md`. **87 domain icons** (tyre/wheel/axle/vehicle, fleet-ops/analytics/compliance, tyre-engineering/wear).
- Reusable consumers: `EmptyState` gained an `illustration=` prop; new `StateScreen.jsx` (full-page 404/500/offline/etc).
- **Brand Assets gallery** `src/pages/BrandAssets.jsx` — living styleguide at **`/brand-assets`** (Admin-gated: `RoleRoute allowed={['Admin']}` + `adminOnly` nav). Logos / Illustrations / Icons tabs, search + filters + click-to-copy; categories derive from the registry (auto-update).
- Wired: branded 404 (`NotFound.jsx`), `AppErrorBoundary` crash art, `OnboardingWizard` hero, illustration-backed empty states across ~15 pages, marketing heroes (Login/Billing), vehicle silhouettes (FleetMaster/AssetManagement/VehicleTyreDiagram via `vehicleArt()`), **19 branded sidebar nav icons**, fleet-map pins (`VehicleMap` markers), and `StatusBadge` in detail views (Vehicle360 / WorkOrders / GatePass / Inspections). Lottie/Rive from the spec deliberately skipped (need binary assets + deps).

### 3. Logo colour + theme fixes
- **Logos rendered black** because the transparent, navy-heavy marks sat on the dark app surface. Added a light `.checker` utility (index.css) used for every logo tile in the Studio + gallery → true colours always show.
- **`BrandIcon.jsx`**: default mark unchanged; a custom logo is framed on a white chip in the app chrome (legible on the green badge) but rendered transparent/blended on the **user login** (`chip={false}`) so it matches the dark page.
- **Console super-admin login** (`ConsoleLogin.jsx`): blended monochrome-white wordmark (`filter: brightness(0) invert(1)`, no chip) so it reads on the near-black console.
- Branded-login persistence: `clearCachedLogos()` keeps the public `login`/`favicon` slots on logout (drops org-scoped ones); Login reads the cached logo at render time. **Caveat:** needs one successful sign-in on a device first (branding is unknown pre-auth); true zero-touch per-tenant login needs subdomain/host resolution.

### 4. Copy cleanup — remove em/en dashes from user-facing text
- 5-agent swarm swept **83 files** (pages + components), replacing em/en dashes + spaced separator hyphens in visible copy with commas / colons / "to". **Preserved:** word-hyphens (real-time, multi-tenant, sign-in), code / classNames / i18n keys, comments/JSDoc, and the `—` "empty cell / no-data" placeholder glyphs. One label doubling as a compared value (`High Scrap, Review`) updated on both sides.

### 5. Executive Report declutter
- Removed the 4 decorative report illustrations (cover-hero, data-quality-seal, exec-summary-banner, section-divider) from `ExecutiveReport.jsx` — it's a formal print/PDF doc. **Rule:** branded art belongs in operational UI + detail views, NOT report/print layouts.

### Notes / follow-ups (owner action)
- **Brand it:** sign in as an **Admin** → `/users` → **Branding** tab (Logo Studio) to assign logos to slots; browse all assets at **`/brand-assets`**. Pick a **dark-legible** login logo (blue/coloured emblem) since the login logo now blends on the dark page.
- Not force-placed (available via `<Illustration name>` / `<TpIcon name>`, browsable in the gallery): most of the 87 icons, badge/marker/widget art, and several report graphics.

---

## Session 13 (11 July 2026) — Mobile checklist UX + reliability, Sentry monitoring, Anomalies restore + workshop-visit analytics

**Theme:** Mobile inspection-checklist fixes + crash monitoring ahead of the distributed APK, and a web Anomalies-page rebuild (rich engine restore + new workshop-visit analytics). Done in the main loop (no worktree agents except one general-purpose agent for the Anomalies rewrite).

**Gate:** web `vite build` ✅ zero errors · anomaly engine **74/74 tests green** · mobile `expo export --platform android` clean Hermes bundle · pushed to `main` (`…→ cb76128`). DB: removed one QA test account (no migration).

### 1. Mobile inspection checklist — UX + reliability (commit `bdfab93`)
- Site picker → searchable **dropdown** (grouped by country), replacing the chip grid.
- Tyre-pressure popup now **scrolls** on short/older screens (`flexShrink` + nested scroll) — fixes "can't go up/down on old phone".
- **Save is instant** — no longer blocks on a fresh GPS capture at submit (uses the fix already warmed on the tyre step).
- **False "1 file offline" fixed** — only a genuine no-signal save queues silently; a server rejection while online now surfaces a clear "saved on device, will retry" alert instead of a phantom stuck offline file (`expo-network` check in `handleSubmit`).
- **Wrong-asset guard** — manual asset entry warns when the typed code isn't in the site fleet, with a "did you mean X?" one-tap fix (catches PM↔MP transpositions — the "showed other vehicle" report).
- **`crypto` ReferenceError fixed** — `crypto.randomUUID()` threw on older Hermes runtimes and aborted submit *before* it could even queue offline (device-dependent "save works sometimes"); replaced with `mobile/lib/ids.ts` `safeUuid()`/`clientId()`. `apiClient.ts` already had a safe local variant.
- Tyreman ID + date confirmed already read-only/locked-to-today (no change needed). EN/AR/UR strings added.

### 2. Mobile crash/perf monitoring — Sentry (commit `162fb06`)
- `@sentry/react-native` 7.2.0 + Expo config plugin + `mobile/metro.config.js` (`getSentryExpoConfig`). **Env-driven DSN** (`EXPO_PUBLIC_SENTRY_DSN`) via `mobile/lib/sentry.ts`: inert without a DSN, reports only from release builds (`enabled: !__DEV__`), operator tagged on login/logout. React render errors report through the existing `ErrorBoundary` — **deliberately NOT `Sentry.wrap()` on the expo-router root `_layout`** (it detaches the `AuthProvider` tree → "useAuth must be used within AuthProvider").
- **Key hardening:** `eas.json` (all profiles) + `app.json` `extra` fallback switched from the **legacy JWT** anon key to the new `sb_publishable_…` key (matches `.env`; avoids breakage if Supabase disables legacy JWT auth).
- **Sentry is ACTIVE** using the shared `shah-profile / javascript-nextjs` project DSN (org policy `403` blocks creating a dedicated RN project via API). Mobile events tag `platform=react-native` + `environment`. **Follow-up:** create a dedicated RN project in the Sentry UI and swap the DSN in `eas.json` (×3) + `app.json`.

### 3. Web Anomalies page — restore rich detection + add workshop-visit analytics (commits `396fc36`, `cb76128`)
- **Regression fixed:** the page had been reduced to 3 flat buckets (cost/duplicate/missing-data) via a thin local deriver, leaving the tested `src/lib/anomalyEngine.js` unused. Rewired to `detectAnomalies()` → all **6 detectors** (Short Interval, Same-Day Burst, Rapid Recurrence, Cost Spike, Serial Reuse, Exact Duplicate) with severity + plain-English message + explanation + record drill-down; kept a supplementary **Data-Quality** group. Severity KPI cards + per-type filter chips.
- **Vehicle/serial/site search** restored (the old search-first drill-down).
- **Workshop-visit analytics (new):** `computeVisitStats()` + `detectVisitFrequency()` added to `anomalyEngine.js` (**additive** — existing exports untouched, so Vehicle History / AI Analytics unaffected). A **"Workshop Visits"** view toggle: KPIs (visits this week / month / total / busiest vehicle) + a sortable, exportable per-vehicle table (total · weekly · monthly · 90d · **peak/90d** · **rate/mo** · last visit · total cost). A "visit" = an asset at the shop on a day (tyre-change events **unioned with `work_orders`**, deduped). New **FREQUENT_VISITS** anomaly flags vehicles returning abnormally often (≥3 visits/90d = High, ≥4 lifetime = Medium). Built on real data (1,394 tyre events, 412 vehicles). Engine tests **+9 (74/74)**.

### 4. Data — QA test account removed
- Deleted the mobile QA account `qatyreman` (auth user + profile + identity) from live Supabase — a known-password backdoor with 0 records. Verified 0/0/0. No migration.

### Notes / follow-ups (owner action)
- **Sentry:** create a dedicated Sentry React Native project (org `shah-profile`) and swap its DSN into `eas.json` (×3) + `app.json` so mobile crashes don't share the web (`javascript-nextjs`) project.
- **APK:** build from `main` with the `production-apk` EAS profile → monitoring live from first install.
- **Emulator note (dev-only, not app):** this 16 GB Windows box can't run Android Studio + emulator + Metro together (RAM/ANRs); keep the AVD at ~2048 MB. A stale Metro cache once masqueraded as a login bug — fix is `expo start -c` after killing orphaned `node` processes. See memory `mobile_metro_stale_bundle`.

---

## Session 12 (11 July 2026) — Data Intake override, vehicle diagram in checklist report + fleet-side entry, MP concrete-pump layout

**Theme:** Targeted product fixes done directly in the main loop (no worktree agents — weekly agent limit), cherry-picked onto the latest `main` (which had advanced with Session 11's workflow engine) and verified together before push.

**Gate:** web build ✅ zero errors · **1665 tests green** · no migrations · pushed to `main` (`0237b66 → 1563974`). All three cherry-picks auto-merged with no conflicts despite `main` having edited `Inspections.jsx`/`FleetMaster.jsx`.

### 1. Data Intake — per-row approver override + precise duplicate/conflict
- `src/pages/DataIntakeCenter.jsx`: the review step now gives the approver the final say on **every** row via an inline Insert/Update/Skip/Reject selector, a bulk "set all" bar, a live action-plan tally, and keeps the global force-include / enrich toggles as batch defaults. `smartAction`/`effectiveAction`/`actionPlan` centralise the derivation so toggles, per-row overrides and staging always agree.
- `src/lib/import/validate.js`: `classifyDuplicates` rewritten per-row — first row of a key = keeper (`none`); an exact whole-row copy = `duplicate`; a same-key row that only adds complementary data = mergeable `duplicate`; only a real **conflict-field** disagreement escalates to `conflict`. New `rowFingerprint` export. Adapter dup-classification tests updated to the keeper+flag semantics.

### 2. Vehicle diagram — now in the checklist report + fleet-side checklist entry
- **Report fix (`src/pages/Inspections.jsx`):** the Daily Tyre Inspection Report was dropping the diagram — the exporter captured the on-screen form diagram, but once a checklist is saved that form is replaced by the saved-confirmation view (SVG `null` → table-only). Added an always-mounted **offscreen copy** of the same `VehicleTyreDiagram` (fed by the saved checklist's vehicle type + tyre conditions) and capture that as a fallback, so every report embeds the identical diagram.
- **Fleet-side entry:** first-class "Start Tyre Checklist" action deep-linking to `/inspections?asset=<assetNo>` (pre-loads the checklist with the same diagram) in three places — **LiveFleetStatus** vehicle drawer (primary action by the tyre-health map), **FleetMaster** row action, **Vehicle360** header. en/ar locale keys added.

### 3. Concrete pump (MP) — 3 single steer axles + 2 dual drive axles
- Renamed asset prefix **PM → MP** (diagram resolver + `inferVehicleTypeFromAsset`) and remodelled the axle layout: 3 single-tyre steer axles (F1/F2/F3) + 2 dual-tyre drive axles (R1/R2) = 14 tyres (was 1 steer + 3 dual-rear).
- Kept in lockstep: `VehicleTyreDiagram.jsx` LAYOUTS, `tyrePositions.js` `_LEGACY_BASE` (added `F3L→LHF3`,`F3R→RHF3`), `Inspections.jsx` `TYRE_POSITIONS['concrete pump']`, and the `exportUtils.js` PDF-fallback layout. Mobile diagram untouched (it resolves by axle-count, no type-named pump). Historical concrete-pump inspections keep their old IDs — expected when the axle model itself changes.

### Held OFF main (dev branch `claude/erp-sync-hub-roles-od8m1k`)
Two **table-standardization** commits were deliberately excluded from this merge per owner request ("keep tables hold"):
- `4d51d63` Standardize **SerialTracker** & **GatePass** tables onto EnterpriseTable.
- `e0a12ed` Standardize **ReportCenter** delivery-history table onto EnterpriseTable.
To release later: rebase these two onto current `main` — note `main` has since edited `GatePass.jsx` (workflow lock), so that commit will need a small conflict resolution.

### Follow-ups (owner action)
- Decide when to release the two held table commits (above).
- Broader raw-`<table>` → EnterpriseTable / chartjs → shared-echarts sweep remains paused (best run via the parallel workflow once the weekly agent limit resets).

---

## Session 11 (10 July 2026) — Reports engine, Universal Approval & Workflow Engine (LIVE), centralized access-control core

**Theme:** Built by many parallel worktree agents, integrated + verified together, committed to `main` incrementally. Three big tracks: (1) a state-faithful reports engine, (2) the Universal Approval & Workflow Engine — extended, applied live, and rolled out to 21 modules, (3) the centralized permission core + Master Access Control plan.

**Gate:** web build ✅ zero errors · **1664 tests green** · migrations V116–V119 applied+verified live · `workflow-notify` edge fn deployed · all pushed to `main`.

### 1. Reports engine (state-faithful PDF/Excel/CSV)
- `src/lib/report/tableReport.js` + `src/components/ui/ExportMenu.jsx` + `src/hooks/useReportMeta.js`: EnterpriseTable's export now matches the exact on-screen state (filters/search/multi-sort/visible columns/selection) across 3 modes (Current View / Filtered / Selected) × PDF/Excel/CSV, branded via tenant logo/colours. Wired into 12 table pages.
- **Optional server engine** scaffolded at `services/report-engine/` (Express + Playwright HTML→PDF, own Dockerfile/README, verified 57KB PDF). Dormant — the app uses it only if `VITE_REPORT_SERVICE_URL` is set (graceful client fallback). Needs a container host to deploy (Vercel serverless can't run Chromium). Spec: `pdf generator prompt.md`.

### 2. Universal Approval & Workflow Engine — **LIVE**
Extends the existing V97 engine. Full spec: `APPROVAL_WORKFLOW_ENGINE.md`.
- **DB (applied+verified live):** V116 (expanded step schema — roles, assignee role|user, per-step require_signature/photo/gps/comment, `condition{field,op,value}`, statuses `in_review`/`returned`), V117 (`workflow_act` approve|reject|**return** with **server-side** requirement enforcement + conditional auto-skip; dropped the V97 3-arg first, kept a compat wrapper), V117a (search_path hardening), V118 (`approval_dashboard()` RPC + `my_pending_approvals` by user), V119 (`workflow_notifications` queue + `consume_event_workflow_notify` + `deliver_workflow_notifications` pg_cron, mirrors V99 webhook pattern). `process_domain_events` dispatches consumers dynamically → notify fires automatically.
- **Edge fn deployed:** `workflow-notify` (verify_jwt=false; Email/Resend + Push/Expo + WhatsApp/Twilio, all env-gated). ⚠️ **Channels dormant until secrets set:** `WORKFLOW_NOTIFY_SECRET` (= seeded `cron_config.workflow_notify_secret`), `RESEND_API_KEY`/`FROM_EMAIL`, `TWILIO_*`. Push needs no key; WhatsApp also needs a phone source (`profiles` has none). See `docs/WORKFLOW_NOTIFICATIONS.md`.
- **Shared UI:** `src/components/workflow/{ApprovalStatusBadge,ApprovalAction,ApprovalTrail,EntityApprovalPanel}.jsx` + `src/hooks/useEntityWorkflow.js`. `WorkflowSettings` rebuilt as a drag-and-drop visual builder + 4 starter templates; `Approvals` rebuilt as the manager dashboard (buckets/SLA/avg-time).
- **Rolled out to 21 modules** (drop-in `<EntityApprovalPanel>` in each detail view + edits gated while under approval): Inspections, Accidents, WorkOrders, Procurement, Warranty, TyreExchange, TyreScrap, GatePass, Retread, AssetManagement, Stock, Maintenance, DriverManagement, Supplier, Fuel, Recalls, Rotation, WorkshopManagement, KnowledgeBase(document), ScheduledReports(report_publish), InspectionPlanner(pm_service).
- **Made functional:** seeded **21 default approval chains live** (org-NULL) — the engine had 0 definitions and was inert. Uses roles real users hold (inspector/manager/director; admin overrides) with reference-flow conditions/signatures/SLAs. Customizable in `/workflow-settings`. Reversible: `delete from workflow_definitions where organisation_id is null`.

### 3. Centralized access control (additive, NOT wired yet)
- `src/lib/permissions/{registry,engine}.js` + `src/hooks/useCan.js` + `src/components/permissions/Can.jsx`: one `module.resource.action` deny-by-default engine (14 actions × 22 modules, 18 role templates, tenant/location scope, 41 tests).
- `MASTER_ACCESS_CONTROL_PLAN.md`: maps the **FOUR** existing permission editors (PermissionMatrix, AccessControlMatrix tab in UserManagement, console ConsolePermissions [raw upsert, per-org — real conflict], static table) into one model. **Confirmation-gated** — old editors NOT retired; 3 "Uncertain" items need sign-off before any removal.

### Follow-ups (owner action)
- Set the notification secrets to activate email/push/WhatsApp.
- Decide on Master Access Control consolidation (retire the 4 editors) — needs sign-off on the Uncertain items.
- ~3 niche modules unwired (GRN≈Procurement, tyre returns/transfers≈TyreExchange, vehicle handover≈GatePass). Phase 5 = mobile act/sign + signature block in module PDFs.

---

## Session 10 (10 July 2026) — EnterpriseTable migration: raw HTML tables → reusable component + charts

**Theme:** Systematically migrate all raw `<table>` elements across the app's pages to the reusable `EnterpriseTable` component (built on @tanstack/react-table v8), adding charts where missing. This standardises sorting, filtering, search, pagination, and export across all data-heavy pages.

**Gate after this session:** web build ✅ (zero errors, 3961 modules transformed) · mobile untouched · all changes merged to `main` and pushed.

### Pages migrated (11 of 13)

| Page | Tables Converted | Charts Added/Preserved |
|------|-----------------|----------------------|
| **AiCostMonitor** | AI log table → EnterpriseTable | — |
| **BrandPerformance** | Brand ranking table → EnterpriseTable | — |
| **Billing** | Invoice history → EnterpriseTable | — |
| **Comparison** | Period comparison table → EnterpriseTable | — |
| **Anomalies** | Anomaly detail tables → EnterpriseTable | — |
| **CountryComparison** | Multi-country metrics → EnterpriseTable | Bar chart added |
| **Analytics** | Site metrics + Brand metrics → EnterpriseTable | Monthly trend bar chart added |
| **Budgets** | Monthly budget table → EnterpriseTable | **New: Budget vs Spend bar chart** |
| **BudgetPlanner** | Brand analysis table → EnterpriseTable | Existing charts preserved (Bar, Line, Doughnut) |
| **AuditTrail** | Audit log + Upload history → EnterpriseTable | — |
| **Accidents** | Main incidents table + Bulk preview → EnterpriseTable | Existing charts preserved (monthly, severity, claims) |

### Key features delivered
- **Sorting** enabled on all EnterpriseTable instances
- **Global search** on Analytics, Accidents, Budgets tables
- **CSV export** on Analytics tables
- **Row selection** with checkboxes on Accidents (Admin bulk delete preserved)
- **Inline editing** preserved on Budgets status dropdown
- **Budget vs Spend bar chart** added to Budgets page
- **Monthly trend bar chart** added to Analytics page
- All existing Chart.js charts preserved (Bar, Line, Doughnut)
- Expandable row detail on AuditTrail (field-level before/after diff)
- Admin-only Delete Batch button on AuditTrail upload history

### Remaining (2 complex pages — deferred)
- **AdvancedAnalytics** (1903 lines) — 8 tables including 2 CSS-based heatmaps. Heatmaps use cell-level background coloring that EnterpriseTable doesn't natively support; needs custom cell renderer approach.
- **DataIntakeCenter** (1024 lines) — 5+ tables in a multi-step wizard with dynamic columns per module. Each step (upload → map → validate → approve) has different table structures.

### Commits (Session 10)
```
9238cd6 chore: remove build output from git, add to gitignore
4c02805 feat: migrate Accidents main table + bulk preview to EnterpriseTable
017a360 feat: migrate BudgetPlanner brand analysis table to EnterpriseTable
05673f9 feat: migrate AuditTrail to EnterpriseTable
10aec2a push
198dbaf feat: migrate Analytics to EnterpriseTable
196ae04 feat: migrate CountryComparison to EnterpriseTable
bcc2f2d feat: migrate AiCostMonitor, BrandPerformance, Billing, Comparison, Anomalies to EnterpriseTable
```

---

## Session 9 (7 July 2026) — Enterprise automation platform (roadmap priorities 20 → 1)

**Theme:** implement the `Improvements road map.md` enterprise roadmap **bottom-up (priority #20 → #1)** on a feature branch (PR #26). During the work, a **parallel roadmap implementation + UI redesign was merged to `main`** (the owner's local tranche: event bus, embedded AI copilot, Report/Dashboard Builder, Executive TV display, field-level audit, Sentry, TanStack Table + RHF/Zod, ECharts, ERP sync, System/Security/Tenant-Health, Permission Matrix). PR #26 was therefore **reconciled onto the new `main`**: main stays authoritative for everything it already has (incl. the redesign), and only this branch's **genuinely-unique, non-duplicated** pieces were grafted on. Migrations renumbered to sit after main's V95 (VEHICLE_PHOTO_GPS / ERP_CONNECTIONS).

**Gate after reconcile:** web build ✅ · **1338 web tests** ✅ (hermetic — passes with zero env vars) · mobile untouched. All new SQL validated end-to-end on a local Postgres 16 harness (triggers → outbox → consumers → workflows/rules/webhooks/deliveries → display snapshot).

### KEPT — unique backend, migrations V96–V103 (⚠️ authored, NOT yet applied live)
- **V96 Event-Driven Architecture** — `domain_events` transactional outbox, exception-safe emit triggers on 9 core tables, `event_consumers` registry, per-minute `process_domain_events()` cron with at-least-once retry. (Distinct, deeper backend than main's client-side event bus.)
- **V97 Approval Workflow Engine** — `workflow_definitions` (validated steps jsonb) → durable `workflow_instances` with step snapshots, role-gated `workflow_act`/`start_workflow`/`my_pending_approvals` RPCs, event auto-start, hourly SLA escalation. **(main had no workflow engine.)**
- **V98 RAG auto-embed** — `knowledge_documents` chunking columns + `embed-worker` edge function (cron auto-embedding of NULL-embedding rows).
- **V99 API Platform + Webhooks** — `api_keys` (sha256-at-rest, per-minute rate limit via `api_key_authenticate`), `public-api` edge function (read-only REST, org-scoped, column allowlists), `webhook_subscriptions`/`webhook_deliveries` (HMAC-SHA256 signed, backoff, auto-disable, pg_net delivery + reconciliation).
- **V100 Business Rules Engine** — `business_rules` (event trigger, conditions/actions jsonb, loop-safe `rule.*` emission), `rule_executions` audit, event-consumer evaluator, hourly `evaluate_alert_thresholds()` that **finally evaluates the legacy `alert_thresholds` server-side**. **(main had no rules engine.)**
- **V101 AI copilot memory** — `ai_conversations`/`ai_messages` (owner-private RLS) backing the `ai-orchestrator` edge function (Anthropic tool-use loop: digest, RAG, counts, events).
- **V102 Audit triggers + builder tables** — generic exception-safe row-change audit triggers → `audit_log_v2` across 16 tables; `user_dashboards`/`report_definitions` tables (main's builders keep their own storage — these tables sit available/unused).
- **V103 Executive TV Display tokens** — `display_tokens` + anon-reachable, token-gated `get_display_snapshot(token,password)` returning **aggregate KPIs only** (no raw rows/PII), per the V55 anon lockdown.

### KEPT — edge functions (NOT yet deployed) + frontend + service
- Edge functions: `public-api` (`--no-verify-jwt`, API-key auth), `embed-worker` (`--no-verify-jwt`, cron-secret gated), `ai-orchestrator` (JWT-verified).
- New pages (Automation nav group, wired into main's App.jsx/Layout.jsx): **Event Stream, Approvals, Approval Workflows, Automation Rules, API & Webhooks** + `src/lib/api/{domainEvents,workflows,businessRules,integrations}.js`, `src/lib/aiOrchestratorClient.js`, chunked KB indexing added to `embeddingService.js`.
- `services/analytics/` — Python **FastAPI** microservice (tyre-life prediction, cost/demand forecast, anomaly detection), 63 pytest tests, Dockerfile. Deploy independently; browser must never hold the service key.

### DROPPED in reconcile (main's equivalents kept, to avoid duplication/redesign regression)
- This branch's DashboardBuilder, ReportBuilder, `src/lib/monitoring/`, `src/components/charts/`, `src/lib/validation/` schemas, `src/components/ui/form/`, `src/components/ui/DataTable.jsx`, and their tests — **superseded by main's** builders / `monitoring.js` / charts / validation / `components/forms/` / EnterpriseTable.

### CI note
- Fixed a pre-existing CI failure: `vitest run` had no Supabase env, so tests importing `src/lib/supabase.js` (e.g. `uploadMapping.test.js`) threw `supabaseUrl is required`. Added dummy public vars to `vite.config.js` `test.env` → suite is hermetic.

### Deployment follow-up (REQUIRED before the new Automation pages work in prod)
Apply **V96→V103** and deploy the three edge functions per `docs/AUTOMATION_PLATFORM_DEPLOYMENT.md`. Until then the new Automation pages error (they're `Safe`-wrapped + lazy, so the rest of the app is unaffected). Docs: `AUTOMATION_PLATFORM_DEPLOYMENT.md`, `ROADMAP_STATUS_2026-07-07.md`.

---

## Session 8 (4 July 2026) — Offline update commands, service-layer migration, cross-file merge

**Theme:** work the genuine open backlog from the gap/security registers (owner-credential and frozen Go/Kotlin items excluded), keeping the gate green throughout. Multi-agent, disjoint directories, integrated + verified centrally.

**Gate after this session:** web build ✅ · **875 web tests** ✅ · mobile typecheck 0 errors ✅.

### Session 8 (continued) — security waves, multi-agent audit, Import Center depth
- **V74/V75** (perf) — FK covering indexes + drop duplicate index (applied live); RLS `auth_rls_initplan` wrapping (**V75 file present, NOT yet applied live** — perf-only, behaviour-preserving, includes the V70 policy; safe to apply).
- **V76/V77 Import Center country isolation** — commit gate (`import_commit_batch` rejects cross-country) + read gate (RESTRICTIVE country SELECT on `import_batches`/`import_files`/`import_rows`). `import_user_can_commit_country` / `import_batch_country` helpers. Preserves the NULL-country admin (sees all). Verified by rolled-back probes.
- **V78** — dropped the fabricated `tyre_records.cost_per_tyre` DEFAULT 1200 (missing cost → NULL → engines render 0).
- **Multi-agent audit (5 agents, every finding schema-verified — many false positives rejected):** search-filter injection sanitizer (`src/lib/searchFilter.js`, 9 `.or()` sites + country value); `corrective_actions.source` broken insert (Inspection Intelligence reported false success) fixed; country isolation added to FleetIntelligence/WorkshopManagement/VendorIntelligence; ÷0/Infinity guards (analyticsEngine, FuelEfficiency). Verified backlog logged in `CHANGELOG_ENGINEERING.md`.
- **Import Center depth (owner-requested):**
  - **Saved Mappings manager** (`src/components/intake/MappingProfilesManager.jsx`, on the Upload step) — browse every saved mapping grouped by module, expand to see its source→target column rules, Rename/Activate/Delete/Apply. Fixes "I can't see my columns" (mappings were only a mid-upload dropdown). New `imports.js`: `listAllProfiles/renameProfile/setProfileActive/deleteProfile`.
  - **"Stage & continue → failed to fetch" FIXED** — `stageRows` POSTed 500 rows × 4 JSONB at once → oversized body dropped by the gateway (left 4 zero-row `staged` batches live). Now size-bounded chunks (≤100 rows / ≤~1.2 MB) + network retry + clear error.
  - **Auto-remember format** — staging a new file auto-saves its mapping profile (by header fingerprint) so the next upload of the same file auto-maps (recognition already existed; auto-save half was missing).
  - **Force-include** (elevated) — a Validate-step toggle to commit validation-error rows anyway; genuinely un-insertable rows still fail safely per-row.
  - **Cross-file enrichment — DONE (V79).** "Enrich existing records" (elevated toggle on the Validate step) completes an existing live record from a LATER file: `import_natural_key` (all modules) matches the live record by natural key, `import_enrich_batch` fills ONLY its blank columns via `jsonb_populate_record` — never overwrites, org+country scoped, audited. Client sets `action='update'` on live-duplicate rows when enabled and calls `enrichBatch` after `commitBatch`; result shows "N existing record(s) enriched". Off by default. Sandbox-verified (fill model, preserve make/site).
  - **Intake "Stage & continue → failed to fetch" FIXED + auto-remember + Saved Mappings manager + force-include** — see the intake commits; large files now stage in size-bounded chunks with retry, new formats auto-save their mapping, and there's a Saved Mappings panel (browse/expand columns/rename/delete) on the Upload step.

### Session 8 (final) — audit-backlog completion, auth, headers, mobile idempotency
- **Multi-agent audit fixes (all schema-verified; false positives rejected):** search-filter injection sanitizer (`src/lib/searchFilter.js`, 9 `.or()` sites + country); `corrective_actions.source` broken insert fixed; ÷0/Infinity guards (analyticsEngine, FuelEfficiency); **8 loader fetch-race guards** (TyreRecords, TyreExchange, DowntimeTracker, FleetHealthBoard, DriverManagement, EngineeringKpi, FleetAnalytics, VehicleHistory) — try/finally + request-id/`cancelled` guards; **localStorage-in-updater** moved to effects (Alerts ×3, Anomalies ×1); country isolation on FleetIntelligence/WorkshopManagement/VendorIntelligence.
- **V80** — dropped redundant `kpi_targets` UNIQUE(metric) (Settings KPI-target save would 23505 at year rollover).
- **React perf** — memoized `Auth`/`Settings`/`Tenant` context values + callbacks (stops app-wide re-renders).
- **Mobile idempotency (V81)** — `client_uuid` (text) + UNIQUE index on tyre_records/work_orders/rca_records/corrective_actions/inspections; both offline queues now upsert-on-conflict-ignore, save-per-item, and share a global sync mutex; the online inspection path shares the client id. No more duplicate records on crash/lost-response/overlapping sync.
- **Mobile hardening** — `admin/approvals.tsx` arbitrary-table write replaced with an `upload_type→table` allow-list; `history.tsx` gained an error/retry state.
- **No-email signup (V82)** — accounts are created with **username + Employee ID + password, no email**. Client mints a synthetic `<slug>@users.tyrepulse.app`; `auto_confirm_synthetic_email()` BEFORE-INSERT trigger confirms it; `handle_new_user()` now copies `employee_id`+`email` from metadata; unique indexes on `lower(username)`/`lower(employee_id)`. `approved=false` (admin approval unchanged). `get_email_by_identifier` resolves login. `src/pages/Login.jsx` drops the email field. (An earlier `supabase/functions/signup` edge-function approach was removed — deploy is approval-gated in headless; the trigger approach needs no deploy.)
- **CSP header** added to `vercel.json` — non-breaking (inline preserved), `connect-src` locked to self + `*.supabase.co`, `object-src none`, `frame-ancestors none`. All other security headers (HSTS, X-Frame-Options DENY, nosniff, Referrer/Permissions-Policy) were already present. ⚠️ Verify the live site loads after deploy; revert the CSP line if anything breaks.
- **Large imports (2k+ rows) FIXED (V83)** — the `authenticated` role caps statements at 8s and a batch commits in one row-by-row RPC, so 2k+ rows were killed mid-commit. Raised `statement_timeout` to 120s on `import_commit_batch` / `import_enrich_batch` / `import_reverse_batch` (SECURITY DEFINER → scoped to the function). Staging was already size-chunked; no client row cap (stripFooterRows only trims sparse footers). 50k+ files may later want a chunked commit.
- **Mobile is Google-free** — removed the dead `google-services.json` reference from `mobile/app.json` (FCM/push unused; only local notifications, which need no Google). Auth is username/Employee-ID (no Google Sign-In). Install by sideloading the `preview` APK (`eas build -p android --profile preview`) — no Play Store / Google account.
- **Gate throughout:** 875 web tests · web build · mobile typecheck 0 errors. **Only V75 (perf RLS initplan) remains an unapplied migration file** (behaviour-preserving; safe to apply).

### Mobile — offline-safe UPDATE commands (closes P3 mobile-offline gap; partial R3/R12)
- Three screens issued **direct Supabase UPDATE writes** that were lost offline and could double-apply on retry: `stock.tsx` (quantity adjust), `work-orders.tsx` (WO status), `workorders/index.tsx` (corrective-action status).
- Extended the typed `recordQueue` (the only place a table name may appear on the client) to support **UPDATE-by-id** commands: `CommandSpec` gained `op: 'insert'|'update'` (default insert) + `matchField` (default `id`); the match column is used in `.eq()` and excluded from the SET so the PK is never rewritten. Added `STOCK_ADJUST`, `WORK_ORDER_STATUS`, `CORRECTIVE_ACTION_STATUS` with schema-verified field allow-lists.
- All three screens now enqueue typed commands: immediate write when online, offline enqueue + auto-flush on reconnect (same `useNetworkSync`/`syncRecordQueue` path), optimistic local state so the change stays visible while queued. Idempotent by design — callers send **absolute** values (computed quantity / target status), so a replayed queued update yields the same result.

### Web — service-layer migration of the top-3 inline-Supabase pages (P3 platform debt)
- Pure refactor (no behavior change): `Dashboard.jsx` (14 inline calls), `DataCleaning.jsx` (22), `UploadData.jsx` (14) now go through new `src/lib/api/` modules `dashboard.js` / `dataCleaning.js` / `uploads.js`. Per-page country-scoping style preserved exactly (null-safe OR for Dashboard, strict `.eq` for DataCleaning). +46 api unit tests.
- **Latent bug found, intentionally not fixed** (to keep the refactor pure): `DataCleaning.loadPending` reads `count` without requesting `{ count: 'exact' }`, so `totalPending` stays 0 and the pending-tab pager never shows. Tracked for a follow-up behavior fix. **→ FIXED (Session 9):** `listPendingRecords` now selects with `{ count: 'exact' }`; `totalPending` populates and the pager renders. +2 unit tests (877 total).

### Import — cross-file merge library (cost file wins) — P3
- New `src/lib/import/mergeCrossFile.js` (`mergeCrossFileRows`, `COST_FIELDS`), exported + **9 unit tests**: same natural key across files → one merged record; the cost-bearing row wins on conflict; blanks enriched from the other file; cost fields never back-filled; line-item aggregation preserved.
- **Deliberately NOT wired client-side.** Traced the batch model: `DataIntakeCenter.runValidation` processes **one sheet at a time**; cross-file rows accumulate server-side across separate `stageRows` passes. A client-side merge (a) would not see cross-file data and (b) would wrongly collapse same-key **lifecycle events** (e.g. a tyre serial re-appearing) that `classifyDuplicates` must preserve. Correct integration is server-side in `import_commit_batch` (a live-DB migration) — deferred rather than applied blind to the production database that emails real tenants. Library is the ready building block for that step.

### Import — server-side cross-file merge, LIVE (V72; closes the deferred half)
- `MIGRATIONS_V72_IMPORT_CROSS_FILE_MERGE.sql` redefines `import_commit_batch` with a pre-insert MERGE: staged rows sharing a module natural key across files collapse to one record, the **cost-of-record row wins**, blanks enrich from other contributors, cost fields never back-fill, line-items roll up without double-counting. **Gated to cost modules only** — `workorder` / `accident` / `warranty` — with `tyre`/`fleet`/`stock`/`inspection`/`gatepass`/`supplier`/`driver` provably identical to V60 (empty plan + vacuous `id <> ALL('{}')`). Adds a `merged` counter to the return/audit payload; preserves auth/org-scope/idempotency/generated-col exclusion/per-row error isolation.
- **Applied live** after a validate-first protocol: full migration + self-asserting test run in a rolled-back transaction (workorder 2→1 cost-wins+enriched; tyre 2 events NOT merged), then applied, then re-verified against the now-live function. Previous V60 definition captured for rollback. This is the server-side counterpart to the client `mergeCrossFile.js` shipped earlier in the session.

### Mobile — GPS tagging on inspections, LIVE columns (V73)
- `expo-location ~19.0.8` (SDK-54 pin from `bundledNativeModules.json`). New `mobile/lib/location.ts` captures a bounded foreground fix on the inspection submit path; a translated status chip (capturing / captured / unavailable + retry) shows state. GPS folds into **both** the online insert and the offline-queued payload, so a queued inspection syncs the same geotag. Graceful degradation — denied/timeout submits with NULL GPS, never blocks the inspection. app.json declares the plugin + Android/iOS permissions. i18n EN/AR/UR.
- `MIGRATIONS_V73_INSPECTION_GPS.sql` adds `gps_lat/gps_lng/gps_accuracy/gps_captured_at` + a partial index to `inspections`, **applied live**. ⚠️ `expo-location` is a native module — it functions only after the next **EAS rebuild** (on merge to `main`), not via OTA JS.

### Docs
- Reconciled stale mobile version facts across the doc set (was SDK 53 / RN 0.79 → actually **SDK 54 / RN 0.81.5**) and refreshed `MOBILE_STATUS.md` (photo upload, push, auto-sync, RBAC, typed `user` were already done in prior sessions but still listed as missing).

---

## Session 7 (4 July 2026) — Security hardening, data-race fixes, branch consolidation

**Theme:** an in-depth security/data/React audit → fix the confirmed-safe findings, then consolidate the branch clutter onto `main`.

### Security (all live, gated: 730 tests + build green)
- **V70 `profiles_org_isolation`** — the only SELECT policy on `profiles` was `auth.role()='authenticated'`, so any signed-in user could read **every** org's profiles (names, roles, org, emp codes). Added a RESTRICTIVE gate (`id=auth.uid()` OR `app_is_org_admin()` OR `org_id=app_current_org()`). Helpers are SECURITY DEFINER (no RLS recursion); `app_current_org()` reads `profiles.org_id` (verified). Proven with a rolled-back two-tenant probe (org-A user sees only self; no org-B/admin leak).
- **V71 `report_org_tyre_spend` + `send-scheduled-reports` scoping** — the cron digest counted tyre_records/work_orders/corrective_actions/accidents and summed spend across **all** organisations with the service role → org A emailed org B's numbers. Now scoped by `schedule.org_id`; edge function redeployed **v2** (verify_jwt preserved).
- **Daily Ops print XSS** — `printBriefing()` interpolated DB fields into `document.write` HTML → now HTML-escaped + severity class whitelisted.
- **`useRealtimeAlerts.markAllRead`** — RPCs were fired inside the state updater (StrictMode double-fires) → moved outside.
- **Verified safe:** impersonating `anon`, all sensitive tables return **0 rows** (RLS holds despite default table grants). `get_advisors(security)` → **0 errors**.

### Data-race hardening
- **`StockManagement.load()`** — a thrown fetch left the spinner stuck forever with no message → wrapped in try/catch/finally (surfaces via the existing error banner).
- **`FleetMaster.loadRecords()`** — fired a query per search keystroke with no ordering guarantee → added a 300ms debounced search term + a monotonic request-id guard (only the newest response applies) + `setLoading` in finally.

### Branch consolidation
- Verified (dry-run merges + `--merged`) that **all** feature/session branches' work is already in `main`; documented in `docs/BRANCH_CONSOLIDATION_2026-07-04.md` with recovery SHAs. Local branches pruned to the 4 protected.
- ⚠️ **Remote branch deletion is still pending** — this session's git credential returns **403** on `git push --delete` (can push commits, cannot delete refs; no GitHub MCP delete tool). **Next dev / owner:** delete the 24 listed branches via the GitHub UI (Branches page) or an authenticated terminal — command is in `docs/BRANCH_CONSOLIDATION_2026-07-04.md`.

### Still open / needs the owner
- Set the **`RESEND_API_KEY`** edge-function secret so scheduled digests actually send.
- Fill each org's branding in **User Management → Branding**.
- **Deferred (need a decision):** `get_email_by_identifier` login enumeration (inherent to email/username login UX); a strict **CSP header** in `vercel.json` (risky to add blind against the live app); ~30 low-value unmount cancellation guards (cosmetic warnings, not correctness bugs).

---

## Session 6 - Fixing the data/AI section: production schema drift, CORS, approvals, UI crashes

**Root theme:** most "X is not working" reports traced to the **live Supabase/edge state having drifted from the code**, not client bugs. Always verify the live DB/edge config (information_schema, pg_policies, pg_proc, edge logs), not just the migration files.

### Knowledge Base / RAG - was never provisioned in prod (FIXED)
- Live `knowledge_documents` had drifted: **no pgvector, no embedding column, old `source_type` schema, no `match_knowledge_documents()`** → every KB upload 400'd, table stayed empty.
- **`MIGRATIONS_V51_KNOWLEDGE_BASE_RAG.sql` (applied live):** enable pgvector, rebuild `knowledge_documents` to the code contract (`doc_type` CHECK sop/manual/policy/inspection/rca/vendor/other, `asset_no`, `tags text[]`, `embedding vector(1536)`, org/created_by defaults), ivfflat cosine index, RLS (select=true / write Admin+Manager), and the `match_knowledge_documents(query_embedding, match_count, filter_doc_type, filter_site)` RPC. Table was empty → non-destructive.

### Edge CORS - blocked ALL AI on the vercel.app site (FIXED)
- `supabase/functions/_shared/auth.ts` only allowed `tyrepulse.app` + localhost. The app is tested on `tyre-pulse-peach.vercel.app`, so the browser CORS-blocked every `chat-ai` / `generate-embedding` POST after preflight (edge logs: OPTIONS 200, no POST). This - not a missing OpenAI key - kept KB un-indexed, the chatbot dead, and `ai_token_logs` empty.
- Fix: allow any `^https://[a-z0-9-]+\.vercel\.app$` origin (prod alias + rotating previews) plus the existing list; `ALLOWED_ORIGINS` env override still wins. Safe because functions still require a valid approved-user JWT.
- **Redeployed live: `chat-ai` v5 (verify_jwt=false), `generate-embedding` v4 (verify_jwt=true).**

### Upload/Approvals - unified the two disconnected pipelines
- There were **two pipelines** that didn't share data: Data Intake (`import_batches`/`import_rows`) and legacy Upload (`pending_uploads`). Each history/approval view read only one → the other always looked empty (the "not linked" symptom).
- **`UploadApprovals.jsx`** now defaults to a **"Data Intake" tab** over `import_batches WHERE approval_status='pending_approval'`: **Approve & Commit** via the secure `import_commit_batch` RPC (fixes non-admin orphaned submissions **and** the client-side insert 400 on generated cols/CHECK enums), **Reject**, and a read-only staged-rows preview. Legacy `pending_uploads` kept as a secondary tab + added **Delete** action + console error logging (errors no longer swallowed into empty lists).
- **`DataIntakeCenter.jsx` Recent imports** now has an Actions column: **Open** (→ history), **Delete** (staged/abandoned - cascades to rows/sheets/attachments), **Reverse** (committed - removes the live rows too).
- New service fns in `src/lib/api/imports.js`: `listForApproval()`, `rejectBatch()`, `deleteBatch()`.

### UI crash + swallowed-error fixes
- **React error #130 crash** on KnowledgeBase and AiCostMonitor: both passed a JSX *element* to `PageHeader icon=` (which renders `<Icon/>`). Fixed to component reference (`icon={BookOpen}` / `icon={DollarSign}`). Every other page already used the component-ref form.
- **Legacy "Preview" did nothing:** `UploadData.buildPreview()` had no try/catch and only advanced the step on its last line - any failure killed the click silently. Now wrapped, surfaces the error.

### Still open / needs the user
- **OPENAI_API_KEY / ANTHROPIC_API_KEY**: user says OpenAI key already set; verify with `supabase secrets list --project-ref jhssdmeruxtrlqnwfksc`. With CORS fixed, KB indexing + chat + AI Cost Monitor population should now work after a hard-refresh.
- **Data Intake staging stall** (`total_rows=0`): proven NOT a schema/RLS/CHECK block - the wizard's `stageRows` was never completed for the two abandoned batches. Needs a live upload with a real file to capture the exact failing step (Console now logs; watch the `import_rows` POST in Network). The two stuck `staged 0/0` batches can now be removed with the new Delete button.
- Untracked, intentionally not committed: `QA_DATA_INTAKE_REPORT.md`, `QA_REPORT.md`, `mobile/ui_screenshot.png`.

---

## Session 5 - RAG/AI tooling, AI cost logging, and the complete Multi-Country Data Intake Center

### Web - new modules (all wired into router + nav, build-clean)
- **Knowledge Base** (`/knowledge-base`, `src/pages/KnowledgeBase.jsx`) - RAG document ingestion: drag-drop upload, 1500/200 chunking, per-chunk embedding via the `generate-embedding` edge function, `knowledge_documents` storage, status/search/filter/re-index, RBAC-gated writes.
- **AI Cost Monitor** (`/ai-cost-monitor`, `src/pages/AiCostMonitor.jsx`) - reads `ai_token_logs`; KPI cards, daily SVG sparkline, feature/site spend breakdown, raw log table, date/feature/model filters. Uses inline SVG/CSS (no chart lib - project has no recharts).
- **Scheduled Reports** - `report_schedules` table created (V44) to back the pre-existing `ScheduledReports.jsx`.

### Edge functions - AI token logging (deployed live)
- `chat-ai` (v4, verify_jwt=false / custom auth) and `generate-embedding` (v3) now fire-and-forget insert into `ai_token_logs` with computed `cost_usd`, fully isolated from the response path. Model logged as base id (`claude-haiku-4-5`) to match the dashboard rate table.

### DB migrations (V42-V50, all applied live)
- **V42** vehicle_fleet RLS split · **V43** `profiles.push_token` (+index) · **V44** `report_schedules` + `ai_token_logs` (trigger fn auto-detect: this DB uses `set_updated_at()`, NOT `update_updated_at_column()`) · **V45/V46** import staging schema + commit/reverse/reprocess RPCs (prior session) · **V47** live-dedup `import_existing_keys` · **V48** accident dedup branch · **V49** inspection/workorder/warranty/gatepass branches · **V50** `suppliers` + `drivers` master tables + supplier/driver dedup branches.

### Mobile - push notifications
- `lib/notifications.ts` (channels, permission, Expo push-token registration to `profiles.push_token`, sync success/failure + daily inspection reminder), wired into `_layout.tsx` boot + `profile.tsx` settings + `offlineQueue.ts` sync. `app.json` plugin + permissions added.

### Mobile - Play Store prep
- `mobile/PLAY_STORE_SUBMISSION.md` runbook; `eas.json` `serviceAccountKeyPath` fixed; secrets gitignored. **Exact-alarm policy declaration** flagged as a likely Play rejection cause.

### Data Intake Center - `Data correction.md` COMPLETE for all live-target modules
Built across phases (see `docs/IMPORT_CENTER_MIGRATION_PLAN.md`). The shared engine (`src/lib/import/*`: parseWorkbook, mapping, transform, validate, synonyms, attachments, reconcile) + `src/pages/DataIntakeCenter.jsx` wizard now handle **10 modules**, each: upload → map (EN/Arabic) → transform → validate → in-batch **+ live-table** dedup → approve → audited commit (`import_commit_batch`) → reconcile / reverse.
- **Phase 2** - Fleet / Tyre / Stock + live-table dedup (V47) + reconciliation report.
- **Phase 3** - Accidents/Insurance: financial-integrity validation, ZIP **evidence-package ingestion** (`attachments.js`, jszip → private `import-files` bucket → `import_attachment_matches`, matched by claim/police/asset).
- **Phase 4** - Inspections / Work Orders / Warranty / Gate Pass (V49).
- **Master tables (V50)** - `suppliers` + `drivers` created (org/country-scoped, RLS like vehicle_fleet) and wired as live adapters.
- Each legacy uploader (FleetMaster, UploadData, StockManagement, Accidents, Inspections, WorkOrders, WarrantyTracker, GatePass, SupplierManagement, DriverManagement) now opens the engine via `/data-intake?module=<key>`.
- **Module → table:** fleet→vehicle_fleet, tyre→tyre_records, stock→stock_records, accident→accidents, inspection→inspections, workorder→work_orders, warranty→warranty_claims, gatepass→gate_passes, supplier→suppliers, driver→drivers.
- **Natural keys** (mirror client `validate.js` keyParts → server `import_existing_keys`, joined with `chr(1)`): fleet=country+asset_no; tyre=country+serial_no; stock=country+site+description; accident=country+claim_no/police_report_no; inspection=country+asset_no+type+date+inspector; workorder=country+work_order_no; warranty=country+serial_number+claim_no; gatepass=country+asset_no+pass_date; supplier=country+code/name; driver=country+driver_id.
- **Staging-only by design:** GPS/ERP + custom (source-defined / preserved in custom_data + Custom Field Catalogue - no fixed target table).

### Known gaps / not done
- **Mobile Play Store submission** needs external artifacts only you can supply: Firebase `google-services.json`, Play service-account key, `notification-icon.png`, store-listing copy + screenshots.
- **No real-device mobile QA** pass run this session.
- **Go-backend migration** (`Roadmap_latest.Md`) deliberately untouched.
- Minor: overlapping `vehicle_fleet` RLS policies (old `vf_*` + new V42) worth consolidating; `package.json`/`app.json` mobile version drift (cosmetic, EAS-managed).

---

## Session 4 - Photo Upload Fix, Secure Storage & RLS Hardening

### Mobile - Photo upload bug fixed (photos were silently failing)
- **Root cause:** `TyreEditor.tsx` used `fetch(localUri).blob()` to read captured photos before uploading. In React Native / Expo, `fetch().blob()` on a `file://` URI yields an **empty blob** - photos appeared to upload but Supabase received 0 bytes.
- Fixed: switched to `FileSystem.readAsStringAsync(localUri, { encoding: 'base64' })` → decode to `Uint8Array` → upload bytes directly. This matches the approach already in `photoUpload.ts` (offline queue path) which was working correctly.
- Both the **immediate upload** path (TyreEditor, online inspection) and the **offline queue** path (`offlineQueue.ts` → `uploadAllPositionPhotos`) now use the same reliable FileSystem base64 method.

### Mobile - Photo bucket alignment
- `photoUpload.ts:uploadInspectionPhoto` was targeting bucket `inspection-photos` which **does not exist** in the Supabase storage setup (only `tyre-photos` is provisioned in MASTER_MIGRATION.sql).
- Fixed: changed to `tyre-photos` with organized path prefix `inspections/{id}/{pos}_{ts}.{ext}` - consistent with TyreEditor's `photos/` prefix and accident photos' `accidents/` prefix, all in the same public bucket.

### Mobile - Chunked SecureStore adapter
- `mobile/lib/secureStorage.ts`: new chunked adapter for `expo-secure-store` handling auth tokens that exceed the **2 KB iOS Keychain item limit**. Supabase access+refresh token pairs routinely exceed 2 KB on accounts with large metadata. The adapter transparently splits values into 1800-char chunks with a metadata key.
- Wired into `supabase.ts` as the `auth.storage` provider - replaces the old bare `SecureStore` adapter.

### DB - vehicle_fleet RLS hardened (MIGRATIONS_V42)
- `MIGRATIONS_V42_VEHICLE_FLEET_RLS.sql` + updated `MASTER_MIGRATION.sql`:
  - Extended SELECT policy to `anon` role (required for registration/site-lookup flows that run before auth completes).
  - Split the old catch-all `vehicle_fleet_write` policy into three explicit `vehicle_fleet_insert / _update / _delete` policies with `auth.uid() IS NOT NULL` guards.

### Storage policy note
The `tyre-photos` bucket is **public** (set in MASTER_MIGRATION.sql). All tyre, inspection, and accident photos are served via public URLs - no signed-URL round-trip required on read. The `storageRefs.ts` `resolveStorageUrl` function handles both the `tp-storage://` internal reference format (→ signed URL) and bare `https://` public URLs transparently.

---

## Session 3 - Stabilization, Scanner & Whole-Project Audit

### Mobile - EAS build fixed (was failing "Gradle build failed with unknown error")
- **Root cause:** `expo` was pinned to `~54.0.0` while the entire tree was Expo **SDK 53** (RN 0.79, React 19.0.0). SDK 54 needs RN 0.81 - a binary mismatch. Earlier New-Arch/NDK/Kotlin commits were treating symptoms.
- Pinned `expo` to `~53.0.0` (53.0.27) and aligned every native module to its SDK 53 canonical version (RN 0.79.6, react-native-screens ~4.11.1, react-native-safe-area-context 5.4.0, gesture-handler ~2.24.0, expo-build-properties ~0.14.8, expo-router ~5.1.11, ...).
- Added explicit **`expo-asset`** dependency - it was nested under `node_modules/expo/` and Metro couldn't resolve it, breaking the JS bundle phase.
- CI now uses `npm ci` (was `npm install --legacy-peer-deps`, which masked the mismatch) + npm caching.
- **Result:** full EAS Android build goes green end-to-end and auto-triggers on merge to `main`.

### Mobile - functional fixes
- **Sign-in routing:** login only navigated after an unrelated re-render (e.g. language change). Added a reactive guard in `(auth)/_layout.tsx` → redirects to `/(app)` the moment the user is authenticated.
- **Inspection flow aligned to the REAL DB schema** (was silently broken): vehicle list was empty because the app queried `asset_number` (real column is **`asset_no`**); submit/history used `inspector_name`/`inspector_id`/`odometer`/`status:'submitted'`/`inspection_type:'Daily Checklist'` which don't exist / violate check constraints. Now uses `asset_no`, `inspector`, `created_by`, `scheduled_date` (NOT NULL), `status:'Done'`, `inspection_type:'Routine'`, odometer folded into `notes`. History/home filter on `created_by`.
- **RLS:** the `inspections` INSERT policy only allowed Reporter/Manager/Admin - the `Tyre Man` (inspector) role was blocked. Added `Tyre Man`, `Inspector`, `Director`.
- **Startup hang fixed:** auth no longer blocks on the profile query (resolves from local session, profile loads in background); font gate has a 3 s timeout fallback.
- **Icons fixed:** Ionicons font preloaded in RootLayout (glyphs were rendering blank).
- **Role badge** now localizes (snake_case key normalization).

### Mobile - new feature: Tyre/Asset Scanner
- `mobile/app/(app)/scanner.tsx` - `expo-camera` `CameraView` reads tyre serial barcodes / asset QR; resolves a code to a **vehicle** (→ start inspection with site+asset preselected) or a **tyre record** (brand/size/position/asset details); torch, permission, rescan states; full EN/AR/UR.
- Home screen has a **"Scan Tyre / Asset"** entry; registered as a hidden route (no extra tab).

### Mobile - History completed to product standard
- Live search (title/asset/site), status filter chips with counts, distinct empty vs no-results states.

### Web - Inspections/Checklist crash + data linkage
- **Crash fixed:** the Checklist page threw a temporal-dead-zone `ReferenceError` (a `useEffect` referenced `masterSites` in its deps before the `useState` was declared). A full TDZ scan of `src/` found no others.
- **Broken data sources linked (no demo data):** created DB **views** `public.vehicles → vehicle_fleet` and `public.tyre_changes → tyre_records` (`security_invoker`), and a real **`public.alerts`** table (indexes + RLS). Fixed `inspections` queries that used non-existent columns (`inspector_name`/`tread_depth`/`pressure_reading` → `inspector` + `tyre_conditions`); removed a non-existent `status` column from the global tyre search.
- **Performance:** added indexes on `tyre_records` (asset_no, issue_date, site, serial_number), `vehicle_fleet` (site, asset_no), `inspections` (created_by, inspection_date, site).

### Audit summary
Mobile: tsc clean, bundle clean, i18n parity en/ar/ur (0 gaps), all routes/buttons/queries valid, RLS + login RPC verified. Web: build + 369/369 tests pass, all referenced tables/columns now resolve against the live DB.

---


## Session 1 - Web Platform (Previously Documented)

### What Was Done
1. Multi-Identifier Login (Email / Username / Employee ID)
2. RBAC tightened - Intelligence (Admin only), Analytics (Admin + Manager + Director)
3. 30-minute session timeout with touch event tracking
4. Admin approval gate (`approved: false` on signup)
5. Inspection Checklist full overhaul - dropdown inputs, auto-title, SVG PDF
6. Vehicle Diagram - case-insensitive, position IDs consistent
7. PageHeader applied to all 73 pages
8. Build errors fixed (orphan divs, missing icons)

Full detail in the previous HANDOFF section below ↓

---

## Session 2 - Mobile App (React Native + Expo SDK 54)

### What Was Built

A complete React Native mobile inspector app - **TyrePulse Inspector** - targeting the Tyre Man / Inspector role workflow. Built with Expo SDK 54 + React Native 0.79.2.

#### Screens

| Screen | Route | Description |
|--------|-------|-------------|
| Login | `/(auth)/login` | Supabase auth, language selector (EN/AR/UR), error states |
| Home | `/(app)/index` | Greeting, pending sync count, quick-start inspection, **Scan Tyre/Asset**, recent history |
| New Inspection | `/(app)/inspection/new` | Multi-step: vehicle details → tyre position cards → submit (accepts `?asset=` deep-link from scanner) |
| Scanner | `/(app)/scanner` | Camera barcode/QR scanner → vehicle or tyre lookup (hidden route) |
| History | `/(app)/history` | Inspections with search + status filters + sync badges (synced/pending/failed) |
| Profile | `/(app)/profile` | User info, language toggle, offline queue stats, sign out |

#### Core Features

**Authentication**
- Supabase JWT stored in `expo-secure-store` (not AsyncStorage)
- Profile fetched from `profiles` table on login
- AuthContext wraps entire app via `app/_layout.tsx`

**Offline-First Inspection Queue**
- File: `mobile/lib/offlineQueue.ts`
- Storage key: `tp_inspection_queue_v1` (AsyncStorage)
- Each queued item: `{ id, payload, sync_status, created_at, retry_count }`
- `sync_status`: `'pending' | 'synced' | 'failed'`
- `syncQueue()` - pushes pending items to Supabase `inspections` table
- `retryFailed()` - re-queues failed items
- `getPendingCount()` - returns count for SyncBanner

**Tyre Position Cards**
- Component: `mobile/components/TyrePositionCard.tsx`
- Supports all vehicle positions: FL, FR, RL, RR, RLO, RLI, RRO, RRI + numbered variants
- Position badge shows code + translated label (e.g. `FL` + `أمامي أيسر`)
- Fields per tyre: serial number, pressure (bar), tread depth (mm), condition, photo, notes
- Condition: Good / Worn / Damaged / Flat / Missing
- Photo: `expo-camera` + `expo-image-picker`

**Network Monitoring**
- `SyncBanner` uses `addNetworkStateListener` from `expo-network` (NOT `@react-native-community/netinfo` - removed due to Gradle incompatibility with AGP 8.x)
- Banner shows: offline status | pending count + sync button | hidden when online + synced

**i18n - Arabic + Urdu + English**
- Context: `mobile/contexts/LanguageContext.tsx`
- Locales: `mobile/locales/en.json`, `ar.json`, `ur.json` (~130 strings each)
- `t('namespace.key')` - dot-notation resolver
- `isRTL` flag - controls text alignment and flex direction
- Language switch → `I18nManager.forceRTL()` → `Updates.reloadAsync()` (full app reload to apply RTL)
- Persisted in AsyncStorage under `tp_language`
- Language selector: Login screen (before auth) + Profile screen (after auth)

---

### Mobile File Structure

```
mobile/
├── app/
│   ├── _layout.tsx              - Root layout: SafeAreaProvider > LanguageProvider > AuthProvider
│   ├── (auth)/
│   │   └── login.tsx            - Login screen with language toggle
│   └── (app)/
│       ├── _layout.tsx          - Tab navigator (Home / Inspect / History / Profile)
│       ├── index.tsx            - Home screen
│       ├── history.tsx          - Inspection history
│       ├── profile.tsx          - Profile + language + sign out
│       └── inspection/
│           └── new.tsx          - New inspection multi-step form
├── components/
│   ├── TyrePositionCard.tsx     - Per-tyre data entry card
│   └── SyncBanner.tsx           - Offline/sync status banner
├── contexts/
│   ├── AuthContext.tsx          - Supabase auth state
│   └── LanguageContext.tsx      - i18n + RTL
├── lib/
│   ├── supabase.ts              - Supabase client (expo-secure-store adapter)
│   └── offlineQueue.ts          - AsyncStorage inspection queue
├── locales/
│   ├── en.json                  - English strings
│   ├── ar.json                  - Arabic strings (MSA, RTL)
│   └── ur.json                  - Urdu strings (RTL)
├── app.json                     - Expo config + EAS project ID
├── eas.json                     - EAS build profiles (dev/preview/production)
└── package.json                 - Dependencies
```

---

### Mobile Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.79.6 |
| Expo SDK | 53.0.27 |
| Router | expo-router v5 |
| Auth storage | expo-secure-store |
| Offline queue | AsyncStorage (`@react-native-async-storage/async-storage` 2.1.2) |
| Network | expo-network 7.1.5 (`addNetworkStateListener`) |
| Camera | expo-camera 16.1 + expo-image-picker 16.1 |
| Icons | @expo/vector-icons (Ionicons) |
| i18n | Custom LanguageContext (no external library) |
| Build | EAS Build (cloud) via GitHub Actions |
| CI/CD | `.github/workflows/build-android.yml` |

---

### EAS Build Configuration

**`mobile/eas.json`** - Supabase env vars baked into all profiles:
```json
{
  "preview": {
    "distribution": "internal",
    "android": { "buildType": "apk" },
    "env": {
      "EXPO_PUBLIC_SUPABASE_URL": "https://jhssdmeruxtrlqnwfksc.supabase.co",
      "EXPO_PUBLIC_SUPABASE_ANON_KEY": "eyJ..."
    }
  }
}
```

**GitHub Actions** - `.github/workflows/build-android.yml`
- Triggers on push to `main` (paths: `mobile/**`) or `workflow_dispatch`
- Uses `EXPO_TOKEN` secret (already added to repo)
- Runs `eas build --platform android --profile preview --non-interactive`
- APK available at expo.dev after successful build

---

### Build Troubleshooting History

The EAS Gradle build has been failing. All fixes applied in order:

| # | Commit | Fix | Root Cause |
|---|--------|-----|-----------|
| 1 | `4e92755` | `expo-build-properties` added to package.json | Was in app.json plugins but missing from dependencies - broke `expo config` |
| 2 | `6b79a34` | Kotlin → `2.0.21` (was `1.9.25`) | RN 0.79.2 requires Kotlin 2.0.x |
| 3 | `4ddcf1a` | TypeScript fix in LanguageContext | `reduce` return type + expo-updates missing locally |
| 4 | `1f3a46e` | Replace `@react-native-community/netinfo` with `expo-network`; add SDK 35 config | netinfo's `build.gradle` uses old `compileOptions` incompatible with AGP 8.x; compileSdkVersion/targetSdkVersion/buildToolsVersion needed |
| 5 | `ea24776` | `"newArchEnabled": false`; `ndkVersion: "27.1.12297006"` | RN 0.79 defaults New Architecture ON - requires NDK 27 C++ compilation that fails silently on EAS workers |

| 6 | (Session 3) | Pin `expo` to `~53.0.0`; align whole native tree to SDK 53; add explicit `expo-asset`; `npm ci` in CI | **Real root cause** - `expo` was on SDK 54 while everything else was SDK 53 (binary mismatch). Fixes #1-5 were symptom-patches. |

**Current status:** ✅ **Resolved.** Full EAS Android build is green end-to-end and auto-builds on push to `main`. The New-Arch/NDK/Kotlin tweaks (#2,#5) remain as valid SDK 53 defaults.

---

### Supabase Tables Used by Mobile

| Table | Usage |
|-------|-------|
| `auth.users` | Login / sign out via `supabase.auth.signInWithPassword` |
| `profiles` | `id`, `username`, `full_name`, `employee_id`, `role`, `site`, `country`, `approved` |
| `vehicle_fleet` | Site/vehicle pickers + scanner lookup - columns `asset_no`, `site`, `vehicle_type`, `make`, `model` |
| `inspections` | Write inspection records - `title`, `site`, **`asset_no`**, `vehicle_type`, **`inspector`** (text), **`created_by`** (uuid), `inspection_date`, **`scheduled_date`** (NOT NULL), `inspection_type` ('Routine'), `tyre_conditions` JSONB, `notes`, `status` ('Done'). No `odometer` column - folded into `notes`. |
| `tyre_records` | Scanner tyre lookup by serial - `serial_no`/`serial_number`/`tyre_serial`, `brand`, `size`, `position`, `asset_no`, `tread_depth`, `pressure_reading` |
| RPC `get_email_by_identifier` | Resolves username / Employee ID → email pre-auth (SECURITY DEFINER, anon-executable) |

**RLS note:** Mobile uses the anon key. The `inspections` INSERT policy allows roles `Reporter, Manager, Admin, Director, Tyre Man, Inspector` (the inspector role was added in Session 3). `vehicle_fleet`, `tyre_records`, and `profiles` SELECT are open to any authenticated user.

---

## Previous Session - Web Platform Detail

### 1. Multi-Identifier Login
- Login accepts Email, Username, or Employee ID
- `AuthContext.signIn()` resolves username/employee_id → email via `profiles` table + `get_user_email_by_id` RPC

### 2. RBAC
- Intelligence (40+ pages) - Admin only
- Analytics (7 pages) - Admin + Manager + Director
- `shouldShowGroup()` in `Layout.jsx` hides nav group; `<RoleRoute>` guards routes

### 3. 30-Minute Session Timeout
- 30-min idle timeout, 30-s check interval
- Touch events tracked (`touchstart`)

### 4. Admin Approval Gate
- New signups: `approved: false`
- `ProtectedRoute` blocks unapproved profiles

### 5-9. Checklist, Vehicle Diagram, PageHeader, Build Fixes
See ROADMAP.md for full status.

---

## Required Supabase SQL (Run Once)

> **Note (Session 3):** The live `inspections` schema uses `asset_no`, `inspector` (text), `created_by` (uuid), `scheduled_date` (NOT NULL) and check constraints on `status` / `inspection_type` - the mobile app and web Checklist write to these. Username login uses the `get_email_by_identifier` RPC. Session-3 also added: views `vehicles`/`tyre_changes`, the `alerts` table, performance indexes, and the inspector INSERT policy (already applied to the live DB). The block below is the original Session-1/2 reference.


```sql
-- Inspection columns
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS tyre_conditions jsonb;
CREATE INDEX IF NOT EXISTS idx_inspections_tyre_conditions ON inspections USING gin(tyre_conditions);
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS vehicle_type text;
CREATE INDEX IF NOT EXISTS idx_inspections_vehicle_type ON inspections (vehicle_type);

-- Multi-identifier login
CREATE OR REPLACE FUNCTION get_user_email_by_id(user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = user_id;
  RETURN v_email;
END;
$$;
GRANT EXECUTE ON FUNCTION get_user_email_by_id(uuid) TO authenticated;
CREATE INDEX IF NOT EXISTS profiles_employee_id_idx ON profiles (employee_id);
CREATE INDEX IF NOT EXISTS profiles_username_idx ON profiles (username);

-- RLS for mobile inspection insert
CREATE POLICY IF NOT EXISTS "Inspector can insert own inspections"
ON inspections FOR INSERT
TO authenticated
WITH CHECK (inspector_id = auth.uid());
```

---

## Architecture Reference

### Auth & RBAC (Web)

| Role | Intelligence | Analytics | Operations | Admin |
|------|-------------|-----------|------------|-------|
| Admin | ✅ | ✅ | ✅ | ✅ |
| Manager | ❌ | ✅ | ✅ | ❌ |
| Director | ❌ | ✅ | ✅ | ❌ |
| Tyre Man | ❌ | ❌ | ✅ | ❌ |
| Inspector | ❌ | ❌ | Inspections + Settings only | ❌ |
| Reporter | ❌ | ❌ | ✅ | ❌ |

### Session (Web)
```
Idle timeout:    30 minutes
Check interval:  30 seconds
Events tracked:  mousemove, keydown, click, touchstart
Storage key:     tp_last_activity (localStorage)
```

---

## Key Libraries

| File | Purpose |
|------|---------|
| `mobile/lib/offlineQueue.ts` | AsyncStorage inspection queue + sync |
| `mobile/lib/supabase.ts` | Supabase client with SecureStore session |
| `mobile/contexts/LanguageContext.tsx` | i18n + RTL management |
| `mobile/contexts/AuthContext.tsx` | Supabase auth + profile state |
| `src/lib/kpiEngine.js` | 18 KPI computations (web) |
| `src/lib/ragService.js` | RAG retrieval + 5-min cache (web) |
| `src/lib/aiRouter.js` | Query classification → agent routing (web) |

---

## Supabase Edge Functions

| Function | Input | Purpose |
|----------|-------|---------|
| `chat-ai` | `{ system, user, model }` | Anthropic API proxy |
| `generate-embedding` | `{ text, model }` | OpenAI embeddings proxy |
| `send-email` | `{ to, subject, body }` | Resend API email |

Env vars: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`

---

## Next Session Priorities

### Mobile (Immediate)
1. ✅ EAS build green (SDK 53) - install the latest `main` APK from expo.dev (`@ws123na/tyrepulse-inspector` → Builds)
2. Device test - login, inspection submit, scanner, offline sync (all wired to live schema)

### Mobile (Next Sprint)
3. ✅ Photo uploads to Supabase Storage - fixed in Session 4 (FileSystem base64 path, correct bucket)
4. ✅ Barcode/QR scanner - delivered (`app/(app)/scanner.tsx`)
5. ✅ Push notifications - delivered in Session 5 (`lib/notifications.ts`, profile settings, daily reminders)
6. Play Store submission prep - `eas.json` production profile ready; need `google-services.json` + signing key + store listing assets

### Web (Done)
7. ✅ RAG document ingestion - `KnowledgeBase.jsx` at `/knowledge-base` (file upload + chunking + embedding)
8. ✅ AI cost monitor - `AiCostMonitor.jsx` at `/ai-cost-monitor` (token logs + spend breakdown)
9. ✅ Scheduled reports DB - `MIGRATIONS_V44` adds `report_schedules` table backing `ScheduledReports.jsx`

### Web / Data Intake Center (Done - Session 5)
10. ✅ Multi-Country Data Intake Center complete for all 10 live-target modules (`Data correction.md`) - see Session 5 above + `docs/IMPORT_CENTER_MIGRATION_PLAN.md`
11. ✅ AI token logging deployed to `chat-ai` (v4) + `generate-embedding` (v3) edge functions
12. ✅ All migrations V42-V50 applied to live Supabase

### Remaining
- **Play Store submission:** Add `google-services.json` (Firebase console, for push) + signing key (EAS managed credentials), submit the **exact-alarm policy declaration** in Play Console (see `mobile/PLAY_STORE_SUBMISSION.md`), then `eas build`/`eas submit -p android --profile production` from `mobile/`. Needs your Expo/Play credentials.
- **Mobile device QA:** run a real-device pass - login, inspection submit, scanner, offline sync, push.
- **GPS/ERP + custom import adapters:** staging-only by design (no fixed target table). Promote only if/when a target schema is defined.
- **Go-backend migration** (`Roadmap_latest.Md`): not started - deliberately out of scope.
- Minor: consolidate overlapping `vehicle_fleet` RLS policies; align mobile `package.json`/`app.json` version.

---

*TyrePulse v6.0 · Readymix Concrete Company · Shahzeb Rahman © 2026*
