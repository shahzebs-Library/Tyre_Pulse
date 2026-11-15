# AI readiness audit

Date 2026-11-12. Read-only. Code read on the working tree (branch `claude/tyrepulse-inspector-build-7rxp2t`);
database read with SELECT only on project `jhssdmeruxtrlqnwfksc`. Counts only, no customer records.

## 1. The two verdicts

| Verdict | Result | Why |
|---|---|---|
| Internal Production Readiness (current company) | READY AS AN ASSISTIVE TOOL, AT RISK IF TRUSTED AS FACT | The AI stack is read-only, cost-capped (USD 20 a month, global), fails closed and has spent under USD 1.20 in total. Nothing it produces changes a record. But photo findings have never been measured for accuracy and 940 of 943 results have never been looked at by a reviewer. |
| Commercial SaaS Readiness (a second company) | NOT READY. Class 4 (incomplete) for tenant controls, Class 3 for the chat paths | Budget, daily photo limit, kill switches, rate-limit setting and model choice are platform-wide, not per company. Agent role names, the country list and the currency text are written for the current company. Photo accuracy is unmeasured, so it cannot be sold as a verified capability. The privacy policy does not disclose that photos and fleet data are sent to AI providers. |

Counts by severity: P0 0, P1 5, P2 8, P3 4.

## 2. The stack as it really is

### 2.1 How many agents

The owner calls it six agents. There are two different things in the code:

| Where | Count | Names | Status |
|---|---|---|---|
| Server registry `supabase/functions/_shared/aiAgents.ts:9-17` | 7 | analyst, tyre_engineer, qa_data, planner, safety, procurement, cost_audit | LIVE. Used by `ai-orchestrator` and by the web Smart Analytics page through `src/lib/aiRouter.js:9`. The file header still says "six" (line 1). |
| Client agents `src/lib/agents/*.js` | 6 | analyst, tyreEngineer, qaData, planner, safety, procurement | DEAD CODE. No page or component imports them (grep of `src` outside `src/lib/agents/` and tests returns nothing). They call `chat-ai` with a browser-built prompt. Only tests keep them alive. |

So the true answer is seven server agents. The seventh, Tyre Cost Audit, is a dry-run reader over the
deterministic `tyre_cost_audit_scan` RPC.

### 2.2 What each agent can actually do

Every agent is read-only. There is no write tool (`ai-orchestrator/policy.ts:4-22`, every tool `risk: 'read'`; a
non-read tool is refused outright at `policy.ts:37-40`). An agent is a system prompt plus a tool allow-list.

| Agent | Tools (all read) | Real capability | Limits |
|---|---|---|---|
| Fleet Analyst | get_country_kpi, get_cost_cpk_overview, get_fleet_cpk, get_brand_size_cpk, get_tyre_consumption, get_maintenance_snapshot, count_records, list_recent_events, knowledge search | Restates the same RPC numbers the screens show | Tool output cut at 12,000 characters (`tools.ts:19,115-119`), flagged as truncated |
| Tyre Engineer | running life, exceptions, evidence audit, CPK, counts, knowledge | Lists hypotheses from 8 written wear rules (`aiAgents.ts:54-103`) | Cannot see photos, pressure history, load or alignment. Prompt tells it to say evidence is missing. It is a rule reciter, not a diagnosis. |
| QA and Data Integrity | data trust, evidence audit, exceptions, counts | Lists data problems | Proposes only |
| Maintenance Planner | running life, consumption, maintenance snapshot, CPK | Replacement lists from running life | Max 50 tyres per call (`tools.ts:163`) |
| Safety and HSE | counts, events, exceptions, running life | Counts and overdue items | Prompt forbids certifying a tyre or vehicle safe |
| Procurement | brand and size CPK, consumption | Brand comparison with sample sizes | `tyre_records.brand` and supplier data are thin (PROJECT_MEMORY) |
| Tyre Cost Audit | tyre_cost_audit_scan (dry run), exceptions, counts | Restates the deterministic audit | Never invents a price |

