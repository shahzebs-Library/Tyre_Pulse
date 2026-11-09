-- 20261109150000 - Tyre lifecycle hardening after PR #470.
--
-- 1. Same-day "latest upload wins" could let a STALE upload close a newer real
--    fitment. A same-day incoming fitment is now HELD for review
--    (status ambiguous_same_day_stale) when the evidence says it is older:
--      a. the incoming serial was already on this wheel and has been removed;
--      b. the replacement log says the tyre now on the wheel replaced it;
--      c. the incoming fitment odometer / hour meter is LOWER than the reading
--         recorded when the tyre now on the wheel went on.
--    Different-day rules are unchanged (earlier = held, later = closes).
-- 2. tyre_import_reconcile capped its review list at 200, and the web intake
--    only withheld rows named in that list, so held row 201+ was still sent to
--    insert. The full list now comes back as `held`; `review` stays capped for
--    display, `review_total` says how many there are.
-- 3. tyre_serial_is_strong also refuses month codes (FEB-62), a tyre size typed
--    with spaces (195 R 15), two serials in one cell, repeated digits and
--    123456-style sequences. MIRROR: src/lib/tyreLifetime.js isStrongSerial.
-- 4. tyre_cost_correction_undo marked EVERY row of a batch undone even when a
--    row was skipped because its price had changed since (5 rows of batch
--    0ad0b895 carry a price moved there by 20261109120000). Only restored rows
--    are marked now, so the skipped ones stay visible.
-- 5. get_tyre_exceptions(country): one read for the data-quality exception list.
-- 6. v_tyre_cost_status: why each fitment has (or has no) price.
-- 7. tyre_close_rotations(dry_run default true): closes the earlier fitment of a
--    serial that is active on two wheels of the SAME vehicle when the later one
--    is dated later (a rotation nobody closed). Same-day pairs are left for a
--    person. NOT run live by this migration - owner decision.
--
-- Every replaced function definition is copied to _bak.fn_defs_20261109d first.
-- ROLLBACK:
--   do $$ declare r record; begin
--     for r in select def from _bak.fn_defs_20261109d loop execute r.def; end loop; end $$;
--   drop function if exists public.get_tyre_exceptions(text);
--   drop function if exists public.tyre_close_rotations(boolean, text);
--   drop view if exists public.v_tyre_cost_status;

create table if not exists _bak.fn_defs_20261109d (fn text primary key, def text not null, saved_at timestamptz default now());
insert into _bak.fn_defs_20261109d(fn, def)
select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('_tyre_close_replaced', 'tyre_import_reconcile', 'tyre_serial_is_strong', 'tyre_cost_correction_undo')
on conflict (fn) do nothing;

-- 1 + 2: anchored edits of the live definitions; abort unless each anchor occurs once.
do $mig$
declare
  d text; n int;
  a1 text := $a$if v_prev_date > p_fit_date then return jsonb_build_object('status', 'ambiguous_not_later', 'tyre_id', v_prev.id); end if;$a$;
  stale text := $s$
    -- 20261109150000: same day is only "latest wins" when nothing says the
    -- incoming row is older than the tyre already on the wheel.
    if v_prev_date = p_fit_date then
      if v_serial is not null and exists (
        select 1 from public.tyre_records t
        where t.organisation_id is not distinct from p_org and coalesce(t.country, '') = coalesce(p_country, '')
          and upper(regexp_replace(coalesce(t.asset_no, t.asset_number, ''), '\s+', '', 'g')) = v_asset
          and upper(btrim(coalesce(t.tyre_position, t.position, ''))) = v_pos
          and upper(btrim(coalesce(t.serial_no, ''))) = v_serial
          and not public.tyre_status_is_active(t.status)) then
        return jsonb_build_object('status', 'ambiguous_same_day_stale', 'reason', 'serial_already_removed_from_wheel', 'tyre_id', v_prev.id);
      end if;
      if v_serial is not null and exists (
        select 1 from public.tyre_replacement_log l
        where l.organisation_id is not distinct from p_org and coalesce(l.country, '') = coalesce(p_country, '')
          and upper(regexp_replace(coalesce(l.asset_no, ''), '\s+', '', 'g')) = v_asset
          and l.position = v_pos and l.undone_at is null
          and upper(btrim(coalesce(l.old_serial, ''))) = v_serial
          and upper(btrim(coalesce(l.new_serial, ''))) = upper(btrim(coalesce(v_prev.serial_no, '')))) then
        return jsonb_build_object('status', 'ambiguous_same_day_stale', 'reason', 'logged_as_replaced_by_current', 'tyre_id', v_prev.id);
      end if;
      if (p_fit_km > 1 and v_prev.km_at_fitment > 1 and p_fit_km < v_prev.km_at_fitment)
         or (p_fit_hrs > 0 and v_prev.hrs_at_fitment > 0 and p_fit_hrs < v_prev.hrs_at_fitment) then
        return jsonb_build_object('status', 'ambiguous_same_day_stale', 'reason', 'meter_below_current_fitment', 'tyre_id', v_prev.id);
      end if;
    end if;$s$;
  a2 text := $a$and jsonb_array_length(v_review) < 200$a$;
  a3 text := $a$'review', v_review);$a$;
