-- V266: optional signature (self-contained SVG string) on the daily meter logs so
-- a driver/operator can sign the odometer / engine-hour reading. Nullable text,
-- governed by the tables' existing org/country RLS. Additive, no behavior change.
-- Applied live via Supabase MCP (project jhssdmeruxtrlqnwfksc). Next free V267.
ALTER TABLE public.odometer_logs     ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE public.engine_hours_logs ADD COLUMN IF NOT EXISTS signature text;
