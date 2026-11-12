-- COM-4a (audit MODA-1, step 1 of 2): a scrap can never rewrite another company's mark.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definition of
--         scrap_tyre_by_serial (pg_get_functiondef, project jhssdmeruxtrlqnwfksc, SELECT only).
--         Not applied to any database. Tested on PGlite only
--         (supabase/tests/commercial_tyre_keys.test.mjs).
--         SAFE TO APPLY ON ITS OWN: no client change is needed for this step.
--
-- ROOT CAUSE
--   public.tyre_status_marks is unique on (serial, mark_type) with no organisation, and
--   scrap_tyre_by_serial (SECURITY DEFINER, so row security does not run inside it) ends
--     on conflict (serial, mark_type) do update set reason = ..., created_by = ..., created_at = ...
--   with no organisation test. When company B scraps a serial that company A already marked:
--     * A's mark is overwritten with B's reason, B's user and B's time (A's register now shows
--       a scrap A never recorded that way, and A's undo snapshot is no longer A's);
--     * the row still belongs to A, so B has no mark at all;
--     * B's tyre_records rows are set to Scrapped anyway, so B's tyre reads Scrapped with no
--       mark, no reason and no undo.
--   Live today: 846 marks, all scrap, all owned by the current company, so nothing has collided.
--
-- WHAT THIS CHANGES (one function, two edits, made on the live text)
--   1. The conflict update only applies when the existing mark belongs to the caller's
--      organisation ("where tyre_status_marks.organisation_id = excluded.organisation_id").
--   2. If no mark was written (the serial is held by another organisation's mark) the function
--      stops BEFORE touching tyre_records and returns
--        {"ok": false, "reason": "serial_mark_conflict", "serial": ...}
--      so a tyre is never left Scrapped without a mark.
--   This closes the cross-company overwrite immediately. It does NOT yet let two companies hold
--   a mark for the same serial: that needs the per-organisation key in step 2
--   (20261113154500), which must ship together with a client change.
--
-- RISK TO THE CURRENT COMPANY: NONE. Every existing mark belongs to it, so the added test is
--   always true for its users and the function returns the same result and writes the same
--   rows as today (proved in the PGlite test: scrap, re-scrap and the audit call are identical).
--
-- VERIFY (after applying; read only)
--   select position('tyre_status_marks.organisation_id = excluded.organisation_id' in
--          pg_get_functiondef('public.scrap_tyre_by_serial(text,text,text)'::regprocedure)) > 0;  -- t
--   select position('serial_mark_conflict' in
--          pg_get_functiondef('public.scrap_tyre_by_serial(text,text,text)'::regprocedure)) > 0;  -- t
--   select has_function_privilege('anon','public.scrap_tyre_by_serial(text,text,text)','EXECUTE'); -- f (unchanged)
--
-- ROLLBACK
--   Re-create scrap_tyre_by_serial from supabase/tests/fixtures/commercial_live_functions.sql.

do $migration$
declare
  c_md5 constant text := '31586bca910c92846086d193ca28aeeb';
  c_old constant text := $a$          then excluded.prior_status
          else tyre_status_marks.prior_status end;
$a$;
  c_new constant text := $b$          then excluded.prior_status
          else tyre_status_marks.prior_status end
    where tyre_status_marks.organisation_id = excluded.organisation_id;

  -- COM-4a: the serial is held by another organisation's mark. Stop before any tyre row changes.
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'serial_mark_conflict', 'serial', v_s);
  end if;
$b$;
  v_def text;
  v_md5 text;
  v_n   int;
begin
  select md5(p.prosrc), pg_get_functiondef(p.oid) into v_md5, v_def
    from pg_proc p where p.oid = 'public.scrap_tyre_by_serial(text,text,text)'::regprocedure;
  if v_md5 is distinct from c_md5 then
    raise exception 'COM-4a: scrap_tyre_by_serial has changed since this draft was written (md5 %). Re-author against the live body.', v_md5;
  end if;
  v_n := (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old);
  if v_n <> 1 then
    raise exception 'COM-4a: expected exactly one conflict clause tail in scrap_tyre_by_serial, found %', v_n;
  end if;
  execute replace(v_def, c_old, c_new);
end
$migration$;
