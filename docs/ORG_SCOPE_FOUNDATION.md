# Organisation-Scope Foundation (Phase 1b)

> Migration: `MIGRATIONS_V42_ORG_SCOPE_FOUNDATION.sql` (applied). **Additive and
> backward-compatible** - no existing RLS policy was changed, so current app
> behaviour is unchanged. This lays the multi-tenant foundation; a follow-up
> (V43) flips RLS to *enforce* org isolation once validated.

## Why
The audit found `organisations` existed but was **empty and unused** - data was
scoped only geographically (`site`, `country[]`), so there was **no
organisation isolation** (the Critical S3/S4 risk: a user could reach another
org's rows once multiple orgs exist). This migration introduces the org
dimension safely, with all existing data assigned to a single default org so
nothing breaks.

## What the migration does (idempotent)
1. **Default organisation** - inserts one org with the sentinel id
   `00000000-0000-0000-0000-000000000001` ("Default Organisation"). All existing
   data belongs to it.
2. **`profiles.org_id`** - added (FK → organisations), backfilled to the default
   org, `DEFAULT` set, indexed.
3. **`organisation_id` on 23 business tables** - `tyre_records, inspections,
   accidents, work_orders, corrective_actions, vehicle_fleet, stock_records,
   stock_movements, gate_passes, rca_records, budgets, purchase_orders, sites,
   alerts, warranty_claims, recalls, tyre_specifications, tyre_rotations,
   inspection_schedules, supplier_ratings, supplier_contracts, accident_parts,
   accident_remarks`. Each: nullable column added, backfilled to default org,
   `DEFAULT` set (so new inserts auto-tag), FK → organisations, indexed.
4. **`organisation_memberships`** (user ↔ org, RLS-enabled) - all existing
   profiles enrolled in the default org.
5. **Helper functions** (`SECURITY DEFINER`, `search_path=public`):
   - `app_current_org()` → the caller's `org_id`.
   - `app_in_org(uuid)` → true when the row's org matches the caller's (or is
     NULL/uncategorised). These are the basis for the V43 enforcement policies.

## Reconciliation (verified post-apply)
| Check | Result |
|-------|--------|
| Default organisation present | ✅ "Default Organisation" |
| Profiles with `org_id` | 4 / 4 |
| `organisation_memberships` rows | 4 |
| Business tables with `organisation_id` | 23 (+ FKs) |
| New-row default (e.g. `tyre_records`) | `...0001::uuid` |
| Helper functions | `app_current_org`, `app_in_org` |
| Security advisors | only generic WARNs (GraphQL exposure / SECURITY DEFINER executability - by design, RLS-protected); no new ERRORs |

## Backward-compatibility guarantees
- **No existing RLS policy modified** → current reads/writes behave exactly as
  before; everyone is in the default org.
- New columns are nullable with a default → existing client `INSERT`s that don't
  set `organisation_id` still succeed and are auto-tagged to the default org.
- Fully idempotent → safe to re-run.

## Next: V43 - enforce org isolation (separate PR)
Add org scope to RLS on the operational tables using `app_in_org(organisation_id)`
(alongside the existing role/active checks), and add **tenant-isolation tests**
(a user in org A cannot read/write org B's rows). Roll out table-by-table with
verification. Until V43, isolation is *modelled* (columns + memberships +
helpers) but not yet *enforced* by RLS - single-org deployments are unaffected.
