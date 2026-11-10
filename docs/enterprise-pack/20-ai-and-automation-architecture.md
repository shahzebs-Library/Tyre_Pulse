# 20. AI and Automation Architecture

| Field | Value |
|---|---|
| Deliverable | 20 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. AI assistant, multi-agent orchestrator, AI tyre photo inspection with a hard budget cap, 26 pg_cron jobs, a domain-event bus with 8 consumers and a notification pipe are built and live. AI governance tables (V205) exist but are not enforced, the knowledge-base RAG holds 0 documents, and two AI usage tables still co-exist. |
| Evidence | Code verified: `supabase/functions/chat-ai`, `ai-orchestrator`, `ai-tyre-inspection` (`index.ts`, `budget.ts`, `logic.ts`), `src/lib/aiRouter.js`, `src/lib/agents/*`, `src/lib/api/aiOps.js`, `src/lib/selfHealing.js`, `src/lib/alertEngine.js`. Live counts measured 2026-11-10 (read-only). Design decisions taken from PROJECT_MEMORY. |
| Related docs | [16 API audit](16-api-audit.md), [21 Monitoring](21-monitoring-and-support-design.md), [19 Data governance](19-data-governance-plan.md), `docs/AI_TYRE_INSPECTION_HANDOVER.md`, `docs/AI_TYRE_INSPECTION_PRODUCTION_GATE.md`, `docs/AUTOMATION_PLATFORM_DEPLOYMENT.md`, `docs/WORKFLOW_NOTIFICATIONS.md` |

## 1. Architecture overview

```
Assistant question (web)
  1. src/lib/aiRouter.js classifyQuery picks one or more of 6 agents (src/lib/agents/*)
  2. the agent builds a COMPACT digest from data already loaded on the page
  3. edge fn chat-ai (single answer) or ai-orchestrator (tool use:
     get_exec_digest | count_records | list_recent_events | search_knowledge_base)
  4. Anthropic API call (model fixed in code)
  5. one ai_token_logs row (tokens, cost, status, latency)

Tyre photo (phone or web)
  1. row in ai_tyre_inspection_jobs
  2. cron ai-tyre-inspection-worker (*/5) plus an enqueue kick
  3. edge fn ai-tyre-inspection: quality gate, budget reservation, provider call, settle

Any business write
  1. trigger writes domain_events
  2. cron process-domain-events (every minute) runs event_consumers
  3. consumers queue workflow_notifications / webhook_deliveries
  4. cron deliver-workflow-notifications calls edge fn workflow-notify
  5. email (Resend) | push (Expo / FCM v1) | WhatsApp (Twilio)
```

Data access rule (standing): operational data reaches the model through DIRECT database tools, never through RAG. RAG is only for free-text documents (SOPs, manuals, policies) with no structured table. Structured first, RAG for documents.

## 2. AI components

| Component | Path | Status | Notes |
|---|---|---|---|
| Router | `src/lib/aiRouter.js` | Built | 6 agents: analyst, tyre_engineer, qa_data, planner, safety, procurement. Pattern ordering = specificity. |
| Agents | `src/lib/agents/{analyst,tyreEngineer,qaData,planner,safety,procurement}Agent.js` | Built | Each builds a digest client-side; procurement reuses `kpiEngine` CPK. |
| Assistant surface | `src/pages/AiCommandCenter.jsx` (`/ai-command-center`; `/ai` redirects) | Built | Single AI surface; the dark-only `AiAnalytics.jsx` is retired. |
| chat-ai edge fn | `supabase/functions/chat-ai/index.ts` | Built | Model hard-coded `claude-haiku-4-5-20251001`; client `model` param ignored. Response cache keyed by tenant+model+messages. |
| ai-orchestrator edge fn | `supabase/functions/ai-orchestrator/index.ts` | Built | Tool use: `get_exec_digest`, `search_knowledge_base`, `count_records`, `list_recent_events`. Same fixed model. |
| AI tyre photo inspection | `supabase/functions/ai-tyre-inspection/*` + `src/lib/api/aiTyreInspection.js` + `/ai-tyre-inspection` | Built, live | 870 completed / 8 failed jobs (live 2026-11-10). Model from `AI_MODEL` env, Gemini fallback `gemini-2.5-flash-lite`. |
| Ask your data | `src/lib/api/askData.js` + `/console/data-browser` | Built | Question to structured filter via chat-ai; the model never computes figures; query runs through safelisted `admin_db_query`. |
| Insurance email reader | `src/lib/insuranceEmailAnalysis.js` | Built | Grounded: citations limited to stored clause numbers; invented clauses dropped. |
| Copilot card | `src/components/CopilotCard.jsx` | Built | Observation / Root cause / Risk / Actions sections. |
| Accuracy + adjudication harness | `src/lib/aiTyreAccuracy.js`, `src/lib/aiTyreAdjudication.js`, `npm run ai:adjudicate` | Built (synthetic fixtures) | Real-photo expert adjudication still outstanding (memory 2026-10-25). |

