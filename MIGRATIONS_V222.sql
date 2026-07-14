-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATIONS V222 — widen accidents.chk_accident_type to the web-form vocabulary
-- Applied live via Supabase MCP on 2026-07-14 (project jhssdmeruxtrlqnwfksc).
--
-- BUG: the web Accidents form offers Collision / Rollover / Rear-end /
-- Side-swipe / Reversing / Fire / Vandalism / Weather / Other, but the original
-- constraint only allowed lowercase collision / rollover / tyre_failure /
-- mechanical / near_miss / property_damage / other. Any incident saved with a
-- non-empty type therefore failed:
--   new row for relation "accidents" violates check constraint "chk_accident_type"
--
-- FIX (two-sided, mirrors the existing severity/status pattern):
--   1. DB: accept the union of both vocabularies as lowercase snake_case tokens
--      (NULL stays allowed — the field is optional).
--   2. Web: Accidents.jsx now maps label ↔ token via toDbAccidentType /
--      canonAccidentType, exactly like toDbSeverity / toDbStatus.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.accidents DROP CONSTRAINT IF EXISTS chk_accident_type;
ALTER TABLE public.accidents ADD CONSTRAINT chk_accident_type CHECK (
  accident_type = ANY (ARRAY[
    'collision','rollover','rear_end','side_swipe','reversing','fire',
    'vandalism','weather','tyre_failure','mechanical','near_miss',
    'property_damage','other'
  ]::text[])
);
