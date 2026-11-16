-- =============================================================================
-- TEN-7c: the role matrix is readable only by the company it applies to.
-- STATUS: AUTHORED, NOT APPLIED. Draft for review. Run only on the local staging copy.
--
-- WHERE TEN-7 LEFT IT
--   TEN-7 (20261113111000) already RESOLVES access per company: own rows
--   (module_permissions.org_id = the company) first, then the global row, and a global
--   row of a custom role name only for the legacy (current) company. What it left open:
--   the TABLE is still readable in full by every signed-in user of every company
--   (three permissive SELECT policies, one of them `true`). A second company can read
--   the current company's custom role names and their access rows (production,
--   counted 2026-11-15: 1,346 global rows, 32 custom role names among them).
--
-- THE MODEL (unchanged storage, no row is moved or rewritten)
--   global row, built-in role   = the platform default. Every company falls back to it.
--   global row, custom role     = belongs to the legacy company only (as resolved today).
--   row with org_id             = that company's own setting. Wins over the default.
--   Read rule = exactly the rows that can take part in the reader's own resolution:
--     own rows, global built-in rows, and global custom rows only for the legacy company.
--
-- WHAT IT ADDS
--   1. RESTRICTIVE select policy module_permissions_own_company_read (the permissive
--      policies stay; a restrictive policy narrows them, nothing is removed).
--   2. get_org_role_matrix()  the effective matrix of the caller's company with the
--      source of each cell ('own' or 'default'), for a company Admin screen.
--   3. admin_seed_org_role_matrix(p_org, p_dry_run default true)  super admin. Copies
--      the built-in defaults into the company's own rows where it has none, so later
--      changes to the defaults no longer reach it. NOT called by anything: whether a new
--      company inherits live or starts from a copy is owner decision D1.
--
-- CURRENT COMPANY: sees the same rows as today (it is the legacy company, so every
--   global row passes, and it has no own rows). get_user_module_permissions() is not
--   touched. The staging run compares its md5 for every synthetic role before and after.
--   Super admins (console Access Control, which reads this table directly) see all rows.
--
-- CLIENT READERS CHECKED (source read, not run): src/lib/api/modulePermissions.js and
--   src/console/pages/navigation/navReach.js run in the console as a super admin;
--   src/lib/api/onboardingReadiness.js reads the table as a company user and will now
--   count only the rows that apply to that company, which is the intended figure.
--
-- APPLY ORDER: after 20261113111000 (TEN-7).
--
-- VERIFY (begin; ... rollback;)  as a legacy-company Manager, before and after:
--   select count(*) from module_permissions;  select md5(get_user_module_permissions()::text);
--   as a second-company Manager: select count(*) from module_permissions where org_id is null
--     and role <> all (public._builtin_roles());      -- 0
--
-- ROLLBACK
--   alter policy module_permissions_own_company_read on public.module_permissions using (true);
-- =============================================================================

do $$ begin
  if to_regprocedure('public._org_inherits_legacy_config(uuid)') is null or to_regprocedure('public._builtin_roles()') is null then
    raise exception 'TEN-7c needs TEN-7 applied first. Nothing applied.';
  end if;
end $$;

-- One definer helper so the policy does one lookup per query (InitPlan), not per row.
create or replace function public._reader_sees_legacy_matrix()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce(public.is_super_admin(), false) or public._org_inherits_legacy_config(public.app_current_org())
$fn$;
revoke execute on function public._reader_sees_legacy_matrix() from public;
revoke execute on function public._reader_sees_legacy_matrix() from anon;
grant execute on function public._reader_sees_legacy_matrix() to authenticated, service_role;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'module_permissions'
                   and policyname = 'module_permissions_own_company_read') then
    create policy module_permissions_own_company_read on public.module_permissions
      as restrictive for select to public
      using (
        (select public.is_super_admin())
        or org_id = (select public.app_current_org())
        or (org_id is null and (role = any (public._builtin_roles()) or (select public._reader_sees_legacy_matrix())))
      );
  end if;
end $$;

create or replace function public.get_org_role_matrix()
returns table (role text, module_key text, enabled boolean, source text)
language plpgsql stable security definer set search_path = public as $fn$
declare v_org uuid := public.app_current_org();
begin
  if v_org is null or public.app_is_active() is not true
     or (public.get_my_role() is distinct from 'Admin' and not coalesce(public.is_super_admin(), false)) then
    raise exception 'Only an Admin of the organisation can read its role matrix.' using errcode = '42501';
  end if;
  return query
    select distinct on (m.role, m.module_key)
           m.role, m.module_key, m.enabled, case when m.org_id is null then 'default' else 'own' end
      from public.module_permissions m
     where m.org_id = v_org
        or (m.org_id is null and public._global_matrix_applies(v_org, m.role))
     order by m.role, m.module_key, (m.org_id is not null) desc, m.updated_at desc;
end $fn$;
revoke execute on function public.get_org_role_matrix() from public;
revoke execute on function public.get_org_role_matrix() from anon;
grant execute on function public.get_org_role_matrix() to authenticated, service_role;

create or replace function public.admin_seed_org_role_matrix(p_org uuid, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'Only a super admin can seed a role matrix.' using errcode = '42501';
  end if;
  if p_org is null or not exists (select 1 from public.organisations o where o.id = p_org) then
    raise exception 'Unknown organisation.' using errcode = '22023';
  end if;
  if public._org_inherits_legacy_config(p_org) then
    raise exception 'The legacy company keeps the global rows as its own. Nothing to seed.' using errcode = 'PT409';
  end if;
  select count(*) into v_n from public.module_permissions g
   where g.org_id is null and g.role = any (public._builtin_roles())
     and not exists (select 1 from public.module_permissions o
                      where o.org_id = p_org and o.role = g.role and o.module_key = g.module_key);
  if coalesce(p_dry_run, true) then
    return jsonb_build_object('ok', true, 'dry_run', true, 'would_copy', v_n);
  end if;
  insert into public.module_permissions (module_key, role, org_id, enabled, updated_by, updated_at)
  select distinct on (g.role, g.module_key) g.module_key, g.role, p_org, g.enabled, auth.uid(), now()
    from public.module_permissions g
   where g.org_id is null and g.role = any (public._builtin_roles())
     and not exists (select 1 from public.module_permissions o
                      where o.org_id = p_org and o.role = g.role and o.module_key = g.module_key)
   order by g.role, g.module_key, g.updated_at desc;
  get diagnostics v_n = row_count;
  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'seed_org_role_matrix', p_org, 'organisation', jsonb_build_object('rows', v_n));
  return jsonb_build_object('ok', true, 'dry_run', false, 'copied', v_n);
end $fn$;
revoke execute on function public.admin_seed_org_role_matrix(uuid, boolean) from public;
revoke execute on function public.admin_seed_org_role_matrix(uuid, boolean) from anon;
grant execute on function public.admin_seed_org_role_matrix(uuid, boolean) to authenticated, service_role;
