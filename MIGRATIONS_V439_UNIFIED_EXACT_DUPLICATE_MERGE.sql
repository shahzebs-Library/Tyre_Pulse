-- =====================================================================
-- V439 - ONE IMPORT RULE: REFRESH CHANGED ROWS, DROP ONLY EXACT COPIES
-- =====================================================================

create or replace function public.import_changed_supplied_patch(
  p_live jsonb,
  p_uploaded jsonb,
  p_allowed text[]
)
returns jsonb
language sql
immutable
set search_path = public
as $function$
  select coalesce(jsonb_object_agg(u.key, u.value), '{}'::jsonb)
  from jsonb_each(coalesce(p_uploaded, '{}'::jsonb)) u
  where u.key = any(coalesce(p_allowed, array[]::text[]))
    and not public.import_jsonb_blank(u.value)
    and not public.import_exact_supplied_match(
      coalesce(p_live, '{}'::jsonb),
      jsonb_build_object(u.key, u.value),
      p_allowed
    );
$function$;

create or replace function public.import_jsonb_pick(p_source jsonb, p_keys text[])
returns jsonb
language sql
immutable
set search_path = public
as $function$
  select coalesce(jsonb_object_agg(k, p_source -> k), '{}'::jsonb)
  from unnest(coalesce(p_keys, array[]::text[])) k;
$function$;

-- Data Intake update rows now refresh changed non-blank supplied values instead
-- of filling blanks only. A stale update that is now identical is processed as
-- an exact duplicate, so it cannot remain pending forever.
do $migration$
declare
  v_def text;
  v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='import_enrich_batch';

  if v_def is null then raise exception 'V439: import_enrich_batch not found'; end if;

  select count(*) into v_hits from regexp_matches(
    v_def,
    'IF NOT public\.import_jsonb_blank\(v_live -> k\) THEN CONTINUE; END IF;',
    'g'
  );
  if v_hits <> 1 then raise exception 'V439: enrich comparison anchor count %', v_hits; end if;
  v_def := replace(
    v_def,
    'IF NOT public.import_jsonb_blank(v_live -> k) THEN CONTINUE; END IF;',
    'IF public.import_exact_supplied_match(v_live, jsonb_build_object(k, v_data -> k), v_ecols) THEN CONTINUE; END IF;'
  );

  if position('IF v_patch = ''{}''::jsonb THEN v_skipped := v_skipped+1; CONTINUE; END IF;' in v_def) = 0 then
    raise exception 'V439: enrich empty-patch anchor not found';
  end if;
  v_def := replace(
    v_def,
    'IF v_patch = ''{}''::jsonb THEN v_skipped := v_skipped+1; CONTINUE; END IF;',
    'IF v_patch = ''{}''::jsonb THEN
      UPDATE public.import_rows SET target_record_id=v_live_id, target_module=b.module,
        processed_at=now(), dup_status=''duplicate'' WHERE id=r.id;
      v_skipped := v_skipped+1;
      CONTINUE;
    END IF;'
  );

  if position(E'    v_data := COALESCE(NULLIF(r.transformed_data,''{}''::jsonb), r.mapped_data);\n    v_key := public.import_natural_key' in v_def) = 0 then
    raise exception 'V439: enrich country-key anchor not found';
  end if;
  v_def := replace(
    v_def,
    E'    v_data := COALESCE(NULLIF(r.transformed_data,''{}''::jsonb), r.mapped_data);\n    v_key := public.import_natural_key',
    E'    v_data := COALESCE(NULLIF(r.transformed_data,''{}''::jsonb), r.mapped_data)\n              || jsonb_build_object(''country'', b.country);\n    v_key := public.import_natural_key'
  );

  execute v_def;
end
$migration$;

-- Shared/country monthly tyre staging: the lifecycle key finds the candidate;
-- values decide whether to refresh it or drop an exact copy.
create or replace function public.process_stg_monthly_tyres()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  rd date; fd date; tmp_d date;
  fkm numeric; rkm numeric; fhr numeric; rhr numeric; tmp_n numeric;
  v_tyre_record_id uuid;
  v_payload jsonb;
  v_live jsonb;
  v_incoming jsonb;
  v_patch jsonb;
  v_cols text[] := array[
    'asset_no','job_card','vehicle_type','size','position','tyre_position','issue_date',
    'km_at_fitment','hrs_at_fitment','removal_date','km_at_removal','hrs_at_removal',
    'total_km','total_hrs','removal_reason','status','brand'
  ];
