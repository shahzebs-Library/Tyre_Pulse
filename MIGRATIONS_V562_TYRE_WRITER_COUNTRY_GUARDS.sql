-- =====================================================================================
-- V562 - THE TYRE WRITERS: A MOVE, A FITMENT AND A SCRAP REASON THAT CROSSED THE WALL
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A), 2026-08-16.
-- Applied as supabase migration `v562_tyre_writer_country_guards`.
-- =====================================================================================
--
-- ROOT CAUSE, unchanged from every migration in this family:
-- A SECURITY DEFINER function runs as its OWNER, and no public table sets FORCE ROW
-- LEVEL SECURITY, so RLS NEVER RUNS INSIDE ONE. V542 gave 78 country tables a
-- RESTRICTIVE FOR ALL write policy, but that governs writes made THROUGH RLS. A definer
-- function steps around it and must re-check org, country and site itself.
--
-- All three functions below check ORGANISATION and stop there. Org separates one company
-- from another; it says nothing about country.
--
--
-- =====================================================================================
-- ENUMERATION
-- =====================================================================================
-- 87 authenticated-callable definer functions write to a country-bearing table and carry
-- no row-level country guard. Triaged:
--
--   25  the accident_* family      -> ALREADY COVERED. They delegate to
--                                     _accident_rpc_context, which V559 moved onto
--                                     app_write_country_ok. V560 proved this by
--                                     impersonation, not by reading the source: a
--                                     narrowed user was REFUSED on a DIRIYAH-G1 case and
--                                     served on an NHC one.
--   ~25 super-admin gated          -> country is moot (admin_*, reclassify_*, decide_*,
--                                     approve/reject_pending_upload, ...).
--    9  argument-only guard        -> the V550 class, still open (section 5).
--   the remainder are the ones this migration reaches, prioritised by DESTRUCTIVE and
--   REACHABLE rather than by name.
--
--
-- =====================================================================================
-- THE THREE HOLES - each reproduced live before it was touched, each recounted by a
-- PRIVILEGED reader after `reset role` in the SAME transaction
-- =====================================================================================
-- The measurement rule matters here more than anywhere: a count taken from inside the
-- attacker's session counts what is READABLE, not what was WRITTEN, so a blocked write
-- and an invisible write look identical. Attacker throughout is the real approved
-- KSA-only Manager 34793423, whose direct UAE read returns 0 rows.
--
-- 1. tyre_move(jsonb) - MOVED A REAL UAE TYRE.
--    Takes a tyre_id, checks organisation, and moves it. No country term anywhere.
--    PROVEN: a real UAE tyre went from position LHCI to 'ZZ-MOVED-BY-KSA'. Privileged
--    recount confirmed the write landed.
--
-- 2. apply_tyre_change(jsonb) - INSERTED A ROW STAMPED UAE.
--    This is the sharpest of the three, because the country of the row being CREATED is
--    taken STRAIGHT OFF THE PAYLOAD:
--        insert into public.tyre_records (..., country, ...)
--        values (..., nullif(btrim(p->>'country'),''), ...)
--    PROVEN: serial ZZ-V562-INJECTED landed with country = 'UAE'. That is exactly the
--    V542 injection defect - a row in another country's registers, cost reports and
--    exports, created by someone who cannot see it to undo it - REOPENED through a
--    definer path that the V542 write policy never sees.
--
-- 3. set_scrap_reason(text,text) - OVERWROTE A SCRAP REASON IN ANOTHER COUNTRY.
--    Keyed on serial + mark_type + organisation_id, with no country predicate.
--    PROVEN: 'original UAE reason' -> 'OVERWRITTEN BY A KSA-ONLY USER'.
--
--    LABELLED HONESTLY: all 201 live scrap marks are KSA today, so this could not be
--    exploited against real data at the time of writing and the UAE mark in the proof
--    was PLANTED. It is armed by data, not leaking by data - it fires the first time a
--    tyre outside the caller's country is scrapped. A boundary that depends on a table
--    holding one country's rows is not a boundary. The other two needed nothing planted.
--
--
-- =====================================================================================
-- THE GUARDS - four insertions over three functions
-- =====================================================================================
--   tyre_move           1  the SOURCE tyre's country, right after the cross-org check
--   apply_tyre_change   1  the PAYLOAD country, before anything is written
--   apply_tyre_change   1  the REMOVED tyre's country, after the cross-org check
--   set_scrap_reason    2  the row predicate, on the UPDATE *and* on the read that
--                          captures the prior value
--
-- apply_tyre_change needs BOTH of its guards and they are not redundant: a change can
-- name a foreign removed tyre while stamping the new row with the caller's own country,
-- and vice versa. Guarding one would leave the other open.
--
-- set_scrap_reason follows V550's rule exactly - scope the ROWS, in the write AND in the
-- read that captures the prior value, so a row the caller cannot touch is never RECORDED
-- as having been changed either.
--
-- public.app_write_country_ok(text) is used, NOT app_can_see_country: V555 added it
-- because the older helper bypassed for app_is_org_admin() = super OR plain admin, so a
-- guard built on it returned TRUE for a country-scoped plain Admin - it would have failed
-- to block the attacker it was written for. (V558 has since removed that bypass, but the
-- write helper stays the consistent choice; it is what the other 11 writers use.)
--
-- NOTHING WAS RETYPED. Each live body is read with pg_get_functiondef and the guard
-- inserted by an anchored replace() that ABORTS unless the anchor occurs EXACTLY the
-- expected number of times, plus an abort if the replacement produced no change. A
-- partial run is the failure mode that matters: half a boundary reads as a closed one.
--
--
-- =====================================================================================
-- VERIFICATION - attacks refused, and the feature still works
-- =====================================================================================
-- ATTACKS REFUSED (privileged recount, rolled back):
--   tyre_move on the real UAE tyre  -> position UNCHANGED at LHCI
--   apply_tyre_change country=UAE   -> 0 rows created
--   set_scrap_reason on a UAE mark  -> reason survived as 'original UAE reason'
--
-- CONTROLS PASS - this is the half that proves it is a fix and not a breakage:
--   apply_tyre_change country=KSA, same caller  -> 1 row created
--   set_scrap_reason as the SUPER ADMIN          -> reason updated
--
-- TEXTUAL REGRESSION PROOF, worth more than re-timing: stripping every inserted guard
-- from each live definition reproduces the backed-up definition BYTE FOR BYTE, so the
-- guard is provably the only change and a permitted country cannot take a different path.
--   strip_back_byte_identical = true on all 3
--   live_matches_applied      = true on all 3
--
-- PRESERVED on all three: SECURITY DEFINER = true, search_path = 'public',
-- authenticated EXECUTE = true, anon EXECUTE = false.
--
-- NO CLIENT CHANGE NEEDED: all three raise errcode 42501, which src/lib/safeError.js
-- already maps to a clean sentence (verified by reading it, not assumed).
--
--
-- =====================================================================================
-- STILL OPEN after this migration - stated rather than left silent
-- =====================================================================================
-- 1. The 9 argument-only-guarded writers (the V550 class): apply_production_station_map,
--    correction_case_open, material_master_set, parts_cost_fill, run_quality_checks,
--    run_reconciliation, scan_data_trust, set_store_site_map, tyre_price_backfill. Each
--    guards the ARGUMENT, and V550's lesson is that a guard on the argument is not a
--    guard on the rows - omitting the argument, which is what a caller does normally,
--    walks straight past it.
-- 2. The remaining unguarded writers: post_stock_movement, set_stock_count,
--    correct_wash_record, record_pm_service, the cost_* family, recon_backfill_*,
--    promote_erp_*, material_master_derive / _set_bulk, data_link_create_missing_assets.
-- 3. The 14 accident RPCs whose enum check is `x <> any (array[...])`, which is TRUE for
--    every value - so accident_task_create, accident_ws_set_status and 12 others can
--    never succeed for anyone. A behaviour repair, not a security one; deliberately not
--    made inside a security pass.
--
--
-- =====================================================================================
-- ROLLBACK
-- =====================================================================================
--     do $$ declare r record; begin
--       for r in select def_before from _bak.rpc_defs_v562 loop execute r.def_before; end loop;
--     end $$;
-- =====================================================================================

