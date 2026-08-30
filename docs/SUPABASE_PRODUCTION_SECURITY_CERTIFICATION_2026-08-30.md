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

The follow-up privileged-function audit removed direct client execution from 44
trigger functions without affecting their installed triggers. All 415 public
`SECURITY DEFINER` routines have a pinned `search_path`, and `PUBLIC` cannot
create objects in the public schema. The remaining advisor warnings include 309
authenticated privileged RPCs and ten intentional anonymous privileged RPCs;
these require function-by-function role and negative-path tests before any grant
can safely be removed.

The current npm lockfile has two high advisories, both in the transitive
`image-size` dependency of `pptxgenjs`. No patched upstream release exists, and
npm's proposed remediation is a breaking downgrade. The affected parser is
disabled by the package's browser mapping and is not imported by the published
browser implementation used by TyrePulse. This is a bounded upstream risk to
track, not a safe candidate for `npm audit fix --force`.

## Meaning of this certification

This is a schema/configuration inspection, not proof of every role/tenant pair.
A real approved low-privilege user was tested against 285 RLS-protected tables
with organisation identifiers and observed zero cross-tenant rows. This proves
the low-privilege read path; final certification still requires mutation tests
and the same negative matrix for every production role.