begin
  d := pg_get_functiondef('public._tyre_close_replaced(uuid,text,text,text,text,date,numeric,numeric,text,uuid,boolean,boolean)'::regprocedure);
  n := (length(d) - length(replace(d, a1, ''))) / length(a1);
  if n <> 1 then raise exception '_tyre_close_replaced anchor found % times', n; end if;
  if position('ambiguous_same_day_stale' in d) = 0 then
    execute replace(d, a1, a1 || stale);
  end if;

  d := pg_get_functiondef('public.tyre_import_reconcile(jsonb,text,boolean)'::regprocedure);
  if position($x$'held', v_review$x$ in d) = 0 then
    n := (length(d) - length(replace(d, a2, ''))) / length(a2);
    if n <> 1 then raise exception 'reconcile cap anchor found % times', n; end if;
    n := (length(d) - length(replace(d, a3, ''))) / length(a3);
    if n <> 1 then raise exception 'reconcile return anchor found % times', n; end if;
    d := replace(d, a2, '');
    d := replace(d, a3, $r$'review', (select coalesce(jsonb_agg(q.e), '[]'::jsonb) from (select e from jsonb_array_elements(v_review) e limit 200) q),
    'review_total', jsonb_array_length(v_review), 'held', v_review);$r$);
    execute d;
  end if;
end $mig$;

-- 3: serial rule. MIRROR src/lib/tyreLifetime.js isStrongSerial().
create or replace function public.tyre_serial_is_strong(p_serial text)
returns boolean language sql immutable set search_path = public as $f$
  select coalesce(
    length(btrim(p_serial)) >= 6
    and upper(btrim(p_serial)) ~ '[0-9]'
    and upper(btrim(p_serial)) !~ '^(DOT|NULL|N/?A|-)'
    and upper(btrim(p_serial)) !~ '^[0-9]{3}/'
    and upper(btrim(p_serial)) !~ '[0-9]{2,3}/[0-9]{2}\s*R'
    and upper(btrim(p_serial)) !~ 'E\+[0-9]+$'
    -- 20261109150000
    and upper(btrim(p_serial)) !~ '^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[- /]?[0-9]{2,4}$'
    and upper(btrim(p_serial)) !~ '^[0-9]{2,3}(\.[0-9]+)?\s*R\s*[0-9]{2}(\.[0-9])?($|[^0-9])'
    and upper(btrim(p_serial)) !~ '[,;&]'
    and upper(btrim(p_serial)) !~ '^([0-9])\1+$'
    and upper(btrim(p_serial)) not in ('123456', '1234567', '12345678', '123456789', '1234567890'),
    false)
$f$;

-- 4: undo marks only what it restored.
create or replace function public.tyre_cost_correction_undo(p_batch uuid)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_n int; v_skipped int;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can undo a cost correction' using errcode = '42501';
  end if;
  with restored as (
    update public.tyre_records t set cost_per_tyre = c.old_cost
    from public.tyre_cost_corrections c
    where c.batch_id = p_batch and c.undone_at is null and t.id = c.tyre_id
      and t.cost_per_tyre is not distinct from c.new_cost
    returning c.id
  )
  update public.tyre_cost_corrections c set undone_at = now() from restored r where c.id = r.id;
  get diagnostics v_n = row_count;
  select count(*) into v_skipped from public.tyre_cost_corrections where batch_id = p_batch and undone_at is null;
  return jsonb_build_object('ok', true, 'restored', v_n, 'skipped_changed_since', v_skipped);
end;
$f$;
revoke all on function public.tyre_cost_correction_undo(uuid) from public, anon;
grant execute on function public.tyre_cost_correction_undo(uuid) to authenticated;

