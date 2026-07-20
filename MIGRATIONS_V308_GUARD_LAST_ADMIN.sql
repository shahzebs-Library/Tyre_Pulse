-- V308 (Phase-1 SaaS security: C2) — applied live 2026-07-20
-- Prevent accidental lockout: the last active super-admin, and the last active
-- Admin of an organisation, cannot be demoted, locked, unapproved or deleted.
-- "active" = not locked (super) / not locked and approved (org admin). A swap is
-- still possible because the guard only fires when NO OTHER active holder remains
-- (promote the replacement first, then demote the incumbent).
create or replace function public.guard_last_admin()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare v_others integer;
begin
  if TG_OP = 'DELETE' then
    if coalesce(OLD.is_super_admin, false) and coalesce(OLD.locked, false) = false then
      select count(*) into v_others from public.profiles
        where id <> OLD.id and coalesce(is_super_admin, false) and coalesce(locked, false) = false;
      if v_others = 0 then
        raise exception 'Cannot remove the last super admin.' using errcode = '42501';
      end if;
    end if;
    if OLD.role = 'Admin' and coalesce(OLD.locked, false) = false and coalesce(OLD.approved, true) then
      select count(*) into v_others from public.profiles
        where id <> OLD.id and role = 'Admin' and org_id is not distinct from OLD.org_id
          and coalesce(locked, false) = false and coalesce(approved, true);
      if v_others = 0 then
        raise exception 'Cannot remove the last administrator of this organisation.' using errcode = '42501';
      end if;
    end if;
    return OLD;
  end if;

  -- UPDATE: last super-admin demotion / lock
  if coalesce(OLD.is_super_admin, false) and coalesce(OLD.locked, false) = false
     and (coalesce(NEW.is_super_admin, false) = false or coalesce(NEW.locked, false) = true) then
    select count(*) into v_others from public.profiles
      where id <> OLD.id and coalesce(is_super_admin, false) and coalesce(locked, false) = false;
    if v_others = 0 then
      raise exception 'Cannot demote or lock the last super admin.' using errcode = '42501';
    end if;
  end if;

  -- UPDATE: last org-Admin demotion / lock / unapprove
  if OLD.role = 'Admin' and coalesce(OLD.locked, false) = false and coalesce(OLD.approved, true)
     and (NEW.role is distinct from 'Admin' or coalesce(NEW.locked, false) = true or coalesce(NEW.approved, true) = false) then
    select count(*) into v_others from public.profiles
      where id <> OLD.id and role = 'Admin' and org_id is not distinct from OLD.org_id
        and coalesce(locked, false) = false and coalesce(approved, true);
    if v_others = 0 then
      raise exception 'Cannot demote, lock or unapprove the last administrator of this organisation.' using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_guard_last_admin_upd on public.profiles;
drop trigger if exists trg_guard_last_admin_del on public.profiles;
create trigger trg_guard_last_admin_upd before update on public.profiles
  for each row execute function public.guard_last_admin();
create trigger trg_guard_last_admin_del before delete on public.profiles
  for each row execute function public.guard_last_admin();