begin
  v_payload := to_jsonb(new);

  if public.erp_is_footer(new.job_card_no) or public.erp_is_footer(new.veh_no) then
    insert into public.stg_monthly_tyres_audit(country, organisation_id, action, reason, payload)
    values (new.country, new.organisation_id, 'rejected', 'footer_row', v_payload);
    return null;
  end if;

  if coalesce(btrim(new.tyre_no),'')='' and coalesce(btrim(new.veh_no),'')='' then
    insert into public.stg_monthly_tyres_audit(country, organisation_id, action, reason, payload)
    values (new.country, new.organisation_id, 'rejected', 'blank_tyre_and_vehicle', v_payload);
    return null;
  end if;

  fd := public.erp_parse_date(new.tyre_fix_date);
  rd := public.erp_parse_date(new.tyre_removed_date);
  fkm := public._to_num(new.fixed_km); rkm := public._to_num(new.removed_km);
  fhr := public._to_num(new.fixed_hrs); rhr := public._to_num(new.removed_hrs);

  if fd is not null and rd is not null and rd < fd then tmp_d:=fd; fd:=rd; rd:=tmp_d; end if;
  if fkm is not null and rkm is not null and rkm < fkm then tmp_n:=fkm; fkm:=rkm; rkm:=tmp_n; end if;
  if fhr is not null and rhr is not null and rhr < fhr then tmp_n:=fhr; fhr:=rhr; rhr:=tmp_n; end if;

  v_incoming := jsonb_strip_nulls(jsonb_build_object(
    'asset_no', new.veh_no, 'job_card', new.job_card_no, 'vehicle_type', new.veh_type,
    'size', new.item_tyre, 'position', new.tyre_position, 'tyre_position', new.tyre_position,
    'issue_date', fd, 'km_at_fitment', fkm, 'hrs_at_fitment', fhr,
    'removal_date', rd, 'km_at_removal', rkm, 'hrs_at_removal', rhr,
    'total_km', public._to_num(new.total_km), 'total_hrs', public._to_num(new.total_hrs),
    'removal_reason', new.reason, 'status', case when rd is not null then 'Removed' else 'Active' end,
    'brand', nullif(btrim(new.brand),'')
  ));

  select t.id, to_jsonb(t) into v_tyre_record_id, v_live
  from public.tyre_records t
  where lower(btrim(t.serial_no)) = lower(btrim(new.tyre_no))
    and t.country is not distinct from new.country
    and t.issue_date is not distinct from fd
    and coalesce(lower(btrim(t.job_card)),'') = coalesce(lower(btrim(new.job_card_no)),'')
    and coalesce(lower(btrim(t.position)),'') = coalesce(lower(btrim(new.tyre_position)),'')
  order by t.created_at
  limit 1;

  if v_tyre_record_id is not null then
    v_patch := public.import_changed_supplied_patch(v_live, v_incoming, v_cols);
    if v_patch = '{}'::jsonb then
      insert into public.stg_monthly_tyres_audit(country, organisation_id, action, reason, payload, tyre_record_id)
      values (new.country, new.organisation_id, 'rejected', 'exact_duplicate', v_payload, v_tyre_record_id);
      return null;
    end if;

    update public.tyre_records t set
      asset_no = coalesce(v_patch->>'asset_no', t.asset_no),
      job_card = coalesce(v_patch->>'job_card', t.job_card),
      vehicle_type = coalesce(v_patch->>'vehicle_type', t.vehicle_type),
      size = coalesce(v_patch->>'size', t.size),
      position = coalesce(v_patch->>'position', t.position),
      tyre_position = coalesce(v_patch->>'tyre_position', t.tyre_position),
      issue_date = coalesce((v_patch->>'issue_date')::date, t.issue_date),
      km_at_fitment = coalesce((v_patch->>'km_at_fitment')::numeric, t.km_at_fitment),
      hrs_at_fitment = coalesce((v_patch->>'hrs_at_fitment')::numeric, t.hrs_at_fitment),
      removal_date = coalesce((v_patch->>'removal_date')::date, t.removal_date),
      km_at_removal = coalesce((v_patch->>'km_at_removal')::numeric, t.km_at_removal),
      hrs_at_removal = coalesce((v_patch->>'hrs_at_removal')::numeric, t.hrs_at_removal),
      total_km = coalesce((v_patch->>'total_km')::numeric, t.total_km),
      total_hrs = coalesce((v_patch->>'total_hrs')::numeric, t.total_hrs),
      removal_reason = coalesce(v_patch->>'removal_reason', t.removal_reason),
      status = coalesce(v_patch->>'status', t.status),
      brand = coalesce(v_patch->>'brand', t.brand)
    where t.id = v_tyre_record_id;

    insert into public.stg_monthly_tyres_audit(country, organisation_id, action, reason, payload, tyre_record_id)
    values (new.country, new.organisation_id, 'accepted', 'updated_changed_values', v_payload, v_tyre_record_id);
    return null;
  end if;

  insert into public.tyre_records
    (country, serial_no, asset_no, job_card, vehicle_type, size, position, tyre_position,
     issue_date, km_at_fitment, hrs_at_fitment, removal_date, km_at_removal, hrs_at_removal,
     total_km, total_hrs, removal_reason, status, brand, extra_fields)
  values (new.country, new.tyre_no, new.veh_no, new.job_card_no, new.veh_type, new.item_tyre,
     new.tyre_position, new.tyre_position, fd, fkm, fhr, rd, rkm, rhr,
     public._to_num(new.total_km), public._to_num(new.total_hrs),
     new.reason, case when rd is not null then 'Removed' else 'Active' end,
     nullif(btrim(new.brand),''),
     jsonb_strip_nulls(jsonb_build_object('job_card',new.job_card_no,'fixed_km',new.fixed_km,'removed_km',new.removed_km,'reason',new.reason)))
  returning id into v_tyre_record_id;

  insert into public.stg_monthly_tyres_audit(country, organisation_id, action, reason, payload, tyre_record_id)
  values (new.country, new.organisation_id, 'accepted', 'inserted', v_payload, v_tyre_record_id);
  return null;
