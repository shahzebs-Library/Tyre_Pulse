---
name: ai-tyre-inspection-evaluation
description: Evaluate and govern the Tyre Pulse AI stack - the ai-tyre-inspection photo worker, the 7-agent ai-orchestrator / chat-ai registry, embeddings and the knowledge base. Accuracy against expert labels, budget and token accounting, prompt-injection defences, grounding, deploy safety (no backslash-u escapes), per-model cost. Use for "AI accuracy", "AI budget", "prompt injection", "redeploy edge function", "AI agent wrong", "knowledge base", "expert labels".
---

# AI tyre inspection and agent evaluation

## Sources of truth
- Agent registry: `supabase/functions/_shared/aiAgents.ts` (patterns, prompts, tools, WEAR_RULES, ROLE_AGENTS,
  PROMPT_VERSION). Web mirror `src/lib/aiRouter.js` must match (test pins it).
- Security: `_shared/aiSecurity.ts` (control-char strip, path guard, injection phrases). Tools run on the CALLER's
  JWT (`ai-orchestrator/tools.ts`); never reintroduce a service-role tool.
- Budget: `ai_orchestrator_reserve_budget` / `_settle_budget` (never insert the GENERATED `total_tokens`),
  monthly cap in `ai-tyre-inspection/budget.ts` (fail closed). Rate limit counts `ai_token_logs`.
- Accuracy: `src/lib/aiTyreAccuracy.js`, `aiTyreExpertLabels.js` (FNV-1a split mirrors `ai_tyre_split_for`),
  `scripts/ai-accuracy.mjs`, `npm run ai:adjudicate`.
- Knowledge base lifecycle: migrations 20261112103000 + 107000 (draft-only edits, approved chunks immutable).

## Evaluation checklist (read-only SQL via Supabase MCP)
1. `ai_tyre_inspection_jobs`: status + failure_kind counts last 30 d; reviewed vs unreviewed; expert labels count
   per split (train/validation/holdout). Below ~500 labelled photos the accuracy figure is a hint, say so.
2. `ai_token_logs` last 30 d: cost by function and model vs `ai_models` pricing; failures; any status='blocked'.
3. Budget table: reservations older than 1 h in 'reserved' = stranded; settle must be idempotent.
4. Prompt injection: run the fixtures in `src/test/aiSecurity*.test.js`; any new tool must whitelist its inputs.
5. Grounding: every number in an agent answer must come from a tool result (structured first, RAG only for
   documents). An agent that cites a figure with no tool call is a defect.
6. Deploy safety: `grep -rn '\\u[0-9a-fA-F]{4}' supabase/functions` must be empty (the MCP deploy tool decodes them);
   deployed version == repo (byte-diff via `get_edge_function`); verify_jwt false and self-validating.
7. Human review: proposals are never auto-applied (cost_audit agent = dry run only).

## Output
Per agent/function: version live vs repo, accuracy basis, cost, failures, injection test result, open risks.
