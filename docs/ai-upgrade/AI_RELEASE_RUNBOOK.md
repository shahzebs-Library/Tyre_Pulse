# AI release runbook (chat-ai, ai-orchestrator, ai-tyre-inspection)

Owner decision required for every step. Nothing here has been run. No migration is needed for this release.
Project `jhssdmeruxtrlqnwfksc`. All three functions self-validate the JWT, so deploy with `--no-verify-jwt`
(keep `verify_jwt=false`, as today).

## 0. Before deploying

1. Web build and tests green on the merged branch: `npm run build`, `npx vitest run src/test/ai*.test.js`.
2. If Deno is available: `deno check supabase/functions/{chat-ai,ai-orchestrator,ai-tyre-inspection}/index.ts`.
3. Note the currently deployed version of each function (Supabase dashboard -> Edge Functions) for rollback.
4. Confirm function secrets: `ANTHROPIC_API_KEY`, `SUPABASE_ANON_KEY` (orchestrator tools run on the caller's
   JWT), `AI_WORKER_SECRET` (tyre worker), optional `OPENAI_API_KEY` (knowledge search), optional `AI_PROVIDER_KEY`.
5. Record `system_config` values: `ai_enabled`, `ai_monthly_budget_usd`, `ai_rate_limit_per_min`.

## 1. Deploy order (one at a time, smoke test between)

Each bundle now includes `_shared/aiSecurity.ts`; the CLI bundles `_shared/` automatically.

1. **chat-ai** (smallest change: limiter, payload validation, paged budget).
   `supabase functions deploy chat-ai --project-ref jhssdmeruxtrlqnwfksc --no-verify-jwt`
2. **ai-orchestrator** (agents, caller-JWT tools, hardening). Files: `index.ts`, `tools.ts`, `policy.ts`,
   `_shared/aiAgents.ts`, `_shared/aiSecurity.ts`, `_shared/auth.ts`.
   `supabase functions deploy ai-orchestrator --project-ref jhssdmeruxtrlqnwfksc --no-verify-jwt`
3. **ai-tyre-inspection** (account-state gate, photo bucket allow-list). Files: `index.ts`, `logic.ts`,
   `budget.ts`, `_shared/aiSecurity.ts`.
   `supabase functions deploy ai-tyre-inspection --project-ref jhssdmeruxtrlqnwfksc --no-verify-jwt`
4. Web app (Vercel `tyre-pulse`) last, through the normal single merge to main. The web degrades gracefully
   against the old functions, so the order web-last is safe.

After each deploy download it back and diff against the repo (`supabase functions download <name>`).

## 2. Smoke tests per role

Use real accounts, read-only questions. Expected results:

| Account | Request | Expected |
|---|---|---|
| Admin / super admin | Command Center: "fleet CPK by vehicle type for KSA last 3 months" | Answer with `[source-N]`, `agents` includes analyst, `coverage` lists `get_fleet_cpk` ok |
| KSA-only Manager | "fleet CPK for UAE" | Tool reports unavailable/forbidden; answer says no UAE data is available to them. Must not show AED figures |
| KSA-only Manager | "fleet CPK" (no country) | KSA only |
| Egypt user (Tyre Data Collector) | "tyres due for replacement" | Egypt rows only; Procurement request refused (403 text) |
| Tyre Man | "which brand should we buy" with agent=procurement | 403 "Your role cannot use the Procurement..." |
| Tire Planning Engineer | "replacement plan next quarter" | Planner answers with a stated basis |
| Welder / Reporter | any question | 403 "not enabled for your role" |
| Any user | reuse another user's `conversation_id` | 404 "Conversation not found" |
| Admin | chat-ai copilot (accident summary, insurance email analysis) | Works as before |
| Admin | send 25 chat requests in a minute (limit 20) | 429 after the limit, row in `ai_token_logs` status `rate_limited` |
| Locked test account (valid session) | tyre photo "screen" / review | 401, no job created |
| Maintenance Supervisor | enqueue AI review on an inspection with photos | Jobs created for `tyre-photos` refs; worker processes on next run |

## 3. Monitoring (first 72 hours)

1. `ai_token_logs` by feature and status: spikes in `error`, `blocked` (503 = a control could not be read),
   `rate_limited`. A sudden rise of 503 means `system_config` or the budget read is failing (fail closed).
2. Edge function logs: `[ai-orchestrator] tool threw`, `[chat-ai] ... failed`, `Anthropic error`.
3. `ai_tyre_inspection_jobs`: pending count draining, `failure_kind` distribution; no new jobs with a bucket
   other than `tyre-photos` (expected: none).
4. Monthly spend vs `ai_monthly_budget_usd` (AI Cost Monitor page).
5. Support reports of "assistant not enabled for your role" from roles that should have access: adjust
   `ROLE_AGENTS` in `_shared/aiAgents.ts` and redeploy the orchestrator.
6. chat-ai 400 "Request too large": a client prompt exceeded 150k chars; raise `CHAT_LIMITS` only after
   checking which screen sends it.

## 4. Rollback

1. Per function: redeploy the previous version noted in step 0.3 from the dashboard (or `git checkout <prev>`
   of the function folder and `supabase functions deploy`). Functions are independent; roll back only the
   failing one.
2. Emergency stop without a deploy: set `system_config.ai_enabled = 'false'` (all three functions honour it;
   tyre worker stops calling the provider).
3. Web: the Command Center reads `agents`/`coverage` only when present, so old functions keep working with the
   new web build; revert the web merge only if a web defect is found.
4. No data migration to reverse.

## 5. Not covered by this release

Expert-labelled photo benchmark (F9), knowledge-base content (F10), atomic orchestrator budget (F11),
answer feedback loop (F12), `domain_events` country scoping for `list_recent_events`, and the
`match_knowledge_documents` NULL-org branch (see AI_SECURITY_VALIDATION_2026-11.md section 4).
