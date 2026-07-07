# Automation Platform — Deployment Runbook (V96–V103)

Session work implementing roadmap phases **20 → 11**: Event-Driven Architecture,
Workflow Engine, RAG auto-embedding, API Platform + Webhooks, Business Rules
Engine, AI conversation memory, server-side audit + builder persistence,
Executive TV Display.

> ⚠️ **Not yet applied to the live database or deployed to edge functions.**
> The code shipped via **PR #26 (merged to `main`, commit a84cb64)** and
> auto-deployed to Vercel, so the Automation admin pages are already live on
> tyrepulse.app — **but they will error until the migrations below are applied**
> (their `src/lib/api/*` calls hit tables/RPCs that don't exist yet). All eight
> migrations were executed end-to-end on a local Postgres 16 cluster before
> commit; the live-apply still needs a session/human with project access to
> `jhssdmeruxtrlqnwfksc` (this session's Supabase MCP is permission-denied and
> has no CLI).
>
> **Numbering note:** an earlier version of this runbook referenced V94–V99.
> Those files were renumbered to **V96–V103** on merge (V94/V95 were taken by
> the parallel roadmap tranche). A few inline comments inside the migration
> files still carry the old cross-reference numbers — they are comments only and
> do not affect execution (the SQL references object *names*, not file numbers).

---

## 1. What ships where

| Piece | File | Cron job | Live action |
|---|---|---|---|
| Domain events outbox + triggers + processor | `MIGRATIONS_V96_DOMAIN_EVENTS.sql` | `process-domain-events` (`* * * * *`) | apply |
| Approval workflow engine | `MIGRATIONS_V97_WORKFLOW_ENGINE.sql` | `escalate-workflows` (`15 * * * *`) | apply |
| KB chunking + auto-embed | `MIGRATIONS_V98_RAG_AUTO_EMBED.sql` | `embed-knowledge-documents` (`*/10 * * * *`) | apply |
| API keys + webhooks | `MIGRATIONS_V99_API_PLATFORM_WEBHOOKS.sql` | `deliver-webhooks` (`* * * * *`) | apply |
| Business rules + threshold evaluator | `MIGRATIONS_V100_BUSINESS_RULES_ENGINE.sql` | `evaluate-alert-thresholds` (`5 * * * *`) | apply |
| AI conversation memory | `MIGRATIONS_V101_AI_CONVERSATIONS.sql` | — | apply |
| Server-side audit triggers + Dashboard/Report Builder tables | `MIGRATIONS_V102_AUDIT_TRIGGERS_BUILDERS.sql` | — | apply |
| Executive TV Display (anon share tokens) | `MIGRATIONS_V103_EXECUTIVE_DISPLAY.sql` | — | apply |
| Auto-embedding worker | `supabase/functions/embed-worker/` | — | deploy, **verify_jwt=false** |
| Public REST API | `supabase/functions/public-api/` | — | deploy, **verify_jwt=false** |
| AI copilot orchestrator | `supabase/functions/ai-orchestrator/` | — | deploy, **verify_jwt=true** |
| Python analytics service | `services/analytics/` | — | optional separate deploy (Fly/Cloud Run) |
| Admin UIs (Event Stream, Approvals, Workflows, Integrations, Automation Rules, …) | `src/pages/*`, `src/lib/api/*` | — | already shipped via PR #26 |

## 2. Apply order (strict)

Numeric order, no gaps: **V96 → V97 → V98 → V99 → V100 → V101 → V102 → V103.**

Later migrations register consumers into V96's `event_consumers`
(`consume_event_workflows` from V97, `consume_event_webhooks` from V99,
`consume_event_rules` from V100) and call V97's notify helpers. V102 attaches
audit triggers to tables created by V97/V99/V100, so it must come after them
(its attachment is `to_regclass()`-guarded, so it is safe either way). V101 and
V103 are self-contained.

Use the **validate-first protocol** (HANDOFF.md): run each file inside
`BEGIN; … ROLLBACK;` first to confirm it executes cleanly, then apply for real.
None of the files wrap themselves in BEGIN/COMMIT, so this is safe.

Prerequisites already live: pg_cron + pg_net (V61), `cron_config.cron_secret`
(V61), pgvector + `knowledge_documents` (V51), `app_current_org()` (V42),
`is_elevated_user()`/`get_my_role()` (V22/V75), `notifications` (V19),
`audit_log_v2` (V15). **V99 creates `pgcrypto` if missing.**

## 3. Edge function deploys

```bash
supabase functions deploy embed-worker    --project-ref jhssdmeruxtrlqnwfksc --no-verify-jwt
supabase functions deploy public-api      --project-ref jhssdmeruxtrlqnwfksc --no-verify-jwt
supabase functions deploy ai-orchestrator --project-ref jhssdmeruxtrlqnwfksc
```

- `embed-worker`: real gate is `x-cron-secret` (from `cron_config`), same as
  send-scheduled-reports. Needs the existing `OPENAI_API_KEY` secret; until it
  is set the function no-ops harmlessly.
- `public-api`: real credential is the `x-api-key` header (keys minted by
  `create_api_key()`), validated + rate-limited by the `api_key_authenticate`
  RPC. JWT verification must be off — callers are external systems.
- `ai-orchestrator`: validates the user JWT itself via `requireApprovedRole`
  (admin/manager/director), like generate-embedding. Uses existing
  `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` secrets. No new secrets required.

## 4. Post-apply verification

```sql
-- 5 new cron jobs present:
select jobname, schedule from cron.job order by jobname;
-- expect: deliver-webhooks(* * * * *), embed-knowledge-documents(*/10 * * * *),
--         escalate-workflows(15 * * * *), evaluate-alert-thresholds(5 * * * *),
--         process-domain-events(* * * * *)

-- consumers registered:
select consumer, enabled from public.event_consumers;
-- expect consume_event_workflows, consume_event_webhooks, consume_event_rules

-- events flowing: create any inspection, then within a minute:
select event_type, status from public.domain_events order by id desc limit 5;
```

Then in the app (elevated user): **Event Stream** shows events;
**Approvals**/**Approval Workflows** manage chains; **API & Webhooks** mints a
key (test: `curl -H "x-api-key: tp_…" https://jhssdmeruxtrlqnwfksc.supabase.co/functions/v1/public-api/v1/vehicles`);
**Automation Rules** creates a rule whose executions appear after the next
matching event; **Executive Display** mints a `/display/<token>` share URL.

## 5. Event catalog (emitted by V96 triggers + engines)

`inspection.completed`, `tyre.installed`, `accident.reported`,
`accident.closure_changed`, `workorder.created`, `workorder.status_changed`,
`corrective_action.created`, `stock.movement`, `purchase.order_created`,
`knowledge.document_added`, `workflow.started` / `workflow.step_advanced` /
`workflow.approved` / `workflow.rejected` / `workflow.cancelled` /
`workflow.escalated`, `threshold.triggered`, `rule.*` (business-rule emitted).

Delivery semantics: at-least-once. Consumers are replay-safe (workflow launches
and webhook deliveries dedupe on source event id; rule executions dedupe per
rule+event).

## 6. Webhook consumer contract (for customers/ERP)

- POST, JSON body `{ id, type, entity_type, entity_id, created_at, data }`.
- Headers: `X-TyrePulse-Event` (type), `X-TyrePulse-Signature: sha256=<hex>` —
  HMAC-SHA256 of the **raw body** with the subscription's signing secret
  (visible on the Integrations page).
- Retries: 6 attempts, exponential backoff (2,4,8,16,32,60 min). 20 consecutive
  failures auto-disable the subscription.

## 7. Python analytics service (optional, separate infra)

See `services/analytics/README.md` — FastAPI, org-scoped reads from the Supabase
Postgres, `x-service-key` auth. Deploy to Fly.io/Cloud Run with `DATABASE_URL` +
`ANALYTICS_SERVICE_KEY`; the browser must never hold the service key (proxy
through an edge function when wiring the UI).

## 8. Overlap with the parallel roadmap tranche (read before applying)

PR #26 and the earlier roadmap tranche independently implemented several of the
same items — server-side (PR #26) vs. client-side (`app_settings`). PR #26
reconciled them (1338/1338 tests, clean build), but confirm which backing store
each UI now uses before relying on it:

- **Report Builder / Dashboard Builder** — V102 adds `report_definitions` /
  `user_dashboards` tables. The tranche's pages persisted to `app_settings`
  keys (`saved_reports`, `dashboard_layouts`). Verify the merged UI points at
  the tables (preferred) and migrate any app_settings data if needed.
- **Executive Display** — V103 adds a token-gated anon `/display/<token>`
  surface; the tranche shipped an authed `/display` page. Both can coexist.
- **Audit** — V102 adds server-side `db.*` audit triggers alongside the
  client-side `src/lib/auditLogger.js` entries; expect both action namespaces.

## 9. Rollback

Each migration file header contains its exact rollback block (unschedule cron →
drop functions → drop tables). Roll back in reverse apply order. Rolling back
V96 requires first removing the consumer registrations added by V97/V99/V100
(their DELETE lines live in their own rollback blocks).
