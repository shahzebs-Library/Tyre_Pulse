-- Captured read-only from deployed schema 2026-09-10; no customer data.
CREATE OR REPLACE FUNCTION public.import_reverse_batch(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
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
$function$

