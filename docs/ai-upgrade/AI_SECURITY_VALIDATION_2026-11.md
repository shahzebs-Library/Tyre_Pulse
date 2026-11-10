# AI security and governance validation (2026-11-10)

Scope: `chat-ai`, `ai-orchestrator` (with `_shared/aiAgents.ts`, `tools.ts`, `policy.ts`),
`ai-tyre-inspection`, and the knowledge RPC `match_knowledge_documents`.
Branch base `claude/tyrepulse-inspector-build-7rxp2t` plus the uncommitted AI-upgrade files from the
main checkout (copied byte-for-byte as the review base, then hardened).
Nothing was merged, pushed, deployed or applied. No data was written to the live database.

## 1. Live verification (read-only, project jhssdmeruxtrlqnwfksc)

Method: one transaction per user, `set_config('request.jwt.claims', {"sub": <real user>})`,
`set local role authenticated`, read-only selects, `rollback`. No DML.

### KSA-only Manager `34793423` (country {KSA}, sites {ALL})

| Call | Result | Verdict |
|---|---|---|
| `get_fleet_cpk(p_country=>'UAE')` | `{"ok": false, "reason": "forbidden"}` | Refused |
| `get_fleet_cpk(p_country=>'Egypt')` | `{"ok": false, "reason": "forbidden"}` | Refused |
| `get_country_kpi('UAE')` rows | 0 (KSA: 1) | Scoped |
| `get_tyre_running_life('UAE', ...)` | `ok:true, rows:[], total:0` | Scoped (empty, not refused) |
| direct `tyre_records` UAE / KSA | 0 / 8,349 | RLS holds |
| `match_knowledge_documents(filter_org => foreign org)` | 0 rows | Guarded in body (KB is empty, see 3.4) |
| `ai_conversations` / `ai_messages` of other users | 0 / 0 | Owner-only |
| anon EXECUTE on `get_fleet_cpk`, `match_knowledge_documents` | false / false | Closed |

### Egypt Tyre Data Collector `0bdeeb0d` (country {Egypt})

| Call | Result | Verdict |
|---|---|---|
| `get_fleet_cpk('KSA')` | `forbidden` | Refused |
| `get_cost_cpk_overview('KSA', ...)` | `forbidden` | Refused |
| `get_country_kpi('KSA')` / `(null)` | 0 rows / only `Egypt` | Scoped on the all-countries path too |
| `get_tyre_running_life('KSA')` / `(null)` total | 0 / 419 (Egypt only) | Scoped |
| `get_tyre_exceptions('KSA')` sum of counts | 0 (same call as KSA manager: 89) | Scoped (INVOKER, RLS) |
| direct `tyre_records` foreign | 0 (Egypt 548) | RLS holds |

Conclusion: the orchestrator's move to the caller's JWT is effective. The RPC guards refuse a foreign
named country and scope the all-countries path; RLS covers the rest.

Other facts read: all 883 `ai_tyre_inspection_jobs` reference bucket `tyre-photos` (paths `photos/...`,
`inspections/...`); `tyre_photos_read` storage policy is `app_is_active() and storage_object_in_my_org(owner)`;
0 approved profiles have a NULL `org_id`; `ai_token_logs` rows: chat 39, orchestrator 1, ai_tyre_inspection 64.

## 2. Findings fixed in this branch

| # | Sev | Function | Finding | Fix |
|---|---|---|---|---|
| S1 | Medium | chat-ai | **Rate limiter was inert.** It counted `ai_usage_log`, which holds 0 rows live, so no user was ever limited (same defect as F3 in the orchestrator). | Count `ai_token_logs` `feature='chat'`, `status in (success,error)`. |
| S2 | Medium | chat-ai | Body passed to the model unvalidated: any role (incl. forged `system` turns), `tool_result`/image blocks, unbounded message count and size. | `validateChatPayload`: user/assistant only, text blocks only, last turn must be user, 40 messages, 150k chars total, 60k system, max_tokens 1..2000. |
| S3 | Medium (latent) | chat-ai, ai-orchestrator | Monthly budget summed a plain select of `ai_token_logs`; PostgREST stops at 1000 rows, so after 1000 calls/month the cap silently stops working. | `pagedMonthSpend`: id-ordered `.range()` paging, fail closed on error, corrupt cost or page ceiling. |
| S4 | Medium | ai-tyre-inspection | `authenticated()` checked only the JWT and role, never `approved`/`locked`: a locked or unapproved account could still enqueue paid work, review, re-queue and backfill until its token expired. | Select `approved, locked`; refuse with `isActiveAccount` (fail closed). |
| S5 | Medium | ai-tyre-inspection | The worker downloads photos with the **service role** from whatever bucket a `tp-storage://<bucket>/...` ref names. Anyone able to write `inspections.tyre_conditions` could point it at another private bucket (e.g. `tenant-exports`, `driver-fine-evidence`); images would be sent to the model and described in the result. | `parseStorageRef` with allow-list `AI_PHOTO_BUCKETS = ['tyre-photos']` (matches 883/883 live jobs), plus control-char/backslash/length checks. |
| S6 | Low | ai-orchestrator | A thrown tool error was sent verbatim to the model (`tool error: <message>`) and persisted in `ai_messages`. | `sanitizeErrorText` (fixed phrases); raw text to the function log only. |
| S7 | Low | tools.ts | RPC refusal `reason` was echoed as free text. | `safeRefusalReason`: short lower-case tokens only, else `refused`. |
| S8 | Low | tools.ts | Echoed inputs (site, asset, unknown country) kept line breaks, so a crafted value could forge a prompt line inside `_provenance`. | `cleanPromptText` collapses control and line-separator characters. |
| S9 | Low | tools.ts | `list_recent_events.event_type` accepted any text. | Must match `^[a-z0-9_.]+$`; otherwise ignored with a note. |
| S10 | Low | aiAgents.ts | `agentsForRole` looked up `ROLE_AGENTS[key]` on a plain object: a role named `constructor`/`__proto__` returned a prototype member and threw (500). Denial, not escalation. | Own-property lookup. |
| S11 | Low (latent) | policy.ts | A consequential tool would run when its call id appeared in `approved_tool_call_ids`, a list the browser supplies. No such tool exists today. | Any non-read tool is refused unconditionally until a server-side approval record exists. |
| S12 | Low | ai-orchestrator | Non-uuid `conversation_id` reached the query. | Must be a uuid; ownership via `ownsConversation` (404 on any doubt). |

