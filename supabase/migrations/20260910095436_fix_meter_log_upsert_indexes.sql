-- Installed React Native clients use ON CONFLICT (client_uuid) DO NOTHING.
-- The existing partial indexes cannot be inferred without a WHERE predicate,
-- causing 42P10 for both immediate saves and queued retries.
-- Full unique indexes retain the same non-null uniqueness and allow multiple
-- NULL keys for web/import clients. Existing indexes, rows and RLS stay intact.
-- Bound lock acquisition so deployment fails rather than holding up traffic.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE UNIQUE INDEX odometer_logs_client_uuid_upsert_idx
  ON public.odometer_logs (client_uuid);
CREATE UNIQUE INDEX engine_hours_logs_client_uuid_upsert_idx
  ON public.engine_hours_logs (client_uuid);
