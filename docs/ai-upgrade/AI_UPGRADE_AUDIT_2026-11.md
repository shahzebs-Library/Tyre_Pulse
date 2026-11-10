# Tyre Pulse AI upgrade: audit, gap matrix and status (2026-11-10)

Branch `claude/tyrepulse-inspector-build-7rxp2t`. Nothing merged, deployed or applied.
Live figures were read (read-only) from project `jhssdmeruxtrlqnwfksc`.

## 1. Confirmed findings (before this work)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | The six agents never ran on the server. The Command Center sent `agent`, the orchestrator only stored it as a label and used one generic prompt. The client agent modules (`src/lib/agents/*`) are not called by the Command Center. | `ai-orchestrator/index.ts` (pre-change), `AiCommandCenter.jsx` imports | High |
| F2 | AI data tools ran with the SERVICE ROLE scoped only by org. `report_exec_digest(p_org)` returned org-wide figures, so a country-scoped user (for example a KSA-only manager) could read UAE/Egypt figures through the assistant. Same class as V545-V576. | `runTool(svc, orgId, ...)` | High (security) |
| F3 | The rate limiter counted `ai_usage_log`, which holds 0 rows, so it never limited anything. `ai_token_logs` is the table that is actually written. | live counts: ai_usage_log 0, ai_token_logs 104 | Medium |
| F4 | Wrong engineering guidance in the Tyre Engineer prompt: "Under-inflation -> centre wear". Under-inflation indicates SHOULDER wear; over-inflation indicates centre wear. Causes were presented as findings, not hypotheses. | `tyreEngineerAgent.js` | High (correctness) |
| F5 | Tools did not use the authoritative calc RPCs (weighted fleet CPK, running life, evidence audit, exceptions). The model could only see a digest and counts. | tool catalog | High |
| F6 | No coverage/provenance in answers: no data window, row count, truncation or "nothing retrieved" signal. | response shape | Medium |
| F7 | Only Admin/Manager/Director could use the assistant; Tyre Engineer, Tyre Man and Tyre Data Collector were refused, and custom roles fold to "reporter" in `normaliseRole`. | `requireApprovedRole(req, ['admin','manager','director'])` | Medium |
| F8 | Photo accuracy gate below owner targets: 50 cases, P 0.80, R 0.85, assessable 0.90, no confidence intervals, no floor on dangerous-defect sample size. | `aiTyreAccuracy.js` | Medium |
| F9 | AI photo inspection: 883 jobs, only 3 human-reviewed (2 accepted, 1 rejected), 880 unreviewed. No expert-labelled set exists, so no real accuracy figure can be stated. | live `ai_tyre_inspection_jobs` | Blocker for benchmark |
| F10 | Knowledge base is empty: `knowledge_documents` 0, `document_chunks` 0. RAG answers "no matching documents". Needs approved documents and `OPENAI_API_KEY` for embeddings. | live counts | Blocker for KB |
| F11 | Monthly AI budget check is a read-then-call (not an atomic reservation) in `ai-orchestrator`. `ai-tyre-inspection` already reserves atomically. | code | Medium |
| F12 | `ai_feedback` (0 rows) and `ai_prompts` (0 rows) exist but nothing writes them; there is no supervised learning loop for chat answers. | live counts | Medium |

## 2. Gap matrix

