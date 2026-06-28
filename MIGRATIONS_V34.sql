-- MIGRATIONS_V34.sql
-- Security: lock down tyre_records writes to least privilege (RBAC).
--
-- Problem
--   `auth_write_tyre_records` (FOR ALL TO authenticated USING true WITH CHECK true)
--   was a permissive policy that OR-overrode the role-based INSERT/UPDATE/DELETE
--   policies, so ANY authenticated user could insert/update/delete tyre records
--   regardless of role (this is also why uploads "worked" for every role).
--
-- Fix
--   Drop the blanket policy and enforce per-role least privilege. get_my_role()
--   is SECURITY DEFINER and returns NULL for locked/unapproved users, so those
--   accounts are denied writes automatically.
--
--   INSERT : Admin, Manager, Reporter, Tyre Man   (operational data entry,
--            incl. Tyre Man recording tyre changes which persist to tyre_records)
--   UPDATE : Admin, Manager                        (corrections only)
--   DELETE : Admin                                 (destructive — admin only)
--   SELECT : unchanged (auth_read_tyre_records, USING true for authenticated)
--
--   Director / Inspector have no tyre_records write access by design.
--   Applied on Supabase as migration `lockdown_tyre_records_writes_rbac`.

DROP POLICY IF EXISTS auth_write_tyre_records ON public.tyre_records;

DROP POLICY IF EXISTS tyre_records_insert ON public.tyre_records;
CREATE POLICY tyre_records_insert ON public.tyre_records
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() = ANY (ARRAY['Admin','Manager','Reporter','Tyre Man']));

DROP POLICY IF EXISTS tyre_records_update ON public.tyre_records;
CREATE POLICY tyre_records_update ON public.tyre_records
  FOR UPDATE TO authenticated
  USING (get_my_role() = ANY (ARRAY['Admin','Manager']))
  WITH CHECK (get_my_role() = ANY (ARRAY['Admin','Manager']));

DROP POLICY IF EXISTS tyre_records_delete ON public.tyre_records;
CREATE POLICY tyre_records_delete ON public.tyre_records
  FOR DELETE TO authenticated
  USING (get_my_role() = 'Admin');
