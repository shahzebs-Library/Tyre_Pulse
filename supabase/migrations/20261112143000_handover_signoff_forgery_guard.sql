-- handover_reports: sign-off cannot be forged on INSERT or rewritten by UPDATE.
--
-- FINDING: RLS-6 (P1)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (reproduced live as a Driver, rolled back):
--   insert ... approval_status='approved', supervisor_by/incharge_by = another
--     user's id, signatures filled                         -> 1 row
--   update that approved row (incharge_name, odometer_km, supervisor_signature) -> 1 row
--   update approved row set approval_status='draft'        -> 1 row (re-opened)
--   The stage guard was BEFORE UPDATE only and returned early whenever
--   approval_status was unchanged; a move back to draft/pending_supervisor was
--   allowed from any state.
--
-- WHAT THIS DOES (the ladder itself is unchanged - src/lib/handoverApproval.js
-- and decide_handover_approval keep the same roles and transitions)
--   1. NEW BEFORE INSERT trigger trg_a0_guard_handover_insert. For a signed-in,
--      non-super-admin session a new row may only start at 'draft' or
--      'pending_supervisor', must carry no supervisor_* / incharge_* / review_note
--      value, and its document_no is always stamped by the existing trigger
--      (the name sorts before trg_aa_stamp_handover_document_no on purpose).
--   2. guard_handover_approval_stages (BEFORE UPDATE) gains a first block for
--      signed-in, non-super-admin sessions that did NOT come through
--      decide_handover_approval:
--        - an approved handover cannot be changed at all;
--        - supervisor_*, incharge_*, review_note, document_no cannot change;
--        - approval_status may only move among draft / pending_supervisor
--          (from draft, pending_supervisor or rejected) - i.e. submit / resubmit.
--      Everything after that block is the previous body, untouched.
--   3. decide_handover_approval sets the transaction-local flag
--      handover.via = 'decide' (the workforce.via / workshop.* pattern) so its own
--      updates pass the guard. Nothing else in the RPC changes.
--   Super admin and backend (no session) writes follow the previous rules.
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Data loss: none. handover_reports held 0 rows at apply time.
-- Rename / removal / type / CHECK: none.
-- Locks: CREATE TRIGGER on an empty table (instant).
-- Clients read first:
--   web  src/lib/api/handoverReports.js  insert: field columns only (status by
--        default); update: field columns only; sign-off: decide_handover_approval.
--   Flutter handover_remote_repository.dart  upsert: field columns +
--        approval_status (draft / pending_supervisor) + created_by; sign-off via RPC.
--   Expo: no handover screen.
--   None of them writes a sign-off column directly, so no client breaks.
-- SECURITY DEFINER: both trigger functions pin search_path = public; the new one
--   is revoked from public / anon / authenticated (triggers need no EXECUTE).
-- Method: the two replaced functions are built from the LIVE pg_get_functiondef
--   by one anchored replacement each; the block aborts unless the anchor is found
--   exactly once.
-- PostgREST: raises 42501 only.
-- Client behaviour that changes: editing an approved handover now fails for
--   everyone except a super admin; a supervisor can no longer sign by a direct
--   table update (the apps already use the RPC).
-- Rollback: at the foot.

create or replace function public.guard_handover_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or public.is_super_admin() then
    return new;
  end if;

  if coalesce(new.approval_status, 'pending_supervisor') not in ('draft', 'pending_supervisor') then
    raise exception 'A new handover starts as a draft or waits for supervisor sign-off.' using errcode = '42501';
  end if;

  if new.supervisor_name is not null or new.supervisor_signature is not null
     or new.supervisor_at is not null or new.supervisor_by is not null
     or new.incharge_name is not null or new.incharge_signature is not null
     or new.incharge_at is not null or new.incharge_by is not null
     or new.review_note is not null then
    raise exception 'Sign-off details cannot be supplied when a handover is created.' using errcode = '42501';
  end if;

  new.document_no := null;
  return new;
end
$function$;

revoke all on function public.guard_handover_insert() from public;
revoke all on function public.guard_handover_insert() from anon;
revoke all on function public.guard_handover_insert() from authenticated;

create trigger trg_a0_guard_handover_insert
  before insert on public.handover_reports
  for each row execute function public.guard_handover_insert();

