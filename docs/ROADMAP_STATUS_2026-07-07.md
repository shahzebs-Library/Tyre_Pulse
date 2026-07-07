# Enterprise Roadmap — Implementation Status (7 Jul 2026)

Tracks `Improvements road map.md` (commits 6c5100e + 94d9ac2). Implemented
**bottom-up from priority #20 toward #1** per direction. Stack-adaptations are
called out — this platform is Supabase + Vercel static, so "Redis/BullMQ/
Temporal"-class items were delivered with Postgres-native equivalents rather
than new infrastructure to babysit.

## Priority list status

| # | Item | Status | Where |
|---|------|--------|-------|
| 20 | Event-Driven Architecture | ✅ Done | V94 outbox + triggers + consumer registry + pg_cron processor |
| 19 | Temporal (workflows) | ✅ Adapted | V95 durable approval-workflow engine (snapshots, SLAs, escalation) — Postgres-native, no Temporal cluster |
| 18 | Python AI & Analytics services | ✅ Done | `services/analytics/` FastAPI (tyre life, cost forecast, anomalies, demand) — needs separate deploy |
| 17 | pgvector + Knowledge Base | ✅ Completed | was mostly built (V51); V96 adds chunking + cron auto-embedding (`embed-worker`) |
| 16 | LangGraph + AI Copilot | ✅ Adapted | `ai-orchestrator` edge function: real tool-use loop (digest, RAG, counts, events) + durable memory (V99). LangGraph itself would need the Python host — revisit if agent graphs grow |
| 15 | API Platform + Webhooks | ✅ Done | V97 keys/HMAC webhooks + `public-api` edge function + Integrations UI |
| 14 | Business Rules Engine | ✅ Done | V98 event rules + server-side alert_thresholds evaluation + Automation Rules UI |
| 13 | Dynamic Dashboard Builder | ✅ Done (this session, wave 2) | V100 `user_dashboards` + `/dashboard-builder` |
| 12 | Report Builder | ✅ Done (this session, wave 2) | V100 `report_definitions` + `/report-builder` (run/export CSV/XLSX) |
| 11 | Full Audit Logs | ✅ Done | V100 server-side row-change triggers → audit_log_v2 (16 tables), on top of existing client logging |
| 10 | Object Storage + CDN | ✅ Already in place | Supabase Storage buckets + public URLs (see HANDOFF) |
| 9 | n8n | ◑ Integration-ready | outbound signed webhooks (V97) are n8n's trigger surface; running n8n itself is an ops decision, not code |
| 8 | ECharts (executive/TV) | ✅ Foundations | lazy `EChart` wrapper + Trend/Heatmap/Gauge/Pareto components; adopt in exec pages incrementally |
| 7 | PostHog | ✅ Wired (env-gated) | `initMonitoring()`; set `VITE_POSTHOG_KEY` to activate |
| 6 | Sentry | ✅ Wired (env-gated) | set `VITE_SENTRY_DSN` to activate |
| 5 | Background Job Queue | ✅ Adapted | domain-events outbox + pg_cron workers (process/deliver/evaluate/escalate/embed) — queue semantics without Redis/BullMQ infra |
| 4 | Redis | ◑ Deferred deliberately | current needs (cache=ai_response_cache, rate limits=api_key_usage/ai_usage_log, queue=V94) are Postgres-served; add managed Redis only when measured load demands it |
| 3 | Zod | ✅ Foundations | `src/lib/validation/schemas.js` (tyre/inspection/vehicle/vendor/PO rules) |
| 2 | React Hook Form | ✅ Foundations | `src/components/ui/form/` RHF+zod kit; convert forms incrementally (guide: docs/UI_FOUNDATIONS.md) |
| 1 | TanStack Table | ✅ Foundations | `src/components/ui/DataTable.jsx` (search/filter/sort/pagination/visibility/selection/export); convert Fleet/Tyres/Inventory/Vendors/Inspections incrementally |

## Remaining (not in this drop — honest gaps)

- **Executive TV display mode** (secure read-only URL, auto-rotate): needs a
  share-token table + public read edge function. Design exists (roadmap
  §Live Executive Dashboard); next natural phase.
- **Form/table conversions of existing pages** (#1–#3 adoption): foundations
  shipped; converting the ~10 legacy pages is deliberately incremental to
  avoid colliding with in-flight local work.
- **n8n / Redis / native mobile / Temporal-proper / LangGraph-proper /
  Langfuse**: external infra or scale-triggered — revisit when operations
  demand them. Langfuse's job (AI cost/usage) is currently covered in-house
  by ai_usage_log/ai_token_logs + AI Cost Monitor.
- **Billing/subscriptions, MFA, OCR, tenant-health console**: separate
  roadmap items not in the 1–20 priority list; untouched this session.

## Deployment

Nothing is applied to the live DB / edge runtime from this session — see
`docs/AUTOMATION_PLATFORM_DEPLOYMENT.md` for the exact apply/deploy runbook
(V94→V100, three edge functions, env vars for Sentry/PostHog).
