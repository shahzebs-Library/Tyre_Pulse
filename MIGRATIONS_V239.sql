-- V239: module_permissions had 518 duplicate/conflicting global rows per (role, module_key),
-- making get_user_module_permissions (last-row-wins) nondeterministic - the root cause of
-- "access changes go back". Keep ONE row per (role, module_key, org_id): most recently updated.
-- Then a unique index prevents recurrence. Applied live 2026-07-14.
WITH ranked AS (
  SELECT ctid, row_number() OVER (
    PARTITION BY role, module_key, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY updated_at DESC NULLS LAST, ctid DESC) AS rn
  FROM public.module_permissions)
DELETE FROM public.module_permissions WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1);
CREATE UNIQUE INDEX IF NOT EXISTS module_permissions_role_module_org_uidx
ON public.module_permissions (role, module_key, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid));
