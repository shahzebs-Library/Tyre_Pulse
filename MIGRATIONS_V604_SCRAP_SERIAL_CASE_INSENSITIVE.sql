-- V604 — scrap/unscrap/list match a tyre serial case-insensitively.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc.
--
-- THE BUG (PROJECT_MEMORY item 12). `tyre_records.serial_no` is case-split: the
-- same physical tyre's life is recorded half under `k507B403590` and half under
-- `K507B403590` (measured: 45 canonical groups, 95 rows). scrap_tyre_by_serial
-- matched `t.serial_no = v_s` EXACTLY, so scrapping `K507B403590` set one row to
-- Scrapped and left the other Active - the tyre reads Scrapped in the register
-- while still fitted in the pool. Physical consequence: equipment shown as out of
-- service when a live fitment remains.
--
-- THE FIX, and why it is the safe one. Do NOT normalise the column - the FIELD
-- lookups (`tyreExchange.findTyreBySerial`, mobile barcode `lookupTyreBySerial`)
-- are case-sensitive `.eq()`, so uppercasing the column turns a split-history bug
-- into a can't-find-in-the-field bug. Instead these three SERVER RPCs now match
-- the tyre by `upper(btrim(serial_no))`, so a scrap touches EVERY fitment of the
-- canonical serial whatever casing the row carries. The scrap MARK is stored
-- canonical (all 201 existing marks are already upper, verified), so the
-- `(serial, mark_type)` unique key dedupes case variants and unscrap/list match it.
-- The column is untouched; field barcode lookups are untouched.
--
-- ROLLBACK: re-create these three functions from V584/earlier definitions (the
-- bodies below with `= v_s` restored and `v_s := btrim(...)`).

CREATE OR REPLACE FUNCTION public.scrap_tyre_by_serial(p_serial text, p_reason text DEFAULT NULL::text, p_country text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.app_current_org();
  v_s   text := upper(btrim(coalesce(p_serial, '')));  -- canonical serial: case-insensitive match
  v_prior jsonb; v_n int; v_tot int; v_ok int; v_ctry text;
begin
  if p_country is not null and not public.app_write_country_ok(p_country) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if v_s = '' then
    raise exception 'Serial number is required' using errcode = '22023';
  end if;
  if v_org is null or not public.tyre_scrap_allowed() then
    raise exception 'You do not have permission to scrap a tyre' using errcode = '42501';
  end if;

  select count(*),
         count(*) filter (where t.country is null or public.app_write_country_ok(t.country)),
         min(t.country) filter (where t.country is not null)
    into v_tot, v_ok, v_ctry
    from public.tyre_records t
   where upper(btrim(t.serial_no)) = v_s and t.organisation_id = v_org;

  if v_tot = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'serial', v_s); end if;
  if v_ok = 0 then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  select coalesce(jsonb_object_agg(t.id::text, coalesce(t.status, 'Active')), '{}'::jsonb)
    into v_prior
    from public.tyre_records t
   where upper(btrim(t.serial_no)) = v_s
     and t.organisation_id = v_org
     and coalesce(t.status, '') <> 'Scrapped'
     and (t.country is null or public.app_write_country_ok(t.country));

  insert into public.tyre_status_marks
    (serial, mark_type, reason, country, created_by, created_at, organisation_id, prior_status)
  values (v_s, 'scrap', nullif(btrim(coalesce(p_reason, '')), ''),
          coalesce(v_ctry, nullif(btrim(coalesce(p_country, '')), '')), auth.uid(), now(), v_org, v_prior)
  on conflict (serial, mark_type) do update
    set reason     = excluded.reason,
        created_by = excluded.created_by,
        created_at = excluded.created_at,
        country    = coalesce(excluded.country, tyre_status_marks.country),
        prior_status = case
          when tyre_status_marks.prior_status is null
            or tyre_status_marks.prior_status = '{}'::jsonb
          then excluded.prior_status
          else tyre_status_marks.prior_status end;

  update public.tyre_records
     set status = 'Scrapped'
   where upper(btrim(serial_no)) = v_s
     and organisation_id = v_org and (country is null or public.app_write_country_ok(country));
  get diagnostics v_n = row_count;

  perform public._log_scrap_action('tyre_scrap', v_s, v_prior,
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''), 'rows', v_n),
    nullif(btrim(coalesce(p_country, '')), ''));

  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'serial', v_s, 'updated', 0); end if;
  return jsonb_build_object('ok', true, 'serial', v_s, 'updated', v_n);
