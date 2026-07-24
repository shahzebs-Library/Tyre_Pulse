-- V357 recon_resolve_duplicate_key
--
-- SAFE "Resolve" action for the "Possible duplicate tyres" review section on
-- Data Reconciliation. A "possible duplicate" is a group of tyre_records that
-- share the same (serial_no, asset_no, issue_date) fitment key on more than one
-- record but MAY differ in other columns.
--
-- This RPC resolves ONE such group and ONLY when every row is byte-identical
-- (ignoring the volatile audit columns id / created_at / updated_at). In that
-- case it keeps the newest row and deletes the exact copies. If any row in the
-- group differs it deletes NOTHING and reports 'differs' so the group is left
-- for manual review. Mirrors the byte-identical guard used by
-- recon_merge_duplicate.
--
-- AUTH: SECURITY DEFINER, self-gated on public.app_is_elevated() (super-admin /
-- Admin / Manager / Director) and org-scoped to public.app_current_org().
-- EXECUTE granted to authenticated; revoked from anon / PUBLIC.

CREATE OR REPLACE FUNCTION public.recon_resolve_duplicate_key(
  p_serial text,
  p_asset text,
  p_issue_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org      uuid := public.app_current_org();
  v_total    integer := 0;
  v_distinct integer := 0;
  v_keep_id  uuid;
  v_deleted  integer := 0;
BEGIN
  IF NOT public.app_is_elevated() THEN
    RAISE EXCEPTION 'Not permitted.' USING errcode = '42501';
  END IF;

  -- Count the group members and how many DISTINCT byte-identical bodies they
  -- reduce to once the volatile audit columns are stripped. issue_date may be
  -- null, so match with IS NOT DISTINCT FROM on every key column.
  SELECT count(*),
         count(DISTINCT (to_jsonb(t.*) - 'id' - 'created_at' - 'updated_at'))
    INTO v_total, v_distinct
    FROM public.tyre_records t
   WHERE t.organisation_id = v_org
     AND t.serial_no    IS NOT DISTINCT FROM p_serial
     AND t.asset_no     IS NOT DISTINCT FROM p_asset
     AND t.issue_date   IS NOT DISTINCT FROM p_issue_date;

  IF v_total < 2 THEN
    RETURN jsonb_build_object('resolved', false, 'reason', 'not_found');
  END IF;

  -- Any difference among the stripped bodies => leave the whole group for a
  -- human. Never delete.
  IF v_distinct > 1 THEN
    RETURN jsonb_build_object('resolved', false, 'reason', 'differs');
  END IF;

  -- All byte-identical: keep the newest (max created_at, then max id) and
  -- delete the exact copies.
  SELECT t.id
    INTO v_keep_id
    FROM public.tyre_records t
   WHERE t.organisation_id = v_org
     AND t.serial_no    IS NOT DISTINCT FROM p_serial
     AND t.asset_no     IS NOT DISTINCT FROM p_asset
     AND t.issue_date   IS NOT DISTINCT FROM p_issue_date
   ORDER BY t.created_at DESC NULLS LAST, t.id DESC
   LIMIT 1;

  DELETE FROM public.tyre_records t
   WHERE t.organisation_id = v_org
     AND t.serial_no    IS NOT DISTINCT FROM p_serial
     AND t.asset_no     IS NOT DISTINCT FROM p_asset
     AND t.issue_date   IS NOT DISTINCT FROM p_issue_date
     AND t.id <> v_keep_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('resolved', true, 'deleted', v_deleted);
END $function$;

REVOKE ALL ON FUNCTION public.recon_resolve_duplicate_key(text, text, date) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.recon_resolve_duplicate_key(text, text, date) TO authenticated;

-- Reversible:
-- DROP FUNCTION IF EXISTS public.recon_resolve_duplicate_key(text, text, date);