-- 6: cost status per fitment (INVOKER view: RLS of tyre_records applies).
create or replace view public.v_tyre_cost_status with (security_invoker = on) as
with priced_serials as (
  select country, upper(btrim(serial_no)) s, min(coalesce(issue_date, fitment_date)) first_priced
  from public.tyre_records
  where coalesce(cost_per_tyre, 0) > 0 and public.tyre_serial_is_strong(serial_no)
  group by 1, 2
)
select t.id, t.country, t.asset_no, t.serial_no, t.issue_date, t.cost_per_tyre,
  case
    when coalesce(t.cost_per_tyre, 0) > 0 and bl.source = 'comparable' then 'estimated_comparable'
    when coalesce(t.cost_per_tyre, 0) > 0 and bl.source = 'own_jobcard' then 'from_job_card'
    when coalesce(t.cost_per_tyre, 0) > 0 then 'purchase_price'
    when cc.reason is not null then 'cleared_' || cc.reason
    when public.tyre_serial_is_strong(t.serial_no) and ps.s is not null then 'refit_no_new_purchase'
    else 'unpriced'
  end as cost_status
from public.tyre_records t
left join lateral (
  select l.source from public.tyre_price_backfill_log l
  where l.tyre_id = t.id and l.new_cost is not distinct from t.cost_per_tyre
  order by l.created_at desc limit 1) bl on true
left join lateral (
  select c.reason from public.tyre_cost_corrections c
  where c.tyre_id = t.id and c.undone_at is null and c.new_cost is not distinct from t.cost_per_tyre
  order by c.created_at desc limit 1) cc on true
left join priced_serials ps on ps.country is not distinct from t.country and ps.s = upper(btrim(t.serial_no));
grant select on public.v_tyre_cost_status to authenticated;

-- 5: exception list. INVOKER, so a user sees only their own org/country rows.
create or replace function public.get_tyre_exceptions(p_country text default null)
returns jsonb language sql stable security invoker set search_path = public
set plan_cache_mode = force_custom_plan as $f$
with act as (
  select t.id, t.country, upper(regexp_replace(coalesce(t.asset_no, ''), '\s+', '', 'g')) asset,
         upper(btrim(coalesce(t.tyre_position, t.position, ''))) pos, upper(btrim(t.serial_no)) serial,
         coalesce(t.issue_date, t.fitment_date) d, t.cost_per_tyre
  from public.tyre_records t
  where public.tyre_status_is_active(t.status) and (p_country is null or t.country = p_country)
), same_vehicle as (
  select country, asset, serial, count(*) n, count(distinct d) dates,
         jsonb_agg(jsonb_build_object('id', id, 'position', pos, 'date', d, 'cost', cost_per_tyre) order by d nulls first, pos) rows
  from act where public.tyre_serial_is_strong(serial)
  group by 1, 2, 3 having count(*) > 1
), priced_twice as (
  select country, upper(btrim(serial_no)) serial,
         jsonb_agg(jsonb_build_object('id', id, 'asset', asset_no, 'date', issue_date, 'cost', cost_per_tyre)) rows
  from public.tyre_records
  where public.tyre_serial_is_strong(serial_no) and coalesce(cost_per_tyre, 0) > 0
    and (p_country is null or country = p_country)
  group by 1, 2 having count(*) > 1
), weak as (
  select country, serial, count(*) n from act
  where serial is not null and serial <> '' and not public.tyre_serial_is_strong(serial)
  group by 1, 2
), remark as (
  select country, serial, count(*) n from act
  where public.tyre_serial_is_strong(serial) and serial ~ '[\s(]'
  group by 1, 2
), reviews as (
  select count(*) n from public.stg_monthly_tyres_audit a
  where a.action = 'rejected' and a.reason like 'replacement_needs_review:%' and a.resolved_at is null
    and (p_country is null or a.country = p_country)
)
select jsonb_build_object(
  'counts', jsonb_build_object(
    'rotation_not_closed', (select count(*) from same_vehicle where dates > 1),
    'same_day_double_entry', (select count(*) from same_vehicle where dates <= 1),
    'serial_priced_twice', (select count(*) from priced_twice),
    'weak_serial_active', (select coalesce(sum(n), 0) from weak),
    'serial_with_remark', (select coalesce(sum(n), 0) from remark),
    'import_reviews_open', (select n from reviews)),
  'same_vehicle', (select coalesce(jsonb_agg(jsonb_build_object('country', country, 'asset', asset, 'serial', serial,
      'kind', case when dates > 1 then 'rotation_not_closed' else 'same_day_double_entry' end, 'rows', rows)
      order by country, asset), '[]'::jsonb) from same_vehicle),
  'priced_twice', (select coalesce(jsonb_agg(jsonb_build_object('country', country, 'serial', serial, 'rows', rows)), '[]'::jsonb) from priced_twice),
  'weak_serials', (select coalesce(jsonb_agg(jsonb_build_object('country', country, 'serial', serial, 'rows', n) order by n desc), '[]'::jsonb)
                   from (select * from weak order by n desc limit 300) w),
  'serials_with_remark', (select coalesce(jsonb_agg(jsonb_build_object('country', country, 'serial', serial, 'rows', n)), '[]'::jsonb)
                   from (select * from remark limit 300) r));
