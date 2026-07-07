# Automation Platform — Deployment Runbook (V94–V99)

Session work implementing roadmap phases **20 → 14** (bottom-up): Event-Driven
Architecture, Workflow Engine, Python Analytics, RAG auto-embedding, AI
Orchestrator, API Platform + Webhooks, Business Rules Engine.

> ⚠️ **Nothing in this drop is applied to the live database or deployed to
> edge functions yet.** This session's tooling had no access to project
> `jhssdmeruxtrlqnwfksc`, so everything ships as files. All six migrations
> were executed end-to-end on a local Postgres 16 cluster (triggers → outbox →
> consumers → workflows/rules/webhooks → deliveries) before commit, but the
> live-apply below still needs a human/session with project access.

---

## 1. What ships where

| Piece | File | Live action needed |
|---|---|---|
| Domain events outbox + triggers + processor | `MIGRATIONS_V94_DOMAIN_EVENTS.sql` | apply |
| Approval workflow engine | `MIGRATIONS_V95_WORKFLOW_ENGINE.sql` | apply |
| KB chunking + auto-embed cron | `MIGRATIONS_V96_RAG_AUTO_EMBED.sql` | apply |
| API keys + webhooks | `MIGRATIONS_V97_API_PLATFORM_WEBHOOKS.sql` | apply |
| Business rules engine + threshold evaluator | `MIGRATIONS_V98_BUSINESS_RULES_ENGINE.sql` | apply |
| AI conversation memory | `MIGRATIONS_V99_AI_CONVERSATIONS.sql` | apply |
| Auto-embedding worker | `supabase/functions/embed-worker/` | deploy, **verify_jwt=false** |
| Public REST API | `supabase/functions/public-api/` | deploy, **verify_jwt=false** |
| AI copilot orchestrator | `supabase/functions/ai-orchestrator/` | deploy, **verify_jwt=true** |
| Python analytics service | `services/analytics/` | optional separate deploy (Fly/Cloud Run) |
| Admin UIs (Event Stream, Approvals, Workflows, Integrations, Automation Rules) | `src/pages/*`, `src/lib/api/*` | ships with normal Vercel deploy |

## 2. Apply order (strict)

V94 → V95 → V96 → V97 → V98 → V99. Later migrations register consumers into
V94's `event_consumers` and call V95's `notify_role_in_org`. Use the
validate-first protocol (HANDOFF.md): run each file inside
`BEGIN; … ROLLBACK;` first, then apply for real.

Prerequisites already live: pg_cron + pg_net (V61), `cron_config.cron_secret`
(V61), pgvector + `knowledge_documents` (V51), `app_current_org()` (V42),
`is_elevated_user()`/`get_my_role()` (V22/V75), `notifications` (V19).
V97 creates `pgcrypto` if missing.

## 3. Edge function deploys

```bash
supabase functions deploy embed-worker    --project-ref jhssdmeruxtrlqnwfksc --no-verify-jwt
supabase functions deploy public-api      --project-ref jhssdmeruxtrlqnwfksc --no-verify-jwt
supabase functions deploy ai-orchestrator --project-ref jhssdmeruxtrlqnwfksc
```

- `embed-worker`: real gate is `x-cron-secret` (from `cron_config`), same as
  send-scheduled-reports. Needs the existing `OPENAI_API_KEY` secret; until
  it's set the function no-ops harmlessly.
- `public-api`: real credential is the `x-api-key` header (keys minted by
  `create_api_key()`), validated + rate-limited by the
  `api_key_authenticate` RPC. JWT verification must be off — callers are
  external systems.
- `ai-orchestrator`: validates the user JWT itself via `requireApprovedRole`
  (admin/manager/director), like generate-embedding. Uses existing
  `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` secrets. No new secrets required.

## 4. Post-apply verification

```sql
-- 5 new cron jobs present:
select jobname, schedule from cron.job order by jobname;
-- expect: deliver-webhooks(*), embed-knowledge-documents(*/10),
--         escalate-workflows(15 *), evaluate-alert-thresholds(5 *),
--         process-domain-events(*)

-- events flowing: create any inspection, then within a minute:
select event_type, status from public.domain_events order by id desc limit 5;

-- consumers registered:
select consumer, enabled from public.event_consumers;
-- expect consume_event_workflows, consume_event_webhooks, consume_event_rules
```

Then in the app (elevated user): **Event Stream** page shows events;
**Approvals**/**Approval Workflows** manage chains; **API & Webhooks** mints
a key (test: `curl -H "x-api-key: tp_…" https://jhssdmeruxtrlqnwfksc.supabase.co/functions/v1/public-api/v1/vehicles`);
**Automation Rules** creates a rule and its executions appear after the next
matching event.

## 5. Event catalog (emitted by V94 triggers + engines)

`inspection.completed`, `tyre.installed`, `accident.reported`,
`accident.closure_changed`, `workorder.created`, `workorder.status_changed`,
`corrective_action.created`, `stock.movement`, `purchase.order_created`,
`knowledge.document_added`, `workflow.started` / `workflow.step_advanced` /
`workflow.approved` / `workflow.rejected` / `workflow.cancelled` /
`workflow.escalated`, `threshold.triggered`, `rule.*` (business-rule emitted).

Delivery semantics: at-least-once. Consumers are replay-safe (workflow
launches and webhook deliveries dedupe on source event id; rule executions
dedupe per rule+event).

## 6. Webhook consumer contract (for customers/ERP)

- POST, JSON body `{ id, type, entity_type, entity_id, created_at, data }`.
- Headers: `X-TyrePulse-Event` (type), `X-TyrePulse-Signature:
  sha256=<hex>` — HMAC-SHA256 of the **raw body** with the subscription's
  signing secret (visible on the Integrations page).
- Retries: 6 attempts, exponential backoff (2,4,8,16,32,60 min). 20
  consecutive failures auto-disable the subscription.

## 7. Python analytics service (optional, separate infra)

See `services/analytics/README.md` — FastAPI, org-scoped reads from the
Supabase Postgres, `x-service-key` auth. Deploy to Fly.io/Cloud Run with
`DATABASE_URL` + `ANALYTICS_SERVICE_KEY`; the browser must never hold the
service key (proxy through an edge function when wiring the UI).

## 8. Rollback

Each migration file header contains its exact rollback block (unschedule
cron job → drop functions → drop tables). Rolling back V94 requires first
rolling back V95/V97/V98 consumer registrations (their DELETE lines are in
their own rollback blocks).
