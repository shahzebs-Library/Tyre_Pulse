-- V545  COUNTRY GUARD ON THE COST / FLEET RPC FAMILY
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A).
--
-- A CROSS-COUNTRY READ LEAK, reproduced before it was fixed.
--
-- A SECURITY DEFINER function runs as its owner and therefore bypasses RLS.
-- These functions took a p_country and never asked whether the CALLER may see
-- that country. Impersonating a real approved KSA-only Manager - for whom
-- app_can_see_country('UAE') is false and a direct read of UAE tyre_records
-- returns 0 rows:
--
--   get_cost_cpk_overview('UAE',...)      -> AED 4,458,439, plus the previous
--                                            and last-year comparison windows
--   get_fleet_cpk('UAE',...)              -> AED 1,367,960 tyre cost, 42.2M km
--   get_parts_expense_snapshot(...,'UAE') -> AED 4,458,439
--   report_tyre_summary('UAE',...)        -> 1,383 records, Dubai / Jebel Ali
--   get_maintenance_snapshot(...,'UAE')   -> 4,315 job cards
--   get_cost_variance('UAE',...)          -> the full variance analysis
--
-- This is DISCLOSURE, unlike the V542 write hole: another country's financials
-- were handed to a user explicitly scoped out of them. RLS was never at fault -
-- it held on every direct table read. The definer functions were simply never
-- asked the question.
--
-- The guard is the idiom the 18 already-guarded functions use, verbatim, placed
-- immediately after the body opens so it runs before any query. All eight return
-- jsonb, so the refusal shape matches their own existing error path.
--
-- It inserts by reading each LIVE definition rather than retyping bodies of up
-- to 8k characters, and ABORTS unless it guards exactly the eight named. A
-- partial run is the failure mode that matters here: half a boundary reads as a
-- closed one (the V396 lesson).
--
-- VERIFIED AFTER, by impersonation:
--   * KSA-only Manager asking for UAE: all six probed functions return
--     {"ok":false,"reason":"forbidden"} instead of data.
--   * The same user's OWN country is untouched: SAR 3,679,183 from both the
--     CPK overview and the expense snapshot, 14,113 job cards.
--   * A null country still means "no country filter" and is still allowed, so
--     the all-countries callers are unaffected.
--   * Super admin still reads UAE: AED 4,458,439.
--
-- NOT COVERED, and stated rather than hidden: seven functions in the same family
-- are LANGUAGE sql (get_country_kpi, report_tyre_summary, get_expense_by_site,
-- get_tyre_cost_by_asset, report_asset_metrics, report_asset_overview,
-- get_brand_size_cpk). A LANGUAGE sql body cannot carry an `if` guard, so each
-- needs converting to plpgsql - a rewrite per function, not a mechanical
-- insertion. THEY STILL LEAK. This migration closes the plpgsql half only.
--
-- ROLLBACK: re-create each function from _bak.rpc_defs_v545, which holds the
-- exact prior definition text.

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v545;
create table _bak.rpc_defs_v545 (proname text, def text, saved_at timestamptz default now());

do $mig$
declare
  r        record;
  def      text;
  body_at  int;
  rel_at   int;
  begin_at int;
  newdef   text;
  n        int := 0;
  targets  text[] := array[
    'get_cost_variance','get_cost_cpk_overview','get_fleet_cpk','get_maintenance_snapshot',
    'get_parts_expense_snapshot','get_cpk_drivers','get_daily_job_cards','list_scrapped_tyres'
  ];
  guard    text := E'\n  if p_country is not null and not public.app_can_see_country(p_country) then\n    return jsonb_build_object(''ok'', false, ''reason'', ''forbidden''); end if;\n';
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join pg_language l   on l.oid  = p.prolang
    where ns.nspname = 'public' and p.prosecdef and l.lanname = 'plpgsql'
      and p.proname = any(targets)
      and pg_get_function_result(p.oid) = 'jsonb'
    order by p.proname
  loop
    def := pg_get_functiondef(r.oid);
    if position('app_can_see_country' in def) > 0 then
      continue;
    end if;
    insert into _bak.rpc_defs_v545 (proname, def) values (r.proname, def);

    -- Anchor on the body delimiter first, so a `begin` in the signature or a
    -- comment cannot be mistaken for the body opener. Case varies across these
    -- bodies (some DECLARE/BEGIN, some declare/begin), hence the lower().
    body_at := position('$function$' in def);
    if body_at = 0 then
      raise exception 'V545: no $function$ delimiter on %', r.proname;
    end if;
    rel_at := position(E'\nbegin' in lower(substring(def from body_at)));
    if rel_at = 0 then
      raise exception 'V545: no body-opening begin found on %', r.proname;
    end if;
    begin_at := body_at + rel_at + 5;   -- just past the word `begin`

    newdef := substring(def from 1 for begin_at) || guard || substring(def from begin_at + 1);
    if position('app_can_see_country' in newdef) = 0 then
      raise exception 'V545: guard not inserted on %', r.proname;
    end if;

    execute newdef;
    n := n + 1;
  end loop;

  raise notice 'V545: guarded % functions', n;
  if n <> 8 then
    raise exception 'V545: expected to guard 8 functions, guarded %', n;
  end if;
end
$mig$;