Live use to date: ONE orchestrator call ever (`ai_token_logs` feature orchestrator: 1 row; `ai_conversations` 1,
`ai_messages` 4). The agent layer is effectively untested in production.

### 2.3 The four AI paths

| Path | Function (deployed version) | Who can call | Data access | Grounding |
|---|---|---|---|---|
| Agent chat | `ai-orchestrator` (v14) | Approved users whose raw role is in `ROLE_AGENTS` (`aiAgents.ts:206-219`) | Tools run on the CALLER's JWT (`index.ts:159-165`, `tools.ts:3-6`): RLS and RPC country guards apply. Service role only for logging, conversation rows and budget. | Server side: provenance on every tool result, sources list, `grounded` flag |
| Free chat | `chat-ai` (v27) | admin, manager, director (`chat-ai/index.ts:118`) | None. The browser or phone sends the system prompt (up to 60,000 characters) and any data it fetched (`aiSecurity.ts:60-65,109-113`) | NONE on the server. Whatever the client sends is the truth for the model. |
| Photo inspection | `ai-tyre-inspection` (v24) | Enqueue: admin, manager, director, maintenance supervisor, tyre man. Worker: cron with shared secret | Service role, own-organisation checks in code | Fixed prompt, fixed 14 defect tokens |
| Knowledge base | `embed-worker` (v11), `generate-embedding` (v21), RPC `match_knowledge_documents` | Cron; admin, manager, director | Organisation-scoped in the RPC | Approved, in-date documents only, citation string |

Callers of `chat-ai` today: web CopilotCard, Ask-your-data, upload helper, insurance letter reader; Expo
`mobile/app/(app)/ai/index.tsx:438` and `admin/ai-chat.tsx:158`; Flutter `admin_repository.dart:264`.

## 3. Live facts (VERIFIED by SQL, 2026-11-12)

| Fact | Value |
|---|---|
| Photo jobs | 943 total: 935 completed, 8 failed. One organisation. First 2026-10-22, last today |
| Photo reviews by a person | accepted 2, rejected 1, unreviewed 940 |
| Expert labels (`ai_tyre_expert_labels`) | 0 |
| Prompt version on jobs | none 38, v1 56, v2 401, v3 448. Jobs created in the last 3 days: all v3 (81). Repo is v4. |
| Photo model recorded | `claude-haiku-5-5` on 937 jobs |
| Reused analyses (cache hits) | 0 |
| Photo spend recorded | USD 0.88 on jobs, plus 64 logged failed calls USD 0.06 |
| Chat calls (`chat-ai`) | 39, USD 0.24. 11 of the 39 rows have no organisation |
| Orchestrator calls | 1, USD 0.01 |
| `ai_usage_log` | 0 rows (dead table, still written fire-and-forget) |
| `ai_budget_reservations` | 0 rows (the reserve path has never run live, or the deployed function predates it) |
| `system_config` AI keys | ai_enabled true, ai_orchestrator_enabled true, ai_tyre_inspection_enabled true, ai_monthly_budget_usd 20, ai_rate_limit_per_min 10, ai_cache_ttl_hours 24, ai_model `claude-sonnet-4-6` (ignored, model is locked in code) |
| `ai_budgets` (per-organisation budget table) | 0 rows, read by no runtime code |
| Knowledge base | 0 documents, 0 embedded |
| `ai_feedback` | 0 rows |
| `ai_proposals` | 0 rows |
| `ai_response_cache` | 39 rows. `brain_cache` 29,570 rows |

## 4. Capability classification

