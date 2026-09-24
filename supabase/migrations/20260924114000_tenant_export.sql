-- =============================================================================
-- 20260924114000_tenant_export.sql
-- Tenant Data Export (super-admin console): export one organisation's dataset
-- for portability, offboarding or legal hold.
--
-- STATUS: APPLIED LIVE 2026-09-24 via Supabase MCP (project jhssdmeruxtrlqnwfksc).
--
-- WHAT IT ADDS
--   * public.tenant_export_jobs        record of every export (who, which org, why,
--                                      which tables, how many rows). RLS: super-admin
--                                      SELECT only; NO client write policy. Rows are
--                                      written only by the DEFINER logger below.
--   * _tenant_export_tables()          fixed server-side SAFELIST (37 base tables that
--                                      carry organisation_id + a uuid id, verified
--                                      against information_schema on 2026-09-24).
--                                      The table name is NEVER taken from the client
--                                      unless it is found in this list, so the dynamic
--                                      SQL has no injection surface.
--   * admin_tenant_export_manifest(p_org)                     per-table row counts
--   * admin_tenant_export_page(p_org,p_table,p_after,p_limit)  keyset page (order by id,
--                                      limit clamped 1..1000)
--   * admin_tenant_export_log(p_org,p_reason,p_tables,p_counts) records the job AND a
--                                      console_sessions audit row action 'tenant_export'.
--   All three: SECURITY DEFINER, search_path=public, refuse non-super-admins with 42501,
--   EXECUTE revoked from PUBLIC then anon (V500 order), granted to authenticated.
--
--   A DEFINER function runs as its owner (rolbypassrls), so RLS does not apply inside
--   it; the is_super_admin() gate plus the explicit organisation_id = p_org predicate
--   are the whole boundary. That is deliberate: a super admin must be able to export
--   ANY tenant, including one they are not a member of.
--
-- VERIFY (rolled back):
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','d2d43a5f-0906-4f7a-9577-e36d89164914','role','authenticated')::text, true);
--   set local role authenticated;
--   select jsonb_array_length(admin_tenant_export_manifest('00000000-0000-0000-0000-000000000001')->'tables'); -- 37
--   select jsonb_array_length(admin_tenant_export_page('00000000-0000-0000-0000-000000000001','sites',null,5)->'rows'); -- <=5
--   rollback;
--   -- a non-super user: same calls raise 42501.
--   select has_function_privilege('anon','public.admin_tenant_export_manifest(uuid)','EXECUTE'); -- false
--
-- ROLLBACK:
--   drop function if exists public.admin_tenant_export_log(uuid,text,jsonb,jsonb);
--   drop function if exists public.admin_tenant_export_page(uuid,text,uuid,int);
--   drop function if exists public.admin_tenant_export_manifest(uuid);
--   drop function if exists public._tenant_export_tables();
--   drop table if exists public.tenant_export_jobs;
-- =============================================================================

create table if not exists public.tenant_export_jobs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  requested_by  uuid default auth.uid(),
  reason        text not null check (length(btrim(reason)) >= 5),
  tables        jsonb not null default '[]'::jsonb,
  status        text not null default 'completed'
                check (status in ('completed','partial','failed')),
  row_counts    jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists tenant_export_jobs_org_created_idx
  on public.tenant_export_jobs (org_id, created_at desc);

alter table public.tenant_export_jobs enable row level security;

drop policy if exists tenant_export_jobs_super_select on public.tenant_export_jobs;
create policy tenant_export_jobs_super_select on public.tenant_export_jobs
  for select to authenticated using ((select public.is_super_admin()));

revoke all on public.tenant_export_jobs from anon;
revoke insert, update, delete, truncate, trigger on public.tenant_export_jobs from authenticated;
grant select on public.tenant_export_jobs to authenticated;

-- ---------------------------------------------------------------------------
-- Safelist
-- ---------------------------------------------------------------------------
create or replace function public._tenant_export_tables()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'accidents','alerts','asset_breakdowns','asset_disposals','budgets',
    'checklist_submissions','corrective_actions','drivers','engine_hours_logs',
    'gate_passes','goods_receipts','inspections','insurance_policies',
    'material_issues','material_master','odometer_logs','parts_consumption',
    'parts_requests','pm_programs','pm_service_records','production_logs',
    'purchase_orders','rca_records','repair_requests','sany_invoices','sco_costs',
    'sites','stock_records','suppliers','tyre_records','tyre_rotations',
    'tyre_status_marks','vehicle_fleet','warranty_claims','wash_records',
    'work_order_line_items','work_orders'
  ]::text[]
$$;

revoke all on function public._tenant_export_tables() from public;
revoke all on function public._tenant_export_tables() from anon;
revoke all on function public._tenant_export_tables() from authenticated;

