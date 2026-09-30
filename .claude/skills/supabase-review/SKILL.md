---
name: supabase-review
description: Review the Tyre Pulse Supabase backend (project jhssdmeruxtrlqnwfksc) for security, correctness and performance - RLS, grants, SECURITY DEFINER functions, storage, constraints, indexes, triggers, edge functions and secrets. Use for "review Supabase", "check RLS", "is this table secure", "database audit", or before shipping any backend change.
---

# Supabase review

**Frontend hiding is not security.** Every finding must be proven or refuted at the database, as a real user.

## Tools
- Supabase MCP (capital-S `mcp__Supabase__*`): `list_tables`, `execute_sql` (read-only probes, rolled back),
  `get_advisors` (security + performance), `list_edge_functions`, `get_edge_function`, `list_migrations`.
  The MCP runs as a privileged role: **RLS does not apply** unless you impersonate (see database-migration-safety).
- If the MCP is unauthenticated, try the Supabase CLI: `npx supabase db query --linked --project-ref jhssdmeruxtrlqnwfksc`.
- Repo tests: `npm run test:database` (`supabase/tests/*.test.mjs`), SQL checks in `supabase/tests/*.sql`.

## Checklist (run the SQL, record numbers)
1. **RLS on every public table**
   `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;` -> expect 0.
2. **Anon grants** on tables: expect 0 (V281). On functions: only the V500 allowlist of 10 (login lookup,
   public config, lockout RPCs, report/workshop/accident portal/display snapshots).
   `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'EXECUTE');`
3. **TRUNCATE/TRIGGER grants** to authenticated/anon: expect 0 (V379). RLS does not govern TRUNCATE.
4. **Isolation model**: RESTRICTIVE `<t>_org_isolation` (`organisation_id = (select app_current_org())`, super-admin
   bypass only via `is_super_admin()`, never `app_is_org_admin()`), RESTRICTIVE country + site policies for ALL
   commands (V542 made writes scoped too). Check new tables follow it.
5. **Permissive policies that annul restrictive intent**: a `FOR ALL USING (true)` permissive policy beside role
   gates makes the gates dead code (kpi_targets, V501). List permissive policies per table.
6. **SECURITY DEFINER functions**: pinned `search_path`; body re-checks org, country AND site (RLS never runs inside
   one - the owner has BYPASSRLS); no `format()`/`EXECUTE` with unescaped input (use `%I`/`%L` or a safelist);
   a DEFINER helper taking an org id is not executable by `authenticated`.
7. **Storage**: bucket list + policies (`storage.objects` policies must include an org/path check; the
   vehicle-photo UPDATE policy lacked one - known open item).
8. **Constraints**: FKs present and indexed (`get_advisors performance` -> unindexed_foreign_keys), UNIQUE keys match
   the business identity (asset_no is unique per org+country, never globally), CHECK vocabularies match clients.
9. **Nullability / audit fields**: `organisation_id NOT NULL` on business rows, `created_at`, `created_by`,
   `updated_at`; `audit_log_v2` actor typing (V499).
10. **Soft delete vs hard delete**: which tables hard-delete, and whether deletes are audited.
11. **Query performance**: EXPLAIN (ANALYZE, BUFFERS) as `authenticated`; flat timing vs page size means per-row
    policy/function cost; watch per-row DEFINER calls in LATERALs; PostgREST caps every response at 1000 rows,
    including set-returning RPCs - page with `.range()` and a unique `.order()` tiebreak.
12. **Realtime publication**: only tables with a real subscriber (V582). Every published table costs WAL decode.
13. **Edge functions** (`supabase/functions/*`): verify_jwt setting matches self-validation, CORS allowlist, no
    secret in the response or logs, service role only server-side, errors sanitised. Deployed code == repo
    (`get_edge_function` and diff).
14. **Secrets / env**: no service-role key or private key in `src/`, `mobile/`, `marketing/`, Flutter assets or git
    history (`git log -S`). Publishable anon key and Firebase Android key are public by design.

## Report format
Per finding: object, evidence (query + result), impact, severity (CRITICAL/HIGH/MEDIUM/LOW/INFO), fix, and the
verification query after the fix. Never mark something secure because a UI screen hides it.

## Fixing
Follow `database-migration-safety`. Additive, reversible, verified by impersonation, snapshot before any data
change. Do not modify production business data during a review.
