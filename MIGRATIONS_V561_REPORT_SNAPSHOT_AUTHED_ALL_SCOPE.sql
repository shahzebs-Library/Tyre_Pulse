-- =====================================================================================
-- V561 - get_report_snapshot_authed HAD NO ALL-COUNTRIES ROW FILTER
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A), 2026-08-16.
-- Applied as supabase migration `v561_report_snapshot_authed_all_scope`.
-- =====================================================================================
--
-- ROOT CAUSE, the same one as every hole in this family:
-- A SECURITY DEFINER function runs as its OWNER, and no public table sets FORCE ROW
-- LEVEL SECURITY, so RLS NEVER RUNS INSIDE ONE. It must re-ask org, country and site
-- itself. This function asked about a NAMED country and asked nothing at all when the
-- country argument was omitted - which is the default path every screen uses.
--
--
-- =====================================================================================
-- A CORRECTION TO THE RECORD, BECAUSE THE FIRST REPORT OF THIS WAS WRONG
-- =====================================================================================
-- The V558 pass reported this function as "ignores its country argument entirely",
-- measuring 11,191 tyres for p_country = 'KSA', 'UAE', 'Egypt' AND NULL alike. That
-- reading is WRONG, and reproducing it here reproduced the mistake before catching it.
--
-- The signature is
--     get_report_snapshot_authed(p_from text, p_to text, p_site text, p_country text)
-- so a positional call passes the country string into p_from, where it fails to parse
-- as a date and is swallowed by an EXCEPTION handler into NULL. All four "different"
-- calls were therefore the SAME call: the all-countries path. The country argument was
-- never being exercised.
--
-- Re-measured with NAMED arguments, as the real approved KSA-only Manager 34793423:
--
--     get_report_snapshot_authed(p_country => 'KSA')    -> 8,145 tyres    correct
--     get_report_snapshot_authed(p_country => 'UAE')    -> forbidden      correct
--     get_report_snapshot_authed(p_country => 'Egypt')  -> forbidden      correct
--     get_report_snapshot_authed()                      -> 11,191 tyres   THE HOLE
--
-- So the named-country guard was working the whole time. The defect is narrower than
-- reported and is the V549 class exactly: `p_country` NULL means "no country filter",
-- and on that path the function applied no row-level country restriction of any kind.
--
-- RULE WORTH KEEPING: when probing a function with more than one text argument, CALL IT
-- BY NAME. A positional probe of a (from, to, site, country) signature silently measures
-- the wrong thing and reports a wider hole than exists - and a report that overstates a
-- hole is not harmless, because the fix it invites is aimed at the wrong place.
--
--
-- =====================================================================================
-- WHAT WAS ACTUALLY DISCLOSED
-- =====================================================================================
-- On the all-scope path, to the KSA-only Manager whose DIRECT table read is correctly
-- bounded (tyre_records: KSA 8,145 / UAE 0 / Egypt 0 - RLS itself never failed here):
--
--     tyres        11,191  against KSA's own 8,145
--     tyre_spend   12,450,391 against KSA's own 6,132,319
--
-- That spend figure deserves naming: it is SAR + AED + EGP ADDED TOGETHER. So it was at
-- once a disclosure of two other countries' money and a number that is not a quantity of
-- anything - the same defect V549 recorded on get_parts_expense_snapshot.
--
--
-- =====================================================================================
-- THE CHANGE - one anchor, 28 occurrences
-- =====================================================================================
-- Every row-reading site in the body filters country as the identical string
--
--     (v_country IS NULL OR country=v_country)
--
-- All 58 mentions of v_country in the body were accounted for BEFORE writing anything,
-- so that nothing could be left unguarded silently:
--
--     28 row filters x 2 mentions each      = 56
--      1 declaration (v_country text := ...) =  1
--      1 echo in the returned `filters` object=  1
--                                            ---
--                                             58   <- matches the live count exactly
--
-- V549's predicate is appended to each of the 28, unchanged:
--
--     and (country is null
--          or (select public.is_super_admin())
--          or (select public.app_sees_all_countries())
--          or lower(btrim((country)::text)) = any(coalesce((select public.app_country_scope()),
--                                                          '{}'::text[])))
--
-- Notes on that predicate, each of which is load-bearing:
--   * is_super_admin() IS NOT DECORATION. The super admin's profiles.country is NULL, so
--     app_sees_all_countries() is false and app_country_scope() is '{}' for every one of
--     the 38 live users. A predicate built from the two scope readers alone - the obvious
--     shape - returns ZERO ROWS to the platform owner.
--   * lower(), because app_country_scope() returns lower-cased values. (The SITE helper
--     is the opposite and needs UPPER; the two are genuinely asymmetric.)
--   * `country is null` keeps the standing convention that a null-dimension row stays
--     visible to every scope, exactly as V542's write policies preserve it.
--   * The zero-argument scope readers, written `(select f())`, hoist to a once-per-query
--     InitPlan. The row-argument app_can_see_country(country) takes the row value so it
--     cannot be hoisted, and being SECURITY DEFINER it can never be inlined - a per-row
--     profiles lookup on every one of 28 scans.
--
-- NOTHING WAS RETYPED. The live definition is read with pg_get_functiondef and the guard
-- inserted by an anchored replace() that ABORTS unless the anchor occurs EXACTLY 28
-- times, and a second abort if `app_country_scope` is already present. A partial run is
-- the failure mode that matters here: half a boundary reads as a closed one.
--
--
-- =====================================================================================
-- DELIBERATELY NOT TOUCHED: get_report_snapshot (the ANONYMOUS sibling)
-- =====================================================================================
-- get_report_snapshot(text,text,text,text,text,text) is the public share-token board and
-- is EXECUTE-able by `anon`. It derives the org from the token row after checking
-- active / expiry / password, and its country and site arguments are PRESENTATION
-- filters chosen by whoever minted the link, not scope claims. Inside a definer function
-- invoked by an anon caller auth.uid() is NULL, so app_country_scope() is '{}' and
-- is_super_admin() is false for EVERY viewer - guarding it would take every public board
-- offline. That is an outage, not a fix.
--
-- Confirmed still working for anon after this migration: a bad token returns
-- {ok:false, reason:'invalid'}, i.e. the function still executes as anon.
--
--
-- =====================================================================================
-- VERIFICATION (all live, impersonated, rolled back)
-- =====================================================================================
-- IT BITES - KSA-only Manager 34793423, all-scope call:
--     tyres       11,191  ->  8,145
--     tyre_spend  12,450,391 -> 6,132,319   (SAR only; no longer three currencies added)
--     fleet 1,030 · accidents 38 · inspections 363 · work_orders_open 60
--
-- THE DECISIVE CHECK, the same one V549 used: that user's ALL-SCOPE payload is now
--     BYTE-IDENTICAL to their own EXPLICIT KSA-scope payload
-- (md5 over the whole jsonb minus `generated_at` and the echoed `filters` object, both of
-- which legitimately differ). true.
--
-- IT IS A NO-OP FOR THE PLATFORM OWNER - super admin, all-scope: 11,191 tyres and
-- 12,450,391 spend, unchanged. This is the check that would have failed had the
-- is_super_admin() term been left out.
--
-- THE NAMED-COUNTRY PATH IS UNCHANGED: p_country=>'KSA' still 8,145 (and equal to the
-- all-scope result); p_country=>'UAE' and 'Egypt' still `forbidden`.
--
-- TEXTUAL REGRESSION PROOF - worth more than re-timing it: stripping the inserted guard
-- from the live definition reproduces the backed-up definition BYTE FOR BYTE, so the
-- guard is provably the only change and a permitted country cannot take a different path.
--     strip_back_byte_identical = true
--     live_matches_applied      = true
--
-- PRESERVED: SECURITY DEFINER = true, search_path = 'public, extensions',
-- authenticated EXECUTE = true, anon EXECUTE = false (unchanged - this function was
-- never anon-callable; its share-token sibling is the one that is).
--
--
-- =====================================================================================
-- ROLLBACK
-- =====================================================================================
--     do $$ declare d text; begin
--       select def_before into d from _bak.rpc_defs_v561
--        where proc = 'public.get_report_snapshot_authed(text,text,text,text)';
--       execute d;
--     end $$;
-- =====================================================================================

