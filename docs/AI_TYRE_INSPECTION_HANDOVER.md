# AI Tyre Inspection — Next Agent Handover

Updated 2026-10-22. Branch `main`. Supabase project `jhssdmeruxtrlqnwfksc`.

## Verified, implemented and deployed

- Flutter position-linked photo references (`tyre_conditions[position].photo_url`) recognized in the database auto-queue, edge function, and web evidence view.
- Automatic abnormal-tyre evidence queue; authenticated manual full-position screening including photos of healthy tyres; historical backfill; five-minute scheduler.
- Claude Haiku model integration with Gemini as optional fallback; visual findings cannot certify mm tread depth without physical measurements; supervisor review operations exist.
- Worker Edge Function **version 17 ACTIVE**, uploaded 2026-10-22. Mainline changes committed.
- **No automatic paid retry** of an attempted photo. Previously attempted pending jobs are marked failed for manual review instead of calling the model again. Bad model JSON becomes a failed job requiring manual investigation.
- **On malformed Claude output with usage metadata**, worker now records tokens, model, cost estimate, reason and failed status in `ai_tyre_inspection_jobs` and `ai_token_logs`. Token data is recorded before JSON validation, so the provider charge is not lost.
- AI Cost Monitor's report engine and page now include known paid failed requests in estimated spend and token totals and display the charged-failure amount. Unpriced failures remain unknown, not assumed free.
- Conservative estimated USD ceiling (`AI_DAILY_LIMIT_USD`, default $1/day). This is *not* a hard provider billing cap; concurrent work and unknown/missing-usage failures can exceed it. Anthropic costs may differ from estimated price rules.

## Last live state

Database check immediately after deployment: **14 completed**, **22 pending**, **36 total**; completed-job estimated cost **$0.012204**. At that instant no `ai_token_logs` entries were returned for `feature='ai_tyre_inspection'`. Do **not** claim the new failed-charge logging works end to end until a controlled malformed-output test succeeds. Jobs produced before v17 may have consumed unmetered tokens. Do not infer provider-billed totals from these estimates.

## Pending — highest priority

1. **P0: Real photograph validation is not done.** Authorized supervisor needs to inspect a set of actual private storage photo originals against AI results, annotate correct/missed/false-positive damage and evaluate image clarity. A structured AI result alone is **not** proof of inspection quality. Record expert adjudication and never auto-certify safety.
2. **P0: Verify failed-charge metering live** after an actual malformed response. Check `ai_tyre_inspection_jobs` for failed job with non-null tokens/cost and `ai_token_logs` for matching `ai_tyre_inspection` row. Ensure failed requests without usage are labelled *unknown*, not zero.
3. **P0: Verify cron calls remain HTTP 200**, stalled processing locks, and that pending jobs are drained with spending ceiling intact. Ensure no second paid retry for a failed job.
4. **P0: Test tenant/role security**, supervisor accept/reject and existing Inspection PDF report output against authoritative backend readings. The preview is not a separate production PDF endpoint.
5. **P1: Validate deployment** for `app.tyrepulse.app`, `www.tyrepulse.app/ai-cost-monitor` redirect and runtime rendering; check actual browser console for blank/dark UI and Vercel latest build.
6. **P1: Add automated integration tests** of malformed provider outputs, token usage logging, spending ceiling, manual review, failed-cost aggregation, and no-repeat inference. Existing unit tests alone do not prove deployed functioning.
7. **P1: Consider accounting of ALL provider attempts**, including non-JSON provider errors and timeouts; some provider failures may be billed even when usage is unavailable. Use an atomic concurrency-safe budget reservation if a true hard limit is needed.

## Technical paths

