-- Captured production tyre transaction definitions for isolated tests, 2026-09-10.
CREATE OR REPLACE FUNCTION public.apply_tyre_change(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.app_current_org();
  v_removed_id uuid; v_removed public.tyre_records%rowtype; v_new_id uuid;
  v_asset    text := nullif(btrim(p->>'asset_no'), '');
  v_position text := nullif(btrim(p->>'position'), '');
  v_site     text := nullif(btrim(p->>'site'), '');
  v_reason   text := nullif(btrim(p->>'removal_reason'), '');
  v_rem_date date := coalesce((p->>'removal_date')::date, current_date);
  v_issue_date date := coalesce((p->>'issue_date')::date, (p->>'fitment_date')::date, current_date);
  v_occupied uuid;
begin
  if public.app_cap_revoked('tyre_records','edit') then
    raise exception 'Not authorised to change tyres.' using errcode = '42501'; end if;
  if not public.is_approved_and_unlocked() then
    raise exception 'Not authorised.' using errcode = '42501'; end if;
  if v_asset is null then raise exception 'asset_no is required.' using errcode = '22004'; end if;
  if v_position is null then raise exception 'position is required.' using errcode = '22004'; end if;
  if nullif(btrim(p->>'country'),'') is not null
     and not public.app_write_country_ok(nullif(btrim(p->>'country'),'')) then
    raise exception 'Cross-country tyre change denied.' using errcode = '42501'; end if;
  v_removed_id := nullif(p->>'removed_record_id','')::uuid;

  if v_removed_id is not null then
    select * into v_removed from public.tyre_records where id = v_removed_id for update;
    if not found then raise exception 'Removed tyre record % not found.', v_removed_id using errcode = 'P0002'; end if;
    if v_removed.organisation_id is not null and v_removed.organisation_id is distinct from v_org then
      raise exception 'Cross-organisation tyre change denied.' using errcode = '42501'; end if;
    if v_removed.country is not null and not public.app_write_country_ok(v_removed.country) then
      raise exception 'Cross-country tyre change denied.' using errcode = '42501'; end if;
    if not public.tyre_status_is_active(v_removed.status) then
      raise exception 'Tyre % is not currently active.', v_removed_id using errcode = '23514'; end if;
    if nullif(upper(btrim(coalesce(v_removed.asset_no, v_removed.asset_number))),'') is distinct from upper(v_asset) then
      raise exception 'Removed tyre is on a different asset.' using errcode = '23514'; end if;
    if nullif(upper(btrim(coalesce(v_removed.tyre_position, v_removed.position))),'') is distinct from upper(v_position) then
      raise exception 'Removed tyre is at a different position.' using errcode = '23514'; end if;
    update public.tyre_records
      set km_at_removal = coalesce((p->>'km_at_removal')::numeric, km_at_removal),
          removal_date  = v_rem_date,
          removal_reason = coalesce(v_reason, removal_reason),
          status = 'Removed'
      where id = v_removed_id;
  else
    select id into v_occupied from public.tyre_records
    where organisation_id is not distinct from v_org
      and nullif(upper(btrim(coalesce(asset_no, asset_number))),'') = upper(v_asset)
      and nullif(upper(btrim(coalesce(tyre_position, position))),'') = upper(v_position)
      and public.tyre_status_is_active(status)
    for update limit 1;
    if v_occupied is not null then
      raise exception 'Position % on asset % already has an active tyre; specify removed_record_id.', v_position, v_asset
        using errcode = '23505'; end if;
  end if;

  insert into public.tyre_records
    (asset_no, serial_no, brand, site, country, cost_per_tyre, qty,
     position, tyre_position, km_at_fitment, removal_reason,
     issue_date, status, risk_level, category, uploaded_by, organisation_id)
  values
    (v_asset, nullif(btrim(p->>'serial_no'),''), nullif(btrim(p->>'brand'),''), v_site,
     nullif(btrim(p->>'country'),''), (p->>'cost_per_tyre')::numeric, coalesce((p->>'qty')::int,1),
     v_position, v_position, (p->>'km_at_fitment')::numeric, v_reason,
     v_issue_date,
     coalesce(nullif(btrim(p->>'status'),''),'Active'),
     coalesce(nullif(btrim(p->>'risk_level'),''),'Low'),
     coalesce(nullif(btrim(p->>'category'),''),'Tyre Change'),
     v_uid, v_org)
  returning id into v_new_id;

  perform public.record_audit_event('tyre_change','tyre_records', v_new_id::text,
    case when v_removed_id is null then null else jsonb_build_object(
      'removed_record_id', v_removed_id, 'asset_no', v_removed.asset_no,
      'serial_no', v_removed.serial_no, 'position', v_removed.position,
      'km_at_removal', coalesce((p->>'km_at_removal')::numeric, v_removed.km_at_removal),
      'removal_reason', v_reason, 'status', 'Removed') end,
    jsonb_build_object('fitment_record_id', v_new_id, 'asset_no', v_asset,
      'serial_no', nullif(btrim(p->>'serial_no'),''), 'brand', nullif(btrim(p->>'brand'),''),
      'position', v_position, 'site', v_site, 'cost_per_tyre', (p->>'cost_per_tyre')::numeric,
      'km_at_fitment', (p->>'km_at_fitment')::numeric, 'fitment_date', v_issue_date));
  return v_new_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.tyre_move(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.app_current_org();
  v_id  uuid := nullif(p->>'tyre_id','')::uuid;
  v_to_asset text := nullif(upper(btrim(p->>'to_asset_no')), '');
  v_to_pos   text := nullif(upper(btrim(p->>'to_position')), '');
  v_km numeric := nullif(p->>'km','')::numeric;
  v_src public.tyre_records%rowtype;
  v_dest_id uuid; v_from_asset text; v_from_pos text;
begin
  if public.app_cap_revoked('tyre_records','edit') then
    raise exception 'Not authorised to move tyres.' using errcode = '42501'; end if;
  if not public.is_approved_and_unlocked() then
    raise exception 'Not authorised.' using errcode = '42501'; end if;
  if v_id is null then raise exception 'tyre_id is required.' using errcode = '22004'; end if;
  select * into v_src from public.tyre_records where id = v_id for update;
  if not found then raise exception 'Tyre % not found.', v_id using errcode = 'P0002'; end if;
  if v_src.organisation_id is not null and v_src.organisation_id is distinct from v_org then
    raise exception 'Cross-organisation move denied.' using errcode = '42501'; end if;
  if v_src.country is not null and not public.app_write_country_ok(v_src.country) then
    raise exception 'Cross-country move denied.' using errcode = '42501'; end if;
  v_from_asset := nullif(upper(btrim(coalesce(v_src.asset_no, v_src.asset_number))), '');
  v_from_pos   := nullif(upper(btrim(coalesce(v_src.tyre_position, v_src.position))), '');
  v_to_asset   := coalesce(v_to_asset, v_from_asset);
  if v_to_pos is null then raise exception 'to_position is required.' using errcode = '22004'; end if;
  select id into v_dest_id from public.tyre_records
  where id <> v_id
    and organisation_id is not distinct from v_src.organisation_id
    and coalesce(country,'') = coalesce(v_src.country,'')
    and nullif(upper(btrim(coalesce(asset_no, asset_number))), '') = v_to_asset
    and nullif(upper(btrim(coalesce(tyre_position, position))), '') = v_to_pos
    and public.tyre_status_is_active(status)
  for update limit 1;
  update public.tyre_records set position = null, tyre_position = null where id = v_id;
  if v_dest_id is not null then
    update public.tyre_records
       set position = v_from_pos, tyre_position = v_from_pos,
           asset_no = case when v_to_asset is distinct from v_from_asset then v_from_asset else asset_no end,
           status = 'Active', removal_date = null, km_at_removal = null
     where id = v_dest_id;
  end if;
  update public.tyre_records
     set position = v_to_pos, tyre_position = v_to_pos, asset_no = v_to_asset,
         km_at_fitment = coalesce(v_km, km_at_fitment),
         status = 'Active', removal_date = null, km_at_removal = null
   where id = v_id;
  perform public.record_audit_event('tyre_move', 'tyre_records', v_id::text,
    jsonb_build_object('asset_no', v_from_asset, 'position', v_from_pos),
    jsonb_build_object('asset_no', v_to_asset, 'position', v_to_pos, 'swapped_with', v_dest_id));
  return jsonb_build_object('moved', v_id, 'swapped_with', v_dest_id);
end; $function$;

CREATE OR REPLACE FUNCTION public.tyre_status_is_active(p_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_status is not null and btrim(p_status) <> ''
     and lower(p_status) not like '%remov%'
     and lower(p_status) not like '%scrap%'
     and lower(p_status) not like '%written%'
     and lower(p_status) not like '%dispos%';
$function$;
