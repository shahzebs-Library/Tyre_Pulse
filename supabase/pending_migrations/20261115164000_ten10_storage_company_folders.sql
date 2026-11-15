-- =============================================================================
-- TEN-10: a file path that names a company can be used only by that company.
-- STATUS: AUTHORED, NOT APPLIED. Draft for review. Run only on the local staging copy.
--
-- WHAT WAS MEASURED (local staging copy, three synthetic companies, 2026-11-15)
--   READS of the photo buckets are already walled by the uploader's company
--   (storage_object_in_my_org(owner)). WRITES are not walled by PATH: the upload
--   policies of tyre-photos, inspection-photos, accident-photos and vehicle-photos
--   accept any name from any active user. A user of company B could therefore create
--   an object under company A's folder (`<A org id>/KSA/<ASSET>/photo.jpg`). Company A
--   cannot read it, but the name is taken, so A's own upload to that path fails
--   (name squatting / denial across companies).
--
-- WHAT IT ADDS
--   storage_path_company_ok(name)  true unless the FIRST path segment is the id of an
--     organisation other than the caller's. Paths that do not start with an organisation
--     id (legacy `accidents/<id>/...`, `<user id>/...`) are untouched.
--   RESTRICTIVE policy storage_company_folder_wall on storage.objects, all commands.
--   A restrictive policy only narrows; no existing policy is changed or removed.
--
-- CURRENT COMPANY: unchanged. Every path it writes that starts with an organisation id
--   starts with its own (vehicle photos, import files, workforce evidence). Super admins
--   and the service role (edge functions) are not limited.
--
-- NOT COVERED (stated, not hidden): legacy paths with no company prefix can still be
--   squatted by name if the other company knows the record id. Reads stay walled by owner.
--   Moving every bucket to `<org id>/...` paths needs client and mobile changes.
--
-- APPLY ORDER: independent. After TEN-9 in the sequence only for readability.
--
-- VERIFY (begin; ... rollback;) as a user of company B:
--   insert into storage.objects (bucket_id, name, owner) values ('vehicle-photos', '<A id>/x.jpg', auth.uid());  -- refused 42501
--   insert into storage.objects (bucket_id, name, owner) values ('vehicle-photos', '<B id>/x.jpg', auth.uid());  -- 1 row
--
-- ROLLBACK
--   alter policy storage_company_folder_wall on storage.objects using (true) with check (true);
-- =============================================================================

create or replace function public.storage_path_company_ok(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare v_first text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_first !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return true;
  end if;
  if not exists (select 1 from public.organisations o where o.id = v_first::uuid) then
    return true;                       -- a user id or record id, not a company folder
  end if;
  if coalesce(public.is_super_admin(), false) then return true; end if;
  return v_first::uuid is not distinct from public.app_current_org();
end $fn$;
revoke execute on function public.storage_path_company_ok(text) from public;
revoke execute on function public.storage_path_company_ok(text) from anon;
grant execute on function public.storage_path_company_ok(text) to authenticated, service_role;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'storage_company_folder_wall') then
    create policy storage_company_folder_wall on storage.objects
      as restrictive for all to public
      using (public.storage_path_company_ok(name))
      with check (public.storage_path_company_ok(name));
  end if;
end $$;
