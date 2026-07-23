-- =============================================================================
-- MIGRATIONS_V338_SITE_MASTER.sql  (as applied)
-- A public.sites master table already existed (id, name, country, region, city,
-- active, notes, site_code, site_type, organisation_id ...) with a name-based
-- unique index ux_sites_org_country_name and NOT NULL country - it backs the
-- existing Site Management page (/sites). Rather than create a duplicate table,
-- this migration BACKFILLS that master from the DISTINCT real site values found
-- across the operational tables so the list is complete for all countries.
--   Insert only sites not already present (by org + country + lower(name)),
--   country NOT NULL required. site_code == name == the upper-trimmed site.
-- Purely additive: only ever inserts rows that do not already exist.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_sites_country ON public.sites (country);
CREATE INDEX IF NOT EXISTS idx_sites_code    ON public.sites (site_code);

WITH distinct_sites AS (
  SELECT organisation_id, country, upper(regexp_replace(btrim(site), '\s+', ' ', 'g')) AS site
  FROM public.vehicle_fleet WHERE site IS NOT NULL AND btrim(site) <> '' AND country IS NOT NULL AND btrim(country) <> ''
  UNION SELECT organisation_id, country, upper(regexp_replace(btrim(site), '\s+', ' ', 'g'))
  FROM public.tyre_records WHERE site IS NOT NULL AND btrim(site) <> '' AND country IS NOT NULL AND btrim(country) <> ''
  UNION SELECT organisation_id, country, upper(regexp_replace(btrim(site), '\s+', ' ', 'g'))
  FROM public.work_orders WHERE site IS NOT NULL AND btrim(site) <> '' AND country IS NOT NULL AND btrim(country) <> ''
  UNION SELECT organisation_id, country, upper(regexp_replace(btrim(site), '\s+', ' ', 'g'))
  FROM public.accidents WHERE site IS NOT NULL AND btrim(site) <> '' AND country IS NOT NULL AND btrim(country) <> ''
  UNION SELECT organisation_id, country, upper(regexp_replace(btrim(site), '\s+', ' ', 'g'))
  FROM public.inspections WHERE site IS NOT NULL AND btrim(site) <> '' AND country IS NOT NULL AND btrim(country) <> ''
)
INSERT INTO public.sites (organisation_id, country, site_code, name, active)
SELECT d.organisation_id, d.country, d.site, d.site, true
FROM distinct_sites d
WHERE d.organisation_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.sites s
    WHERE coalesce(s.organisation_id, '00000000-0000-0000-0000-000000000001'::uuid)
        = coalesce(d.organisation_id, '00000000-0000-0000-0000-000000000001'::uuid)
      AND lower(btrim(s.country)) IS NOT DISTINCT FROM lower(btrim(d.country))
      AND lower(btrim(s.name)) = lower(btrim(d.site))
  );
