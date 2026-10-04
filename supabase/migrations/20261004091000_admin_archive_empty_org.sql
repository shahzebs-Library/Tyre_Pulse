-- Archive an EMPTY organization atomically, server side.
-- STATUS: APPLIED live 2026-10-04.
-- Before: the console archived after a CLIENT check over five table counts from admin_org_overview(), so an
-- organization holding records in any other table, or gaining a member/record after the overview loaded,
-- could still be set inactive.
-- After: admin_archive_empty_org(p_org_id) locks the organization row, then checks members (profiles.org_id /
-- organisation_id) and EVERY public base table that carries organisation_id. Any row anywhere refuses, and
-- the response names the first table found. Audit/log/event history tables are skipped (they are history,
-- not business records, and archiving is reversible). Nothing is deleted; active=false only. Super admin only.
-- Rollback: drop function public.admin_archive_empty_org(uuid);
create or replace function public.admin_archive_empty_org(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_hit boolean;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can archive an organization' using errcode = '42501';
  end if;
  perform 1 from public.organisations where id = p_org_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if exists (select 1 from public.profiles where org_id = p_org_id or organisation_id = p_org_id) then
    return jsonb_build_object('ok', false, 'reason', 'has_members');
  end if;
  for r in
    select c.table_name, c.data_type
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'organisation_id'
       and t.table_type = 'BASE TABLE' and c.table_name not in ('organisations', 'profiles')
       -- history/log tables never block: archive is reversible and deletes nothing
       and c.table_name !~ '(audit|_log$|_logs$|_log_|^system_logs$|_events$|^notifications$|_sessions$)'
  loop
    if r.data_type = 'uuid' then
      execute format('select exists (select 1 from public.%I where organisation_id = $1)', r.table_name)
        into v_hit using p_org_id;
    else
      execute format('select exists (select 1 from public.%I where organisation_id::text = $1)', r.table_name)
        into v_hit using p_org_id::text;
    end if;
    if v_hit then
      return jsonb_build_object('ok', false, 'reason', 'has_records', 'table', r.table_name);
    end if;
  end loop;
  update public.organisations set active = false where id = p_org_id;
  perform public.log_console_event('org_archive', null, 'organisation', jsonb_build_object('org_id', p_org_id));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_archive_empty_org(uuid) from public;
revoke all on function public.admin_archive_empty_org(uuid) from anon;
grant execute on function public.admin_archive_empty_org(uuid) to authenticated, service_role;
