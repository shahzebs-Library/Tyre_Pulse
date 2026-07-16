-- V248 — Add ply_rating to tyre_specifications.
--
-- The spec library already carries min_load_index / min_speed_index (load & speed
-- indices). Ply rating (a.k.a. Star rating for radial truck/OTR tyres) is the third
-- casing-strength descriptor engineers approve on. Stored as text to allow the real
-- vocabulary: "16PR", "18PR", "20PR", "*", "**", "***" (radial star) etc. Nullable,
-- additive — existing org / country RLS on tyre_specifications governs it unchanged.
ALTER TABLE public.tyre_specifications
  ADD COLUMN IF NOT EXISTS ply_rating text;

COMMENT ON COLUMN public.tyre_specifications.ply_rating IS
  'Minimum approved ply rating / star rating (e.g. 16PR, 18PR, 20PR, *, **, ***). Casing-strength descriptor alongside min_load_index/min_speed_index.';
