-- Add the industry-standard rearward cross pattern (rear-wheel drive / 4x4) to tyre_rotations.rotation_type.
-- Widening only: no stored row can become invalid. UI labels: standard = "Front to Rear",
-- cross = "Forward Cross", rearward_cross = "Rearward Cross".
-- Rollback: re-add the constraint without 'rearward_cross' (fails only if such rows exist).
alter table public.tyre_rotations drop constraint if exists tyre_rotations_rotation_type_chk;
alter table public.tyre_rotations add constraint tyre_rotations_rotation_type_chk
  check (rotation_type is null or rotation_type in ('standard','cross','rearward_cross','side_to_side','x_pattern','custom'));
