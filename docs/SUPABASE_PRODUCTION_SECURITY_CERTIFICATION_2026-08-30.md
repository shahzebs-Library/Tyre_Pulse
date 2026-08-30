# Supabase production security certification — 2026-08-30

Project inspected: `Tyre_pulse` (`jhssdmeruxtrlqnwfksc`).

## Certified controls

- No API-granted `public` base table was found with RLS disabled.
- The `anon` role had no direct write grant on a `public` base table.
- New workflow records are tenant-scoped through `app_current_org()` and RLS.
- `action_item_history`, shift handovers and stock reservations deny anonymous access.
- Stock reservation is performed atomically by a server function that validates
  authentication, tenant ownership, quantities and available inventory.
- Automatic action generation now has a database-enforced tenant-scoped
  idempotency key.
- Five internal migration snapshot/backup tables were removed from authenticated
  GraphQL/API discovery.

## Advisor result and bounded exceptions

The security advisor returned no `ERROR` findings. It returned warnings for two
extensions in `public`, authenticated GraphQL visibility, and executable
`SECURITY DEFINER` functions. Most GraphQL-visible objects are intentional API
tables protected by RLS; revoking them broadly would disable the product.

Ten anonymous `SECURITY DEFINER` functions remain. Public configuration, login
throttling, and token/password-protected report/display/accident-share functions
are intentional pre-authentication endpoints. `get_email_by_identifier(text)`
is the notable residual risk: username/employee-ID login currently requires it
to resolve an email for Supabase password authentication. It may disclose the
email mapped to a known identifier. Replacing it safely requires moving alias
authentication behind a rate-limited server endpoint; revoking it now would
break advertised username and employee-ID login.

The `vector` and `pg_net` extension-location warnings were not changed during
launch closure. Moving installed extensions can invalidate dependent objects and
requires a separately rehearsed maintenance migration.

## Meaning of this certification

This is a schema/configuration inspection, not proof of every role/tenant pair.
Final tenant-isolation certification still requires authenticated negative tests
using users from two seeded organisations and each production role. No
cross-tenant production records were read during this audit.