- `supabase/functions/ai-tyre-inspection/index.ts`: edge auth, provider calls, queue/worker, retry guard, failed response metering.
- `src/lib/api/aiOps.js`: unified `ai_token_logs` reader.
- `src/lib/aiCostMonitorAnalytics.js`, `src/pages/AiCostMonitor.jsx`: known charged failures included in dashboard/report.
- `src/pages/AiTyreInspection.jsx`, `src/lib/aiTyreInspectionDomain.js`, `src/lib/api/aiTyreInspection.js`: visual inspection, tyre-photo linkage, physical readings, role review.
- `src/lib/aiTyreInspectionReport.js`, `src/lib/exportUtils.js`, `src/pages/Inspections.jsx`: report composition.

## Safe read-only checks

```sql
select status,count(*) as jobs,sum(coalesce(cost_usd,0)) as estimated_usd
from public.ai_tyre_inspection_jobs group by status order by status;
select status,count(*) from public.ai_token_logs
where feature='ai_tyre_inspection' group by status;
select id,inspection_id,tyre_position,review_status,
       input_tokens,output_tokens,cost_usd
from public.ai_tyre_inspection_jobs
where status='completed' order by updated_at desc limit 8;
```

Preserve user secrets; do not reveal keys in reports. **Distinguish committed / deployed / tested / operational**. Update this handover after each substantive deployment. Avoid many small PRs; keep approved code on main once verified.
\n
## 2026-10-22 follow-up: live output verification (do not claim independent image validation)

- Live queue: **17 completed, 1 failed, 18 pending** (36 total).
- `ai_token_logs` has **1 error record** for `feature='ai_tyre_inspection'`: failed-call logging is now exercised, but invoice reconciliation remains outstanding.
- Examined the stored analysis JSON of five recent completed position-linked jobs. All include human-review-required flags and numeric depth remains null. Findings are generally described as **uncertain**, with repeated comments about blurred/angled views, dust, residue and missing sidewall coverage.
- Inspected examples from positions R2Li, R1Lo, R2Ro and R2Lo in the database, including photo storage references and AI finding structures. **No original photo pixels were inspected**: current Supabase integration can query records but cannot fetch private Storage image bytes. Therefore accuracy versus image, false-positive rate and missed-dangerous-defect rate remain **NOT VALIDATED**. Do not auto-approve any findings.
- Next authorized reviewer must open each original tyre photo in the web AI Inspection screen and compare with associated defect text; record matching/contradicted/uncertain assessments and requests for retake, then test PDF and costs. Priority: first five completed findings and at least five photos with no detected defects. Require expert adjudication before production acceptance.

## 2026-10-22 — Canonical tyre map and Excel export

- Updated `src/pages/AiTyreInspection.jsx` at commit `1a4bdc07`: screen now displays canonical tyre-position codes through shared `displayPositionCode(inspectionTypeHint(inspection), slot)` from `src/lib/tyreBay.js`; e.g. `F1L` becomes `LHF1` on supported vehicle maps. The underlying `tyre_conditions` and job tyre position keys remain unchanged to preserve photo/readings linkage. Unknown vehicle types retain raw slot ids rather than guessing a map.
- Added **Download full AI inspection Excel** per selected vehicle/inspection. Includes vehicle, site/location, date, inspector, inspection ID, canonical and internal position, condition, linked photo count/refs, AI status, review state, assessability, defect text/evidence/severity, recommendation, model, estimated model cost, verified physical depth and remaining tread values. Unknown depth remains blank.
- **Verification still required:** Vercel latest web build completion, actual Excel generated with 12 slots and correct labels for truck mixer layout, position captions against actual vehicle diagram, and reviewer comparison to real photo pixels. Do not mark browser/rendering verified yet.

## 2026-10-22 — Expanded AI Inspection register filters

Commits `49d1412c`, `c0f8f013` on `main` added combinations of vehicle/site search, site dropdown, tyre condition, inspection status, inspection date-from/to, existing photo/measurement categories, AI job status (not requested/pending/processing/completed/failed) and supervisor review status (unreviewed/accepted/rejected/corrected), with clear all and matching-count feedback. AI job status is loaded through existing tenant-RLS-bound `readInspectionAnalysis` in batches of <=100 inspection IDs. No new back-end schema was introduced.

