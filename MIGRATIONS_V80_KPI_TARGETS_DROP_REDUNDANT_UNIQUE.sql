-- V80: fix KPI-target save breaking at year rollover.
-- kpi_targets carried BOTH UNIQUE(metric) and UNIQUE(metric,year,month,site).
-- The Settings save upserts on (metric,year,month,site); once a new year's row
-- (metric, 2027, null, null) doesn't match the stored (metric, 2026, null, null),
-- the upsert attempts an INSERT that violates UNIQUE(metric) → 23505 "Save failed",
-- and per-year / per-site targets are impossible. Drop the redundant single-column
-- constraint; the composite key is the real identity. Loosening only — safe.
ALTER TABLE public.kpi_targets DROP CONSTRAINT IF EXISTS kpi_targets_metric_unique;