do $mig$
declare
  v_def text;
  v_a   text := E'begin\n  if new.approval_status is not distinct from old.approval_status then';
  v_b   text := '  v_org := public.app_current_org();';
begin
  select pg_get_functiondef('public.guard_handover_approval_stages()'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 then
    raise exception 'stage guard: anchor not found exactly once';
  end if;
  if position('handover.via' in v_def) > 0 then
    raise exception 'stage guard: already extended';
  end if;
  v_def := replace(v_def, v_a,
       E'begin\n'
    || E'  if coalesce(current_setting(''handover.via'', true), '''') <> ''decide''\n'
    || E'     and auth.uid() is not null\n'
    || E'     and not public.is_super_admin() then\n'
    || E'    if old.approval_status = ''approved'' then\n'
    || E'      raise exception ''An approved handover cannot be changed.'' using errcode = ''42501'';\n'
    || E'    end if;\n'
    || E'    if new.supervisor_name is distinct from old.supervisor_name\n'
    || E'       or new.supervisor_signature is distinct from old.supervisor_signature\n'
    || E'       or new.supervisor_at is distinct from old.supervisor_at\n'
    || E'       or new.supervisor_by is distinct from old.supervisor_by\n'
    || E'       or new.incharge_name is distinct from old.incharge_name\n'
    || E'       or new.incharge_signature is distinct from old.incharge_signature\n'
    || E'       or new.incharge_at is distinct from old.incharge_at\n'
    || E'       or new.incharge_by is distinct from old.incharge_by\n'
    || E'       or new.review_note is distinct from old.review_note\n'
    || E'       or new.document_no is distinct from old.document_no then\n'
    || E'      raise exception ''Sign-off details are recorded through the sign-off step only.'' using errcode = ''42501'';\n'
    || E'    end if;\n'
    || E'    if new.approval_status is distinct from old.approval_status\n'
    || E'       and not (coalesce(old.approval_status, ''pending_supervisor'') in (''draft'', ''pending_supervisor'', ''rejected'')\n'
    || E'                and new.approval_status in (''draft'', ''pending_supervisor'')) then\n'
    || E'      raise exception ''A handover is signed off through the sign-off step only.'' using errcode = ''42501'';\n'
    || E'    end if;\n'
    || E'  end if;\n\n'
    || E'  if new.approval_status is not distinct from old.approval_status then');
  execute v_def;

  select pg_get_functiondef('public.decide_handover_approval(uuid, boolean, text, text)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_b, ''))) / length(v_b) <> 1 then
    raise exception 'decide: anchor not found exactly once';
  end if;
  if position('handover.via' in v_def) > 0 then
    raise exception 'decide: already extended';
  end if;
  v_def := replace(v_def, v_b, v_b || E'\n  perform set_config(''handover.via'', ''decide'', true);');
  execute v_def;
end
$mig$;

-- ============================================================================
-- VERIFY (rolled-back impersonation, one identity per transaction)
--   Driver 54eca847-...
--     forged insert (approved + other user's sign-off)          -> ERR 42501 (was 1 row)
--     insert with supervisor_signature only                     -> ERR 42501
--     plain field insert (default status)                       -> 1 row, document_no HND-...
--     insert with a made-up document_no                         -> stored as HND-<id>, not the value sent
--     update own pending row odometer_km / notes                -> 1 row (field edit still works)
--     update pending row set supervisor_signature               -> ERR 42501
--     update set approval_status='pending_incharge' / 'approved'-> ERR 42501
--     draft -> pending_supervisor (submit)                      -> 1 row
--   Fleet Supervisor f3a70480-...
--     decide_handover_approval(id, true, sig)  -> status pending_incharge, supervisor_by stamped
--     direct update approval_status='pending_incharge'          -> ERR 42501 (use the RPC)
--   Admin / super admin d2d43a5f-...
--     decide_handover_approval on pending_incharge              -> approved
--   Driver again, on the approved row: any update               -> ERR 42501 (was 1 row)
--
-- ROLLBACK (owner, SQL editor - the first statement is one the MCP gate will not run):
--   drop trigger trg_a0_guard_handover_insert on public.handover_reports;
--   drop function public.guard_handover_insert();
--   then re-create guard_handover_approval_stages and decide_handover_approval from
--   supabase/migrations/20261112130000_handover_two_stage_signoff.sql.