create schema if not exists _bak;
create table if not exists _bak.rpc_defs_v562 (
  proc text primary key, def_before text not null, def_after text,
  guards jsonb, captured_at timestamptz not null default now()
);

do $mig$
declare
  r record;
  v_before text; v_after text; v_n int; v_guards jsonb;
  specs jsonb := jsonb_build_array(
    jsonb_build_object(
      'proc','public.tyre_move(jsonb)',
      'anchor', E'    raise exception ''Cross-organisation move denied.'' using errcode = ''42501''; end if;\n',
      'add',    E'  if v_src.country is not null and not public.app_write_country_ok(v_src.country) then\n    raise exception ''Cross-country move denied.'' using errcode = ''42501''; end if;\n',
      'count', 1),
    jsonb_build_object(
      'proc','public.apply_tyre_change(jsonb)',
      'anchor', E'  if v_position is null then raise exception ''position is required.'' using errcode = ''22004''; end if;\n',
      'add',    E'  if nullif(btrim(p->>''country''),'''') is not null\n     and not public.app_write_country_ok(nullif(btrim(p->>''country''),'''')) then\n    raise exception ''Cross-country tyre change denied.'' using errcode = ''42501''; end if;\n',
      'count', 1),
    jsonb_build_object(
      'proc','public.apply_tyre_change(jsonb)',
      'anchor', E'      raise exception ''Cross-organisation tyre change denied.'' using errcode = ''42501''; end if;\n',
      'add',    E'    if v_removed.country is not null and not public.app_write_country_ok(v_removed.country) then\n      raise exception ''Cross-country tyre change denied.'' using errcode = ''42501''; end if;\n',
      'count', 1),
    jsonb_build_object(
      'proc','public.set_scrap_reason(text,text)',
      'anchor', E'where serial = v_s and mark_type = ''scrap'' and organisation_id = v_org',
      'add',    E' and (country is null or public.app_write_country_ok(country))',
      'count', 2)
  );
