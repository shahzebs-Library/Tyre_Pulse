# Tyre Pulse commercial readiness audit: shared brief for every audit agent

Owner objective: Tyre Pulse must be sold to independent companies (fleet operators, construction, ready-mix,
tyre contractors, PMV maintenance teams) as a secure, reliable, multi-tenant SaaS. A new company must be able to
register, select a subscription, add or import its fleet, manage tyres, inspect, track maintenance and costs,
produce trustworthy reports, and never depend on the existing company's data.

## Hard rules
- READ-ONLY. No commits, pushes, stash, checkout, reset. No edits to any file except your own report file(s)
  under `docs/commercial-readiness/audit/`. No database writes of any kind, no DDL, no migrations, no edge
  function deploys. Database access is SELECT only through `mcp__Supabase__execute_sql` (project
  `jhssdmeruxtrlqnwfksc`; load with ToolSearch `select:mcp__Supabase__execute_sql`). Rolled-back impersonation
  probes are allowed ONLY as `begin; ... rollback;` with SELECT statements inside; never an insert/update/delete,
  even rolled back, on production.
- Never print secrets, full tokens, passwords, emails, phone numbers or customer records. Counts and column
  names only. Do not put customer data in the report.
- Do not count rows and call it a verdict. Zero rows does not mean broken; rows do not mean working. Read the
  code path end to end (page -> service -> RPC/RLS/trigger) and say what actually happens for (a) a brand-new
  empty company and (b) a company with data.
- Separate VERIFIED findings (with evidence: file:line, SQL result, or observed behaviour) from ASSUMPTIONS
  and from NOT VERIFIED (say what access was missing). Do not invent findings.
- A feature is not "ready" because code exists, a page opens, or its table has data.

## Context to read first
- `CLAUDE.md`, `PROJECT_MEMORY.md` (long; search it for your area), `docs/audit-2026-11/` (10 security audit
  documents from this week), `docs/enterprise-pack/README.md`, project skills in `.claude/skills/`
  (use the ones for your area: supabase-review, rbac-testing, auth-testing, api-testing,
  tyre-engineering-validation, cross-module-workflow-testing, ai-tyre-inspection-evaluation, flutter-qa,
  performance-review, edge-case-testing, audit-findings-register).
- Module baseline: `/tmp/claude-0/-home-user-Tyre-Pulse/f5f47d6f-b333-5be3-b15d-8e39da2bbfea/scratchpad/module_register.json`
  (218 menu items with routes, keys, tables, row counts; its classes A-E are SUPERSEDED, use it only as an index).
- Known state: one live tenant (org Company A), 3 countries (KSA/UAE/Egypt, SAR/AED/EGP never blended), about
  38 users. 76 rows in `public.modules` were set to `disabled` today; a working-branch has unmerged UI changes
  (duplicate pages hosted as views). Audit the code on the current working tree but note where main differs.

## Commercial status classes (use exactly these)
1 Commercially ready · 2 Functional but requires customer setup or data · 3 Needs functional or data-quality
repairs · 4 Incomplete or future development · 5 Duplicate requiring controlled consolidation ·
6 Internal administrator-only or legacy

## Finding format
ID (AREA-n) · Title · Severity P0/P1/P2/P3 · Confidence VERIFIED/PLAUSIBLE/NOT VERIFIED · Evidence (file:line or
SQL result) · What exists / what should be / what happens · Impact on selling to a second company · Recommended
fix · Acceptance test · Implementation area (DB, edge fn, web, Flutter, console, marketing, ops, owner action).

## Output
Write your report to the file named in your task under `docs/commercial-readiness/audit/`. Plain English, no
em or en dashes. End your final message with a 10-line summary: top findings, counts by severity, what you
could not verify.
