-- One server-side rule for how far a tyre really ran.
-- MIRROR of src/lib/tyreKm.js tyreKmAssessment (change both).
--
-- WHY: total_km on 545 removed tyres is the MACHINE odometer, not the tyre's
-- life - their fitment odometer was typed as 1, so removal minus 1 reads as a
-- 230,000 km tyre. Measured live 2026-11-04 over 6,464 removed tyres: 5,381
-- carry a real fitment reading and total_km equals removal minus fitment on
-- every one of them; 545 carry the "1" placeholder (55 over 100,000 km); 100
-- were fitted new at 0 km (owner-approved, a real life).
--
-- Rule: real fitment (> 1) -> removal - fitment (or total_km); fitment 0 ->
-- total_km / removal; fitment 1 -> unknown; a life above tyre_life_km_cap for
-- the vehicle class -> unknown. Unknown is NULL, never 0.
--
-- Also points list_scrapped_tyres (V384) at it, by anchored replace that aborts
-- unless the old expression is found exactly once.
--
-- Rollback: re-apply V384's list_scrapped_tyres body; drop function public.tyre_km_life(numeric,numeric,numeric,text);

create or replace function public.tyre_km_life(
  p_fit numeric, p_rem numeric, p_total numeric, p_vehicle_type text)
 returns numeric
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case when v.km is not null and v.km <= public.tyre_life_km_cap(p_vehicle_type) then v.km end
  from (select case
    when p_fit > 1 and p_rem > p_fit then p_rem - p_fit
    when p_fit > 1 and p_total > 0 then p_total
    when p_fit = 1 then null
    when p_fit = 0 and p_total > 0 then p_total
    when p_fit = 0 and p_rem > 0 then p_rem
    when p_fit is null and p_total > 0 then p_total
  end as km) v
$function$;

grant execute on function public.tyre_km_life(numeric,numeric,numeric,text) to authenticated, service_role;

do $$
declare
  v_def text := pg_get_functiondef('public.list_scrapped_tyres(text,text,integer)'::regprocedure);
  v_old text := E'coalesce(r.total_km,\n                    case when r.km_at_removal is not null and r.km_at_fitment is not null\n                          and r.km_at_removal >= r.km_at_fitment\n                         then r.km_at_removal - r.km_at_fitment end) as km_run,';
  v_new text := 'public.tyre_km_life(r.km_at_fitment, r.km_at_removal, r.total_km, r.tyre_vehicle_type) as km_run,';
  v_old2 text := E'           t.tread_depth\n      from public.tyre_records t';
  v_new2 text := E'           t.tread_depth, t.vehicle_type as tyre_vehicle_type\n      from public.tyre_records t';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'list_scrapped_tyres km_run expression not found exactly once';
  end if;
  if (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2) <> 1 then
    raise exception 'list_scrapped_tyres rec column list not found exactly once';
  end if;
  execute replace(replace(v_def, v_old, v_new), v_old2, v_new2);
end $$;