**Pending verification:** actual Vercel build/render; manually cross-check all filters, loading states and the latest 200-inspection limit. Date and filtering apply to the 200 most recently loaded inspections, not an unbounded historical server search. Review-status filter is inspection-level (any matching job); one inspection may have multiple distinct review statuses. Consider server-side pagination/date query for a global history search in a later iteration.

## 2026-10-22 — Sajid access, concise review & learning feedback
- Confirmed account: **Sajid**, username `Skambih`, role **Tyre Data Collector**, approved, not locked, web access enabled, same organisation. Role already has `inspections` module permission. Layout sidebar previously had `adminOnly` on the AI inspection entry, so Sajid could not see the link. Commit `132786ca` changed it to explicit permitted roles including **Tyre Data Collector**. No admin role or cross-tenant grant was issued; the route remains protected by `ModuleRoute moduleKey='inspections'`.
- Commit `099afcc5`: converted the long capture guide and manager-only historical backfill into collapsed optional sections; added human review quality summary (accepted/rejected/unreviewed), reviewer reason textarea, and persisted review note with the decision. These reasons are durable supervised feedback for *future evaluation*, not automatic online model weight updates.
- Existing detailed **Download full AI inspection Excel** per vehicle remains available. No new separate reporting dashboard was created.
- **Pending**: browser login as Sajid to confirm actual RLS read; role-specific UI hiding of actions the Edge Function refuses; test reviewer decisions and Excel export; live Vercel build checks; aggregate feedback outcomes for prompt evaluation and expert-confirmed training dataset. Do not claim continuous learning or autonomous model retraining until that controlled evaluation pipeline exists.

## 2026-10-23 — Hardening pass (branch `feature/ai-inspection-hardening-20261022`): code-done vs still needs live validation

**Nothing below has been applied to the live database, deployed as an edge function, or exercised in a browser or with real photos.** Distinguish *committed in the branch* from *deployed* from *validated*.

### Code-done and covered by automated tests (committed in branch only)

| Handover item | What changed | Evidence |
|---|---|---|
| P1-6 automated tests: malformed provider output, token/cost logging, unknown-vs-zero cost, spending ceiling, no second paid retry, failed-cost aggregation, tenant/role refusal | Worker job logic extracted to `supabase/functions/ai-tyre-inspection/logic.ts` (pure, no Deno globals) so it is testable; `index.ts` wires real Supabase/provider dependencies. | `src/test/aiTyreWorker.test.js` (28 tests, injected fakes), `src/test/aiCostMonitorAnalytics.test.js` (failed-cost aggregation, unknown-cost failures), `logic.ts` passes `tsc --strict` |
| P1-7 account for ALL provider attempts incl. non-JSON errors and timeouts | Each attempt is recorded before the request (`provider_attempts`, `provider_called_at`). Timeout, HTTP error, non-JSON body and malformed output all become `failed` jobs with `failure_kind`, an `ai_token_logs` error row, and a budget settlement. When usage is not returned the cost stays **NULL (unknown), never 0**, and the budget is charged the reservation. | worker tests above |
| P1-7 atomic concurrency-safe daily budget | Migration `20261023090000_ai_tyre_budget_reservation_and_feedback.sql` (NOT APPLIED): `ai_tyre_daily_budget`, `ai_tyre_reserve_budget` (conditional UPDATE under the day row lock; one reservation per job), `ai_tyre_settle_budget` (exactly once), `ai_tyre_fail_stale_processing` (stalled locks fail for manual review, never retry). Service-role only. The worker **fails closed**: no reservation, no paid call. | `supabase/tests/ai_tyre_budget_reservation.test.mjs` runs the real migration in PGlite (5 tests). PGlite is single-connection, so true multi-connection contention is **not** proven; see live checks. |
| P1 UI matches backend role gates | `src/lib/aiTyreInspectionRoles.js` mirrors the edge-function role lists (parity test fails on drift). Queue/screen buttons are disabled, review controls and the historic-backfill section are hidden, and a notice explains read-only access. Tyre Data Collector (Sajid-style) can open the page and read results but cannot queue, review or backfill. | `aiTyreWorker.test.js` (role matrix, parity), `aiTyreReviewFeedback.test.js` (page wiring scan) |
| Server-side date/site query + pagination for the register | `listInspectionsForAiRegister` (in `src/lib/api/inspections.js`): date range, site, status and vehicle/site text are applied in the database with an exact total and 50-row pages (stable `inspection_date desc, id` order). The fixed latest-200 window is gone. Site list comes from `reference_site_options`. | `aiTyreReviewFeedback.test.js` |
| Reviewer-feedback aggregate | RPC `get_ai_tyre_review_feedback(from,to)` (SECURITY INVOKER, supervisor roles, tenant scoped by existing RLS) plus an "evaluation data" panel with Excel download. Counts accepted/rejected/corrected per model and prompt version (worker now stamps `prompt_version = tyre-photo-v2 (v1 before the plain-text output rule)`). Rates are of reviewed findings and show N/A when nothing was reviewed. **Labelled evaluation data only; nothing is trained, tuned or fed back automatically.** | PGlite test + `aiTyreReviewFeedback.test.js` |