| Capability | Class | Basis |
|---|---|---|
| Deterministic expense classifier ("classification brain", `brain_cache`) | COMMERCIALLY VALIDATED as rules, not AI | Rule engine with human review precedence, checked against 216k stored rows (PROJECT_MEMORY V370-V373). It is not a model. Rules are tuned to this customer's ERP item codes (see AI-13). |
| Action Center "AI proposals" | NOT AI. Deterministic detectors (`src/lib/aiProposals.js` `detectProposals`), person accepts or rejects. Never run live (0 rows). EXPERIMENTAL until used. |
| Agent chat (7 agents, orchestrator) | EXPERIMENTAL | One live call. Design is sound (caller JWT, read-only, provenance). No evaluation set has been run against live answers. |
| Free chat (`chat-ai`, CopilotCard, mobile AI chat, Ask-your-data) | EXPERIMENTAL, NOT GROUNDED | No server grounding. Numbers come from whatever the client fetched. |
| Insurance letter reader | EXPERIMENTAL | Grounding is client side (drops invented clause numbers). Uses `chat-ai`. |
| Tyre photo defect flagging | EXPERIMENTAL | 0 expert labels, 3 of 943 reviewed, accuracy never measured. |
| Knowledge base answers with citations | NOT WORKING TODAY (no content) / EXPERIMENTAL | 0 documents. Retrieval code and lifecycle exist; never exercised. Needs `OPENAI_API_KEY` (presence NOT VERIFIED). |
| Feedback loop, offline evaluation (`aiEvaluation.js`, `scripts/ai-eval.mjs`) | NOT WORKING TODAY (no data) | 0 feedback rows. |
| Photo accuracy harness (`aiTyreAccuracy.js`, `scripts/ai-accuracy.mjs`, `npm run ai:adjudicate`) | BUILT, NEVER RUN ON REAL DATA | 0 labels. Fixtures are synthetic (PROJECT_MEMORY 2026-10-25). |
| AI root cause "diagnosis" | NOT A CAPABILITY | The Tyre Engineer agent has no measurement input. It lists possible causes from written rules. |

### Must NOT be presented as verified engineering fact

1. Any tyre photo finding (defect type, severity, "no defect"). It is an unvalidated model reading.
2. A "clean" photo result as proof the tyre is serviceable. The prompt forbids roadworthiness statements
   (`ai-tyre-inspection/index.ts:354`) but a result with no defects can be read that way.
3. Tread depth, remaining life, pressure or kilometres from a photo. The prompt forbids these; none may be quoted.
4. Any root cause from the Tyre Engineer agent. It is a hypothesis list.
5. Any figure from `chat-ai` based surfaces (CopilotCard, mobile AI chat, Flutter admin chat). No server check.
6. Forecasts from the Planner agent. They are estimates from running-life data.
7. Any accuracy percentage for the photo feature. None exists.
8. "AI proposals" as AI. They are rule detectors.

## 5. Findings

### AI-1 Photo inspection accuracy has never been measured
- Severity P1. Confidence VERIFIED.
- Evidence: `ai_tyre_expert_labels` 0 rows; `ai_tyre_inspection_jobs.review_status` accepted 2, rejected 1,
  unreviewed 940. Harness exists (`src/lib/aiTyreAccuracy.js`, `scripts/ai-accuracy.mjs`) and has no input.
- What exists: 935 completed analyses shown in the app and in reports. What should be: a holdout set of
  expert-labelled photos (the project skill says under about 500 labels a figure is only a hint) and a stated
  precision and recall per defect class before any claim. What happens: results are displayed with no measured
  error rate.
- Internal: at risk (used as a hint only if the team knows that). Commercial: Class 4.
- Impact on a second company: cannot be sold or demonstrated as a working detector. A missed bulge or exposed
  cord that the customer believed was screened is a safety and liability exposure.
- Fix: label a stratified sample (aim 500 or more, per position and defect type), run `npm run ai:adjudicate`
  and `scripts/ai-accuracy.mjs`, publish the figure with its sample size inside the product, and show
  "unverified AI reading" on every result until reviewed. Risk to current company: none (additive).
- Acceptance test: `select count(*) from ai_tyre_expert_labels` at or above the agreed sample; a stored
  accuracy report by prompt version; UI label present on unreviewed results.
- Area: owner action (labelling), web, Flutter.