begin
  for r in
    select value->>'proc' proc,
           jsonb_agg(jsonb_build_object('anchor', value->>'anchor','add', value->>'add','count',(value->>'count')::int)
                     order by ord) gs
    from jsonb_array_elements(specs) with ordinality t(value, ord)
    group by value->>'proc'
  loop
    v_before := pg_get_functiondef(r.proc::regprocedure);
    v_after  := v_before;
    v_guards := '[]'::jsonb;

    for v_n in 0 .. jsonb_array_length(r.gs) - 1 loop
      declare
        a text := r.gs->v_n->>'anchor';
        g text := r.gs->v_n->>'add';
        c int  := (r.gs->v_n->>'count')::int;
        hits int;
      begin
        select count(*) into hits
        from regexp_matches(v_after, regexp_replace(a, '([.^$*+?()\[\]{}|\\])', E'\\\\\\1', 'g'), 'g');
        if hits <> c then
          raise exception 'V562 ABORT %: anchor expected % times, found %', r.proc, c, hits;
        end if;
        v_after := replace(v_after, a, a || g);
        v_guards := v_guards || jsonb_build_object('add', g, 'count', c);
      end;
    end loop;

    if v_after = v_before then
      raise exception 'V562 ABORT %: no change produced', r.proc;
    end if;

    insert into _bak.rpc_defs_v562 (proc, def_before, def_after, guards)
    values (r.proc, v_before, v_after, v_guards)
    on conflict (proc) do update set def_before=excluded.def_before,
      def_after=excluded.def_after, guards=excluded.guards, captured_at=now();

    execute v_after;
  end loop;
end
$mig$;