## 3. Cost control and governance

| Control | Where enforced | Status |
|---|---|---|
| `ai_enabled` master switch | chat-ai, ai-orchestrator, ai-tyre-inspection read `system_config` at request time | Active (live value `true`) |
| `ai_monthly_budget_usd` | Assistant edge fns sum the month's `ai_token_logs.cost_usd`; tyre worker reserves atomically (`ai_tyre_reserve_budget_atomic`, `ai_tyre_settle_budget`) | Active (live value 20 USD). Tyre worker fails CLOSED and returns the job to pending with `failure_kind=monthly_budget_reached`. |
| `ai_rate_limit_per_min` | chat-ai / ai-orchestrator, 429 on breach | Active (live 10) |
| `ai_cache_ttl_hours` | chat-ai response cache | Active (live 24) |
| `ai_model` | NOT enforced. Live value is `claude-sonnet-4-6` but both assistant edge fns hard-code Haiku for safety; the console badge says saved-only. | Saved only, by decision |
| `ai_models` (V205) | Pricing source read by `src/lib/api/aiOps.js` for cost display | Read for display; 20 rows live |
| `ai_prompts`, `ai_budgets`, `ai_feedback` (V205) | Admin config only, not read at runtime | Not enforced; `ai_prompts` and `ai_budgets` hold 0 rows |
| `ai_permissions` | Not consumed | Not built |
| Concurrent-worker overshoot | Up to about workers x reservation per tick (memory 2026-10-25) | Known gap |

Usage tables: `ai_token_logs` is the single reader source (104 rows live; status success/error/rate_limited/blocked, http_status, latency_ms since V236). `ai_usage_log` has 0 rows and is read by nothing after the 2026-09-24 console fix. Recommendation: retire `ai_usage_log` (comment then drop after one release) rather than "converge" two tables.

## 4. RAG / knowledge base

| Item | State |
|---|---|
| Tables | `knowledge_documents` 0 rows, `document_chunks` 0 rows (live) |
| Indexing | cron `embed-knowledge-documents` */10 to `embed-worker` (x-cron-secret, OpenAI embeddings); `generate-embedding` for single docs |
| Retrieval | `search_knowledge_base` tool in ai-orchestrator; `match_knowledge_documents` (org check added V548) |
| Cache security | `ai_response_cache` / `document_chunks` client read removed (20260930120000) after a cross-tenant read was found |
| Assessment | Plumbing built and secured, but EMPTY. The spec's "Vector Database: SOPs, manuals, notes, reports" is not populated. The cron runs every 10 minutes against nothing. |

## 5. Automation: scheduled jobs (pg_cron, live 2026-11-10, 26 active)

| Job | Schedule (UTC) | Purpose |
|---|---|---|
| process-domain-events | every minute | Drains `domain_events` to `event_consumers` |
| deliver-workflow-notifications | every minute | Calls workflow-notify for queued notifications |
| deliver-webhooks | every minute | Sends queued `webhook_deliveries` |
| flag-changes-apply | every minute | Applies scheduled feature-flag changes |
| ai-tyre-inspection-worker | */5 | Drains the photo analysis queue |
| cron-health-watch | */5 | Watches other jobs (binary-searches `cron.job_run_details`, V-2026-10-11) |
| jit-elevation-expiry | */5 | Ends temporary access |
| embed-knowledge-documents | */10 | RAG indexing |
| qr-login-purge | */15 | Purges QR sign-in requests |
| send-scheduled-reports | */15 | Emails due scheduled reports |
| sentry-crash-alert | */15 | New fatal crash alert |
| user-issue-breach-check | */30 | Reported problems past target time |
| evaluate-alert-thresholds | hourly :05 | Alert rules |
| escalate-workflows | hourly :15 | Escalates stale approvals |
| workshop-status-notify | hourly :20 | Workshop status thresholds |
| due-alerts-scan | hourly :40 | Due alert engine |
| checklist_assignments_daily | 00:15 | Generates checklist assignments |
| nightly-backup | 00:30 | Core-table restore point |
| audit-seal-daily | 00:45 | Hash-chains yesterday's audit log |
| audit-log-retention | 01:15 | Purges audit/error LOG rows past `audit_retention_days` (365) |
| cron-run-history-retention | 01:47 | Keeps `cron.job_run_details` to 30 days |
| tenant-export-retention | 02:40 | Removes expired export files |
| driver-fine-daily-reminders | 05:15 | Driver fine reminders |
| upload-gap-check | 05:30 | Missing daily upload notices |
| accident-sla-scan | 06:30 | VOR SLA and overdue accident events |
| security-audit-weekly | Sunday 05:00 | `admin_security_posture` scan, alerts on new findings |