-- ---------------------------------------------------------------------------
-- Manifest
-- ---------------------------------------------------------------------------
create or replace function public.admin_tenant_export_manifest(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_t      text;
  v_n      bigint;
  v_out    jsonb := '[]'::jsonb;
  v_total  bigint := 0;
  v_name   text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can export tenant data' using errcode = '42501';
  end if;
  if p_org is null then
    raise exception 'An organisation is required' using errcode = '22023';
  end if;
  select name into v_name from public.organisations where id = p_org;
  if not found then
    raise exception 'Organisation not found' using errcode = '22023';
  end if;

  foreach v_t in array public._tenant_export_tables() loop
    begin
      if to_regclass('public.' || quote_ident(v_t)) is null then
        v_out := v_out || jsonb_build_array(jsonb_build_object('table', v_t, 'rows', null, 'error', 'missing'));
        continue;
      end if;
      execute format('select count(*) from public.%I where organisation_id = $1', v_t)
        into v_n using p_org;
      v_total := v_total + v_n;
      v_out := v_out || jsonb_build_array(jsonb_build_object('table', v_t, 'rows', v_n, 'error', null));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object('table', v_t, 'rows', null, 'error', 'count_failed'));
    end;
  end loop;

  return jsonb_build_object(
    'org_id', p_org,
    'org_name', v_name,
    'generated_at', now(),
    'total_rows', v_total,
    'tables', v_out
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Keyset page
-- ---------------------------------------------------------------------------
create or replace function public.admin_tenant_export_page(
  p_org uuid, p_table text, p_after uuid default null, p_limit int default 1000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 1000), 1), 1000);
  v_rows  jsonb;
  v_n     int;
  v_last  uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can export tenant data' using errcode = '42501';
  end if;
  if p_org is null then
    raise exception 'An organisation is required' using errcode = '22023';
  end if;
  if p_table is null or not (p_table = any (public._tenant_export_tables())) then
    raise exception 'That table cannot be exported' using errcode = '22023';
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(x) order by x.id), ''[]''::jsonb), count(*)::int, '
    || '(array_agg(x.id order by x.id desc))[1] '
    || 'from (select * from public.%I t where t.organisation_id = $1 '
    || 'and ($2::uuid is null or t.id > $2) order by t.id limit $3) x',
    p_table)
  into v_rows, v_n, v_last
  using p_org, p_after, v_limit;

  return jsonb_build_object(
    'table', p_table,
    'rows', v_rows,
    'count', v_n,
    'next_after', case when v_n = v_limit then v_last else null end,
    'done', v_n < v_limit
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Job log + console audit
-- ---------------------------------------------------------------------------
create or replace function public.admin_tenant_export_log(
  p_org uuid, p_reason text, p_tables jsonb, p_counts jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_status  text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can export tenant data' using errcode = '42501';
  end if;
  if p_org is null or not exists (select 1 from public.organisations where id = p_org) then
    raise exception 'Organisation not found' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'A reason of at least 5 characters is required' using errcode = '22023';
  end if;

  v_status := coalesce(nullif(p_counts->>'_status', ''), 'completed');
  if v_status not in ('completed','partial','failed') then
    v_status := 'partial';
  end if;

  insert into public.tenant_export_jobs (org_id, requested_by, reason, tables, status, row_counts, completed_at)
  values (p_org, auth.uid(), btrim(p_reason), coalesce(p_tables, '[]'::jsonb), v_status,
          coalesce(p_counts, '{}'::jsonb) - '_status', now())
  returning id into v_id;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'tenant_export', p_org, 'organisation',
          jsonb_build_object('job_id', v_id, 'reason', btrim(p_reason), 'status', v_status,
                             'tables', coalesce(p_tables, '[]'::jsonb),
                             'row_counts', coalesce(p_counts, '{}'::jsonb) - '_status'));
  return v_id;
end;
$$;

-- Grants (V500 order: grant authenticated first, then revoke PUBLIC, then anon)
grant execute on function public.admin_tenant_export_manifest(uuid) to authenticated;
grant execute on function public.admin_tenant_export_page(uuid,text,uuid,int) to authenticated;
grant execute on function public.admin_tenant_export_log(uuid,text,jsonb,jsonb) to authenticated;
revoke execute on function public.admin_tenant_export_manifest(uuid) from public;
revoke execute on function public.admin_tenant_export_page(uuid,text,uuid,int) from public;
revoke execute on function public.admin_tenant_export_log(uuid,text,jsonb,jsonb) from public;
revoke execute on function public.admin_tenant_export_manifest(uuid) from anon;
revoke execute on function public.admin_tenant_export_page(uuid,text,uuid,int) from anon;
revoke execute on function public.admin_tenant_export_log(uuid,text,jsonb,jsonb) from anon;
