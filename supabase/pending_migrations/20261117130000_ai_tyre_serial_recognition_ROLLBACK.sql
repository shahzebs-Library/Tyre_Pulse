-- ROLLBACK for 20261117130000_ai_tyre_serial_recognition.sql (DRAFT, NOT APPLIED).
-- Removes ONLY the objects that file created. No tyre_records / jobs / inspections row is touched.
-- WARNING: dropping the two tables discards the stored serial readings and reviewer decisions.
-- Export them first if the pilot produced evidence worth keeping:
--   select * from public.ai_tyre_serial_readings;  select * from public.ai_tyre_serial_review_events;
-- Turn the worker flag off first (system_config ai_tyre_serial_enabled <> 'true') so the deployed
-- worker stops calling ai_tyre_serial_record; with the function gone it records a
-- "serial_compare_unavailable" flag and the damage analysis still completes.
begin;
drop function if exists public.ai_tyre_serial_review(uuid, text, text, text);
drop function if exists public.ai_tyre_serial_record(uuid, jsonb);
drop function if exists public.ai_tyre_serial_outcome(text, text, text, text, text[]);
drop function if exists public.ai_tyre_serial_norm(text);
drop table if exists public.ai_tyre_serial_review_events;
drop table if exists public.ai_tyre_serial_readings;
drop function if exists public.ai_tyre_serial_append_only();
commit;
