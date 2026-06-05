-- ============================================================
-- TYREPULSE - MIGRATIONS V9
-- Run in Supabase SQL Editor
-- Adds photo_data column to corrective_actions and rca_records
-- ============================================================

ALTER TABLE public.corrective_actions
  ADD COLUMN IF NOT EXISTS photo_data text;

ALTER TABLE public.rca_records
  ADD COLUMN IF NOT EXISTS photo_data text;
