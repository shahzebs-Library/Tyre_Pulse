-- =============================================================================
-- Review fixes on PR #620 (2026-11-28).
-- STATUS: AUTHORED, NOT APPLIED. Apply only on the owner's OK.
--
-- 1. driver_concerns.case_no was unique across ALL companies, while the number
--    is minted per company and year (driver_concern_counters keyed on
--    organisation_id, yr). The first concern of a second company would collide
--    with DC-<year>-0001 of the first, and since the counter increment rolls
--    back with the failed insert it would stay stuck there. Uniqueness is now
--    per company: (organisation_id, case_no).
--
-- 2. workshop_intake__ingest (SECURITY DEFINER) found an existing intake row
--    by organisation + source + row id alone and updated it. A caller allowed
--    in one country/site who knew another row's id could change a record
--    outside their own scope, and a Google Sheet row whose asset code was
--    changed kept updating the OLD vehicle's record. Now, before an existing
--    row is touched:
--      * a signed-in caller must be in scope for the STORED record's
--        country and site (same check as workshop_intake__load);
--      * the stored record must be in the same country as the call;
--      * the asset code must still match. A changed asset is refused with a
--        plain message: add the new vehicle as a new row.
--    Patched by anchored replace on the live definition (aborts unless the
--    anchor is found exactly once), so nothing else in the body changes.
--
-- Verify: select count(*) from pg_constraint where conname = 'driver_concerns_org_case_no_key';  -- 1
--         select pg_get_functiondef('public.workshop_intake__ingest'::regproc) ~ 'already belongs to another vehicle';  -- t
-- Rollback: alter table public.driver_concerns drop constraint driver_concerns_org_case_no_key,
--           add constraint driver_concerns_case_no_key unique (case_no);
--           re-create workshop_intake__ingest from 20261128090000.
-- =============================================================================

alter table public.driver_concerns drop constraint if exists driver_concerns_case_no_key;
alter table public.driver_concerns
  add constraint driver_concerns_org_case_no_key unique (organisation_id, case_no);

do $patch$
declare
  v_def text;
  v_anchor text := E'    if found then\n      if r.row_hash = v_hash then';
  v_new text := E'    if found then\n'
    || E'      if p_actor is not null\n'
    || E'         and not coalesce(public.workshop_intake_in_scope(r.organisation_id, r.country, r.site), false) then\n'
    || E'        n_bad := n_bad + 1;\n'
    || E'        v_res := v_res || jsonb_build_object(''source_key'', v_key, ''outcome'', ''invalid'', ''asset_no'', v_asset,\n'
    || E'                                              ''message'', ''You cannot change this vehicle''''s record'');\n'
    || E'        continue;\n'
    || E'      end if;\n'
    || E'      if r.country is distinct from p_country\n'
    || E'         or public.workshop_status_asset_key(r.asset_no) is distinct from v_asset then\n'
    || E'        n_bad := n_bad + 1;\n'
    || E'        v_res := v_res || jsonb_build_object(''source_key'', v_key, ''outcome'', ''invalid'', ''asset_no'', v_asset,\n'
    || E'                                              ''record_id'', r.id,\n'
    || E'                                              ''message'', ''This row id already belongs to another vehicle. Add the new vehicle as a new row.'');\n'
    || E'        continue;\n'
    || E'      end if;\n'
    || E'      if r.row_hash = v_hash then';
begin
  v_def := pg_get_functiondef('public.workshop_intake__ingest'::regproc);
  v_def := replace(v_def, E'\r\n', E'\n');
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'anchor in workshop_intake__ingest did not match exactly once; not patched';
  end if;
  execute replace(v_def, v_anchor, v_new);
end
$patch$;
