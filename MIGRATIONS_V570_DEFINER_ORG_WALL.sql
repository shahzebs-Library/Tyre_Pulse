-- V570  THE TENANT WALL, PART 2: DEFINER FUNCTIONS THAT READ AND WRITE WITH NO
--       organisation_id PREDICATE AT ALL
--
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc as v570_definer_org_wall.
--
-- V551 closed six such functions. V549 flagged this class and deliberately did not
-- alter it; V556 flagged that several of the functions it guarded read with no org
-- predicate and left them. This closes what remains.
--
-- Same root cause as the whole V542-V569 run: a SECURITY DEFINER function executes
-- as its OWNER, no public table sets FORCE ROW LEVEL SECURITY, so RLS NEVER RUNS
-- INSIDE ONE. Such a function sits outside the policy system by construction and
-- must re-ask every question itself. These did not.
--
-- ORG IS THE MORE SERIOUS BOUNDARY THAN COUNTRY, because country separates one
-- company's regions while ORG SEPARATES ONE COMPANY FROM ANOTHER.
--
--
-- ============================================================================
-- THE POPULATION ENUMERATED, so the boundary of this claim is explicit
-- ============================================================================
--
--   402 SECURITY DEFINER functions in `public`; 351 executable by `authenticated`.
--   293 relations in `public` carry organisation_id or org_id (289 tables, 4 views).
--
--   Of the definer + authenticated-executable functions written in sql/plpgsql
--   that reference an org-bearing relation and contain NEITHER `organisation_id`
--   NOR `app_current_org` anywhere in the body: 66.
--
--   Static analysis alone does not settle this - the V551 lesson, re-confirmed.
--   `is_super_admin` appearing in a body proves nothing on its own: in
--   `get_sentry_config_status` it is a real gate, and in V551's `get_console_stats`
--   it was a column filter that a gate-detecting regex read as a gate. Equally,
--   the accident RPC family LOOKS unscoped and is not. So every candidate was
--   settled by IMPERSONATION, and 61 of the 66 were dismissed on evidence
--   (itemised under DISMISSALS below).
--
--   FIVE genuine holes remained. All five reproduced before anything was touched.
--
--
-- ============================================================================
-- THE PROBE
-- ============================================================================
--
--   a4fd5401-7345-4c08-9701-d39349e612af - Mahmoud Taher, Director, country
--   {Egypt}, sites {ALL}, approved, not locked, NOT a super admin, org
--   e340fa7a. He is the ONE account outside Company A, which makes him the
--   natural cross-tenant probe: his org holds 0 rows of every table involved,
--   so anything he can see or write belongs to someone else.
--
--   4 organisations exist; only Company A holds data. 38 approved users, of whom
--   37 and BOTH super admins are in Company A. All 38 accidents are Company A's;
--   the Egypt org holds 0.
--
--   ON EVERY PROBE HIS DIRECT TABLE READS RETURNED 0 - accidents 0, import_rows 0,
--   import_batches 0, user_access_grants 0. RLS ITSELF WAS NEVER AT FAULT. The
--   wall held everywhere except inside the functions that stepped around it.
--
--   THE MEASUREMENT TRAP, avoided as the standing rule requires: a count taken
--   from inside an impersonated session counts what is READABLE, not what was
--   WRITTEN, and a blocked write and an invisible write both return 0. Every
--   write below was confirmed by `reset role` and recounting as a privileged
--   reader IN THE SAME TRANSACTION, and every transaction was rolled back.
--
--
-- ============================================================================
-- THE FIVE HOLES, each reproduced before it was touched
-- ============================================================================
--
-- 1. `request_accident_closure(uuid, text)` - NO GATE OF ANY KIND.
--    Not org, not country, not site, not even role. Any authenticated user.
--    Reproduced as the Egypt Director against Company A accident 2dfde192:
--      * direct read of `accidents` for that user ............ 0 rows
--      * closure_status ...................... open -> pending_closure
--      * close_requested_by ........... stamped as the Egypt Director
--      * close_request_note . attacker-supplied free text landed verbatim
--      * accident_remarks .......... 1 row inserted carrying that text
--
--    AND ITS NOTIFICATION FAN-OUT HAD NO ORG PREDICATE WHATSOEVER:
--      INSERT INTO notifications ... FROM profiles p
--       WHERE lower(...p.role...) IN ('admin','manager','director')
--         AND p.id <> auth.uid();
--    Every elevated user in EVERY organisation. Measured: 4 elevated recipients
--    in Company A, 1 in Egypt.
--
--    THIS IS THE ONE THAT LEAKED IN THE OTHER DIRECTION AND WAS LIVE TODAY.
--    A real Company A Manager requesting a routine closure delivered into the
--    Egypt Director's notification bell:
--
--      title: "Accident closure requested"
--      body : "Asset TM673 closure submitted by adnan mohammad alhaj ali
--              - review & approve."
--
--    Company A's asset number and a Company A employee's real name, injected
--    into another tenant's inbox, inviting them to act on it. Unlike every other
--    finding here, this one did not need the misconfigured account to initiate -
--    it fired on ordinary use by a correctly configured user.
--
-- 2. `reject_accident_closure(uuid, text)` - gated ONLY on `is_elevated_user()`.
--    Reproduced as the Egypt Director on the same Company A case:
--      * closure_rejected_reason .. "V570 PROBE injected rejection reason"
--        written onto ANOTHER TENANT'S ROW
--      * accident_remarks ..... 1 `closure_rejected` row inserted with it
--
--    `is_elevated_user()` is `app_role() in ('admin','manager','director')`, so a
--    plain Manager passes. It is not a tenant check and never was.
--
-- 3. `approve_accident_closure(uuid)` - gated ONLY on `is_elevated_user()`.
--    The cross-tenant UPDATE is attempted and reaches the table, but is currently
--    rejected by an UNRELATED CHECK constraint on a DIFFERENT column: the function
--    writes `status = 'Closed'` while `chk_status` admits only the lowercase token
--    vocabulary (V222). So it raises 23514 FOR EVERY CALLER, in every tenant.
--
--    STATED HONESTLY: this is GUARDED WITHOUT AN OBSERVED SUCCESSFUL WRITE. It is
--    not evidence of a leak and must not be cited as one. It is guarded because
--    the tenant hole is real and is held shut today only by a defect in a column
--    it does not care about - repair `chk_status` or the status vocabulary and it
--    arms immediately. (The pre-existing approve defect is NOT fixed here; it is
--    a product decision about the status vocabulary, not a security fix.)
--
-- 4. `import_reprocess_row(uuid)` - gated ONLY on `is_approved_and_unlocked()`,
--    i.e. ANY approved user, then UPDATE ... WHERE id = p_row_id with no org
--    predicate. Reproduced as the Egypt Director, confirmed by privileged recount:
--      * direct read of `import_rows` for that user .......... 0 rows
--      * validation_status ....................... warning -> pending
--      * processed_at ................................. cleared to NULL
--    Another tenant's staged import row reset for reprocessing by someone who
--    cannot see it to undo it. Same INJECTION shape as V542.
--
-- 5. `user_has_capability(uuid,text)` and `(uuid,text,text)` - NO GATE AT ALL,
--    and they take an ARBITRARY user id. Any authenticated caller can interrogate
--    any other tenant's per-user permission grants, one boolean per call.
--    Reproduced as the Egypt Director:
--      * direct read of `user_access_grants` ................. 0 rows
--      * user_has_capability('5640bf61...','accidents:incidents','create')
--        returned TRUE for Company A user MAi Yousef
--
--    POSITIVE CONTROL RUN FIRST, per the standing rule that a probe must be shown
--    capable of returning data before a false is read as proof of anything: the
--    first probe returned `f`, so a real live grant was located and re-probed, and
--    BOTH signatures returned `t`. The oracle works.
--
--
-- ============================================================================
-- THE IDENTITY PROBE - proof by identity, not by argument
-- ============================================================================
--
-- Each unscoped READ was executed as ALL 38 approved users and the distinct
-- payloads counted:
--
--   import_batch_country(<Company A batch>) ..... 1 distinct payload: {UAE}
--   user_has_capability(<Company A user>, ...) .. 1 distinct payload: {true}
--
-- ONE distinct payload across all 38 users, spanning two organisations. They
-- cannot tell any two callers apart, in any org - the same proof that settled
-- `count_records_with_extra_fields` and `get_console_stats` in V551.
--
--
-- ============================================================================
-- WHAT WAS GUARDED vs WHAT WAS WITHDRAWN, and why each
-- ============================================================================
--
-- GUARDED (they have live callers, so the feature must keep working):
--
--   request_accident_closure  - src/components/AccidentDetailModal.jsx,
--                               mobile/components/AccidentClaimsPanel.tsx
--   approve_accident_closure  - AccidentDetailModal.jsx, src/lib/api/approvalsQueue.js,
--                               mobile AccidentClaimsPanel.tsx, mobile admin/approvals.tsx
--   reject_accident_closure   - same four
--   import_reprocess_row      - src/lib/api/imports.js (reprocessRow)
--
--   The three closure functions DELEGATE TO `_accident_rpc_context(p_accident_id)`
--   rather than carrying a hand-written predicate. That helper is the database's
--   own idiom for this exact family - the five sibling accident RPCs
--   (accident_task_complete, accident_evidence_verify, accident_repair_complete,
--   accident_repair_task_complete, accident_document_mark_received) already use it,
--   which is precisely why V551 correctly dismissed them. Reusing it means the
--   closure path and the rest of the accident workflow can never disagree about
--   who may touch a case, and there is no second copy of the rule to drift.
--
--   It was PROVEN in both directions before being adopted, not assumed:
--     Egypt Director  -> REFUSED: "Not permitted for this organisation."
--     Company A Mgr   -> ADMITTED: org 00000000-...-0001, country KSA, site NHC
--
--   It checks org AND country AND site. The country/site term is a deliberate
--   tightening beyond this migration's scope, and it is the SAME boundary the five
--   sibling RPCs already enforce on the same cases - closure is a write on the case
--   like any other. Blast radius measured per elevated user rather than argued:
--
--     adnan mohammad alhaj ali  Manager  {KSA}   38 of 38 actionable  (unchanged)
--     Test User                 Manager  {KSA}   38 of 38 actionable  (unchanged)
--     Anum                      Admin    NULL    38 of 38 actionable  (unchanged)
--     shahzeb Rahman            Admin    NULL    38 of 38 actionable  (unchanged)
--     Mahmoud Taher             Director {Egypt}  0 of 0  actionable  (0 before)
--
--   NOT ONE legitimate user loses a single case.
--
--   request_accident_closure additionally gets `AND p.org_id = v_ctx.org` on the
--   notification fan-out. The org comes from THE ACCIDENT, not from the caller, so
--   the notice reaches the tenant that owns the case. `org_id` is the column
--   `app_current_org()` itself reads (`SELECT org_id FROM profiles WHERE id =
--   auth.uid()`), so the two can never disagree.
--
--   import_reprocess_row is scoped ON THE ROWS, not on an argument - the V550
--   lesson. A row the caller may not touch simply does not match, so the void
--   function needs no refusal shape and no client change. Verified: the Egypt
--   Director's call now matches 0 rows and the target row stays `warning`.
--
-- WITHDRAWN (the V551 `get_console_users` precedent - sometimes the right fix is
-- to take the grant away rather than guard):
--
--   user_has_capability(uuid,text) and (uuid,text,text)
--
--   Checked before deciding, not assumed: NO RLS policy references either
--   signature, NO other database function calls them, and the repo contains only
--   two DOCUMENTATION COMMENTS naming them (src/lib/api/accessGrants.js,
--   src/test/accessGrantOverride.test.js) - `grep "rpc('user_has_capability"`
--   returns nothing. The live capability resolver is `app_user_can`, which does
--   NOT call them. They are dead weight carrying an EXECUTE grant.
--
--   REVOKE SAFETY MEASURED, with a positive control so an all-zero result could
--   not masquerade as "nothing broke". Re-run as MAi Yousef, who holds 53 real
--   grant rows across 20 module keys - before vs after the revoke:
--     user_access_grants read ......... 53 -> 53
--     get_my_capabilities ............. byte-identical payload
--     get_my_access_grants ............ byte-identical payload
--     app_user_can('accidents:incidents','create') ......... t
--     errors .............................................. NONE
--
--
-- ============================================================================
-- DISMISSALS, each with the evidence that settled it
-- ============================================================================
--
-- `import_batch_country(uuid)` - A REAL UNSCOPED READ, DELIBERATELY LEFT ALONE.
--   It genuinely discloses: the Egypt Director reads 0 import_batches directly yet
--   the function returned 'KSA' for a Company A batch, and the identity probe
--   returned ONE payload across all 38 users. It is left because BOTH available
--   fixes were measured and are WORSE THAN THE HOLE:
--
--   (a) WITHDRAWING THE GRANT IS AN OUTAGE. It is consumed INSIDE the RESTRICTIVE
--       RLS policy `import_rows_country_isolation`
--         USING import_user_can_commit_country(import_batch_country(batch_id))
--       and PostgreSQL checks function EXECUTE privilege against the INVOKING user
--       when evaluating a policy expression. Tested, not reasoned about: after the
--       revoke a legitimate Company A Manager went from reading 2,751 import_rows
--       to a hard `permission denied for function import_batch_country`. The whole
--       table becomes unreadable.
--
--   (b) ADDING AN ORG FILTER IS A WIDENING DRESSED AS A GUARD. It would return
--       NULL for an out-of-org batch, and `import_user_can_commit_country(NULL)`
--       returns TRUE by its own first branch (`p_country IS NULL OR ...`), turning
--       a country RESTRICTION into a pass. It is harmless only because the sibling
--       RESTRICTIVE policy `import_rows_org_isolation` independently blocks those
--       rows - and encoding a lie into a policy helper while relying on a
--       neighbouring policy to cover for it is exactly the shape V552 refused for
--       `import_existing_keys`.
--
--   What is actually exposed is ONE token from the set {KSA, UAE, Egypt}, per
--   known batch uuid, with no financial or operational content, while
--   `import_batches` and `import_rows` themselves stay fully closed (measured 0
--   and 0 for the probe). Correctness of the import boundary wins. DO NOT "fix"
--   this without re-measuring both consequences above.
--
-- THE ACCIDENT RPC FAMILY (5 functions) - VERIFIED, not inherited from V551.
--   accident_task_complete, accident_evidence_verify, accident_repair_complete,
--   accident_repair_task_complete, accident_document_mark_received all delegate to
--   `_accident_rpc_context`, whose body was read and whose refusal/admission was
--   demonstrated live in both directions (see above). Genuinely scoped.
--
-- THE SUPER-ADMIN-GATED SET - each read to confirm the gate RAISES rather than
--   being a column filter (the V551 `get_console_stats` trap):
--     admin_data_cleanup_targets ... `if not is_super_admin() then raise` - real.
--       Its cross-org counts are the deliberate platform-owner view.
--     admin_get_effective_access ... raises 42501 - real.
--     backup_restore_preview ....... raises 'Not authorized' - real.
--     get_sentry_config_status ..... reads own is_super_admin, then raises - real.
--     owner_data_audit, admin_dup_restore, reclassify_revert, admin_bulk_set_role,
--     admin_set_user_country/_sites/_web_access, admin_clear_push_token,
--     admin_mobile_user_action, admin_db_revert_change, set_module_permissions,
--     set_sentry_config, set_user_access_grant, revoke_user_access_grant - all
--     carry a raising is_super_admin() gate.
--
-- OWN-ROW READERS (~22) - app_current_org, app_role, app_is_active, get_my_role,
--   get_my_site, is_super_admin, is_elevated_user, is_approved_and_unlocked,
--   app_country_scope, app_site_scope, app_sees_all_countries, app_sees_all_sites,
--   app_can_see_country, app_can_see_site, app_in_org, app_cap_revoked,
--   app_user_can, get_my_access_grants, get_my_capabilities,
--   import_user_can_commit_country, tyre_scrap_allowed, reset_login_attempts.
--   Every one keys on auth.uid() and MUST read the caller's own row across orgs or
--   the scope system it implements cannot function.
--
-- SELF-ATTRIBUTED WRITES - record_audit_event (stamps the caller's own uid/email/
--   site/country) and revoke_user_device (`WHERE user_id = v_uid`). Own row only.
--
-- LOGIN PATH - `_login_identifier_exists` returns a boolean and is consumed by
--   `record_login_failure` (V287). A user signing in has no org context yet, so it
--   MUST work across orgs by construction. The standing `get_email_by_identifier`
--   open item is the same class and is unchanged here.
--
-- TRIGGER FUNCTIONS (8) - enforce_accident_closure, lock_inspection_content,
--   normalize_profiles_role, notify_workshop_parts, process_stg_complaints,
--   process_stg_tyre_brand, guard_last_admin, log_access_audit_generic, plus
--   process_stg_parts_grid. All RETURN trigger and are not directly callable.
--
--
-- ============================================================================
-- METHOD
-- ============================================================================
--
-- NOTHING WAS RETYPED. Every guard is inserted by reading the function's own LIVE
-- `pg_get_functiondef` and doing an anchored `replace()`, and EVERY REPLACEMENT
-- ABORTS UNLESS ITS ANCHOR OCCURS EXACTLY ONCE. A partial run is the failure mode
-- that matters: half a boundary reads as a closed one (the V396 lesson). Anchors
-- are single-line fragments only, because these bodies carry CRLF line endings and
-- an anchor spanning a line break would silently fail to match.
--
-- `CREATE OR REPLACE` preserves SECURITY DEFINER, the pinned search_path and the
-- grants - verified after: all four still definer, still `search_path=public`,
-- still authenticated-executable, still anon=false.
--
-- THE STRONGEST REGRESSION PROOF IS TEXTUAL. For ALL SIX functions, stripping the
-- inserted text back out of the live definition reproduces the backed-up
-- definition BYTE FOR BYTE (equality and md5 both true), so the guard is provably
-- the ONLY change and a permitted caller cannot take a different path.
--
--
-- ============================================================================
-- VERIFIED AFTER (all in rolled-back transactions)
-- ============================================================================
--
--   EGYPT DIRECTOR (the other tenant):
--     request_accident_closure ... REFUSED "Not permitted for this organisation."
--     approve_accident_closure ... REFUSED "Not permitted for this organisation."
--     reject_accident_closure .... REFUSED "Not permitted for this organisation."
--     import_reprocess_row ....... matched 0 rows; target row still `warning`
--     user_has_capability ........ REFUSED "permission denied for function"
--
--   COMPANY A MANAGER (the control - the feature still works):
--     request_accident_closure ... SUCCEEDED, closure_status -> pending_closure
--     notifications raised ....... 3, of which OUTSIDE Company A = 0  (was 4/1)
--     import_reprocess_row ....... warning -> pending  (STILL WORKS)
--
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
--   Prior definitions are in `_bak.definer_org_defs_v570` (6 rows: sig, def,
--   captured_at). To restore any one of them:
--
--     do $$ declare d text; begin
--       select def into d from _bak.definer_org_defs_v570
--        where sig = 'request_accident_closure(uuid,text)';
--       execute d;
--     end $$;
--
--   To restore the withdrawn grants:
--
--     grant execute on function public.user_has_capability(uuid,text)      to authenticated;
--     grant execute on function public.user_has_capability(uuid,text,text) to authenticated;
--
--   Restoring the two closure functions re-opens holes 1-3; restoring
--   import_reprocess_row re-opens hole 4.
--
--
-- ============================================================================
-- RE-RUN HAZARD - THIS MIGRATION IS NOT IDEMPOTENT, BY CHOICE
-- ============================================================================
--
-- It reads the LIVE definition and inserts into it, so running it a second time
-- against an already-guarded database would append a SECOND guard. It does not
-- fail silently - request_accident_closure aborts on a duplicate `v_ctx`
-- declaration - but it MUST NOT be re-run casually, and it would also overwrite
-- `_bak.definer_org_defs_v570` with the already-guarded definitions, destroying
-- the rollback. An idempotency check was deliberately NOT added afterwards so
-- this file stays faithful to the text that was actually applied.
--
-- TO RE-APPLY: restore all six definitions from `_bak.definer_org_defs_v570`
-- first (see ROLLBACK above), then run this file once.
--
-- The only difference between this file and the applied text is four additional
-- SQL comment lines inside the DO block. They sit outside every string literal,
-- so no anchor, replacement or executed statement differs.
-- ============================================================================