### Behaviour changes to be aware of
- The daily ceiling is now a **reservation** (`AI_RESERVE_USD_PER_CALL`, default $0.01 per call, `AI_DAILY_LIMIT_USD` default $1/day, UTC day, global not per tenant). A job that cannot reserve is returned to `pending` un-attempted and the run stops. An actual cost above the reservation is still booked, so the limit is "effectively hard for the worker", not a provider-side billing cap. Unknown-usage attempts are booked at the reservation amount.
- Stalled `processing` jobs (>15 min) are failed for manual review at the start of each worker run because the provider may already have been billed.
- Register filters for photos, measured positions, tyre condition, AI job status and review status still apply to the loaded 50-row page only (they depend on per-position JSON or job rows).
- Role comparison in the edge function is now case-insensitive for every action (lists unchanged). `PMV Manager` may backfill but not queue or review, as before.
- `Failed model calls with unknown cost` is a separate notice in AI Cost Monitor; those calls are not counted as free and not guessed.

### Deploy order (when the owner approves)
1. Review and apply the migration (`database-migration-safety`; pre-flight is in the file header, rollback included).
2. Deploy the edge function (`index.ts` + `logic.ts`; `index.ts` could not be type-checked here because Deno is not installed, only syntax-checked with esbuild). Deploying the function before the migration makes the worker defer every job.
3. Deploy the web build.

### Still NOT done / needs live, browser or photo validation
- **P0 real photograph validation** by an authorised supervisor, with expert adjudication. Untouched by this pass.
- **P0 live failed-charge metering** after a real malformed response, comparing `ai_tyre_inspection_jobs`, `ai_token_logs`, `ai_tyre_daily_budget` and the provider invoice.
- **P0 cron HTTP 200, stalled-lock reaping and queue drain** against the live project, and a multi-connection concurrency test of `ai_tyre_reserve_budget`.
- **P0 tenant/role security test** as real users (including Sajid) through the deployed function and RLS; the new tests only prove the role lists and source-level tenant checks.
- **P1 deployment and rendering** (Vercel build, console errors, dark/light UI, 390px layout of the new register footer and feedback panel). No browser run was possible here.
- Continuous learning/model improvement is **not** implemented. The feedback aggregate is evaluation data for a future, expert-confirmed process only.

## 2026-10-22 — Measurement engine, correctness tests and performance (branch `feature/ai-engine-advanced-20261023`)

Code only. No migration, no edge function change (`supabase/functions/ai-tyre-inspection/index.ts` untouched), no live DB, no browser.

### Code done vs needs live

