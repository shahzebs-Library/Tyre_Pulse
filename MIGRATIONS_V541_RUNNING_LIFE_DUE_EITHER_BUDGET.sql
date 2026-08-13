-- =============================================================================
-- V541 - "Due" means whichever budget runs out first
-- STATUS: APPLIED LIVE on project jhssdmeruxtrlqnwfksc (2026-08-13), verified.
--
-- WHY
-- `get_tyre_running_life`'s `is_due` read the DISTANCE side first and only
-- looked at engine hours when there was no distance at all:
--
--     case when j.rem_km   is not null then (km rule)
--          when j.rem_hours is not null then (hours rule)
--          else false end
--
-- A concrete pump carries BOTH targets because the owner set both - 30,000 km
-- AND 5,000 hours - and a pump drives to site, so it nearly always has a
-- distance. The hours arm was therefore almost never reached, and a tyre that
-- had spent its hours budget while its distance still looked healthy was not
-- returned at all. The Inspections page asks the server for the due set only,
-- so those tyres were invisible there.
--
-- MEASURED ON THE LIVE KSA FLEET, before and after:
--   all active tyres            3,580
--   due under the old km-first rule 415
--   due under "either budget"       431
--   newly flagged                    16
--   no longer flagged                 0   <- strictly more visibility, nothing lost
--   pump tyres carrying BOTH targets 719 (73 of them further along on distance)
--
-- MIRRORED IN JS by measureFor / bandFor in src/lib/tyreRunningLife.js and
-- pinned by src/test/tyreRunningLifeBands.test.js. CHANGE BOTH TOGETHER - the
-- test file exists precisely because this rule is written twice.
--
-- HOW IT WAS APPLIED
-- By rewriting the LIVE definition through regexp/replace rather than retyping
-- an 8.7k-character body. Hand-copying a long function is how a subtle change
-- ships alongside an accidental one; the guards below abort unless the expected
-- text is found exactly once.
--
-- ROLLBACK: re-run this block with v_old and v_new swapped.
-- =============================================================================
do $$
declare
  v_def  text;
  v_old  text;
  v_new  text;
  v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_tyre_running_life'
    and pg_get_function_identity_arguments(p.oid) = 'p_country text, p_limit integer, p_offset integer, p_asset text, p_due_only boolean';

  if v_def is null then
    raise exception 'V541: get_tyre_running_life(text,integer,integer,text,boolean) not found';
  end if;

  v_old := '         case
           when j.rem_km is not null then
             (j.rem_km = 0 or j.rem_km < 10000 or (j.used_km_pct is not null and j.used_km_pct >= 90))
           when j.rem_hours is not null then
             (j.rem_hours = 0 or j.rem_hours < 500 or (j.used_hours_pct is not null and j.used_hours_pct >= 90))
           else false
         end as is_due';

  v_new := '         -- WHICHEVER BUDGET RUNS OUT FIRST. Each side is judged against its
         -- own limits and the tyre is due when either is spent; reading one
         -- side first hid every tyre spent on the other. Thresholds mirror
         -- DUE_SOON_KM / DUE_SOON_HOURS / LIFE_USED_DUE_PCT in
         -- src/lib/tyreRunningLife.js - change both together.
         case
           when j.rem_km is null and j.rem_hours is null then false
           else coalesce(j.rem_km = 0 or j.rem_km < 10000
                         or (j.used_km_pct is not null and j.used_km_pct >= 90), false)
             or coalesce(j.rem_hours = 0 or j.rem_hours < 500
                         or (j.used_hours_pct is not null and j.used_hours_pct >= 90), false)
         end as is_due';

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  if v_hits is distinct from 1 then
    raise exception 'V541: expected exactly 1 is_due block, found %', coalesce(v_hits, 0);
  end if;

  execute replace(v_def, v_old, v_new);
end $$;
