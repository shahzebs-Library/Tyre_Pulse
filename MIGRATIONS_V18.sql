-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V18.sql — Tyre lifecycle columns (Monthly Consumption Report)
-- Aligns tyre_records with the ERP "MONTHLY TYRES CONSUMPTION REPORT" and the
-- Master Asset List so fitment → removal lifecycle data imports without loss.
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Vehicle classification carried by every ERP tyre/complaint export
ALTER TABLE public.tyre_records ADD COLUMN IF NOT EXISTS vehicle_type    text;

-- Fitment-side metrics (km_at_fitment already exists from base schema)
ALTER TABLE public.tyre_records ADD COLUMN IF NOT EXISTS hrs_at_fitment  numeric;

-- Removal-side metrics (km_at_removal already exists from base schema)
ALTER TABLE public.tyre_records ADD COLUMN IF NOT EXISTS removal_date    date;
ALTER TABLE public.tyre_records ADD COLUMN IF NOT EXISTS hrs_at_removal  numeric;
ALTER TABLE public.tyre_records ADD COLUMN IF NOT EXISTS removal_reason  text;

-- Lifetime totals reported by the consumption report (TOTAL KM / TOTAL HRS)
ALTER TABLE public.tyre_records ADD COLUMN IF NOT EXISTS total_km        numeric;
ALTER TABLE public.tyre_records ADD COLUMN IF NOT EXISTS total_hrs       numeric;

-- Indexes for lifecycle / position analytics
CREATE INDEX IF NOT EXISTS idx_tyre_records_position      ON public.tyre_records(position);
CREATE INDEX IF NOT EXISTS idx_tyre_records_vehicle_type  ON public.tyre_records(vehicle_type);
CREATE INDEX IF NOT EXISTS idx_tyre_records_removal_date  ON public.tyre_records(removal_date DESC);
CREATE INDEX IF NOT EXISTS idx_tyre_records_removal_reason ON public.tyre_records(removal_reason);

-- Backfill total_km where both endpoints are known and total is blank
UPDATE public.tyre_records
   SET total_km = km_at_removal - km_at_fitment
 WHERE total_km IS NULL
   AND km_at_removal IS NOT NULL
   AND km_at_fitment IS NOT NULL
   AND km_at_removal >= km_at_fitment;
