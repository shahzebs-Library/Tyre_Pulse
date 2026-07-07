# Handoff — start here in the next session

**Written:** 2026-07-07 · **Branch:** `main` · **HEAD:** `736b060` (pushed) ·
**Web build:** ✅ clean, **1387/1387 tests** · **Working tree:** only `.mcp.json`
is uncommitted (the Supabase MCP server entry added below).

---

## The one job left: apply the Automation Platform to the live database

Everything is coded, merged, pushed, and green. The **only** remaining work is a
live-database apply that no prior session could do (no DB access). The full,
corrected runbook is **`docs/AUTOMATION_PLATFORM_DEPLOYMENT.md`** — follow it.

### Prerequisite: confirm you actually have DB access this session
Earlier sessions were blocked because the Supabase MCP was permission-denied.
A project-scoped Supabase MCP was added to `.mcp.json` and (should be)
authenticated by the user before this session started. **Verify first** with a
read-only call before doing anything destructive:

- Call `list_migrations` for project `jhssdmeruxtrlqnwfksc`.
  - ✅ Returns a list → you have access, proceed.
  - ❌ "You do not have permission to perform this action" → still blocked; do
    NOT proceed. Tell the user the OAuth auth (`claude /mcp` → supabase →
    Authenticate, in a real terminal) hasn't taken effect, and stop.

### Apply order (strict) — validate-first each file
Apply in numeric order, each wrapped in `BEGIN; … ROLLBACK;` first to confirm it
runs clean, then apply for real:

```
V96  MIGRATIONS_V96_DOMAIN_EVENTS.sql          (cron: process-domain-events   * * * * *)
V97  MIGRATIONS_V97_WORKFLOW_ENGINE.sql         (cron: escalate-workflows      15 * * * *)
V98  MIGRATIONS_V98_RAG_AUTO_EMBED.sql          (cron: embed-knowledge-documents */10 * * * *)
V99  MIGRATIONS_V99_API_PLATFORM_WEBHOOKS.sql   (cron: deliver-webhooks        * * * * *; creates pgcrypto)
V100 MIGRATIONS_V100_BUSINESS_RULES_ENGINE.sql  (cron: evaluate-alert-thresholds 5 * * * *)
V101 MIGRATIONS_V101_AI_CONVERSATIONS.sql
V102 MIGRATIONS_V102_AUDIT_TRIGGERS_BUILDERS.sql (adds report_definitions, user_dashboards + db.* audit triggers)
V103 MIGRATIONS_V103_EXECUTIVE_DISPLAY.sql       (adds display_tokens + get_display_snapshot anon RPC)
```
Each file has its own rollback block in its header. None self-wrap in
BEGIN/COMMIT, so the validate-first wrapper is safe. Use the Supabase MCP
`apply_migration` tool (one call per file, name in snake_case).

### Then deploy the 3 edge functions
```
embed-worker     --no-verify-jwt
public-api       --no-verify-jwt
ai-orchestrator  (verify jwt ON)
```
No new secrets needed (uses existing OPENAI_API_KEY / ANTHROPIC_API_KEY).
If the MCP can't deploy functions, the user runs the `supabase functions deploy`
commands from the runbook §3.

### Verify after apply
```sql
select jobname, schedule from cron.job order by jobname;   -- expect the 5 cron jobs above
select consumer, enabled from public.event_consumers;      -- expect consume_event_workflows/webhooks/rules
-- create any inspection, then:
select event_type, status from public.domain_events order by id desc limit 5;  -- events flowing
```

### Final step after the DB is live
Turn the **Automation Platform** feature flag ON (it defaults OFF so the pages
stay hidden until now): app → **Settings → Feature Flags → Automation → toggle
`Automation Platform` on**. That reveals Event Stream, Approvals, Approval
Workflows, Automation Rules, and API & Webhooks. (Flag key: `automation_platform`
in `src/lib/featureFlags.js`.)

---

## What's already done (context — no action needed)

1. **Roadmap tranche (Sessions 7–8)** — EnterpriseTable, RHF+Zod forms, Ctrl+K
   command palette, feature flags, Sentry (env-gated), notifications, field-level
   audit, TV display, Report/Dashboard Builder, ECharts executive analytics,
   System/Tenant Health, Security Center, Permission Matrix, event bus + webhooks
   (client), embedded AI copilot. All merged to main.
2. **PR #26 (Automation Platform backend)** — merged (a84cb64): domain events,
   workflow engine, RAG auto-embed, API keys + webhooks, business rules, AI
   conversation memory, server-side audit + builder tables, executive display,
   Python analytics service. Ships as the V96–V103 migrations + 3 edge functions
   above (NOT yet applied — that's the job).
3. **Gating (this session)** — the 5 Automation pages are hidden behind the
   default-OFF `automation_platform` flag so they don't error in production
   before the DB is applied.
4. **Overlap reconciliation (this session)** —
   - `src/lib/api/savedViews.js`: Report/Dashboard Builder now PREFER the V102
     tables (`report_definitions`, `user_dashboards`) and FALL BACK to
     `app_settings` until V102 is applied (42P01/PGRST205 detection), with a
     one-time data migration on first successful table read. Today (V102 not
     live) it transparently uses app_settings; after you apply V102 it switches
     to per-user tables automatically. Report modules outside V102's 7-module
     CHECK (gate_passes/suppliers/warranty) stay on app_settings.
   - `src/pages/DisplayShare.jsx` at anon route `/display/:token` + Settings
     `DisplayTokensPanel`: the frontend for V103's executive display. Degrades
     gracefully (42883/42P01/PGRST202) until V103 is applied.

## Known follow-ups (lower priority, after the apply)
- **Permission Matrix** (`/permission-matrix`) stores overrides in
  `app_settings.permission_overrides` but only the `view` capability is wired
  into `hasPermission`; the other capabilities are stored, not yet enforced.
- **Light-safety pass** — ~12 pages still look dark-on-light in the default light
  theme (not broken; fine in dark mode). List is in the memory / redesign handoff.
- **app_settings single-row-per-key** features (feature flags, ERP config,
  webhook_endpoints, permission_overrides) are org-level last-write-wins; ties
  into the multi-tenant RLS follow-up.
- V102 `report_definitions` has no columns for a report's `limit`/`group` —
  table-backed reports drop those two fields (filters/sort/chart round-trip fine).

## Key facts
- Supabase project: `jhssdmeruxtrlqnwfksc` (region ap-northeast-1). Live app:
  tyrepulse.app (auto-deploys from `main` via Vercel).
- Full deployment detail + rollback + event catalog + webhook contract:
  `docs/AUTOMATION_PLATFORM_DEPLOYMENT.md`.
