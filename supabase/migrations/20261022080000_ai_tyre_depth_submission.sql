-- AI tyre inspection: authenticated physical gauge capture.
-- The caller identity and tenant are inferred from auth.uid and inspection ownership.
create or replace function public.record_ai_tyre_depth(
 p_inspection_id uuid,p_position text,p_source text,p_original numeric,
 p_minimum numeric,p_inner numeric,p_center numeric,p_outer numeric,
 p_odometer numeric default null,p_serial text default null
) returns uuid language plpgsql security invoker set search_path=public,pg_catalog
as $$
declare v_org uuid; v_result uuid;
begin
 if auth.uid() is null or not app_user_can('inspections','edit') then
  raise exception 'Not authorized' using errcode='42501';
 end if;
 if p_position is null or length(trim(p_position)) not between 1 and 80 then
  raise exception 'Invalid position';
 end if;
 if p_source not in ('manual_gauge','digital_gauge','calibrated_device')
 or p_original is null or p_original<=0 or p_original>100
 or p_minimum is null or p_minimum<0 or p_minimum>=p_original
 or (p_inner is null and p_center is null and p_outer is null)
 or (p_inner is not null and (p_inner<0 or p_inner>p_original))
 or (p_center is not null and (p_center<0 or p_center>p_original))
 or (p_outer is not null and (p_outer<0 or p_outer>p_original))
 or (p_odometer is not null and p_odometer<0) then
  raise exception 'Invalid physical tread measurement';
 end if;
 select organisation_id into v_org from public.inspections
 where id=p_inspection_id and organisation_id=app_current_org();
 if v_org is null then raise exception 'Inspection not found in organization' using errcode='42501'; end if;
 -- RPC is invoker and requires a tightly scoped write policy below.
 insert into public.ai_tyre_depth_measurements
 (organisation_id,inspection_id,tyre_position,source,original_mm,minimum_mm,
 inner_mm,center_mm,outer_mm,odometer_km,tyre_serial,measured_at,recorded_by)
 values (v_org,p_inspection_id,trim(p_position),p_source,p_original,p_minimum,
 p_inner,p_center,p_outer,p_odometer,nullif(trim(p_serial),''),now(),auth.uid())
 returning id into v_result;
 return v_result;
end $$;
revoke all on function public.record_ai_tyre_depth(uuid,text,text,numeric,numeric,numeric,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.record_ai_tyre_depth(uuid,text,text,numeric,numeric,numeric,numeric,numeric,numeric,text) to authenticated;
grant insert on public.ai_tyre_depth_measurements to authenticated;
drop policy if exists ai_tyre_depth_authorized_insert on public.ai_tyre_depth_measurements;
create policy ai_tyre_depth_authorized_insert on public.ai_tyre_depth_measurements
 for insert to authenticated with check (
 recorded_by=auth.uid() and organisation_id=app_current_org()
 and app_user_can('inspections','edit')
 and exists(select 1 from public.inspections i where i.id=inspection_id
 and i.organisation_id=organisation_id)
);