create schema if not exists _bak;

create table if not exists _bak.rpc_defs_v561 (
  proc text primary key,
  def_before text not null,
  def_after  text,
  guard_added text,
  captured_at timestamptz not null default now()
);

do $mig$
declare
  v_sig    text := 'public.get_report_snapshot_authed(text,text,text,text)';
  v_before text;
  v_after  text;
  v_anchor text := '(v_country IS NULL OR country=v_country)';
  v_guard  text := ' and (country is null'
                || ' or (select public.is_super_admin())'
                || ' or (select public.app_sees_all_countries())'
                || ' or lower(btrim((country)::text)) = any(coalesce((select public.app_country_scope()), ''{}''::text[])))';
  v_n int;
begin
  v_before := pg_get_functiondef(v_sig::regprocedure);

  select count(*) into v_n
  from regexp_matches(v_before, '\(v_country IS NULL OR country=v_country\)', 'g');
  if v_n <> 28 then
    raise exception 'V561 ABORT: expected 28 anchors, found %', v_n;
  end if;

  if position('app_country_scope' in v_before) > 0 then
    raise exception 'V561 ABORT: already guarded';
  end if;

  v_after := replace(v_before, v_anchor, v_anchor || v_guard);

  if replace(v_after, v_guard, '') <> v_before then
    raise exception 'V561 ABORT: strip-back is not byte-identical';
  end if;

  insert into _bak.rpc_defs_v561 (proc, def_before, def_after, guard_added)
  values (v_sig, v_before, v_after, v_guard)
  on conflict (proc) do update
    set def_before = excluded.def_before,
        def_after  = excluded.def_after,
        guard_added= excluded.guard_added,
        captured_at= now();

  execute v_after;
end
$mig$;
