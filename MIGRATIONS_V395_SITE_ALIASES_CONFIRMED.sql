-- V395 — customer-confirmed site name variants + three missing KSA sites
--
-- Follows V394 (which stamped the country on 55,606 job cards). With country
-- resolved, 5,207 KSA job cards across 15 site names did not join the site
-- registry. The customer went through them by name and confirmed each one.
--
-- WHAT THEY CONFIRMED
--   KSP-T3          -> a SEPARATE terminal from KSP1-T3. Kept distinct. Already
--                      present in `sites`; nothing to do.
--   MALHAM-ST       -> KSA, and already present in `sites`. Nothing to do.
--   EMC WORKSHOP    -> already present in `sites`. Nothing to do.
--   DIRIYAH-G1-ST   -> KSA, "different names to it", i.e. a naming variant of
--                      the registered DIRIYAH-G1. Aliased. This does NOT merge
--                      G1 into G2 or into DIRIYAH-ST - V247 established those
--                      are distinct gates and they stay distinct.
--   RIYADH - METRO  -> "Both same things": METRO and RIY-MET-ST are ONE site.
--                      This REVERSES the V247 decision to hold them apart, on
--                      the customer's explicit instruction.
--   remainder       -> all KSA.
--
-- NOTE ON THE EARLIER "5,207 unmatched" FIGURE: it compared job card sites
-- against `vehicle_fleet`, which only lists sites that have vehicles based
-- there. The correct reference is the `sites` registry. Measured against it,
-- KSP-T3, MALHAM-ST and EMC WORKSHOP were already valid all along.
--
-- RESULT (verified live): 60,065 of 60,099 KSA job cards now sit on a
-- registered site = 99.94%. The 34 that remain are literally named "KSA" - a
-- country used as a site placeholder. That is NOT registered as a site on
-- purpose; it needs the customer to say which site those 34 belong to.

begin;

-- Reversible record of every row touched.
create table if not exists public._site_alias_snapshot_v395 as
select 'work_orders' as tbl, id, site as site_before, now() as snapshot_at from public.work_orders
 where upper(btrim(site)) in ('AMALLA','DAHBAN','DHABAN','SALBOUK','RIYADH - SALBOKH','JIZAN','RIYADH - METRO','METRO','DIRIYAH-G1-ST')
union all
select 'vehicle_fleet', id, site, now() from public.vehicle_fleet
 where upper(btrim(site)) in ('AMALLA','DAHBAN','DHABAN','SALBOUK','RIYADH - SALBOKH','JIZAN','RIYADH - METRO','METRO','DIRIYAH-G1-ST')
union all
select 'accidents', id, site, now() from public.accidents
 where upper(btrim(site)) in ('AMALLA','DAHBAN','DHABAN','SALBOUK','RIYADH - SALBOKH','JIZAN','RIYADH - METRO','METRO','DIRIYAH-G1-ST');

revoke all on public._site_alias_snapshot_v395 from authenticated, anon;

-- normalize_site() applies these to every FUTURE write, so a re-import of the
-- same export self-corrects and this never has to be run again.
insert into public.site_aliases (alias, canonical) values
  ('AMALLA',           'AMAALA'),      -- double-L misspelling
  ('DAHBAN',           'DHAHBAN'),     -- joins the existing DHABAN-ST -> DHAHBAN
  ('DHABAN',           'DHAHBAN'),
  ('SALBOUK',          'RIY-SAL-ST'),  -- Salboukh, Riyadh
  ('RIYADH - SALBOKH', 'RIY-SAL-ST'),
  ('JIZAN',            'JIZAN-ST'),    -- same pattern as NHC-ST -> NHC
  ('RIYADH - METRO',   'RIY-MET-ST'),
  ('METRO',            'RIY-MET-ST'),
  ('DIRIYAH-G1-ST',    'DIRIYAH-G1')
on conflict (alias) do nothing;

-- Backfill the rows already loaded (531 work_orders, 56 vehicle_fleet, 2 accidents).
update public.work_orders   t set site = a.canonical from public.site_aliases a where upper(btrim(t.site)) = a.alias;
update public.vehicle_fleet t set site = a.canonical from public.site_aliases a where upper(btrim(t.site)) = a.alias;
update public.accidents     t set site = a.canonical from public.site_aliases a where upper(btrim(t.site)) = a.alias;

-- Three real KSA sites that carried job cards but were never registered.
-- organisation_id must be set explicitly: its default is app_current_org(),
-- which is NULL outside a user session, and a null-org site would be invisible.
insert into public.sites (name, country, organisation_id, site_type, notes)
select v.name, 'KSA',
       (select organisation_id from public.sites where country='KSA' and organisation_id is not null
        group by organisation_id order by count(*) desc limit 1),
       'other', 'Registered from job card data 2026-07-27; customer confirmed KSA'
from (values ('NEOM_CP_14'), ('RIY-TWG-ST'), ('YANBU')) as v(name)
where not exists (
  select 1 from public.sites s
  where upper(btrim(s.name)) = upper(btrim(v.name)) and s.country = 'KSA'
);

commit;

-- VERIFY (expect 0 rows sitting on an alias)
--   select count(*) from public.work_orders t
--   join public.site_aliases a on upper(btrim(t.site)) = a.alias;
--
-- UNDO
--   update public.work_orders   t set site = s.site_before from public._site_alias_snapshot_v395 s
--     where s.tbl='work_orders'   and t.id = s.id;
--   update public.vehicle_fleet t set site = s.site_before from public._site_alias_snapshot_v395 s
--     where s.tbl='vehicle_fleet' and t.id = s.id;
--   update public.accidents     t set site = s.site_before from public._site_alias_snapshot_v395 s
--     where s.tbl='accidents'     and t.id = s.id;
--   delete from public.site_aliases where alias in ('AMALLA','DAHBAN','DHABAN','SALBOUK',
--     'RIYADH - SALBOKH','JIZAN','RIYADH - METRO','METRO','DIRIYAH-G1-ST');
--   delete from public.sites where name in ('NEOM_CP_14','RIY-TWG-ST','YANBU');
