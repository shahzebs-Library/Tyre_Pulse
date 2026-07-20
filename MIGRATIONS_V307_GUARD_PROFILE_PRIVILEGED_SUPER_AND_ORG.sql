-- V307 (Phase-1 SaaS security: A2) — applied live 2026-07-20
-- The BEFORE-UPDATE guard on profiles previously authorized ANY privileged
-- column change (role/approved/locked/is_super_admin/country/site) for any
-- caller whose role = 'Admin'. That let a plain Company Admin:
--   (a) set is_super_admin = true on themselves -> self-escalate to platform owner;
--   (b) move a user to another organisation via org_id;
--   (c) edit a profile belonging to another organisation.
-- Tighten it: a non-super Admin keeps org-scoped user management (role/approve/
-- lock/country/site of users IN THEIR OWN ORG) but can never change super-admin
-- status, never change org membership, and never touch a user in another org.
create or replace function public.guard_profile_privileged_cols()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  -- Nothing privileged changed -> allow (self-service edits, updated_at, etc.)
  if NEW.role            is not distinct from OLD.role
     and NEW.approved    is not distinct from OLD.approved
     and NEW.locked      is not distinct from OLD.locked
     and NEW.is_super_admin is not distinct from OLD.is_super_admin
     and NEW.country     is not distinct from OLD.country
     and NEW.site        is not distinct from OLD.site
     and NEW.org_id      is not distinct from OLD.org_id
     and NEW.organisation_id is not distinct from OLD.organisation_id then
    return NEW;
  end if;

  -- Super admin may change anything.
  if public.is_super_admin() then
    return NEW;
  end if;

  -- Only an Admin may change any privileged column at all.
  if public.get_my_role() is distinct from 'Admin' then
    raise exception 'Not authorized to change role, approval, lock, country, site or organisation.'
      using errcode = '42501';
  end if;

  -- A non-super Admin may NEVER grant/revoke super-admin status.
  if NEW.is_super_admin is distinct from OLD.is_super_admin then
    raise exception 'Only a super admin can change super-admin status.'
      using errcode = '42501';
  end if;

  -- A non-super Admin may NEVER move a user between organisations.
  if NEW.org_id is distinct from OLD.org_id
     or NEW.organisation_id is distinct from OLD.organisation_id then
    raise exception 'Only a super admin can change a user''s organisation.'
      using errcode = '42501';
  end if;

  -- A non-super Admin may only manage users within their OWN organisation.
  if OLD.org_id is distinct from public.app_current_org() then
    raise exception 'Not authorized to manage a user in another organisation.'
      using errcode = '42501';
  end if;

  return NEW;
end;
$function$;