end
$function$;

-- ERP review -> fleet promotion.
create or replace function public.promote_erp_assets(p_batch uuid, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_org uuid := public._erp_promote_guard();
  r record; v_country text; v_asset text; v_new_id uuid; v_live_id uuid;
  v_live jsonb; v_incoming jsonb; v_patch jsonb; v_before jsonb; v_set text;
  v_ins jsonb := '{}'::jsonb;
  v_skip int := 0; v_ins_tot int := 0; v_updated int := 0; v_exact int := 0;
  v_cols text[] := array[
    'site','make','vehicle_type','model_year','current_km','current_hours','status',
    'operator_name','insurance_type','insurance_name','insurance_start','insurance_expiry',
    'operating_card_no','operating_card_issue','operating_card_expiry','driver_licence_issue',
    'driver_licence_expiry','purchase_value','net_book_value','monthly_depreciation',
    'operation_start_date','fa_asset_number','asset_remarks','registration_no','asset_extra'
  ];
begin
  for r in
    select s.* from public.erp_asset_import s
    where s.batch_id=p_batch and s.organisation_id=v_org
      and not exists (select 1 from erp_promote_bak.promotion_log l where l.source_staging_id=s.id)
    order by s.source_row
  loop
    v_asset := nullif(upper(btrim(coalesce(r.asset_no,''))), '');
    if v_asset is null then v_skip:=v_skip+1; continue; end if;
    v_country := coalesce(public.normalize_country(r.country), public._erp_country_from_prefix(v_asset), 'KSA');
    v_incoming := jsonb_strip_nulls(jsonb_build_object(
      'site',r.site,'make',r.make,'vehicle_type',r.asset_type,'model_year',r.model_year,
      'current_km',r.current_km,'current_hours',r.hour_meter,
      'status',case when nullif(btrim(coalesce(r.status,'')),'') is null then null
        when r.status ~* 'inactive|retire|dispos' then 'Inactive' else 'Active' end,
      'operator_name',r.operator,'insurance_type',r.insurance_type,'insurance_name',r.insurance_name,
      'insurance_start',r.insurance_start,'insurance_expiry',r.insurance_end,
      'operating_card_no',r.operating_card_no,'operating_card_issue',r.card_issue_date,
      'operating_card_expiry',r.card_expiry_date,'driver_licence_issue',r.licence_issue,
      'driver_licence_expiry',r.licence_expiry,'purchase_value',r.purchase_value,
      'net_book_value',r.net_book_value,'monthly_depreciation',r.monthly_dep,
      'operation_start_date',r.opr_start_date,'fa_asset_number',r.finance_asset_no,
      'asset_remarks',r.remarks,'registration_no',r.plate_no,
      'asset_extra',nullif(jsonb_strip_nulls(jsonb_build_object('capacity',r.capacity,'shift',r.shift,
        'second_user',r.second_user,'age_of_asset',r.age_of_asset,'org_ou',r.org_ou)),'{}'::jsonb)
    ));

    select f.id,to_jsonb(f) into v_live_id,v_live from public.vehicle_fleet f
    where f.organisation_id=v_org and coalesce(f.country,'')=coalesce(v_country,'')
      and upper(btrim(f.asset_no))=v_asset limit 1;

    if v_live_id is not null then
      v_patch := public.import_changed_supplied_patch(v_live,v_incoming,v_cols);
      if v_patch='{}'::jsonb then v_exact:=v_exact+1; else v_updated:=v_updated+1; end if;
      if not p_dry_run then
        if v_patch <> '{}'::jsonb then
          v_before := public.import_jsonb_pick(v_live, array(select jsonb_object_keys(v_patch)));
          select string_agg(format('%I=(jsonb_populate_record(t,$1)).%I',k,k),', ')
            into v_set from jsonb_object_keys(v_patch) k;
          execute format('update public.vehicle_fleet t set %s where id=$2',v_set) using v_patch,v_live_id;
        end if;
        insert into erp_promote_bak.promotion_log
          (dataset,batch_id,organisation_id,master_table,master_id,source_staging_id,action,detail)
        values ('asset',p_batch,v_org,'vehicle_fleet',v_live_id,r.id,
          case when v_patch='{}'::jsonb then 'exact' else 'update' end,
          case when v_patch='{}'::jsonb then '{}'::jsonb else jsonb_build_object('before',v_before,'after',v_patch) end);
        update public.erp_asset_import set promoted_at=now(),promoted_by=auth.uid() where id=r.id;
      end if;
      continue;
    end if;

    v_ins := jsonb_set(v_ins,array[v_country],to_jsonb(coalesce((v_ins->>v_country)::int,0)+1),true);
    v_ins_tot:=v_ins_tot+1;
    if not p_dry_run then
      insert into public.vehicle_fleet
        (organisation_id,asset_no,country,region,site,make,vehicle_type,model_year,current_km,current_hours,
         status,operator_name,insurance_type,insurance_name,insurance_start,insurance_expiry,
         operating_card_no,operating_card_issue,operating_card_expiry,driver_licence_issue,
         driver_licence_expiry,purchase_value,net_book_value,monthly_depreciation,operation_start_date,
         fa_asset_number,asset_remarks,registration_no,asset_extra)
      values (v_org,v_asset,v_country,v_country,r.site,r.make,r.asset_type,r.model_year,r.current_km,r.hour_meter,
        case when r.status ~* 'inactive|retire|dispos' then 'Inactive' else 'Active' end,
        r.operator,r.insurance_type,r.insurance_name,r.insurance_start,r.insurance_end,r.operating_card_no,
        r.card_issue_date,r.card_expiry_date,r.licence_issue,r.licence_expiry,r.purchase_value,r.net_book_value,
        r.monthly_dep,r.opr_start_date,r.finance_asset_no,r.remarks,r.plate_no,
        jsonb_strip_nulls(jsonb_build_object('import','erp_asset','erp_batch',p_batch::text,
          'source_row',r.source_row,'capacity',r.capacity,'shift',r.shift,'second_user',r.second_user,
          'age_of_asset',r.age_of_asset,'org_ou',r.org_ou))) returning id into v_new_id;
      insert into erp_promote_bak.promotion_log
        (dataset,batch_id,organisation_id,master_table,master_id,source_staging_id,action)
      values ('asset',p_batch,v_org,'vehicle_fleet',v_new_id,r.id,'insert');
      update public.erp_asset_import set promoted_at=now(),promoted_by=auth.uid() where id=r.id;
    end if;
  end loop;
  return jsonb_build_object('dataset','asset','batch_id',p_batch,'dry_run',p_dry_run,
    'to_insert_total',v_ins_tot,'to_insert_by_country',v_ins,'updated',v_updated,
    'exact_duplicates',v_exact,'skipped_no_asset_no',v_skip);
end
$function$;

-- ERP review -> tyre lifecycle promotion.
create or replace function public.promote_erp_tyre_changes(p_batch uuid, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  r record; v_org uuid := public._erp_promote_guard();
  v_country text; v_asset text; v_pos text; v_status text; v_removal date;
  v_active_conflict boolean; v_new_id uuid; v_live_id uuid;
  v_live jsonb; v_incoming jsonb; v_patch jsonb; v_before jsonb; v_set text;
  v_ins_active int:=0; v_ins_old int:=0; v_updated int:=0; v_exact int:=0;
  v_skip_key int:=0; v_conflicts int:=0; v_by_country jsonb:='{}'::jsonb;
  v_cols text[] := array['brand','size','job_card','site','removal_date','km_at_fitment',
    'km_at_removal','hrs_at_fitment','hrs_at_removal','total_km','status'];
begin
  for r in
    with cand as (
      select s.*,nullif(lower(btrim(coalesce(s.asset_no,''))),'') g_asset,
        nullif(lower(btrim(coalesce(s.tire_pos,''))),'') g_pos
      from public.erp_tyre_change_import s
      where s.batch_id=p_batch and s.organisation_id=v_org
        and not exists(select 1 from erp_promote_bak.promotion_log l where l.source_staging_id=s.id)
    )
    select c.*,row_number() over(partition by c.g_asset,c.g_pos
      order by (c.fix_date is null) desc,c.fix_date,c.source_row) rn,
      count(*) over(partition by c.g_asset,c.g_pos) grp_n
    from cand c order by c.source_row
  loop
    if nullif(btrim(coalesce(r.serial_no,'')),'') is null
       or nullif(btrim(coalesce(r.asset_no,'')),'') is null then v_skip_key:=v_skip_key+1; continue; end if;
    v_asset:=upper(btrim(r.asset_no));
    v_pos:=nullif(upper(btrim(coalesce(r.tire_pos,''))),'');
    v_country:=coalesce(public.normalize_country(r.country),public._erp_country_from_prefix(coalesce(v_asset,r.job_card)),'KSA');
    v_removal:=case when r.remove_date is null then null when r.fix_date is null then r.remove_date
      when r.remove_date>=r.fix_date then r.remove_date else null end;

    select t.id,to_jsonb(t) into v_live_id,v_live from public.tyre_records t
    where t.organisation_id=v_org and coalesce(t.country,'')=coalesce(v_country,'')
      and lower(btrim(coalesce(t.serial_no,'')))=lower(btrim(r.serial_no))
      and upper(btrim(coalesce(t.asset_no,t.asset_number,'')))=v_asset
      and coalesce(nullif(upper(btrim(coalesce(t.tyre_position,t.position,''))),''),'')=coalesce(v_pos,'')
      and t.issue_date is not distinct from r.fix_date
    order by t.created_at limit 1;

    if v_live_id is not null then
      v_status:=case when v_removal is not null then 'Removed' else coalesce(v_live->>'status','Active') end;
      v_incoming:=jsonb_strip_nulls(jsonb_build_object('brand',r.tyre_brand,'size',r.tyre_size,
        'job_card',r.job_card,'site',r.site,'removal_date',v_removal,'km_at_fitment',r.fix_km,
        'km_at_removal',r.remove_km,'hrs_at_fitment',r.fix_hour,'hrs_at_removal',r.remove_hour,
        'total_km',r.total_km,'status',v_status));
      v_patch:=public.import_changed_supplied_patch(v_live,v_incoming,v_cols);
      if v_patch='{}'::jsonb then v_exact:=v_exact+1; else v_updated:=v_updated+1; end if;
      if not p_dry_run then
        if v_patch<>'{}'::jsonb then
          v_before:=public.import_jsonb_pick(v_live,array(select jsonb_object_keys(v_patch)));
          select string_agg(format('%I=(jsonb_populate_record(t,$1)).%I',k,k),', ')
            into v_set from jsonb_object_keys(v_patch) k;
          execute format('update public.tyre_records t set %s where id=$2',v_set) using v_patch,v_live_id;
        end if;
        insert into erp_promote_bak.promotion_log
          (dataset,batch_id,organisation_id,master_table,master_id,source_staging_id,action,detail)
        values ('change',p_batch,v_org,'tyre_records',v_live_id,r.id,
          case when v_patch='{}'::jsonb then 'exact' else 'update' end,
          case when v_patch='{}'::jsonb then '{}'::jsonb else jsonb_build_object('before',v_before,'after',v_patch) end);
        update public.erp_tyre_change_import set promoted_at=now(),promoted_by=auth.uid() where id=r.id;
      end if;
      continue;
    end if;

    v_active_conflict:=false;
    if v_pos is not null and v_pos<>'0' then
      select exists(select 1 from public.tyre_records t where t.organisation_id=v_org
        and coalesce(t.country,'')=coalesce(v_country,'')
        and upper(btrim(coalesce(t.asset_no,t.asset_number,'')))=v_asset
        and coalesce(nullif(upper(btrim(coalesce(t.tyre_position,t.position,''))),''),'')=v_pos
        and public.tyre_status_is_active(t.status)) into v_active_conflict;
    end if;
    v_status:=case when r.rn=r.grp_n and v_removal is null and not v_active_conflict then 'Active' else 'Removed' end;
    if v_status='Active' then v_ins_active:=v_ins_active+1; else v_ins_old:=v_ins_old+1; end if;
    if v_active_conflict and v_removal is null and r.rn=r.grp_n then v_conflicts:=v_conflicts+1; end if;
    v_by_country:=jsonb_set(v_by_country,array[v_country],to_jsonb(coalesce((v_by_country->>v_country)::int,0)+1),true);
    if not p_dry_run then
      begin
        insert into public.tyre_records
          (organisation_id,country,region,serial_no,asset_no,tyre_position,position,brand,size,job_card,
           site,issue_date,removal_date,km_at_fitment,km_at_removal,hrs_at_fitment,hrs_at_removal,
           total_km,status,data_source,upload_batch_id,qty,extra_fields)
        values (v_org,v_country,v_country,r.serial_no,v_asset,r.tire_pos,r.tire_pos,r.tyre_brand,
          r.tyre_size,r.job_card,r.site,r.fix_date,v_removal,r.fix_km,r.remove_km,r.fix_hour,
          r.remove_hour,r.total_km,v_status,'upload',p_batch,1,
          jsonb_strip_nulls(jsonb_build_object('import','erp_tyre_change','erp_batch',p_batch::text,
            'source_row',r.source_row,'old_serial_no',r.old_serial_no,'old_tyre_brand',r.old_tyre_brand,
            'version',r.version))) returning id into v_new_id;
      exception when unique_violation then
        insert into public.tyre_records
          (organisation_id,country,region,serial_no,asset_no,tyre_position,position,brand,size,job_card,
           site,issue_date,removal_date,km_at_fitment,km_at_removal,hrs_at_fitment,hrs_at_removal,
           total_km,status,data_source,upload_batch_id,qty,extra_fields)
        values (v_org,v_country,v_country,r.serial_no,v_asset,r.tire_pos,r.tire_pos,r.tyre_brand,
          r.tyre_size,r.job_card,r.site,r.fix_date,v_removal,r.fix_km,r.remove_km,r.fix_hour,
          r.remove_hour,r.total_km,'Removed','upload',p_batch,1,
          jsonb_strip_nulls(jsonb_build_object('import','erp_tyre_change','erp_batch',p_batch::text,
            'source_row',r.source_row,'old_serial_no',r.old_serial_no,'old_tyre_brand',r.old_tyre_brand,
            'version',r.version,'downgraded','active fitment already present'))) returning id into v_new_id;
        v_conflicts:=v_conflicts+1;
      end;
      insert into erp_promote_bak.promotion_log
        (dataset,batch_id,organisation_id,master_table,master_id,source_staging_id,action)
      values ('change',p_batch,v_org,'tyre_records',v_new_id,r.id,'insert');
      update public.erp_tyre_change_import set promoted_at=now(),promoted_by=auth.uid() where id=r.id;
    end if;
  end loop;
  return jsonb_build_object('dataset','change','batch_id',p_batch,'dry_run',p_dry_run,
    'to_insert_active',v_ins_active,'to_insert_old',v_ins_old,'to_insert_total',v_ins_active+v_ins_old,
    'to_insert_by_country',v_by_country,'updated',v_updated,'exact_duplicates',v_exact,
    'already_present',v_exact,'skipped_no_key',v_skip_key,'active_position_conflicts',v_conflicts);
end
$function$;

create or replace function public.erp_batch_promotion_status(p_dataset text, p_batch uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then
    return jsonb_build_object('inserted',0,'updated',0,'exact_duplicates',0,'existing',0,'promoted',false);
  end if;
  return (select jsonb_build_object(
    'inserted',coalesce(sum((action='insert')::int),0),
    'updated',coalesce(sum((action='update')::int),0),
    'exact_duplicates',coalesce(sum((action in ('exact','exists'))::int),0),
    'existing',coalesce(sum((action in ('exact','exists'))::int),0),
    'total',count(*),'promoted',count(*)>0,'promoted_at',max(promoted_at))
  from erp_promote_bak.promotion_log
  where dataset=p_dataset and batch_id=p_batch and organisation_id=v_org);
end
$function$;

-- Undo both inserts and reversible refreshes.
create or replace function public.promote_erp_undo(p_dataset text, p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_org uuid:=public._erp_promote_guard();
  v_deleted int:=0; v_restored int:=0; v_set text; x record;
  v_staging text:=case p_dataset when 'asset' then 'erp_asset_import'
    when 'change' then 'erp_tyre_change_import' when 'expense' then 'erp_tyre_expense_import' else null end;
begin
  if v_staging is null then raise exception 'Unknown dataset %',p_dataset using errcode='22023'; end if;

  for x in select * from erp_promote_bak.promotion_log l
    where l.dataset=p_dataset and l.batch_id=p_batch and l.organisation_id=v_org
      and l.action='update' and l.master_id is not null and l.detail ? 'before'
    order by l.promoted_at desc
  loop
    select string_agg(format('%I=(jsonb_populate_record(t,$1)).%I',k,k),', ')
      into v_set from jsonb_object_keys(x.detail->'before') k;
    if v_set is not null then
      if x.master_table='vehicle_fleet' then
        execute format('update public.vehicle_fleet t set %s where id=$2',v_set)
          using x.detail->'before',x.master_id;
      elsif x.master_table='tyre_records' then
        execute format('update public.tyre_records t set %s where id=$2',v_set)
          using x.detail->'before',x.master_id;
      end if;
      v_restored:=v_restored+1;
    end if;
  end loop;

  if p_dataset='asset' then
    delete from public.vehicle_fleet f using erp_promote_bak.promotion_log l
    where l.dataset='asset' and l.batch_id=p_batch and l.organisation_id=v_org
      and l.action='insert' and l.master_table='vehicle_fleet' and f.id=l.master_id;
    get diagnostics v_deleted=row_count;
  elsif p_dataset='change' then
    delete from public.tyre_records t using erp_promote_bak.promotion_log l
    where l.dataset='change' and l.batch_id=p_batch and l.organisation_id=v_org
      and l.action='insert' and l.master_table='tyre_records' and t.id=l.master_id;
    get diagnostics v_deleted=row_count;
  elsif p_dataset='expense' then
    delete from public.parts_consumption p using erp_promote_bak.promotion_log l
    where l.dataset='expense' and l.batch_id=p_batch and l.organisation_id=v_org
      and l.action='insert' and l.master_table='parts_consumption' and p.id=l.master_id;
    get diagnostics v_deleted=row_count;
  end if;

  execute format('update public.%I s set promoted_at=null,promoted_by=null
    from erp_promote_bak.promotion_log l where l.dataset=$1 and l.batch_id=$2
      and l.organisation_id=$3 and l.source_staging_id=s.id',v_staging)
    using p_dataset,p_batch,v_org;
  delete from erp_promote_bak.promotion_log l
    where l.dataset=p_dataset and l.batch_id=p_batch and l.organisation_id=v_org;
  return jsonb_build_object('dataset',p_dataset,'batch_id',p_batch,'deleted',v_deleted,'restored',v_restored);
end
$function$;

comment on function public.import_enrich_batch(uuid,integer,uuid) is
  'V439: refreshes changed non-blank supplied values and processes no-change rows as exact duplicates.';
comment on function public.process_stg_monthly_tyres() is
  'V439: lifecycle key selects a candidate; changed values refresh it and only exact copies are dropped.';
