# Supabase production certification — 2026-08-30

## Status

**Not certified for production.** Repository-side controls are materially stronger, but a live database catalog audit could not be completed because this environment has neither an authenticated Supabase CLI profile nor a CLI-linked project. This is a release blocker, not an assumed pass.

## Evidence collected

- Supabase CLI `2.116.0` is installed and supports linked security and performance advisors.
- The configured browser endpoint is HTTPS, belongs to the expected project reference, and `/auth/v1/settings` responded successfully.
- Anonymous PostgREST OpenAPI discovery returned HTTP 401, so the schema was not anonymously enumerated.
- Email signup is enabled. The public Auth settings response did not advertise MFA as enabled, but that endpoint is not sufficient to certify the project's MFA policy. Before production, confirm that open signup is intentional, implement an approval/invitation boundary, and require/test MFA for privileged roles.
- No service-role credential was found in browser source. Frontend initialization also contains a guard against mistakenly supplied privileged variables.
- The committed hardening migrations use RLS policies, server-derived organization/user identity, explicit function grants, append-only audit triggers, and tenant/country checks for destructive import reversal.
- `scripts/security/supabase-security-inventory.sql` is read-only and now covers RLS gaps, empty-policy tables, policy predicates, exposed views, definer execution, search paths, grants, UPDATE policy checks, authorization anti-patterns, writable schemas, storage buckets, and FORCE RLS status.

## Live certification commands

Run these from a secure operator workstation after `supabase login` and `supabase link --project-ref <project-ref>`. Do not place access tokens or database passwords in source control.

```powershell
npx supabase db advisors --linked --type security --level info --fail-on warn
npx supabase db advisors --linked --type performance --level warn --fail-on error
```

Then run `scripts/security/supabase-security-inventory.sql` in the SQL editor or through a read-only database role and export every result set as release evidence. Expected results are zero unapproved rows for queries 1, 4, 6, 10, 11, and 12. Query 13 must return `false` for every privilege boolean. Queries 3, 5, 7, 8, 9, 14, and 15 are review inventories and require signed disposition per row.

## Required release gates

1. Security advisor has no unresolved error or warning finding.
2. Every exposed table has RLS and an explicit tenant/ownership policy, unless documented as immutable global reference data.
3. Every exposed view is `security_invoker=true` or inaccessible to Data API roles.
4. Every `SECURITY DEFINER` function has a pinned safe search path, explicit authorization inside the body, and least-privilege `EXECUTE` grants.
5. `anon` cannot execute privileged functions or read tenant/business tables.
6. Cross-tenant tests prove Tenant A cannot select, insert, update, delete, invoke RPCs against, or access storage objects belonging to Tenant B.
7. Locked, unapproved, and deleted users are denied; privileged session revocation and JWT refresh behavior are tested.
8. Storage upload, replacement, download, and deletion are tested for owner, tenant admin, other tenant, and anonymous identities.
9. Auth signup and MFA configuration have approved production decisions; privileged roles require MFA.
10. Migration history on the live project matches the reviewed repository migrations, and backup/restore evidence is current.

## Repository risk requiring operator verification

The repository contains a long historical series of root-level `MIGRATIONS_*.sql` files while only a small recent subset is under `supabase/migrations`. Historical/bootstrap SQL still contains deprecated `auth.role()` and role-only access patterns; later numbered migrations appear intended to replace these, including the documented live V500 definer-execute closure. These files must not be replayed selectively or treated as the current schema. The repository alone cannot prove which definitions are live, so a migration-list/schema comparison is mandatory before deployment.
