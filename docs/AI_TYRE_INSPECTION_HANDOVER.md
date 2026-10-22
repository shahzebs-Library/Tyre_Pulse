# AI Tyre Inspection — implementation handover

**Last verified:** 2026-10-22 (Riyadh). **Repository:** shahzebs-Library/Tyre_Pulse. **Branch:** main. **Supabase project:** jhssdmeruxtrlqnwfksc. **Worker:** ai-tyre-inspection.

## Verified live state
- Query `select status,count(*) from public.ai_tyre_inspection_jobs group by status;` returned **8 completed, 28 pending** (36 jobs total).
- Pending rows still include error: `Unterminated string in JSON at position 97 (line 3 column 73)`. Do not assume all 36 jobs will complete.
- Supabase Edge Function version **16 ACTIVE** was deployed with Anthropic support and bounded output. Completion of 8 jobs confirms storage of results, but **review, invoice-equivalent cost accuracy and PDF rendering have not been end-to-end verified**.
- Web/Vercel build and domain redirect deployment success are **not verified**. Last observed Vercel deployments queued/building.

## Implemented (code committed to main)
1. Position-linked Flutter inspection media: `tyre_conditions.<position>.photo_url` recognized in SQL trigger, Edge Function, domain evidence extraction, and UI; other photo formats retained. Database backfill for Oct 21 Riyadh scanned 39 inspections and created 36 jobs.
2. Database: `ai_tyre_inspection_jobs`, autoqueue trigger on `inspections.tyre_conditions` insert/update, bounded backfill routine; job metrics and estimated USD cost columns.
3. Cron worker dispatcher configured every 5 minutes. Edge Function `verify_jwt=false` permits cron gateway access **only because the work action validates `x-worker-secret`**, while interactive actions verify Supabase JWT + organization/role. Previously encountered 401 (gateway), then 500 (`provided is not defined`), then 503 (missing Gemini key): these were addressed. Validate worker response status anew after changes.
4. Both manual queued defect photos and on-demand **screen all photographed tyres**, including condition Good. Automatic trigger remains abnormal-tyre-only for cost control.
5. Gauge-free AI visual assessment: model may describe observable damage, uneven wear, assessability and recommendations. **Never fabricate numeric tread depth, pressure, remaining tyre life, or roadworthiness.** Verified groove depths require physical gauge source, separate measurement record and review.
6. Anthropic provider selected when `ANTHROPIC_API_KEY` exists, otherwise Google selected when `AI_PROVIDER_KEY` exists. Default model names currently coded: `claude-haiku-5-5` / `gemini-2.5-flash-lite`; **verify model availability and published rates**. There is no automatic Sonnet escalation. Anthropic integration requests images through Messages API; Google through generateContent.
7. Worker has a configurable application-side **estimated daily USD cap** (`AI_DAILY_LIMIT_USD`, default 1), image payload size restriction, capped responses, max 4 claimed jobs per run and token/cost tracking. This cap is not a guaranteed billing cap and may omit failed/unpriced requests.
8. Human review accept/reject UI with server-side role checks; AI results in inspection appendix, existing inspection PDF addition, per-inspection costs, date-bounded historical backfill UI. Capturing guide for photographs and physical gauge readings added.
9. `www.tyrepulse.app/ai-cost-monitor` conditional redirect to `app.tyrepulse.app/ai-cost-monitor` authored in `vercel.json` (production behavior not yet verified).

## Still pending — next agent priorities (do not mark done without evidence)
**P0** Verify latest jobs reach completed reliably. Inspect `ai_tyre_inspection_jobs` error_message and Edge logs. The earlier Claude response was truncated / malformed JSON. Confirm the latest 1100-token compact-JSON prompt solves it; implement a robust validation/response strategy without unlimited paid retries. Handle failed jobs and stale processing locks safely; distinguish provider errors from invalid images.
**P0** Confirm credentials/model config securely via Supabase secrets (do NOT print keys), correct model IDs/pricing from official Anthropic docs, and record real `usage` fields. Confirm billing estimates for image input, output, retries, cache and thinking if applicable.
**P0** Test end-to-end with a real, tenant-authorized inspection photograph: queue -> worker -> structured finding -> supervisor decision -> PDF appendix -> cost tracking. Validate RLS / cross-tenant and role boundaries.
**P1** Fix the code/UI inconsistency around photo counts, healthy-position screening, latest saved depth measurements, and report export. Add automated tests and inspect Vercel successful production deployment, app domain/marketing redirects and `/ai-cost-monitor` blank screen.
**P1** Production PDF: verify current Inspection > Download PDF actually includes only authorized reviewed findings and physical measurements. The preview is not a centralized production PDF endpoint; don't advertise one until built and tested.
**P1** Cost guardrail: harden concurrent worker reservation/cap to prevent overspend; price unknown models as unpriced, never silently 0. Limit huge backfills and implement optional manager confirmations.
**P2** Image-quality grading (blur, low light, angle, tyre position), retake requests, and evidence audit. Benchmark against expert-labelled tyre images to quantify missed safety-relevant damage / false positives. Do NOT claim validated mm from ordinary photos.

## Working files
- `supabase/functions/ai-tyre-inspection/index.ts` — auth, queue, backfill, worker, Anthropic/Google, cost.
- `supabase/migrations/20261022130000_ai_tyre_autoqueue_usage.sql` and `20261022140000_ai_tyre_flutter_photo_link.sql`.
- `src/lib/aiTyreInspectionDomain.js`, `src/lib/aiTyreInspectionDomain.test.js` — image refs, readings, evidence summary.
- `src/lib/api/aiTyreInspection.js` — server data and actions.
- `src/pages/AiTyreInspection.jsx` — UI, photo guidance, manual screening, review, costs, preview.
- `src/lib/aiTyreInspectionReport.js` — appendix; `src/lib/exportUtils.js` and `src/pages/Inspections.jsx` — existing report integration.
- `vercel.json` — app route redirect.
- CI: `.github/workflows/vercel-production.yml` — private repo CLI alternative; direct Vercel Git deploy may also occur when repository public.

## Verification SQL (read-only)
```sql
select status,count(*) as jobs,max(error_message) as example_error
from public.ai_tyre_inspection_jobs group by status order by status;
select count(*) as reviewed
from public.ai_tyre_inspection_jobs
where review_status in ('accepted','rejected','corrected');
select provider,model_version,count(*) as completed_jobs,
       sum(input_tokens) as input_tokens,sum(output_tokens) as output_tokens,
       sum(cost_usd) as estimated_cost_usd
from public.ai_tyre_inspection_jobs
where status='completed'
group by provider,model_version;
```

## Agent working agreement
Continue in **main** or one consolidated PR, not a stream of tiny PRs. Prefer verified functionality over line count. Preserve existing inspection screens and PDF format. Treat “deployed,” “merged,” “tested,” and “operational” as different milestones. Never overwrite secrets or claim completion without live evidence. Update this handover every substantive change, listing commit, deployment, verification and remaining blockers.