| Area | Code done and unit-tested here | Needs live / real data / browser |
|---|---|---|
| Measurement engine `src/lib/tyreMeasurementEngine.js` | Reading validation (impossible depth, future date, bad limits/odometer, duplicates, same-instant conflicts); per tyre series (asset + position + serial); wear rate mm/1000 km (mm/day when no odometer); remaining km/days with 90% band (3+ readings; 2 readings give a point estimate flagged low confidence); new series when depth rises (replaced/retreaded); odometer regression ignored; inner/centre/outer hints (alignment, under/over-inflation, marked indicative); replace-soon flag (uses the conservative end of the band); leave-one-out comparison with the median of other vehicles. Everything is `null`/"Not measured" when data is insufficient. 30 tests. | The thresholds in `ENGINE_LIMITS` (wear-rate ceiling 4 mm/1000 km, 2 mm shoulder gap, 1.5 mm centre gap, replace margin 1.5 mm / 10,000 km / 30 days) are engineering defaults, **not calibrated against this fleet**. A tyre/fleet engineer must confirm them against real gauge history before anyone acts on a flag. `ai_tyre_depth_measurements` currently holds few or no repeated readings, so most rows will read "Not measured" until gauge data is recorded. |
| Measurements tab | "Wear analysis from repeated gauge readings" table (EnterpriseTable) plus a side drawer per tyre (SideDrawer) and a "Data checks" list of excluded/suspicious readings. Fetches the vehicle's own inspections and same-type peers on the loaded page in ONE batched query. Render-tested with mocked data. | Not seen in a real browser (390 px layout, dark/light). Fleet comparison only covers the loaded page (<=100 inspections), not the whole fleet. |
| Position labels | Every layout key and every slot round-trips slot -> canonical code -> slot, codes are unique and have left/right mirrors, real vehicle types and asset prefixes map correctly. **Bug fixed:** the 4-wheel layouts (Pickup, Wheel loader, Skid loader) displayed the rear-right slot as `RR` instead of `RHR1` (`canonicalToSlotId` now matches an exact stored slot id first). | Checking labels against the physical tyre-position diagram on a real vehicle. |
| Excel (per vehicle) | Row building moved to `src/lib/aiTyreInspectionExport.js`; columns, canonical + stored position, joins of several jobs, "Not measured"/"Not requested" states and file name are tested. New columns: wear rate, estimated km to limit, replace soon, uneven-wear hint. | Opening a real generated file in Excel. |
| Damage report Excel/PDF | Row mapping, decision grouping (Accepted/Rejected/Corrected/Awaiting), one sheet per group, summary counts, PDF page and table per group, empty-group message, photo-limit note: all asserted through mocked writers. | Real PDF/Excel visual check with real signed photos; PDF thumbnails need a browser (canvas). |
| Combined filters | `src/lib/aiTyreInspectionFilters.js` (site + date + condition + AI status + review status + chips) and the server query builder `listInspectionsForAiRegister` (country, date range, site, status, sanitized text, paging clamp) are tested, including filter-injection characters. | Running against the real database and RLS. Condition, photo, measured, AI-status and review filters still apply to the loaded page of 50, not the whole register. |
| Performance | Heavy derivations memoized (visible rows, damage rows, readings, appendix, engine); photo URLs resolved lazily on scroll through a shared cache (dedupe, 40-minute TTL, 4 concurrent); damage report signs links with one `createSignedUrls` call per bucket per 100 photos; the reviewer-feedback table no longer pulls `exportUtils` into the page chunk; the page stays lazy-routed. | Measuring real load time and Supabase request counts in a browser. |
| Design ratchet | Reviewer-feedback raw `<table>` (it was failing `designSystemRatchet` before this change) replaced with EnterpriseTable. Ratchet green. | |

Verified here: eslint (0 errors on touched files), targeted vitest (345 tests across 19 files), `vite build`.

