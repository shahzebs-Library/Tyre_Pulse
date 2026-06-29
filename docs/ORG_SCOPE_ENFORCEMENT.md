# Organisation-Scope Enforcement (Phase 1c / V43)

> Migration: `MIGRATIONS_V43_ORG_SCOPE_ENFORCE.sql` (applied). **Builds on V42**
> (`MIGRATIONS_V42_ORG_SCOPE_FOUNDATION.sql`, PR #19) — apply V42 first.
> Closes the Critical org-isolation gap (security-plan **S3/S4**) by enforcing
> organisation isolation in RLS.

## What it does
Adds one **RESTRICTIVE** RLS policy per business table:

```sql
CREATE POLICY <t>_org_isolation ON public.<t>
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organisation_id IS NULL OR organisation_id = public.app_current_org())
  WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org());
```

Applied to the 23 tables that carry `organisation_id` (from V42): `tyre_records,
inspections, accidents, work_orders, corrective_actions, vehicle_fleet,
stock_records, stock_movements, gate_passes, rca_records, budgets,
purchase_orders, sites, alerts, warranty_claims, recalls, tyre_specifications,
tyre_rotations, inspection_schedules, supplier_ratings, supplier_contracts,
accident_parts, accident_remarks`.

## Why RESTRICTIVE (and therefore safe)
PostgreSQL **ANDs** restrictive policies on top of *every existing permissive
policy without modifying them*. So all current role / active / creator rules are
preserved exactly, and we simply add "…AND the row is in my organisation".

- All existing data is in the single default org (V42) → **nothing changes for
  current users today**.
- The instant a second organisation exists, cross-org reads/writes are blocked.
- `service_role` (Edge Functions) bypasses RLS → **unaffected**.
- `NULL` org (legacy uncategorised) is permitted so no row is ever orphaned.
- Inline `= app_current_org()` (STABLE, evaluated once) lets the planner use the
  `idx_<t>_org` index.

## Tenant-isolation test — `tests/rls_org_isolation.sql` (PASSED)
Simulates an org-A authenticated user (`SET ROLE authenticated` + JWT `sub`) and
asserts, inside a rolled-back transaction:

| Assertion | Result |
|-----------|--------|
| Foreign org's row is **not readable** | ✅ count = 0 |
| Own org's row **is** readable (no over-blocking) | ✅ count = 1 |
| Insert into a foreign org is **denied** (WITH CHECK) | ✅ blocked (SQLSTATE 42501) |

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rls_org_isolation.sql`
(self-asserting — non-zero exit on any failure).

## Scope / rollout
- `profiles` keeps its existing scoping (own-row / elevated) and is intentionally
  **not** org-gated here, to avoid interfering with login / profile-fetch.
- Any future business table gets org enforcement by adding `organisation_id`
  (V42 pattern) + the restrictive policy (V43 pattern).
- No existing app code changes; web/mobile behaviour is identical for the
  current single-org deployment.
