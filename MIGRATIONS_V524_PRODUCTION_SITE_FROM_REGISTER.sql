-- V524 / V524b - production site names now come from the site register, and the
-- region comes with them
-- STATUS: APPLIED LIVE 2026-08-11
--
-- Owner: "it should use those sites which we put in site management and make the
-- region by there, why do you need another column in it".
--
-- THERE IS NO SECOND REGION COLUMN, and there never was. production_logs holds
-- no region and production_station_map holds no region; the region is read from
-- sites.region by get_cost_per_m3 (it joins on upper(btrim(name))). The only
-- extra column is production_logs.station, which keeps the plant NUMBER the
-- file sent so the site column can hold the real name - without it, once site
-- is overwritten with a mapped name we no longer know which plant produced the
-- load and a later correction to the map cannot be re-applied.
--
-- What WAS wrong is that the site names could not match the register at all.
-- The register is upper case (DIRIYAH-G1, DHAHBAN); production carried
-- 'Diriyah-G1', 'Dhaban', 'Metro'. trg_normalize_site (upper + collapse
-- whitespace + apply site_aliases) is attached to 24 other tables and had
-- simply never been attached to production_logs. So the join found nothing and
-- the region came back empty.
--
-- V524 attached the trigger and backfilled. IT CHANGED NOTHING, and the reason
-- is worth keeping: TRIGGERS FIRE IN NAME ORDER, and 'trg_normalize_site' sorts
-- BEFORE 'trg_resolve_production_station', whose last statement is
--   NEW.site := coalesce(v_site, NEW.station)
-- so the resolver overwrote the normalised name with the raw station text on
-- every row. The backfill touched all 4,173 rows and left them exactly as they
-- were - a silent no-op that reads like a successful migration.
--
-- V524b renames it to trg_zz_normalize_site so the normaliser runs LAST: the
-- station resolves to a site name first, then that name is upper-cased and
-- passed through site_aliases. Same lesson as the aa_ prefix on the expense
-- country guard, mirrored.
--
-- RESULT, 4,173 rows, all nine renames landing on a registered site:
--   Diriyah-G1 -> DIRIYAH-G1, Diriyah-G2 -> DIRIYAH-G2,
--   Qiddiya-Lower/Upper Plateau -> QIDDIYA-LOWER/UPPER PLATEAU,
--   Dhaban -> DHAHBAN (via site_aliases), Metro -> RIY-MET (the owner's own
--   confirmed merge), Amaala -> AMAALA, Red Sea -> RED SEA,
--   Laheq Island -> LAHEQ.
-- Every named production site now matches the register. KSA approved m3 is
-- unchanged at 2,193,569.9 - this moved no quantity, only spelling.
--
-- STILL SHOWING NO REGION, and correctly so: RIY-MET and LAHEQ carry no region
-- in Site Management. That is a Site Management job, which is why the station
-- screen prints "Set in Site Management" rather than offering a second place to
-- record the same fact.
--
-- CLIENT: StationMapPanel now picks the site from a strict dropdown of the
-- register (a free-text box could invent a 39th site nothing else knows about)
-- and shows the site's region read back from Site Management.
--
-- Rollback: _bak.production_site_v524 holds (id, old_site) for all 4,173 rows;
--   update production_logs p set site = b.old_site
--     from _bak.production_site_v524 b where b.id = p.id;
-- with trg_zz_normalize_site disabled, or it will normalise them straight back.

-- V524
create trigger trg_normalize_site
  before insert or update on public.production_logs
  for each row execute function public.normalize_site();

-- V524b
alter trigger trg_normalize_site on public.production_logs
  rename to trg_zz_normalize_site;

update public.production_logs p
   set site = p.site
  from _bak.production_site_v524 b
 where b.id = p.id;
