-- MIGRATIONS_V36.sql
-- Add columns that live features referenced but the schema lacked — each caused
-- a PostgREST 400 and a silently broken action/screen. Applied on Supabase as
-- `add_missing_feature_columns`.

-- Tyre lifecycle status (Active/Scrapped): Scrap action, scanner, tyre filters.
alter table public.tyre_records add column if not exists status text default 'Active';
create index if not exists idx_tyre_records_status on public.tyre_records(status);

-- Budget approval workflow status.
alter table public.budgets add column if not exists status text default 'Draft';

-- Link an upload_history row to its ingest batch (enables batch rollback).
alter table public.upload_history add column if not exists batch_id uuid;

-- Fleet asset odometer + registration (predictive maintenance, QR-by-plate scan).
alter table public.vehicle_fleet add column if not exists current_km numeric;
alter table public.vehicle_fleet add column if not exists registration_no text;
alter table public.vehicle_fleet add column if not exists registration_date date;

-- Code-side companion fixes (no DB change) corrected wrong column references via
-- PostgREST aliases / renames:
--   accidents.date            -> incident_date           (SafetyCompliance)
--   tyre_records.cost         -> cost:cost_per_tyre       (SerialTracker, Comparison, TyreScanCamera)
--   tyre_records.pressure     -> pressure:pressure_reading(TyreScanCamera)
--   work_orders.scheduled_date-> scheduled_date:target_completion (DailyOps, WorkshopManagement)
--   work_orders.assigned_to   -> assigned_to:technician_name       (WorkshopManagement)
--   vehicle_fleet.vehicle_number -> fleet_number          (useSupabaseQuery order)
--   inspections.vehicle_id    -> asset_no                 (useSupabaseQuery filter)
--   ConsoleOrganisations per-org tyre count -> platform total (tyre_records not org-scoped)