## 3. Checked and correct (no change)

1. **chat-ai does NOT read business data with the service role.** The service client is used only for
   `system_config`, the budget/rate-limit counts, the response cache and logging. All fleet data in its
   prompts comes from the browser, which read it under the user's own RLS session. So the orchestrator's
   F2 defect does not exist in chat-ai. Its cache key includes the user id, so cached answers never cross users.
   Residual: chat-ai is a general completion proxy for Admin/Manager/Director (client chooses the prompt);
   bounded by role, rate limit, budget and S2.
2. Agent field: validated against the registry; an explicit agent outside the role is a 403; auto-routing
   only returns allowed agents (tested over forged names).
3. Conversation ownership: `user_id` checked before history is read with the service role; RLS also hides
   other users' rows (verified 0).
4. Tool allow-list per request: a registered tool outside the active agents is refused (tested).
5. Tool outputs are wrapped with an untrusted-data marker and GLOBAL_RULES rule 6.
6. `ai-tyre-inspection` enqueue/review read the inspection through the caller's client (RLS, country);
   jobs are org-checked; worker requires `x-worker-secret`.
7. Web photo display signs URLs with the user's session; storage SELECT is org-scoped by owner.
8. Errors to users are generic in all three functions.

## 4. Open items (not fixed here, by severity)

| Sev | Item | Recommendation |
|---|---|---|
| Low | `list_recent_events` reads `domain_events`, which has no country column: the KSA manager sees 222,857 events org-wide, so the tool reveals event type, entity id and time of UAE/Egypt events (no payload). | Restrict the tool to Admin/Manager/Director, or join to entity country server-side. |
| Low (latent) | `match_knowledge_documents` honours any `filter_org` when `app_current_org()` is NULL. 0 approved users have a NULL org today and the orchestrator always passes the server org. | Migration: drop the `app_current_org() IS NULL` branch and give the service path its own function. |
| Low | `ai-tyre-inspection` `retry` is org-scoped but not country-scoped (cost only; needs job uuids). | Check job visibility through the caller client before the RPC. |
| Medium | Orchestrator budget is read-then-call (F11), so concurrent calls can overshoot slightly. | Atomic reservation, as `ai_tyre_reserve_budget_atomic`. |
| Info | `ai_usage_log` inserts from both chat functions leave 0 rows (cause not diagnosed). Nothing reads it any more for limits. | Diagnose or remove the insert. |
| Info | Knowledge base has no site/country scoping (documents are org-wide) and is empty (F10). | Decide before loading site-specific SOPs. |
| Info | `ai-tyre-inspection` keeps the CORS origin in a module-level variable (concurrent requests can see another request's origin). Not a security boundary (JWT is). | Compute per request. |
| Info | Edge functions were syntax-checked with the TypeScript transpiler only; no Deno typecheck available here. | `deno check` in CI before deploy. |

## 5. Tests

`src/test/aiSecurity.test.js` (61 tests, synthetic): role matrix (Admin, Manager, Director, Tire Planning
Engineer, Tyre Man, Tyre Data Collector, Inspector, Welder, Reporter, Driver, empty, null, super admin) x agents x
tools; forged agent names; unknown and consequential tools; injection strings in country/date/limit/asset/
resource/event_type/org; RPC refusal and DB error sanitising; conversation ownership; chat payload validation;
budget paging past 1000 rows and fail-closed cases; photo bucket allow-list and path traversal; account state;
ai-tyre-inspection role matrix. Related suites: 22 files, 384 tests pass. `npm run build` passes.
