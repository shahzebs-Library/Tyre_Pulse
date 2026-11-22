# Web acceptance tooling (2026-11-20)

Evidence: `../95_WEB_ACCEPTANCE.md`. Local only; nothing here touches production except the three
SELECT-only extraction queries (`extract_q1_functions.sql`, `extract_q2_relations.sql`,
`extract_q3_data.sql`, run through the Supabase MCP; their results feed `../93_rehearsal_tooling/build_snapshot.py`
and are never committed).

| File | Role |
|---|---|
| `testusers.sql`, `testgrants.sql` | QA users (7) and approver test grants, snapshot copy only |
| `pgrst.conf` | PostgREST 12.2.3 against the copy (local test secret, not production) |
| `jwt.mjs` | HS256 minting of anon key and per-user sessions |
| `proxy.mjs` | `/rest/v1` -> PostgREST, `/auth/v1` GoTrue stub, CORS |
| `call.mjs` | `node call.mjs <user\|anon> <METHOD> <path> [json]` direct API checks |
| `pw.mjs`, `ui.mjs` | Playwright: session injected into localStorage `tp_auth`, country KSA, helpers |
| `smoke.mjs`, `t01`..`t15` | Browser cases (locations, receive, issue/reserve, transfer, ledger, audit, count, reconcile, recount, discrepancies, approvals, sections, tyres, scheduled report) |
