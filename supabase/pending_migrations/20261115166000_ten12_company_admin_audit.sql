-- =============================================================================
-- TEN-12: administrative actions inside a company are recorded and the company's
--         own Admin can read them.
-- STATUS: AUTHORED, NOT APPLIED. Draft for review. Run only on the local staging copy.
--
-- WHAT WAS MEASURED (local staging copy, 2026-11-15)
--   access_audit and console_sessions record administrative changes but carry no company
--   and are readable by a super admin only. A customer Admin has no record of who invited
--   whom, who changed a role, who changed the role matrix or who exported data.
--
-- WHAT IT ADDS
--   public.org_admin_events  append-only, one row per administrative action, always with
--     the company. Written ONLY by SECURITY DEFINER triggers; no client insert, update or
--     removal (no write policy, write privileges revoked).
--   Triggers (AFTER, never block the business write: any failure is swallowed):
--     org_invitations        invitation.created / .accepted / .revoked   (never the token)
--     profiles               member.joined / .role_changed / .approval_changed / .lock_changed / .left
--     module_permissions     role_matrix.changed          (company rows only)
--     user_access_grants     access_grant.changed         (company rows only)
--     organisation_settings  settings.changed             (key only, never the value)
--     org_subscriptions      plan.changed                 (plan and status, before and after)
--   get_org_admin_audit(limit, before)  the company Admin (or a super admin) reads the
--     company's own events, newest first.
--   No names, e-mails or values are stored: user ids, role names, keys and flags only.
--
-- CURRENT COMPANY: nothing it does today changes. It gains the same record. Volume is one
--   row per administrative change (not per business row).
--
-- CONTAINS a CREATE TABLE, so it ends with anum_integration.apply_reader_policies().
--
-- APPLY ORDER: after 20261113113000 (TEN-9, org_invitations) and 20261113150000
--   (organisation_settings). Triggers on tables that are absent are skipped.
--
-- VERIFY (begin; ... rollback;) as a company Admin: change a member role, then
--   select action, entity_id, details from public.get_org_admin_audit(5);
--
-- ROLLBACK (no data of any other table is touched)
--   alter table public.org_invitations disable trigger trg_org_audit_invitations;   (same for the
--   other five triggers: trg_org_audit_profiles, trg_org_audit_module_permissions,
--   trg_org_audit_access_grants, trg_org_audit_settings, trg_org_audit_subscriptions)
--   The table can stay; nothing reads it but get_org_admin_audit().
-- =============================================================================

create table if not exists public.org_admin_events (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  actor           uuid,
  actor_role      text,
  action          text not null,
  entity          text,
  entity_id       text,
  details         jsonb not null default '{}'::jsonb,
  at              timestamptz not null default now()
);
create index if not exists org_admin_events_org_at_idx on public.org_admin_events (organisation_id, at desc);
alter table public.org_admin_events enable row level security;
revoke all on public.org_admin_events from anon;
revoke insert, update, delete, truncate, references, trigger on public.org_admin_events from authenticated;
grant select on public.org_admin_events to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'org_admin_events'
                   and policyname = 'org_admin_events_org_isolation') then
    create policy org_admin_events_org_isolation on public.org_admin_events
      as restrictive for all to public
      using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
      with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'org_admin_events'
                   and policyname = 'org_admin_events_admin_read') then
    create policy org_admin_events_admin_read on public.org_admin_events
      for select to authenticated
      using ((select public.is_super_admin())
             or ((select public.app_is_active()) is true and (select public.get_my_role()) = 'Admin'));
  end if;
end $$;

