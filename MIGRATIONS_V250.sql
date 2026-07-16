-- V250 — Incident Report screen: three new capture fields requested in the spec.
-- Free-text / numeric snapshots on the accident record; existing org + country
-- RLS already governs the whole row, so no new policy is needed.
--   amount_transfer   : amount transferred as part of a recovery (Recovery = Yes)
--   workshop_location : a site (internal repair) or free-text external workshop
--   taqdeer_no        : Taqdeer estimation reference (shown when a report exists)
ALTER TABLE public.accidents
  ADD COLUMN IF NOT EXISTS amount_transfer   numeric,
  ADD COLUMN IF NOT EXISTS workshop_location text,
  ADD COLUMN IF NOT EXISTS taqdeer_no        text;

COMMENT ON COLUMN public.accidents.amount_transfer IS 'Amount transferred as part of the recovery (shown when Recovery = Yes).';
COMMENT ON COLUMN public.accidents.workshop_location IS 'Workshop location: a site (internal repair) or a free-text external workshop name.';
COMMENT ON COLUMN public.accidents.taqdeer_no IS 'Taqdeer estimation reference (shown when a Taqdeer report exists).';