### Rules for whoever continues
- The engine only reads physical gauge rows. It must never be fed AI photo findings or invent a millimetre value.
- Estimates are trend aids. Do not present a replace-soon flag as a safety certification.
- Position display goes through `displayPositionCode(inspectionTypeHint(row), stored)`; the stored key is never rewritten.

## 2026-10-23 — Spec completion pass (branch `feature/spec-completion-20261023`): FINAL honest status table

Nothing here is applied to the live database, deployed as an edge function, or seen in a browser. "Code-done" means committed, covered by the named automated test, and lint/ratchet/build checked locally.

| Item | Status | Where | Evidence |
|---|---|---|---|
| P0 queue draining | **Code-done** (was PARTIAL: one batch of 4 per 5-minute tick) | `drainQueue` in `supabase/functions/ai-tyre-inspection/logic.ts`, wired in `index.ts` `work()` (reaper first, claim-before-process, 4 per batch, max 10 batches, 90 s wall budget) | `src/test/aiTyreDrain.test.js` (9): 18-job backlog in one run, batch cap, budget deferral stops the run, time budget, failed/prior-attempt never reprocessed, lost claims never spin, queue error |
| P0 failed-token billing | Code-done (earlier pass) | `processJob` in `logic.ts` | `aiTyreWorker.test.js`; `aiCostMonitorAnalytics.test.js` |
| P0 supervisor review tests | Code-done (earlier pass) | role lists + parity in `aiTyreInspectionRoles.js` | `aiTyreWorker.test.js` role/tenant block |
| PDF findings | Code-done (earlier pass) | `aiDamageReport.js`, `aiTyreInspectionReport.js` | `aiTyreInspectionReport.test.js`, damage report tests |
| P1 position labels | Code-done (earlier pass) | `displayPositionCode` | `aiTyrePositionLabels.test.js` |
| P1 Excel report | Code-done (earlier pass) | `aiTyreInspectionExport.js` | `aiTyreInspectionExport.test.js` |
| P1 filters over the whole register | **Code-done** (was PARTIAL: condition, photo, AI-status, review filters only covered the loaded 50-row page) | Migration `20261023100000_ai_tyre_register_server_filters_and_labelled_findings.sql` (`ai_tyre_register_page`, SECURITY INVOKER, exact total, stable paging); client `listAiRegisterFiltered` in `src/lib/api/inspections.js`; page passes all filters | `supabase/tests/ai_tyre_register_filters.test.mjs` (PGlite, real SQL, 7 tests), `src/test/aiTyreRegisterDeepFilters.test.js` (5) |
| P1 cost-monitor blank screen | **Code-done** (loading skeleton, error with Retry, empty message already existed; now locked by tests) | `src/pages/AiCostMonitor.jsx` | `src/test/aiCostMonitor.render.test.jsx` (5): loading, error + Retry with no raw DB text, zero rows, null cost/missing date/unknown status rows, payload without rows |
| P1 E2E-style tests | Code-done | worker harness, drain harness, PGlite SQL tests, page render tests | listed above |
| P2 learning pipeline | **Code-done as an evaluation pipeline** (was PARTIAL: aggregate only) | RPC `get_ai_tyre_labelled_findings` (supervisor roles, INVOKER); `shapeLabelledFindings`, `labelledJsonl`, `labelledExportRows` in `aiTyreReviewFeedback.js`; Excel and JSONL download in the reviewer-feedback panel | `src/test/aiTyreLabelledFindings.test.js` (6), PGlite test for the RPC and its role gate. **No model is retrained, tuned or re-prompted automatically.** |
| Measured / missing-measurement chips beyond the loaded page | **Still page-level** | depends on gauge maths (`calculateTread`) on per-position JSON | stated in the page text; not a requested filter |