### AI-2 AI budget, daily limit and switches are platform-wide, not per company
- Severity P1. Confidence VERIFIED.
- Evidence: `ai_month_spend_usd()` sums every row with no organisation filter (migration
  `20261112100000_ai_orchestrator_budget.sql:117-141`); `ai-tyre-inspection/budget.ts:14` ("Month totals are
  GLOBAL (all tenants, all AI features)"); `chat-ai/index.ts:151` ("Global across the platform");
  `AI_DAILY_LIMIT_USD` default 1 for the whole worker (`ai-tyre-inspection/index.ts:367`); `ai_budgets` has 0
  rows and no runtime reader; `subscription_plans.features.ai_tools` is not read by any edge function.
- What happens with two companies: one company's usage exhausts the USD 20 month or the USD 1 day for
  everyone. The photo queue is drained oldest first across all companies (`index.ts:465-468`), so a backfill by
  one company (up to 100 pages of 50 inspections) starves the others. Turning AI off turns it off for all.
- Internal: ready (one tenant, the global cap is the tenant cap). Commercial: Class 4.
- Fix: add an optional per-organisation cap (read `ai_budgets` or a plan limit) checked inside the existing
  reserve RPCs in addition to the global cap; per-organisation fair queueing in the worker; honour
  `ai_tools` plan flag. Keep the global cap as the outer limit. Risk to current company: low (additive check;
  with no per-organisation row behaviour is unchanged).
- Acceptance test: two test organisations, one at its cap gets 402 while the other still gets answers; worker
  processes jobs from both in one drain.
- Area: DB, edge fn.

### AI-3 Deployed photo worker is behind the repository (prompt v3 live, v4 in repo)
- Severity P2. Confidence VERIFIED for the photo worker; NOT VERIFIED byte for byte for the other functions.
- Evidence: jobs created in the last 3 days all carry `tyre-photo-v3`; `logic.ts:21` says `tyre-photo-v4`.
  PROJECT_MEMORY (2026-11-11) records the redeploy as deferred because the tool route risks truncation and
  the CLI was not authenticated. `chat-ai` v27 and `ai-orchestrator` v14 were last updated on the same day as
  the photo worker; they were not byte-compared in this audit.
- Impact: the 14 fixed defect tokens and the "uncertain" rule (v4) are not live, so defect types are still
  free text from v3. Any accuracy labelling done now measures v3.
- Internal: at risk (low). Commercial: Class 3.
- Fix: deploy with the manual workflow `.github/workflows/deploy-edge-functions.yml`, then byte-compare.
  Label only after v4 is live. Risk to current company: low (follow the deploy and diff routine).
- Acceptance test: new jobs carry `tyre-photo-v4`; downloaded function equals the repo file.
- Area: ops, owner action.

### AI-4 Free chat (`chat-ai`) has no server grounding and accepts a client system prompt
- Severity P2. Confidence VERIFIED.
- Evidence: `chat-ai/index.ts:131-133,221-234` forwards `system` and `messages` from the request body;
  `aiSecurity.ts:109-113` only limits size. Model is locked server side, roles are limited to admin, manager,
  director.
- What happens: it is a general model relay for elevated users. Answers on the mobile AI screen, the Flutter
  admin chat and CopilotCard are only as correct as the client-built digest. There is no provenance, no
  source list, no country guard beyond what the client fetched under RLS.
- Internal: at risk (acceptable for three elevated roles who understand it). Commercial: Class 3.
- Fix: move the mobile and CopilotCard chat to `ai-orchestrator`, keep `chat-ai` for narrow parse-only tasks
  with server-held prompts. Risk to current company: low to medium (behaviour of the mobile chat changes;
  needs a mobile build).
- Acceptance test: a request with a custom `system` field is refused or ignored; mobile chat answers carry
  sources.
- Area: edge fn, web, Flutter, Expo.

### AI-5 Monthly cap in `chat-ai` is read-then-call, not atomic, and chat rows carry no organisation
- Severity P2. Confidence VERIFIED.
- Evidence: `chat-ai/index.ts:152-165` reads spend then calls; the insert at `:271-281` has no
  `organisation_id` (11 of 39 live chat rows are null; the rest are filled by a column default). The
  orchestrator and photo worker use atomic reserve RPCs; chat does not.
- Impact: concurrent chat calls can overshoot the cap by a few cents each; per-company cost reporting from
  `ai_token_logs` is incomplete, and the RLS org policy hides null-organisation rows from company admins.
- Internal: ready (trivial amounts). Commercial: Class 3.
- Fix: route `chat-ai` through `ai_orchestrator_reserve_budget` with feature 'chat' and write the
  organisation. Risk: low.
- Acceptance test: every new `ai_token_logs` row has an organisation; a reservation row exists per chat call.
- Area: edge fn.

### AI-6 Agent access, country list and currency wording are written for the current company
- Severity P1 for commercial. Confidence VERIFIED.
- Evidence: `ROLE_AGENTS` (`aiAgents.ts:206-219`) lists this customer's custom roles (pmv_manager,
  workshop_maintenance_area_manager, tire_planning_engineer, tyre_data_collector); an unknown role gets no
  agents (`:225-231`). `cleanCountry` accepts only KSA, UAE, Egypt (`tools.ts:72-79`); any other country is
  silently dropped and the tool runs for "every country the user can see". The Analyst prompt names the three
  currencies (`aiAgents.ts:129`). The evidence audit tool defaults to 2025-01-01 (`tools.ts:169,175`), a date
  that is this customer's data baseline.
