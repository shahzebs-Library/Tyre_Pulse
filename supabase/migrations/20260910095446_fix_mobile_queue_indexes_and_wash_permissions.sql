-- Complete the installed React Native queue compatibility fix. Meter indexes
-- are in 20260910095436_fix_meter_log_upsert_indexes.sql.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE UNIQUE INDEX checklist_submissions_client_uuid_upsert_idx
  ON public.checklist_submissions (client_uuid);
CREATE UNIQUE INDEX accidents_client_uuid_upsert_idx
  ON public.accidents (client_uuid);
CREATE UNIQUE INDEX tech_activity_events_client_uuid_upsert_idx
  ON public.tech_activity_events (client_uuid);

-- Fleet Supervisor uploaded wash evidence but could not insert its record.
-- Preserve the existing submitters and all restrictive org/country/site rules.
-- get_my_role() already excludes locked and unapproved profiles.
ALTER POLICY wash_records_insert ON public.wash_records
  WITH CHECK (public.get_my_role() = ANY (ARRAY[
    'Admin', 'Manager', 'Director', 'driver', 'Fleet Supervisor'
  ]::text[]));
