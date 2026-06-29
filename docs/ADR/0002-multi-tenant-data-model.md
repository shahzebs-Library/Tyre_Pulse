# ADR 0002 — Multi-tenant data model

**Status:** Proposed · **Date:** 2026-06-29

## Context
The schema scopes data **geographically** today: `site` (text) and
`country` (text[] on `profiles`). An `organisations` table exists but has **0
rows** and is not referenced by any RLS policy. There is no project/cost-center
hierarchy, no per-row ownership/version, and duplicate master tables
(`vehicle_fleet`/`fleet_master`, `stock_records`/`stock`). The target is an
enterprise multi-tenant platform that must scale to many organisations,
countries, projects, and sites with strict isolation.

## Decision
Adopt a canonical hierarchy and put tenancy + scope on **every business row**:

```
Organisation → Country → Project → Site → Asset
                                          → Tyre / Inspection / WorkOrder / Accident / Cost / StockMovement
```

Every business table carries:
`id`, `organisation_id`, scope ids (`country_id`, `project_id`, `site_id` as
applicable), `created_at`, `updated_at`, `created_by`, `updated_by`,
`deleted_at`/lifecycle `status` (soft delete), and `version int` (optimistic
concurrency).

Authorization tables:
`organisations`, `countries`, `projects`, `sites`, `cost_centers`, `roles`,
`permissions`, `role_permissions`, `user_role_assignments`,
`user_site_assignments`, `organisation_memberships`.

The Go API enforces **role + scope** on every request (RBAC plus a scope check
against the caller's assignments). RLS remains as defense-in-depth.

**Backfill:** since `organisations` is empty, create a single **default
organisation** and assign all existing rows/users to it during the identity
cutover (Step 2). Country/site values map to `countries`/`sites` rows; projects
default to a per-org "Default Project" until real projects are modeled.

## Consequences
**Positive:** true tenant isolation; consistent ownership/audit/concurrency;
removes duplicate-master ambiguity by designating canonical `assets`/inventory.
**Negative:** wide migration (every business table gains columns); careful
backfill needed; version checks add write complexity.
**Neutral:** geographic `site`/`country` semantics preserved under the new ids.

## Alternatives considered
- **Schema-per-tenant** — rejected: operational overhead, cross-tenant
  analytics harder, overkill for current scale.
- **Keep geographic-only scoping** — rejected: cannot represent multiple
  organisations or enforce org isolation.
- **Org id without scope/version columns** — rejected: loses optimistic
  concurrency and per-scope authorization needed by the role matrix.
