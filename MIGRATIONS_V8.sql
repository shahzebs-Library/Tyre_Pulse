-- Migration V8: Extend inspections table for observations and training
-- Run in Supabase SQL Editor

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS attendees text,
  ADD COLUMN IF NOT EXISTS severity  text DEFAULT 'Medium',
  ADD COLUMN IF NOT EXISTS photo_data text,
  ADD COLUMN IF NOT EXISTS linked_action_id uuid REFERENCES corrective_actions(id) ON DELETE SET NULL;

-- Ensure existing rows have a severity default
UPDATE inspections SET severity = 'Medium' WHERE severity IS NULL;