Plain-English descriptions live in `JOB_DESCRIPTIONS` in `src/lib/engineeringCenter.js`; 5 live jobs are missing there (ai-tyre-inspection-worker, cron-run-history-retention, due-alerts-scan, qr-login-purge, workshop-status-notify) and render "No description recorded".

## 6. Event bus, consumers and notifications

`domain_events` holds 222,611 rows (live). Consumers registered in `event_consumers` (all enabled):

| Consumer | Events |
|---|---|
| consume_event_workflows | any (auto-start approval workflows by trigger_event) |
| consume_event_webhooks | any (queues `webhook_deliveries` for active subscriptions; 2 subscriptions live) |
| consume_event_rules | any (evaluates `business_rules`; 1 rule live) |
| consume_event_workflow_notify | workflow.step_advanced / approved / rejected / returned |
| consume_event_approval_push | inspection / checklist .approval_requested |
| consume_event_assignment_push | workshop.job_assigned |
| consume_event_accident_notify | accident.reported / stage_changed / claim_changed / vor_changed / vor_sla_breach / overdue |
| consume_event_accident_case_notify | accident.workstream_assigned / approval_requested / closure_requested / closure_decided |

`workflow_notifications`: 4,259 delivered, 193 skipped (live). Pre-rendered `push` payloads let new alert types ship without an edge redeploy (due alerts, upload gaps, workshop status). `push_delivery_receipts`: 2,936 rows; 153 active `user_devices`.

Live setting to note: `system_config.accident_emails_enabled` reads `true` on 2026-11-10. PROJECT_MEMORY records it shipped OFF by default (V304); it has since been switched on by an operator. Treat accident case emails as LIVE.

## 7. Rule and alert engines

| Engine | Path / tables | Status |
|---|---|---|
| Alert rules (no-code) | `alert_thresholds` + `/console/alert-rules`, cron hourly | Built; 0 rules live. Rules notify in-app only (23 h cooldown); never email. |
| Due alerts | `due_alert_rules` (8 live) + `_due_items()` + `scan_due_alerts()` | Built. Vehicle document-expiry rules have no data (expiry dates empty on active vehicles, owner file pending). |
| Business rules | `business_rules` + `consume_event_rules` | Built; 1 rule |
| Accident routing | `accident_routing_rules`, `accident_email_templates`, departments (V302-V305) | Built |
| Approval matrix | `approval_matrix` + `resolve_approvers()` (V477) | Built; empty until configured |
| Self-healing | `src/lib/selfHealing.js` + `/console/self-healing` | Built: read-only scans + already-guarded recon fixes only |
| Anomaly | `src/lib/anomalyEngine.js`, `/ops-intelligence` | Built; client-side |
| Data trust alerts | `trust_alerts` + `scan_data_trust` (V475) | Built; 0 open (live) |
| Alert to anomaly "approaching threshold" | Requested by owner 2026-08-06 | Not built |

## 8. Gaps against spec sections 13 and 20

| Gap | Phase | Effort |
|---|---|---|
| Model choice not configurable (deliberate safety lock); `ai_model` config is misleading | 5 | S (document) / M (enable with allowlist) |
| `ai_prompts` / `ai_budgets` / `ai_permissions` not enforced at runtime | 5 | M |
| Per-org (tenant) AI budget, not only global | 5 | M |
| RAG has no documents; no ingestion UI flow tested end to end | 5 | M |
| Retire `ai_usage_log` | 2 | S |
| Concurrent-worker budget overshoot | 5 | S |
| AI feedback loop has no per-finding correction source | 5 | M |
| Real-photo expert adjudication of the tyre model | 5 | M |
| Alert rules cannot email; alert-to-anomaly "approaching" not built | 4 | M |
| 5 cron jobs missing plain-English descriptions | 1 | S |
| Embedding cron runs against an empty table | 1 | S (pause until documents exist) |

## Open decisions for the owner

- Keep the assistant model locked to Haiku in code, or allow a vetted list selectable from the console.
- Confirm accident case emails should stay ON (live value `true`).
- Per-company AI budgets once a second tenant exists.

## Next actions

1. Phase 1 (S): add the 5 missing job descriptions; pause or gate `embed-knowledge-documents` while `knowledge_documents` is empty.
2. Phase 2 (S): retire `ai_usage_log` (comment, release, drop).
3. Phase 5 (M): enforce `ai_budgets` per org and `ai_prompts` versions in chat-ai/ai-orchestrator, keeping env fallbacks.
4. Phase 5 (M): seed SOPs/manuals into `knowledge_documents` and test retrieval with citations.
5. Phase 4 (M): alert-rule email channel and "approaching threshold" anomaly level.