### Needs live DB / deploy / device / owner (cannot be closed in code)
1. Apply migrations `20261023090000_ai_tyre_budget_reservation_and_feedback.sql` then `20261023100000_ai_tyre_register_server_filters_and_labelled_findings.sql` (pre-flight and rollback are in each header). **The web register and the feedback panel call the new RPCs; apply the migration BEFORE shipping the web build, or condition/photo/AI/review filters and labelled export show an error.** Deploy the edge function after `20261023090000`.
2. Edge function `index.ts` and `logic.ts` deploy; Deno type-check (Deno not installed here; esbuild syntax check only). Confirm cron HTTP 200 and that a real backlog drains (watch `stoppedBecause` in the response).
3. P0 real photograph adjudication by an authorised supervisor; live failed-charge reconciliation against the provider invoice; multi-connection budget concurrency test.
4. Real-user role/tenant test (including Sajid) through the deployed function; browser pass (console errors, dark/light, 390 px) of the register footer, feedback panel and cost monitor.
5. Continuous learning is **not** implemented and must not be claimed; the labelled export is input for a future, expert-confirmed evaluation.

## 2026-10-25 - Adjudication harness, worker integration tests, hard monthly budget (branch `claude/ai-adjudication-harness-20261025`)

Code only. Nothing is deployed or applied; no migration was needed.

### Adjudication harness
- Engine `src/lib/aiTyreAdjudication.js` (pure, deterministic): scores AI findings against an expert golden set (per-type precision/recall, assessable agreement, dangerous misses), summarises human review decisions (accepted/rejected/corrected), measures depth correction magnitude (MAE, bias, p90) for engine-predicted depth vs gauge/human value, clusters disagreements, and gates a change (`pass` / `fail` / `insufficient`) on thresholds and on regression versus a stored baseline. Samples below the minimum give `null`, never 0; `insufficient` blocks by default.
- Hard rule enforced by the gate: any AI result carrying an exact tread depth fails (a photo may not certify millimetres).
- `fromJobRows(jobs)` maps live `ai_tyre_inspection_jobs` + reviewer decisions into the same engine.
- CLI: `npm run ai:adjudicate` (`scripts/ai-adjudicate.mjs`); exit 0 pass, 1 fail, 2 insufficient, 3 bad input. Fixtures in `src/test/fixtures/ai-adjudication/` are SYNTHETIC. They exercise the harness and prove the gate trips; they are not evidence of real accuracy. P0 real-photo expert adjudication is still outstanding: replace `golden.v1.json` with expert-labelled real cases and regenerate `baseline.json` (`--write-baseline`).

### Hard monthly budget
- `supabase/functions/ai-tyre-inspection/budget.ts` (pure) + `checkMonthlyBudget` dependency in `logic.ts` + wiring in `index.ts`. Reads `system_config` `ai_monthly_budget_usd` (0/unset = uncapped, same as chat-ai) and `ai_enabled`. Refuses a call when spend + the per-call reservation would exceed the limit; fails closed if config or spend cannot be read, or the limit is non-numeric.
- Spend = `ai_token_logs` for every other feature + `ai_tyre_inspection_jobs` (the worker writes a token-log row only for FAILED calls, so successful tyre calls are only in the jobs table). A called job with NULL cost is charged the reservation, never 0. Both reads are paged (PostgREST caps at 1000).
- A stopped run leaves the job `pending`, un-attempted, with `failure_kind = monthly_budget_reached`, writes a `blocked` row in `ai_token_logs`, and the worker response carries `stoppedBecause: "monthly_budget"` and a `budget` object. The page shows the paused reason on the photo.
- **Deploy needed:** redeploy edge function `ai-tyre-inspection` (`index.ts`, `logic.ts`, `budget.ts`). No migration. Deploying it before the 20261023090000 migration still makes the worker defer every job (existing behaviour).
- Limits: read-then-act, so concurrent workers can overshoot by about (workers in flight x reservation); jobs called before `provider_called_at` existed are invisible to the month total; totals are global across tenants. `chat-ai` still reads `ai_token_logs` with a plain select (1000-row truncation) and does not include tyre-inspection successes; not changed here.