| Area | State |
|---|---|
| Engineering calcs (weighted CPK, one price per tyre, km rule, running life, evidence audit from 2025-01-01) | Implemented + tested + live (previous sessions). Not re-implemented here; the AI now READS them. |
| Six agents end to end | **Fixed this branch** (server registry, routing, prompts, tool gating). Not yet deployed. |
| Real-time data intelligence with provenance | **Fixed this branch** (13 read-only tools on the caller's JWT, provenance, truncation flags). Not deployed. |
| Country/site isolation for AI | **Fixed this branch** (RLS + RPC guards via user client). Not deployed. |
| Rate limiting | **Fixed this branch** (ai_token_logs). Not deployed. |
| Role/agent access | **Added this branch**, deny-by-default per raw role. |
| Photo inspection pipeline (idempotency, budget, retries, reuse, quality gate) | Implemented + deployed (v23). |
| Photo accuracy release gate | **Added this branch** (500 cases, P .90, R .95, assess .95, 0 dangerous misses with >= 60 dangerous labels, Wilson CIs, split leakage). |
| Real-photo benchmark | **Blocked**: needs expert labels (F9). |
| Knowledge base | Code exists; **blocked** on content + embeddings key (F10). |
| Supervised learning loop for chat | Missing (F12). Tyre classification learning (V400/V471) exists for data, not for AI answers. |
| Atomic budget for orchestrator | Missing (F11). |
| Intelligent automation (domain events, approvals) | Event bus + approvals exist; AI-prepared proposals not built. |

## 3. What changed (this branch)

| File | Why |
|---|---|
| `supabase/functions/_shared/aiAgents.ts` (new) | Single registry: agent patterns, prompts, tools, wear rules, role access. Pure TS shared by server, client and tests. |
| `supabase/functions/ai-orchestrator/tools.ts` (new) | Read-only tools over authoritative RPCs, input sanitising, provenance, truncation, safe errors. |
| `supabase/functions/ai-orchestrator/policy.ts` | 13 read tools registered; per-request tool allow-list. |
| `supabase/functions/ai-orchestrator/index.ts` | User-scoped client for tools, agent resolution, role gate, ai_token_logs rate limit, coverage + grounded flag in response, richer logging. Service-role digest removed. |
| `src/lib/aiRouter.js` | Imports the classifier from the shared registry. |
| `src/lib/agents/tyreEngineerAgent.js` | Corrected wear guidance (shared WEAR_RULES). |
| `src/lib/aiCoverage.js` (new), `src/pages/AiCommandCenter.jsx` | Shows the agents the server actually ran, "Data used" lines and an unverified-answer warning. |
| `src/lib/aiTyreAccuracy.js`, `scripts/ai-accuracy.mjs` | Release profile, Wilson intervals, dangerous-support floor, per vehicle type, leakage check, `--release` flag. |

No migration was needed.

## 4. Tests

- `src/test/aiAgentsRegistry.test.js` (new): registry integrity, classifier parity client/server, wear rules, role access, tool gating, RPC parameter mapping, error sanitising, truncation, coverage text.
- `src/test/aiTyreReleaseGate.test.js` (new): release thresholds, insufficient vs fail, dangerous-support floor, intervals, leakage.
- `src/test/aiOrchestratorPolicy.test.js`: updated for the new catalog; asserts the service-role digest is gone.
- All fixtures are SYNTHETIC. They prove logic, not model accuracy.

## 5. Deployment (owner decision, not done)

1. Deploy `ai-orchestrator` with `_shared/aiAgents.ts`, `_shared/auth.ts`, `tools.ts`, `policy.ts`, `index.ts`. Keep `verify_jwt=false` (self-validating).
2. Confirm `SUPABASE_ANON_KEY` is set for the function (it is used by `_shared/auth.ts` already).
3. Smoke test as: a KSA-only Manager (must see KSA only), a Tyre Man (Engineer/QA/Safety only, procurement refused), a Welder (403).
4. Rollback: redeploy the previous `ai-orchestrator` version from the Supabase dashboard; the web change degrades gracefully (no `agents`/`coverage` -> previous display).

## 6. Owner decisions and remaining work

1. **Expert labels**: assign two qualified reviewers to label at least 500 photos (with >= 60 showing dangerous defects: exposed cord, bulge, suspected separation), each row carrying tyre serial and split. Then run `node scripts/ai-accuracy.mjs --labelled ... --predictions ... --release`.
2. **Knowledge base**: supply approved SOPs/manuals; set `OPENAI_API_KEY` for embeddings.
3. **Role map**: confirm `ROLE_AGENTS` in `aiAgents.ts` (for example whether Tyre Man should get the Planner).
4. Atomic budget reservation for the orchestrator (mirror `ai-tyre-inspection/budget.ts`).
5. Answer feedback loop: write thumbs/corrections to `ai_feedback`, build an offline evaluation set; no online retraining.
6. AI-prepared proposals on the domain-event bus (critical findings, CPK spikes, warranty opportunities), approval-gated.

## 7. Supervised feedback loop (F12) - code done, migration authored not applied

- Command Center: Helpful / Not helpful under every saved answer; Not helpful takes a category
  (wrong figure, wrong cause, missing data, unsafe, other), a correct answer and a note.
  `src/components/ai/AnswerFeedback.jsx`, service `src/lib/api/aiFeedback.js`.
- `ai-orchestrator` now returns `assistant_message_id` (the saved `ai_messages` row) and
  `prompt_version` (`PROMPT_VERSION` in `_shared/aiAgents.ts`, bump on any prompt change). Needs a redeploy.
- Migration `supabase/migrations/20261112101000_ai_feedback_loop.sql` (NOT applied). Live check:
  `ai_feedback.message_id` is uuid but `ai_messages.id` is bigint, every member could read every
  member's feedback, and insert did not bind `user_id`. Adds a bigint answer reference, agent, category,
  question/answer snapshot (trigger, own answers only), expected answer, expert verification
  (reviewer-only, trigger-enforced), own + reviewer RLS, one rating per person per answer.
  Until applied, the client stores feedback in the V205 shape with the answer id in the note.
- AI Administration > Feedback: filters (verdict, category, agent, verification, date), review and
  "expert verified" in the edit dialog, Excel/PDF, and an evaluation dataset export (verified rows only).
  Also fixed: the tab applied a country filter to a table with no country column, which silently
  emptied it whenever a country was selected.
- Offline evaluation `src/lib/aiEvaluation.js` + `scripts/ai-eval.mjs` (no paid calls): versioned dataset,
  deterministic split by conversation (no leakage), checks (cites `[source-N]` when grounded, no figures
  when nothing was retrieved, tyre engineer states missing evidence, expected figures/terms).
- Promotion rule: candidate scored on the HOLDOUT must beat the current prompt by >= 2 points on >= 30
  items, no regression on unsafe/critical items, then a named human approves; the previous prompt version
  stays deployable for rollback. Nothing is promoted automatically. Reviewer role (Admin/Manager/Director)
  is an owner decision.