create or replace function public._org_admin_event(p_org uuid, p_action text, p_entity text, p_entity_id text, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_org is null or p_action is null then return; end if;
  insert into public.org_admin_events (organisation_id, actor, actor_role, action, entity, entity_id, details)
  values (p_org, auth.uid(), (select p.role from public.profiles p where p.id = auth.uid()),
          p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
exception when others then
  null;   -- the record must never block the action it records
end $fn$;
revoke execute on function public._org_admin_event(uuid, text, text, text, jsonb) from public;
revoke execute on function public._org_admin_event(uuid, text, text, text, jsonb) from anon;
revoke execute on function public._org_admin_event(uuid, text, text, text, jsonb) from authenticated;

create or replace function public.trg_org_admin_audit()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
        o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
        r jsonb := coalesce(n, o);
        v_org uuid;
begin
  if tg_table_name = 'org_invitations' then
    v_org := (r ->> 'organisation_id')::uuid;
    if tg_op = 'INSERT' then
      perform public._org_admin_event(v_org, 'invitation.created', 'invitation', r ->> 'id',
        jsonb_build_object('role', r ->> 'role', 'is_owner', r -> 'is_owner', 'expires_at', r ->> 'expires_at'));
    elsif tg_op = 'UPDATE' and (o ->> 'accepted_at') is null and (n ->> 'accepted_at') is not null then
      perform public._org_admin_event(v_org, 'invitation.accepted', 'invitation', r ->> 'id',
        jsonb_build_object('role', r ->> 'role', 'accepted_by', n ->> 'accepted_by'));
    elsif tg_op = 'UPDATE' and (o ->> 'revoked_at') is null and (n ->> 'revoked_at') is not null then
      perform public._org_admin_event(v_org, 'invitation.revoked', 'invitation', r ->> 'id', jsonb_build_object('role', r ->> 'role'));
    end if;

  elsif tg_table_name = 'profiles' then
    if tg_op = 'INSERT' then
      perform public._org_admin_event((n ->> 'org_id')::uuid, 'member.joined', 'member', n ->> 'id',
        jsonb_build_object('role', n ->> 'role', 'approved', n -> 'approved'));
    elsif tg_op = 'UPDATE' then
      if (o ->> 'org_id') is distinct from (n ->> 'org_id') then
        perform public._org_admin_event((o ->> 'org_id')::uuid, 'member.left', 'member', n ->> 'id', jsonb_build_object('role', o ->> 'role'));
        perform public._org_admin_event((n ->> 'org_id')::uuid, 'member.joined', 'member', n ->> 'id',
          jsonb_build_object('role', n ->> 'role', 'approved', n -> 'approved'));
      end if;
      if (o ->> 'role') is distinct from (n ->> 'role') then
        perform public._org_admin_event((n ->> 'org_id')::uuid, 'member.role_changed', 'member', n ->> 'id',
          jsonb_build_object('before', o ->> 'role', 'after', n ->> 'role'));
      end if;
      if (o -> 'approved') is distinct from (n -> 'approved') then
        perform public._org_admin_event((n ->> 'org_id')::uuid, 'member.approval_changed', 'member', n ->> 'id',
          jsonb_build_object('before', o -> 'approved', 'after', n -> 'approved'));
      end if;
      if (o -> 'locked') is distinct from (n -> 'locked') then
        perform public._org_admin_event((n ->> 'org_id')::uuid, 'member.lock_changed', 'member', n ->> 'id',
          jsonb_build_object('before', o -> 'locked', 'after', n -> 'locked'));
      end if;
    else
      perform public._org_admin_event((o ->> 'org_id')::uuid, 'member.left', 'member', o ->> 'id', jsonb_build_object('role', o ->> 'role'));
    end if;

  elsif tg_table_name in ('module_permissions', 'user_access_grants') then
    v_org := (r ->> 'org_id')::uuid;
    if v_org is not null then
      perform public._org_admin_event(v_org,
        case tg_table_name when 'module_permissions' then 'role_matrix.changed' else 'access_grant.changed' end,
        case tg_table_name when 'module_permissions' then 'role' else 'member' end,
        coalesce(r ->> 'role', r ->> 'user_id'),
        jsonb_build_object('op', lower(tg_op), 'module_key', r ->> 'module_key',
                           'before', case when o is null then null else coalesce(o -> 'enabled', o -> 'effect') end,
                           'after',  case when n is null then null else coalesce(n -> 'enabled', n -> 'effect') end));
    end if;

  elsif tg_table_name = 'organisation_settings' then
    perform public._org_admin_event((r ->> 'organisation_id')::uuid, 'settings.changed', 'setting', r ->> 'key',
      jsonb_build_object('op', lower(tg_op)));

  elsif tg_table_name = 'org_subscriptions' then
    if tg_op = 'INSERT' or (o ->> 'plan_code') is distinct from (n ->> 'plan_code') or (o ->> 'status') is distinct from (n ->> 'status') then
      perform public._org_admin_event((r ->> 'organisation_id')::uuid, 'plan.changed', 'subscription', r ->> 'id',
        jsonb_build_object('op', lower(tg_op),
                           'before', case when o is null then null else jsonb_build_object('plan', o ->> 'plan_code', 'status', o ->> 'status') end,
                           'after',  case when n is null then null else jsonb_build_object('plan', n ->> 'plan_code', 'status', n ->> 'status') end));
    end if;
  end if;
  return null;
exception when others then
  return null;
end $fn$;
revoke execute on function public.trg_org_admin_audit() from public;
revoke execute on function public.trg_org_admin_audit() from anon;
revoke execute on function public.trg_org_admin_audit() from authenticated;

do $$
declare t record;
begin
  for t in select * from (values
      ('org_invitations',       'trg_org_audit_invitations',        'insert or update'),
      ('profiles',              'trg_org_audit_profiles',           'insert or update or delete'),
      ('module_permissions',    'trg_org_audit_module_permissions', 'insert or update or delete'),
      ('user_access_grants',    'trg_org_audit_access_grants',      'insert or update or delete'),
      ('organisation_settings', 'trg_org_audit_settings',           'insert or update or delete'),
      ('org_subscriptions',     'trg_org_audit_subscriptions',      'insert or update')
    ) as x(tbl, trg, ev)
  loop
    if to_regclass('public.' || t.tbl) is not null
       and not exists (select 1 from pg_trigger where tgname = t.trg and tgrelid = to_regclass('public.' || t.tbl)) then
      execute format('create trigger %I after %s on public.%I for each row execute function public.trg_org_admin_audit()',
                     t.trg, t.ev, t.tbl);
    end if;
  end loop;
end $$;

create or replace function public.get_org_admin_audit(p_limit integer default 100, p_before timestamptz default null)
returns setof public.org_admin_events
language plpgsql stable security definer set search_path = public as $fn$
declare v_org uuid := public.app_current_org();
begin
  if v_org is null or public.app_is_active() is not true
     or (public.get_my_role() is distinct from 'Admin' and not coalesce(public.is_super_admin(), false)) then
    raise exception 'Only an Admin of the organisation can read its administration record.' using errcode = '42501';
  end if;
  return query
    select e.* from public.org_admin_events e
     where e.organisation_id = v_org and (p_before is null or e.at < p_before)
     order by e.at desc, e.id
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $fn$;
revoke execute on function public.get_org_admin_audit(integer, timestamptz) from public;
revoke execute on function public.get_org_admin_audit(integer, timestamptz) from anon;
grant execute on function public.get_org_admin_audit(integer, timestamptz) to authenticated, service_role;

select anum_integration.apply_reader_policies();