end $function$;

CREATE OR REPLACE FUNCTION public.unscrap_tyre_by_serial(p_serial text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.app_current_org();
  v_s   text := upper(btrim(coalesce(p_serial, '')));  -- canonical serial
  v_mark record; v_prior jsonb; v_n int := 0;
begin
  if v_s = '' then
    raise exception 'Serial number is required' using errcode = '22023';
  end if;
  if v_org is null or not public.tyre_unscrap_allowed() then
    raise exception 'Only an administrator can undo a scrap' using errcode = '42501';
  end if;

  select * into v_mark from public.tyre_status_marks
   where serial = v_s and mark_type = 'scrap' and organisation_id = v_org
     and (country is null or public.app_write_country_ok(country));
  v_prior := v_mark.prior_status;

  perform public._log_scrap_action('tyre_unscrap', v_s,
    jsonb_build_object('scrapped_by', v_mark.created_by, 'scrapped_at', v_mark.created_at,
                       'reason', v_mark.reason, 'prior_status', v_prior),
    null, v_mark.country);

  delete from public.tyre_status_marks
   where serial = v_s and mark_type = 'scrap' and organisation_id = v_org
     and (country is null or public.app_write_country_ok(country));

  if v_prior is not null and v_prior <> '{}'::jsonb then
    update public.tyre_records t
       set status = v_prior ->> t.id::text
     where upper(btrim(t.serial_no)) = v_s
       and t.organisation_id = v_org
       and t.status = 'Scrapped'
       and (t.country is null or public.app_write_country_ok(t.country))
       and v_prior ? t.id::text;
    get diagnostics v_n = row_count;
  else
    update public.tyre_records
       set status = 'Active'
     where upper(btrim(serial_no)) = v_s
       and organisation_id = v_org
       and (country is null or public.app_write_country_ok(country))
       and status = 'Scrapped';
    get diagnostics v_n = row_count;
  end if;

  return jsonb_build_object('ok', true, 'serial', v_s, 'updated', v_n,
                            'restored_exactly', (v_prior is not null and v_prior <> '{}'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.list_scrapped_tyres(p_search text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_limit integer DEFAULT 500)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.app_current_org();
  v_q   text := nullif(btrim(coalesce(p_search, '')), '');
  v_lim int  := least(greatest(coalesce(p_limit, 500), 1), 2000);
  result jsonb;
begin
  if p_country is not null and not public.app_can_see_country(p_country) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  with marked as (
    select m.serial, m.reason, m.created_at as scrapped_at, m.created_by,
           coalesce(m.country, '') as mark_country
      from public.tyre_status_marks m
     where m.mark_type = 'scrap'
       and m.organisation_id = v_org
  ), rec as (
    -- ONE row per CANONICAL serial (case-split fitments of one physical tyre
    -- collapse together); the most recent fitment carries the live detail.
    select distinct on (upper(btrim(t.serial_no)))
           t.id, t.serial_no, t.asset_no, t.tyre_position, t.brand, t.size, t.site,
           t.country, t.cost_per_tyre, t.issue_date, t.removal_date, t.status,
           t.removal_reason, t.job_card, t.total_km, t.km_at_fitment, t.km_at_removal,
           t.tread_depth
      from public.tyre_records t
     where t.organisation_id = v_org
       and nullif(btrim(coalesce(t.serial_no, '')), '') is not null
     order by upper(btrim(t.serial_no)), t.issue_date desc nulls last, t.created_at desc nulls last
  ), joined as (
    select coalesce(m.serial, upper(btrim(r.serial_no))) as serial,
           r.id as tyre_record_id,
           r.asset_no, r.tyre_position, r.brand, r.size, r.site,
           coalesce(nullif(m.mark_country, ''), r.country) as country,
           r.cost_per_tyre, r.issue_date, r.removal_date, r.removal_reason,
           r.job_card, r.tread_depth,
           coalesce(r.total_km,
                    case when r.km_at_removal is not null and r.km_at_fitment is not null
                          and r.km_at_removal >= r.km_at_fitment
                         then r.km_at_removal - r.km_at_fitment end) as km_run,
           coalesce(m.reason, r.removal_reason) as reason,
           m.scrapped_at, m.created_by,
           (m.serial is not null) as marked
      from marked m
      full outer join rec r on upper(btrim(r.serial_no)) = m.serial
     where m.serial is not null
        or coalesce(r.status, '') = 'Scrapped'
  ), enriched as (
    select j.*,
           coalesce(nullif(btrim(p.full_name), ''), p.username, p.email) as scrapped_by_name,
           w.status      as job_card_status,
           w.work_type   as job_card_type,
           left(coalesce(nullif(btrim(w.description), ''), nullif(btrim(w.notes), '')), 120) as job_card_complaint,
           w.opened_at::date as job_card_opened,
           v.vehicle_type, v.make, v.model,
           d.status as disposal_status
      from joined j
      left join public.profiles p on p.id = j.created_by
      left join public.work_orders w
        on w.organisation_id = v_org and w.work_order_no = j.job_card
      left join lateral (
        select f.vehicle_type, f.make, f.model
          from public.vehicle_fleet f
         where f.organisation_id = v_org
           and f.asset_no = j.asset_no
           and (j.country is null or f.country is null or f.country = j.country)
         order by (f.country = j.country) desc nulls last
         limit 1
      ) v on true
      left join public.tyre_disposals d on d.tyre_record_id = j.tyre_record_id
  ), visible as (
    select * from enriched
     where (p_country is null or country = p_country) and (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries()) or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[]))) and ((site)::text is null or btrim((site)::text) = '' or (select public.is_super_admin()) or (select public.app_sees_all_sites()) or upper(btrim((site)::text)) = any(coalesce((select public.app_site_scope()), '{}'::text[])))
       and (v_q is null
            or serial   ilike '%' || v_q || '%'
            or coalesce(asset_no, '')         ilike '%' || v_q || '%'
            or coalesce(brand, '')            ilike '%' || v_q || '%'
            or coalesce(reason, '')           ilike '%' || v_q || '%'
            or coalesce(job_card, '')         ilike '%' || v_q || '%'
            or coalesce(scrapped_by_name, '') ilike '%' || v_q || '%')
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'total',              (select count(*) from visible),
    'marked_total',       (select count(*) from visible where marked),
    'unattributed_total', (select count(*) from visible where not marked),
    'linked', jsonb_build_object(
      'with_job_card', (select count(*) from visible where job_card is not null),
      'with_cost',     (select count(*) from visible where cost_per_tyre is not null),
      'with_km',       (select count(*) from visible where km_run is not null),
      'with_disposal', (select count(*) from visible where disposal_status is not null)),
    'search',  v_q,
    'country', p_country,
    'truncated', (select count(*) from visible) > v_lim,
    'rows', (select coalesce(jsonb_agg(to_jsonb(x) order by x.scrapped_at desc nulls last, x.serial), '[]'::jsonb)
               from (select * from visible
                      order by scrapped_at desc nulls last, serial
                      limit v_lim) x)
  ) into result;

  return result;
end $function$;
