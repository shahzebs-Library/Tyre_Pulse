-- =============================================================================
-- TEN-13: a company Admin can export the company's own data (read-only).
-- STATUS: AUTHORED, NOT APPLIED. Draft for review. Run only on the local staging copy.
--
-- WHERE IT STOOD
--   The only export path is the super-admin console (admin_tenant_export_*). A customer
--   cannot take its own data out without the platform owner. Leaving the platform
--   (offboarding) therefore depends on a person at the platform.
--
-- WHAT IT ADDS (reads only; no business row is written, changed or removed)
--   org_export_manifest()                     tables on the export list and the row count
--                                             of the caller's company in each.
--   org_export_page(table, after, limit)      one page (up to 1000 rows, keyed on id) of
--                                             one table, the caller's company only.
--   Both: Admin of the company (or super admin), active account. SECURITY DEFINER, so
--   they re-check the company themselves and, where the table has the column, the
--   caller's country and site scope. The table list is the existing
--   _tenant_export_tables() safelist; the name is never taken from the caller unchecked.
--   Each page is recorded in org_admin_events (export.page: table and row count) when
--   TEN-12 is applied; without it the export still works.
--
-- OFFBOARDING. This is the read half only. Removal of a company's data stays where it
--   is: admin_purge_organisation() (TEN-9), super admin only, dry run by default, never
--   the current company. Running it for real is an owner decision (HOLD): not part of
--   this draft and not exercised beyond a dry run.
--
-- CURRENT COMPANY: nothing changes for it. Its Admin gains the same export.
--
-- APPLY ORDER: after TEN-12 (optional) on a database that has _tenant_export_tables().
--
-- VERIFY (begin; ... rollback;) as a company Admin:
--   select public.org_export_manifest();
--   select (public.org_export_page('vehicle_fleet')) -> 'count';
--
-- ROLLBACK
--   revoke execute on function public.org_export_manifest() from authenticated;
--   revoke execute on function public.org_export_page(text, uuid, integer) from authenticated;
-- =============================================================================

do $$ begin
  if to_regprocedure('public._tenant_export_tables()') is null then
    raise exception 'TEN-13 needs _tenant_export_tables(). Nothing applied.';
  end if;
end $$;

create or replace function public._org_export_guard()
returns uuid language plpgsql stable security definer set search_path = public as $fn$
declare v_org uuid := public.app_current_org();
begin
  if auth.uid() is null or v_org is null or public.app_is_active() is not true
     or (public.get_my_role() is distinct from 'Admin' and not coalesce(public.is_super_admin(), false)) then
    raise exception 'Only an Admin of the organisation can export its data.' using errcode = '42501';
  end if;
  return v_org;
end $fn$;
revoke execute on function public._org_export_guard() from public;
revoke execute on function public._org_export_guard() from anon;
revoke execute on function public._org_export_guard() from authenticated;

-- Row predicate for one table: own company, plus country and site scope where the table has them.
create or replace function public._org_export_predicate(p_table text)
returns text language sql stable security definer set search_path = public as $fn$
  select 't.organisation_id = $1'
      || case when exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                             and c.table_name = p_table and c.column_name = 'country' and c.data_type = 'text')
              then ' and (t.country is null or public.app_can_see_country(t.country))' else '' end
      || case when exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                             and c.table_name = p_table and c.column_name = 'site' and c.data_type = 'text')
              then ' and (t.site is null or btrim(t.site) = '''' or public.app_can_see_site(t.site))' else '' end
$fn$;
revoke execute on function public._org_export_predicate(text) from public;
revoke execute on function public._org_export_predicate(text) from anon;
revoke execute on function public._org_export_predicate(text) from authenticated;

create or replace function public.org_export_manifest()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_org uuid := public._org_export_guard(); t text; v_n bigint; v_out jsonb := '[]'::jsonb;
begin
  foreach t in array public._tenant_export_tables() loop
    if to_regclass('public.' || quote_ident(t)) is null then continue; end if;
    execute format('select count(*) from public.%I t where %s', t, public._org_export_predicate(t)) into v_n using v_org;
    v_out := v_out || jsonb_build_object('table', t, 'rows', v_n);
  end loop;
  return jsonb_build_object('organisation_id', v_org, 'generated_at', now(), 'tables', v_out);
end $fn$;
revoke execute on function public.org_export_manifest() from public;
revoke execute on function public.org_export_manifest() from anon;
grant execute on function public.org_export_manifest() to authenticated, service_role;

create or replace function public.org_export_page(p_table text, p_after uuid default null, p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_org uuid := public._org_export_guard();
  v_limit int := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_rows jsonb; v_n int; v_last uuid;
begin
  if p_table is null or not (p_table = any (public._tenant_export_tables())) or to_regclass('public.' || quote_ident(p_table)) is null then
    raise exception 'That table cannot be exported' using errcode = '22023';
  end if;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(x) order by x.id), ''[]''::jsonb), count(*)::int, '
    || '(array_agg(x.id order by x.id desc))[1] '
    || 'from (select t.* from public.%I t where %s and ($2::uuid is null or t.id > $2) order by t.id limit $3) x',
    p_table, public._org_export_predicate(p_table))
  into v_rows, v_n, v_last
  using v_org, p_after, v_limit;
  if to_regprocedure('public._org_admin_event(uuid,text,text,text,jsonb)') is not null then
    perform public._org_admin_event(v_org, 'export.page', 'table', p_table, jsonb_build_object('rows', v_n, 'after', p_after));
  end if;
  return jsonb_build_object('table', p_table, 'rows', v_rows, 'count', v_n,
    'next_after', case when v_n = v_limit then v_last else null end,
    'done', v_n < v_limit);
end $fn$;
revoke execute on function public.org_export_page(text, uuid, integer) from public;
revoke execute on function public.org_export_page(text, uuid, integer) from anon;
grant execute on function public.org_export_page(text, uuid, integer) to authenticated, service_role;
