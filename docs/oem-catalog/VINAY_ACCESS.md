# Read-only catalog access for Vinay: lookup, expected behaviour, rolled-back test

Status: PREPARED, NOT RUN. No production access from this session. Nothing here changes a user or a permission.

## How he was identified (read-only, from the repo)

`PROJECT_MEMORY.md` (2026-08-18 part 5, V600) names **VINAY KUMAR T** as the person holding the role **Workshop Maintenance Area Manager** (KSA), a custom role, signing the second rung of the workshop checklist and the inspections. That is the only trace in the repo; the repo does not hold his user id. The owner or lead confirms with query 1 below.

## 1. Read-only lookup (run by the owner or lead, SELECT only)

```sql
select p.id, p.full_name, p.username, p.role, p.approved, p.locked, p.is_super_admin,
       p.org_id, p.organisation_id, p.country, p.sites
from public.profiles p
where p.full_name ilike '%vinay%' or p.username ilike '%vinay%';

-- his module grants and revokes (read-only)
select ug.module_key, ug.capability, ug.effect, ug.expires_at
from public.user_access_grants ug
join public.profiles p on p.id = ug.user_id
where p.full_name ilike '%vinay%';
```

Expected: one active profile, role `Workshop Maintenance Area Manager`, not a super admin. If his role is `Admin`, `Manager` or `Director`, stop: after the migration only `Admin` (and the platform super admin) can import; a Manager or Director would be read-only too, which is the intended rule, but confirm it is what the owner wants for him.

## 2. What he can and cannot do after the pending migration

| Action | Vinay | Enforced in |
|---|---|---|
| Open catalog, browse published manuals, view drawings, search, select parts, view part info | yes | RLS: SELECT for active members of his own organisation; storage read policy is organisation scoped |
| Use existing parts-request flow | only as his current role already allows (insert as himself) | unchanged `parts_requests` RLS |
| Import or upload a manual, replace or delete a source PDF | no | RLS on `oem_parts_manuals`, `oem_parts_entries`, storage policies (admin only) |
| Edit, correct, approve, publish, reprocess, change extraction data | no | RLS plus `oem_apply_correction` (admin check inside) |
| Read the review queue or correction history | no | RLS on `oem_review_items`, `oem_corrections` |
| Open another company's private manuals | no | restrictive organisation policy on every OEM table and on storage |

UI: the Import, Review and Reprocess tabs are hidden for non-admins (`useAuth().isAdmin`), but that is only convenience; every row above is enforced in the database. The service layer also refuses writes for non-admins before calling the server.

## 3. Rolled-back permission test (run on STAGING or production inside a transaction; it ends with ROLLBACK)

Replace `:vinay_id` with the id from query 1. It acts as him through the same claim mechanism the app uses, so it needs no password.

```sql
begin;
  select set_config('request.jwt.claims', json_build_object('sub', ':vinay_id', 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;

  -- must succeed (rows visible, own company only)
  select count(*) as manuals_visible from public.oem_parts_manuals;
  select count(*) as entries_visible from public.oem_parts_entries;

  -- every statement below must FAIL or affect 0 rows; run each one on its own, note the result
  insert into public.oem_parts_manuals (manufacturer, model, source_file_name, source_sha256) values ('T','T','t.pdf','vinay-test');   -- expect: row-level security error
  update public.oem_parts_entries set description = 'x' where true;                                                                    -- expect: UPDATE 0
  delete from public.oem_parts_entries where true;                                                                                      -- expect: DELETE 0
  delete from public.oem_parts_manuals where true;                                                                                      -- expect: DELETE 0
  select count(*) from public.oem_review_items;                                                                                         -- expect: 0
  select public.oem_apply_correction((select id from public.oem_parts_entries limit 1), 'description', 'x', 't');                       -- expect: error, administrator only
  insert into storage.objects (bucket_id, name) values ('oem-parts-catalogs', 'vinay-test/source.pdf');                                 -- expect: row-level security error
rollback;
```

Pass criteria: the two counts equal the company's counts; all seven mutating statements fail or change 0 rows. The repo test `supabase/tests/oem_catalog_access.test.mjs` runs the same matrix against PGlite (read-only member, Manager, Director, Admin, super admin, other company) and passes.

## 4. Approval items (nothing applied)

1. Apply `supabase/pending_migrations/20261118100000_oem_catalog_advanced.sql` (rollback file beside it).
2. Decision: Manager and Director lose import and edit on the catalog (today they have it). If the owner wants them to keep it, change `oem_catalog_admin()` to include them; Vinay is unaffected either way.
3. No change to Vinay's profile, role or grants is proposed.
