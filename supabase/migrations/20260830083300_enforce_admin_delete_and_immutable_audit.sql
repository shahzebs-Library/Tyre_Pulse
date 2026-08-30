-- Final access-control closure:
--   * DELETE is a server-enforced Admin/Super Admin operation.
--   * personal, non-business records retain owner-managed deletion.
--   * audit evidence is append-only, including for administrators.

create or replace function public.app_can_admin_delete()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_super_admin is true or lower(btrim(coalesce(p.role, ''))) = 'admin'
    from public.profiles p
    where p.id = auth.uid()
      and p.locked is false
      and coalesce(p.approved, true) is true
    limit 1
  ), false);
$$;

revoke all on function public.app_can_admin_delete() from public, anon;
grant execute on function public.app_can_admin_delete() to authenticated, service_role;

-- A RESTRICTIVE policy is AND-ed with legacy permissive policies. This closes
-- old FOR ALL / Manager policies without changing their read and edit behavior.
do $policy$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and has_table_privilege('authenticated', c.oid, 'delete')
      and c.relname not in (
        'ai_conversations', 'ai_messages', 'user_dashboards', 'notifications',
        'saved_searches', 'notification_preferences', 'user_devices'
      )
  loop
    execute format('drop policy if exists admin_only_delete_guard on public.%I', r.relname);
    execute format(
      'create policy admin_only_delete_guard on public.%I as restrictive for delete to authenticated using (public.app_can_admin_delete())',
      r.relname
    );
  end loop;
end
$policy$;

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Audit records are immutable.' using errcode = '42501';
end;
$$;

revoke all on function public.prevent_audit_mutation() from public, anon, authenticated;

do $audit$
declare
  v_table text;
begin
  foreach v_table in array array[
    'audit_log', 'audit_log_v2', 'admin_audit', 'admin_row_changes',
    'import_audit_events', 'inspection_audit_log', 'accident_audit_log',
    'system_logs', 'upload_history', 'parts_cost_fill_log', 'ai_usage_log',
    'ai_token_logs', 'report_send_log', 'domain_events', 'sentry_alert_log'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('drop trigger if exists prevent_audit_mutation_trigger on public.%I', v_table);
      execute format(
        'create trigger prevent_audit_mutation_trigger before update or delete on public.%I for each row execute function public.prevent_audit_mutation()',
        v_table
      );
    end if;
  end loop;
end
$audit$;

-- Reversing an import deletes landed master data; this must not inherit the
-- historical Manager/Director definition of "elevated".
create or replace function public.import_reverse_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  b public.import_batches%rowtype;
  r public.import_rows%rowtype;
  v_org uuid := public.app_current_org();
  v_target text;
  v_deleted int := 0;
  v_skipped int := 0;
  v_hit int := 0;
begin
  if not public.app_can_admin_delete() then
    raise exception 'Import reversal requires Admin or Super Admin.' using errcode = '42501';
  end if;
  select * into b from public.import_batches where id = p_batch_id;
  if not found then raise exception 'Import batch not found.'; end if;
  if b.organisation_id is not null and b.organisation_id is distinct from v_org then
    raise exception 'Cross-organisation reversal denied.' using errcode = '42501';
  end if;
  if not public.app_write_country_ok(b.country) then
    raise exception 'Cross-country reversal denied: you are not assigned to country %.', b.country using errcode = '42501';
  end if;
  v_target := public.import_target_table(b.module);
  if v_target is null then raise exception 'No target table for module "%".', b.module; end if;
  for r in select * from public.import_rows where batch_id = p_batch_id and target_record_id is not null loop
    execute format(
      'delete from public.%I where id::text = $1 and organisation_id = $2 and (country is null or public.app_write_country_ok(country))',
      v_target
    ) using r.target_record_id, v_org;
    get diagnostics v_hit = row_count;
    if v_hit > 0 then
      update public.import_rows set target_record_id = null, processed_at = null where id = r.id;
      v_deleted := v_deleted + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  update public.import_batches
     set import_status = 'reversed', imported_rows = 0, completed_at = now()
   where id = p_batch_id;
  insert into public.import_audit_events (organisation_id, batch_id, actor, action, detail)
  values (v_org, p_batch_id, auth.uid(), 'reverse',
          jsonb_build_object('deleted', v_deleted, 'skipped', v_skipped, 'target', v_target));
  return jsonb_build_object('status', 'reversed', 'deleted', v_deleted, 'skipped', v_skipped);
end;
$$;

revoke all on function public.import_reverse_batch(uuid) from public, anon;
grant execute on function public.import_reverse_batch(uuid) to authenticated, service_role;