$f$;
revoke all on function public.get_tyre_exceptions(text) from public, anon;
grant execute on function public.get_tyre_exceptions(text) to authenticated;

-- 7: rotation closer. Dry run by default; logs to tyre_replacement_log so
-- tyre_replacement_undo(batch) reverses it.
create or replace function public.tyre_close_rotations(p_dry_run boolean default true, p_country text default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  v_org uuid := public.app_current_org();
  v_batch uuid := gen_random_uuid();
  r record; v_n int := 0; v_list jsonb := '[]'::jsonb;
begin
  if not (public.is_super_admin() or (v_org is not null and public.app_is_elevated())) then
    raise exception 'You do not have permission to close rotations' using errcode = '42501';
  end if;
  if p_country is not null and not public.app_can_see_country(p_country) then
    raise exception 'Country not in your scope' using errcode = '42501';
  end if;
  for r in
    select e.id old_id, e.country, e.asset_no, upper(btrim(coalesce(e.tyre_position, e.position, ''))) old_pos,
           e.serial_no, e.removal_date, e.km_at_removal, e.total_km, e.status, e.extra_fields,
           l.id new_id, upper(btrim(coalesce(l.tyre_position, l.position, ''))) new_pos,
           coalesce(l.issue_date, l.fitment_date) new_date, e.organisation_id
    from public.tyre_records e
    join public.tyre_records l
      on l.id <> e.id and l.organisation_id is not distinct from e.organisation_id
     and l.country is not distinct from e.country
     and upper(regexp_replace(coalesce(l.asset_no, ''), '\s+', '', 'g')) = upper(regexp_replace(coalesce(e.asset_no, ''), '\s+', '', 'g'))
     and upper(btrim(l.serial_no)) = upper(btrim(e.serial_no))
     and upper(btrim(coalesce(l.tyre_position, l.position, ''))) <> upper(btrim(coalesce(e.tyre_position, e.position, '')))
     and coalesce(l.issue_date, l.fitment_date) > coalesce(e.issue_date, e.fitment_date)
    where public.tyre_status_is_active(e.status) and public.tyre_status_is_active(l.status)
      and public.tyre_serial_is_strong(e.serial_no)
      and (public.is_super_admin() or e.organisation_id = v_org)
      and (p_country is null or e.country = p_country)
      and not exists (  -- the later row must be the latest fitment of that serial on this vehicle
        select 1 from public.tyre_records z
        where z.organisation_id is not distinct from e.organisation_id and z.country is not distinct from e.country
          and upper(btrim(z.serial_no)) = upper(btrim(e.serial_no))
          and upper(regexp_replace(coalesce(z.asset_no, ''), '\s+', '', 'g')) = upper(regexp_replace(coalesce(e.asset_no, ''), '\s+', '', 'g'))
          and public.tyre_status_is_active(z.status)
          and coalesce(z.issue_date, z.fitment_date) > coalesce(l.issue_date, l.fitment_date))
  loop
    v_n := v_n + 1;
    v_list := v_list || jsonb_build_array(jsonb_build_object('country', r.country, 'asset', r.asset_no, 'serial', r.serial_no,
      'from_position', r.old_pos, 'to_position', r.new_pos, 'rotated_on', r.new_date));
    if not p_dry_run then
      insert into public.tyre_replacement_log (organisation_id, batch_id, tyre_id, country, asset_no, position, old_serial, new_serial,
        replaced_on, old_values, new_values, source)
      values (r.organisation_id, v_batch, r.old_id, r.country, r.asset_no, r.old_pos, r.serial_no, r.serial_no, r.new_date,
        jsonb_build_object('removal_date', r.removal_date, 'km_at_removal', r.km_at_removal, 'total_km', r.total_km,
          'status', r.status, 'extra_fields', r.extra_fields),
        jsonb_build_object('removal_date', r.new_date, 'status', 'Removed', 'rotated_to', r.new_pos), 'rotation_close');
      update public.tyre_records t set removal_date = r.new_date, status = 'Removed',
        extra_fields = coalesce(t.extra_fields, '{}'::jsonb) || jsonb_build_object('rotated_to', r.new_pos, 'rotated_on', r.new_date, 'rotation_batch', v_batch)
      where t.id = r.old_id;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'batch_id', case when p_dry_run then null else v_batch end,
    'rotations', v_n, 'rows', v_list);
end;
$f$;
revoke all on function public.tyre_close_rotations(boolean, text) from public, anon;
grant execute on function public.tyre_close_rotations(boolean, text) to authenticated;