do $mig$
declare
  v_def text; v_new text; v_cnt int;
  CRLF  text := chr(13)||chr(10);
  LF    text := chr(10);
  a1 text; a2 text; a3 text;
begin
  ---------------------------------------------------------------- snapshot
  create schema if not exists _bak;
  drop table if exists _bak.definer_org_defs_v570;
  create table _bak.definer_org_defs_v570 as
    select p.oid::regprocedure::text as sig,
           pg_get_functiondef(p.oid)  as def,
           now()                      as captured_at
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('request_accident_closure','approve_accident_closure',
                         'reject_accident_closure','import_reprocess_row','user_has_capability');

  if (select count(*) from _bak.definer_org_defs_v570) <> 6 then
    raise exception 'V570 abort: expected 6 definitions to snapshot, found %',
      (select count(*) from _bak.definer_org_defs_v570);
  end if;

  ------------------------------------------------- 1. request_accident_closure
  -- org/country/site wall + an org-scoped notification fan-out.
  select pg_get_functiondef('public.request_accident_closure(uuid,text)'::regprocedure) into v_def;
  v_new := v_def;

  a1 := '  v_asset text;';
  v_cnt := (length(v_new) - length(replace(v_new, a1, ''))) / length(a1);
  if v_cnt <> 1 then raise exception 'V570 abort: request_accident_closure anchor A1 occurs % times, expected 1', v_cnt; end if;
  v_new := replace(v_new, a1, a1 || CRLF || '  v_ctx   record;');

  a2 := '  SELECT COALESCE(full_name, username, ''User'') INTO v_name FROM public.profiles WHERE id = auth.uid();';
  v_cnt := (length(v_new) - length(replace(v_new, a2, ''))) / length(a2);
  if v_cnt <> 1 then raise exception 'V570 abort: request_accident_closure anchor A2 occurs % times, expected 1', v_cnt; end if;
  v_new := replace(v_new, a2,
      '  -- V570: tenant wall. Refuses a case outside the caller''s org/country/site.' || CRLF ||
      '  SELECT * INTO v_ctx FROM public._accident_rpc_context(p_accident_id);' || CRLF || CRLF || a2);

  -- the fan-out reached every elevated user in EVERY organisation; scope it to
  -- the org that owns the case (org comes from the accident, not the caller).
  a3 := '     AND p.id <> auth.uid();';
  v_cnt := (length(v_new) - length(replace(v_new, a3, ''))) / length(a3);
  if v_cnt <> 1 then raise exception 'V570 abort: request_accident_closure anchor A3 occurs % times, expected 1', v_cnt; end if;
  v_new := replace(v_new, a3,
      '     AND p.id <> auth.uid()' || CRLF ||
      '     AND p.org_id = v_ctx.org;');
  execute v_new;

  ------------------------------------------------- 2. approve_accident_closure
  select pg_get_functiondef('public.approve_accident_closure(uuid)'::regprocedure) into v_def;
  a1 := '  SELECT COALESCE(full_name, username, ''Approver'') INTO v_name FROM public.profiles WHERE id = auth.uid();';
  v_cnt := (length(v_def) - length(replace(v_def, a1, ''))) / length(a1);
  if v_cnt <> 1 then raise exception 'V570 abort: approve_accident_closure anchor occurs % times, expected 1', v_cnt; end if;
  execute replace(v_def, a1,
      '  -- V570: tenant wall. Refuses a case outside the caller''s org/country/site.' || CRLF ||
      '  PERFORM public._accident_rpc_context(p_accident_id);' || CRLF || CRLF || a1);

  ------------------------------------------------- 3. reject_accident_closure
  select pg_get_functiondef('public.reject_accident_closure(uuid,text)'::regprocedure) into v_def;
  a1 := '  SELECT COALESCE(full_name, username, ''Reviewer'') INTO v_name FROM public.profiles WHERE id = auth.uid();';
  v_cnt := (length(v_def) - length(replace(v_def, a1, ''))) / length(a1);
  if v_cnt <> 1 then raise exception 'V570 abort: reject_accident_closure anchor occurs % times, expected 1', v_cnt; end if;
  execute replace(v_def, a1,
      '  -- V570: tenant wall. Refuses a case outside the caller''s org/country/site.' || CRLF ||
      '  PERFORM public._accident_rpc_context(p_accident_id);' || CRLF || CRLF || a1);

  ------------------------------------------------- 4. import_reprocess_row
  -- scope the ROWS, not an argument (V550): a row the caller may not touch simply
  -- does not match, so a void function needs no refusal shape and no client change.
  select pg_get_functiondef('public.import_reprocess_row(uuid)'::regprocedure) into v_def;
  a1 := 'WHERE id=p_row_id AND target_record_id IS NULL;';
  v_cnt := (length(v_def) - length(replace(v_def, a1, ''))) / length(a1);
  if v_cnt <> 1 then raise exception 'V570 abort: import_reprocess_row anchor occurs % times, expected 1', v_cnt; end if;
  execute replace(v_def, a1,
      'WHERE id=p_row_id AND target_record_id IS NULL' || LF ||
      '    AND (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));');

  ------------------------------------------------- 5. withdraw the dead grants
  -- No RLS policy, no database function and no repo caller. Revoke proven
  -- harmless against a user holding 53 real grant rows.
  revoke execute on function public.user_has_capability(uuid,text)      from authenticated, anon, public;
  revoke execute on function public.user_has_capability(uuid,text,text) from authenticated, anon, public;
end $mig$;
