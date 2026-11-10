-- 20261111101000_tyre_due_rule_matches_app
-- Found by the enterprise pack (docs/enterprise-pack/11). The server's is_due in
-- get_tyre_running_life used a FIXED "due soon" limit (10,000 km / 500 h) while the app's
-- measureFor() (src/lib/tyreRunningLife.js) uses the SMALLER of that and 10% of the tyre's
-- expected life. For a short-life tyre (loader cap 15,000 km) the server flagged it due at
-- 33% of life while the app called it mid-life, so Inspections and Running & Remaining
-- disagreed. Measured before applying: 101 tyres flagged due by the server only (km side),
-- 0 on the hours side. The app's rule is the correct one; the server now mirrors it.
-- Anchored replace on the LIVE body; aborts unless each anchor occurs exactly once.
-- MIRROR: DUE_SOON_KM / DUE_SOON_HOURS / LIFE_USED_DUE_PCT + the 10% rule in
-- src/lib/tyreRunningLife.js. Change both together.
-- Rollback: reverse the two replacements below.
do $$
declare
  sig regprocedure := 'public.get_tyre_running_life(text,integer,integer,text,boolean)'::regprocedure;
  def text := pg_get_functiondef(sig);
  a_km text := 'j.rem_km < 10000';
  a_h  text := 'j.rem_hours < 500';
  n_km int; n_h int;
begin
  n_km := (length(def) - length(replace(def, a_km, ''))) / length(a_km);
  n_h  := (length(def) - length(replace(def, a_h,  ''))) / length(a_h);
  if n_km <> 1 or n_h <> 1 then
    raise exception 'anchor count km=% hours=% (expected 1 each)', n_km, n_h;
  end if;
  def := replace(def, a_km,
    'j.rem_km < least(10000, case when j.expected_km > 0 then j.expected_km * 0.1 else 10000 end)');
  def := replace(def, a_h,
    'j.rem_hours < least(500, case when j.target_hours > 0 then j.target_hours * 0.1 else 500 end)');
  execute def;
end $$;
