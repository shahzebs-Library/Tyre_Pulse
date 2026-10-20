-- Speeds the two latest-reading lookups in get_tyre_running_life.
-- Live EXPLAIN evidence (2026-10-20): for KSA, each lookup ran 2,852 times.
-- The existing asset-only index read rows then filtered by country/date and
-- sorted each result set. This composite index matches the equality filters
-- and requested descending reading_date order. It does not change row logic.
create index if not exists engine_hours_country_asset_reading_idx
  on public.engine_hours_logs (country, asset_no, reading_date desc)
  include (engine_hours);

-- Rollback, if needed after comparing production query plans:
-- drop index if exists public.engine_hours_country_asset_reading_idx;
