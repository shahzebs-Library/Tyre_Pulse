-- V81: offline-write idempotency for the mobile queues.
-- The record queue (tyre_records/work_orders/rca_records/corrective_actions) and
-- the inspection queue could double-insert a record if the app crashed mid-sync,
-- a response was lost after the insert committed, or two syncs overlapped. Add a
-- client-generated `client_uuid` (text) with a UNIQUE index so a replayed insert
-- (upsert … onConflict client_uuid, ignoreDuplicates) is a no-op. A unique index
-- treats NULLs as distinct, so rows created any other way (client_uuid NULL) are
-- unaffected — only client-supplied ids are deduped.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tyre_records','work_orders','rca_records','corrective_actions','inspections'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS client_uuid text', t);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (client_uuid)', 'ux_'||t||'_client_uuid', t);
  END LOOP;
END $$;
