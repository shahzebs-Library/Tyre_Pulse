-- ============================================================================
-- V604. Scrap a tyre by serial, case-insensitively.
--
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc as migration
--         `20260819202740 / v604_scrap_serial_case_insensitive`.
--
-- THIS FILE WAS RECONSTRUCTED FROM THE LIVE DATABASE on 2026-08-24, because the
-- migration was applied without a committed repo file and V604 then looked free.
-- It is not a new change: the body below is the live `pg_get_functiondef` output
-- verbatim. Re-running it is a no-op.
--
-- WHAT IT FIXES. `tyre_records.serial_no` carries the same physical tyre under
-- more than one casing (measured today: 45 serial groups / 95 rows differ only
-- by case or padding). `scrap_tyre_by_serial` matched `t.serial_no = v_s`
-- EXACTLY, so scrapping one casing left the other rows Active: the tyre read
-- Scrapped in the register while still sitting in the fitment pool. That was
-- reproduced live on TM662 LHRO, where scrapping `K507B403590` set the 2025 row
-- to Scrapped and left the 2026 row Active.
--
-- WHY THE COLUMN IS NOT NORMALISED INSTEAD, and this must stay true: two lookups
-- are case-SENSITIVE `.eq()` reads - `tyreExchange.findTyreBySerial` (which feeds
-- Scrap) and the mobile `lookupTyreBySerial` used by the BARCODE SCANNER.
-- Uppercasing the stored column would turn a split-history bug into a
-- cannot-find-the-tyre bug in the field. Readers first, column second.
--
-- SCOPE: the same `upper(btrim(...))` match was applied to all three scrap RPCs:
--     scrap_tyre_by_serial      (body below)
--     unscrap_tyre_by_serial
--     list_scrapped_tyres
-- To read the other two as they stand live:
--     select pg_get_functiondef(p.oid)
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname in ('unscrap_tyre_by_serial','list_scrapped_tyres');
--
-- BEHAVIOUR NOTE: `tyre_status_marks.serial` is now written UPPER-trimmed
-- (`v_s`). That is consistent with the existing data - the marks table was
-- already 100% canonical, so no historical mark is orphaned by the change.
--
-- ROLLBACK: restore the previous bodies from a backup. There is no snapshot for
-- this one, because it was applied without a repo file. Reverting would also
-- reopen the partial-scrap bug, so it should not be done casually.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.scrap_tyre_by_serial(p_serial text, p_reason text DEFAULT NULL::text, p_country text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.app_current_org();
  v_s   text := upper(btrim(coalesce(p_serial, '')));
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
