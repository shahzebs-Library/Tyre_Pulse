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
