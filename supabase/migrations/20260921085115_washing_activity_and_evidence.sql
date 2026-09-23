-- Additive washing evidence. Existing records and installed clients remain valid.
alter table public.wash_records
  add column wash_details jsonb,
  add column captured_at timestamptz,
  add column entry_name text,
  add column entry_username text,
  add column completed_by uuid,
  add column completed_at timestamptz;

create or replace function public.valid_wash_details(d jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare item jsonb; field text;
begin
  if d is null then return true; end if;
  if jsonb_typeof(d) <> 'object' or octet_length(d::text) > 40000
    or d->>'version' is distinct from '1'
    or coalesce(d->>'chemical_status','') not in ('not_recorded','none','used')
    or jsonb_typeof(d->'chemicals') is distinct from 'array'
    or jsonb_typeof(d->'checklist') is distinct from 'array' then return false; end if;
  if jsonb_array_length(d->'chemicals') > 10 or jsonb_array_length(d->'checklist') > 30
    or (d->>'chemical_status' <> 'used' and jsonb_array_length(d->'chemicals') <> 0)
    or (d->>'chemical_status' = 'used' and jsonb_array_length(d->'chemicals') = 0)
    then return false; end if;
  for item in select value from jsonb_array_elements(d->'chemicals') loop
    if jsonb_typeof(item) <> 'object' or coalesce(length(btrim(item->>'name')),0) not between 1 and 160
      or coalesce(length(item->>'manufacturer'),0) > 160
      or coalesce(length(item->>'dilution'),0) > 120
      or coalesce(length(item->>'quantity'),0) > 40
      or coalesce(length(item->>'unit'),0) > 20
      or coalesce(length(item->>'sds_url'),0) > 1000
      or (coalesce(item->>'sds_url','') <> '' and item->>'sds_url' !~ '^https://[^[:space:]]+$')
      then return false; end if;
    foreach field in array array['name','manufacturer','quantity','unit','dilution','sds_url'] loop
      if item ? field and jsonb_typeof(item->field) <> 'string' then return false; end if;
    end loop;
  end loop;
  for item in select value from jsonb_array_elements(d->'checklist') loop
    if jsonb_typeof(item) <> 'object' or coalesce(length(btrim(item->>'label')),0) not between 1 and 200
      or coalesce(item->>'result','') not in ('not_checked','pass','fail','na')
      or coalesce(length(item->>'note'),0) > 1000
      or (item->>'result' = 'fail' and coalesce(length(btrim(item->>'note')),0) = 0)
      then return false; end if;
    foreach field in array array['label','result','note'] loop
      if item ? field and jsonb_typeof(item->field) <> 'string' then return false; end if;
    end loop;
  end loop;
  return true;
end $$;
alter table public.wash_records add constraint wash_details_valid check (public.valid_wash_details(wash_details));

create or replace function public.guard_wash_attribution()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    if auth.uid() is not null then
      if new.created_by is not null and new.created_by <> auth.uid() then
        raise exception 'Wash creator must match the signed-in user' using errcode = '42501';
      end if;
      new.created_by := auth.uid();
    end if;
    new.entry_name := null; new.entry_username := null;
    select p.full_name, p.username into new.entry_name, new.entry_username
      from public.profiles p where p.id = new.created_by and p.organisation_id = new.organisation_id;
    new.completed_by := null; new.completed_at := null;
    if new.status = 'Completed' then
      new.completed_by := new.created_by; new.completed_at := now();
    end if;
  else
    if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
      or new.captured_at is distinct from old.captured_at then
      raise exception 'Original wash attribution cannot be changed' using errcode = '42501';
    end if;
    new.entry_name := old.entry_name; new.entry_username := old.entry_username;
    new.completed_by := old.completed_by; new.completed_at := old.completed_at;
    if new.status = 'Completed' and old.status is distinct from 'Completed' then
      new.completed_by := auth.uid(); new.completed_at := now();
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_wash_attribution() from public, anon, authenticated;
create trigger wash_attribution before insert or update on public.wash_records
for each row execute function public.guard_wash_attribution();

-- Run as the caller: both wash and profile RLS continue to apply. A hidden or
-- deleted profile does not remove the wash; clients retain its creator ID.
create or replace function public.wash_entry_people(p_ids uuid[])
returns table(id uuid, full_name text, username text)
language sql stable security invoker set search_path = pg_catalog, public as $$
  select distinct p.id, p.full_name, p.username from public.profiles p
  join public.wash_records w on w.created_by = p.id and w.organisation_id = p.organisation_id
  where w.id = any(p_ids) and cardinality(p_ids) <= 500;
$$;
revoke all on function public.wash_entry_people(uuid[]) from public, anon;
grant execute on function public.wash_entry_people(uuid[]) to authenticated;

-- Corrections use caller RLS, typed values and one atomic update. This also
-- prevents moving a record outside the caller's country/site write scope.
create or replace function public.correct_wash_record(p_id uuid, p_patch jsonb, p_reason text default null)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare old_row public.wash_records; new_row public.wash_records; patch jsonb; k text; changes int := 0;
begin
  if auth.uid() is null or not public.app_is_elevated() then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;
  select * into old_row from public.wash_records where id=p_id and organisation_id=public.app_current_org() for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'A correction reason is required'; end if;
  select coalesce(jsonb_object_agg(key, case when value='""'::jsonb then 'null'::jsonb else value end),'{}'::jsonb)
    into patch from jsonb_each(p_patch) where key = any(array[
    'site','area','asset_no','vehicle_type','wash_date','wash_time','wash_type','bay','washed_by',
    'water_liters','cost','duration_min','status','odometer_km','notes','wash_details']);
  new_row := jsonb_populate_record(old_row,patch);
  perform set_config('app.wash_correction_reason',btrim(p_reason),true);
  update public.wash_records set site=new_row.site, area=new_row.area, asset_no=new_row.asset_no,
    vehicle_type=new_row.vehicle_type, wash_date=new_row.wash_date, wash_time=new_row.wash_time,
    wash_type=new_row.wash_type, bay=new_row.bay, washed_by=new_row.washed_by,
    water_liters=new_row.water_liters, cost=new_row.cost, duration_min=new_row.duration_min,
    status=new_row.status, odometer_km=new_row.odometer_km, notes=new_row.notes, wash_details=new_row.wash_details
    where id=p_id;
  if not found then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  for k in select jsonb_object_keys(patch) loop
    if (to_jsonb(old_row)->k) is distinct from (to_jsonb(new_row)->k) then
      changes := changes + 1;
    end if;
  end loop;
  perform set_config('app.wash_correction_reason','',true);
  return jsonb_build_object('ok',true,'changed',changes,'record',
    (select to_jsonb(w) from public.wash_records w where w.id=p_id));
end $$;
revoke all on function public.correct_wash_record(uuid,jsonb,text) from public, anon;
grant execute on function public.correct_wash_record(uuid,jsonb,text) to authenticated;

-- Audit actual changes, including direct permitted updates; clients cannot
-- insert invented audit rows. The trigger is not an exposed writer endpoint.
create or replace function public.audit_wash_changes()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare k text;
begin
  foreach k in array array['site','area','asset_no','vehicle_type','wash_date','wash_time','wash_type',
    'bay','washed_by','water_liters','cost','duration_min','status','odometer_km','notes','wash_details'] loop
    if (to_jsonb(old)->k) is distinct from (to_jsonb(new)->k) then
      insert into public.wash_record_corrections(organisation_id,wash_id,field,old_value,new_value,reason,corrected_by)
      values(new.organisation_id,new.id,k,to_jsonb(old)->>k,to_jsonb(new)->>k,
        coalesce(nullif(current_setting('app.wash_correction_reason',true),''),'Record updated'),auth.uid());
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.audit_wash_changes() from public,anon,authenticated;
create trigger wash_changes_audit after update on public.wash_records
for each row execute function public.audit_wash_changes();
create policy wash_corrections_parent_scope on public.wash_record_corrections as restrictive for select to authenticated
using (exists(select 1 from public.wash_records w where w.id=wash_id));
create index wash_records_creator_date_idx on public.wash_records(organisation_id,created_by,created_at desc);
notify pgrst, 'reload schema';