- What happens for a new company: custom roles get "The AI assistant is not enabled for your role"; a company
  in another country can never scope a question to its country; the baseline date is meaningless.
- Internal: ready. Commercial: Class 3.
- Fix: derive agent access from the permission matrix (a module key per agent) with the current map as the
  default; read countries from the tenant's settings; pass currency from data, not the prompt. Risk: low if the
  current map stays as the fallback.
- Acceptance test: a second organisation with a custom role and a fourth country can use an agent scoped to
  that country.
- Area: edge fn, web.

### AI-7 Privacy policy does not disclose AI processing by third parties
- Severity P1. Confidence VERIFIED.
- Evidence: `src/pages/Privacy.jsx:62-65` states the only data shared with a third party is diagnostics sent
  to Sentry. In fact inspection photos go to Anthropic and, on fallback, Google
  (`ai-tyre-inspection/index.ts:285-300,374-379`); chat content and fleet figures go to Anthropic
  (`chat-ai/index.ts:221`, `ai-orchestrator/index.ts:330`); knowledge text goes to OpenAI
  (`embed-worker/index.ts:85`). Photos can contain people, plates and locations.
- Internal: at risk (the current company's users are covered by an untrue statement). Commercial: Class 3
  (a buyer's security questionnaire will ask for sub-processors).
- Fix: list AI sub-processors and what is sent; add a per-company switch to keep photos out of AI; confirm
  provider data-retention terms (NOT VERIFIED here). Risk: none.
- Acceptance test: policy text names each provider; a company with the switch off has zero new jobs.
- Area: web (legal page), owner action, edge fn.

### AI-8 Almost nothing is reviewed, and unreviewed results look the same as reviewed ones
- Severity P2. Confidence VERIFIED (counts), PLAUSIBLE (UI presentation not rendered in a browser here).
- Evidence: 940 of 943 unreviewed. Review is role-gated and atomic (`index.ts:257-277`).
- Impact: the human check that the marketing copy relies on ("for your team to check") is not happening.
- Internal: at risk. Commercial: Class 3.
- Fix: a review queue with a target (for example every high or urgent finding within one day), and a
  dashboard tile for the unreviewed count. Risk: none.
- Area: web, owner action (process).

### AI-9 Previous-reading comparison ignores country
- Severity P2. Confidence VERIFIED (code).
- Evidence: `loadPrevious` (`ai-tyre-inspection/index.ts:400-413`) matches on organisation, asset number and
  position only. PROJECT_MEMORY V376 records that the same asset code in two countries is usually a different
  machine (239 shared codes).
- Impact: the "contradicts previous inspection" flag can compare two different machines.
- Internal: at risk (low; all photo jobs so far are from one country). Commercial: Class 3.
- Fix: add country (and prefer vehicle id) to the match. Risk: none.
- Area: edge fn.

### AI-10 Wheel position is taken from the form key, with no check that the photo shows that wheel
- Severity P3. Confidence VERIFIED (code).
- Evidence: `tyre_position` is the key of `inspections.tyre_conditions` (`index.ts:104-113`). The model is
  not told the position and does not verify it. The only cross-check is the history flag in AI-9.
- Impact: a photo attached to the wrong wheel yields a confident finding on the wrong position.
- Fix: none needed in code beyond AI-9; state it in the UI ("position as recorded by the inspector").
- Area: web, Flutter.

### AI-11 Automatic queue analyses defect-marked wheels only
- Severity P3. Confidence VERIFIED.
- Evidence: `eligibleCondition` (`index.ts:67-69,108`) queues a photo only when the inspector already marked
  worn, damaged, cut and similar. Healthy wheels are analysed only on a manual "screen" action.
- Impact: the feature confirms what the inspector found; it does not screen for missed defects by default.
  Marketing wording "flags possible tyre defects from inspection photos" is literally true but reads wider.
- Area: marketing, web.

### AI-12 Knowledge base has no content and embedding depends on an unverified secret
- Severity P2. Confidence VERIFIED (0 rows), NOT VERIFIED (`OPENAI_API_KEY` presence; the worker returns
  `skipped` quietly when it is missing, `embed-worker/index.ts:59-64`).
- What exists: approved-only lifecycle, organisation-scoped retrieval (`match_knowledge_documents` filters
  `organisation_id` and checks the caller's organisation), citations (`knowledge.ts:39-45`), a "do not invent
  policy" note when nothing matches (`knowledge.ts:9-12`). Embedding cost rows carry no organisation
  (`embed-worker/index.ts:123-131`).
- Internal: not in use. Commercial: Class 2 once tested with real documents; Class 4 today.
- Fix: load 5 to 10 real SOPs, approve, run retrieval questions, record results. Risk: none.
- Area: owner action, edge fn (organisation on cost rows).

### AI-13 Deterministic classifier rules are tuned to one ERP
- Severity P2 for commercial. Confidence VERIFIED (PROJECT_MEMORY V370-V373: code ranges `310xxx`,
  `TI-GE-*`, `OL-*`, brand list).
- Impact: a new company's item codes fall to the default bucket; tyre against spare split will be weaker until
  its material master is reviewed. `brain_cache` is organisation-scoped (policy `brain_cache_org_isolation`).
- Internal: ready. Commercial: Class 2 (needs customer setup).
- Area: DB, onboarding.

### AI-14 Rate limits
- Severity P3. Confidence VERIFIED.
- Per user, per minute (config, 10) and per day (500), counted on `ai_token_logs`, fail closed
  (`ai-orchestrator/index.ts:194-218`, `chat-ai/index.ts:168-192`). The per-minute value is one global
  setting. Cached chat answers return after the limit check but do not count toward it. No per-company limit.
- Area: edge fn.

### AI-15 Prompt-injection defences: adequate for a read-only assistant
- Severity P3 (residual). Confidence VERIFIED (code and tests present; tests not executed in this audit).
- What exists: tool output wrapped as untrusted (`ai-orchestrator/index.ts:393`), control characters stripped
  from echoed inputs (`aiSecurity.ts:52-57`), refusal reasons reduced to short tokens (`:25-28`), error text
  mapped to fixed phrases (`:14-20`), browser cannot forge tool results or images in `chat-ai` (`:69-82`),
  photo bucket allow-list (`:152-165`), conversation ownership check (`:42-45`), no write tools, tools scoped
  by agent (`policy.ts:33-35`). No backslash-u escapes in function source (grep empty).
- Residual: a poisoned record or document can still steer wording of an answer; it cannot widen data access
  (caller JWT) or change data. The photo prompt has no defence against text painted on a tyre, low impact.
- Area: none required.

### AI-16 Failure handling
- Confidence VERIFIED (code). Photo worker: quality gate before spend (`logic.ts:107,349-351`), automatic
  retry only for failures that cannot have been billed (`logic.ts:31`), stalled jobs failed for manual review
  (`index.ts:392-394`), fallback provider only when a second key exists (`index.ts:374-379`, key presence NOT
  VERIFIED), reuse of identical bytes within one organisation and prompt version (`index.ts:448-456`, never
  hit live). 64 failed provider calls are logged against 8 jobs left failed. Orchestrator: budget settle on
  every exit, plain message on failure.
- Gap: failed photo jobs are not surfaced as an alert; `ai_usage_log` is still written and is empty (P3).

### AI-17 Model configuration is misleading
- Severity P3. Confidence VERIFIED.
- `system_config.ai_model` is `claude-sonnet-4-6`; chat and orchestrator are locked to
  `claude-haiku-4-5-20251001` (`chat-ai/index.ts:7`, `ai-orchestrator/index.ts:33`); the photo worker uses
  `AI_MODEL` or defaults to `claude-haiku-5-5` (`ai-tyre-inspection/index.ts:364`). Whether the per-token
  rates used for that model are correct is NOT VERIFIED (rates come from function secrets).
- Fix: remove or label the console setting; record model and rate source per job. Risk: none.

## 6. Multi-tenant isolation of AI data

| Object | Isolated per company | Evidence |
|---|---|---|
| `ai_tyre_inspection_jobs` | Yes | Read policy on organisation; writes only by the function with explicit organisation checks |
| `ai_tyre_expert_labels`, `ai_feedback`, `ai_proposals` | Yes | RESTRICTIVE organisation policies |
| `ai_conversations`, `ai_messages` | Per user | Owner-only policies; no organisation policy needed |
| `knowledge_documents` and retrieval | Yes | RESTRICTIVE organisation and country policies; RPC filters organisation |
| `ai_response_cache` | Per user by construction | No organisation column, RLS deny-all to clients; cache key includes the user id (`chat-ai/index.ts:197`) |
| `brain_cache` | Yes | Organisation policy; key includes organisation |
| `ai_token_logs` | Partly | Organisation policy exists, but chat, embedding and failure rows can have no organisation and are then invisible to the company |
| `ai_budget_reservations` | Platform owner only | Super-admin read |
| Budget, daily limit, kill switches, rate setting, model | NO | Global (AI-2) |
| `ai_models`, `ai_prompts`, `ai_budgets` | Organisation-scoped config tables | Not read at runtime; pricing is hard-coded in the functions |
| Photo storage | Allow-listed bucket `tyre-photos`; path isolation NOT VERIFIED here (see TENANCY_SECURITY.md) |

## 7. Recommended order

1. AI-7 disclose AI sub-processors (text change, no risk).
2. AI-3 deploy the repo versions and byte-compare.
3. AI-1 and AI-8 label, measure, add the "unverified" marker and a review target.
4. AI-2 and AI-5 per-company caps and organisation on every cost row.
5. AI-6 tenant-driven roles, countries and currency.
6. AI-4 move chat surfaces to the grounded orchestrator.

## 8. Not verified

- Byte equality of deployed `chat-ai`, `ai-orchestrator`, `embed-worker` with the repo.
- Presence and names of function secrets (`OPENAI_API_KEY`, `AI_PROVIDER_KEY`, `AI_WORKER_SECRET`, rate
  overrides) and the vault entries the cron dispatcher reads.
- Provider data-retention and training terms for the accounts in use.
- How unreviewed photo results are labelled on screen (not rendered here).
- The security test suites were read, not executed.
- Storage path isolation between organisations for `tyre-photos`.
