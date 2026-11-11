-- 360 audit fix wave 1 — Loop 3 / F-B-01 (P1, confirmed).
-- approve_accident_closure writes `status = 'Closed'` (Title Case) but accidents.chk_status
-- allows only lowercase tokens, so EVERY approval raises 23514 ("Some values are not valid.")
-- and nothing is written — the closure-approval step is dead for every tenant. Even without the
-- CHECK, accident_stage_from_status('Closed') returns 'reported' (verified live), so the derive
-- trigger would push workflow_stage back to the start. accident_stage_from_status('closed')
-- returns 'closed' (verified live), and the CHECK allows 'closed'.
--
-- FIX: re-create approve_accident_closure from the LIVE pg_get_functiondef (2026-11-10) with
-- EXACTLY ONE token changed:  status = 'Closed'  ->  status = 'closed'.
-- Every V570 guard (cap-guard:approve, is_elevated_user gate, _accident_rpc_context tenant wall
-- before and after the FOR UPDATE lock, pending_closure state check, remark + notification) is
-- byte-identical to the live body. No grant changes (CREATE OR REPLACE preserves grants).
--
-- Owner decision #11: fix the legacy RPC now; the V417 closure-review engine
-- (accident_request_closure / accident_decide_closure) stays DORMANT — the UI uses the legacy
-- closure_status flow. A COMMENT records that below.
--
-- PRE-FLIGHT (database-migration-safety):
--   Data loss      : none (function re-creation only).
--   Rename/removal : none.
--   CHECK          : accidents.chk_status unchanged — the fix makes the RPC write a value it
--                    already allows ('closed'). Live constraint:
--                    CHECK (status = ANY (ARRAY['reported','under_review','repair_in_progress',
--                    'awaiting_parts','awaiting_approval','insurance_claim','released','closed'])).
--   Locks          : none beyond the catalog lock for CREATE OR REPLACE FUNCTION.
--   Triggers       : none fire at apply time. At CALL time, accident_derive_fields maps
--                    status 'closed' -> workflow_stage 'closed' (accident_stage_from_status).
--   PostgREST      : no 40001; existing error codes (42501/55000/P0002) preserved.
--   Rollback       : re-create with 'Closed' (the base body) — SQL at the bottom.
--
-- DIFF vs the live body (the ONLY change):
--   -         status              = 'Closed',
--   +         status              = 'closed',

create or replace function public.approve_accident_closure(p_accident_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_name      text;
  v_requester uuid;
  v_closure_status text;
BEGIN
  -- cap-guard:approve
  if public.app_cap_revoked('accidents','approve') then
    raise exception 'You are not permitted to approve or decide this record.' using errcode = '42501';
  end if;
  IF NOT public.is_elevated_user() THEN
    RAISE EXCEPTION 'Only Admin, Manager or Director can approve closures';
  END IF;

  -- V570: tenant wall. Refuses a case outside the caller's org/country/site.
  PERFORM public._accident_rpc_context(p_accident_id);

  SELECT COALESCE(full_name, username, 'Approver') INTO v_name FROM public.profiles WHERE id = auth.uid();
  -- Lock the current case state before deciding or creating audit/notifications.
  SELECT close_requested_by, closure_status
    INTO v_requester, v_closure_status
    FROM public.accidents
   WHERE id = p_accident_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident % not found.', p_accident_id USING ERRCODE = 'P0002';
  END IF;
  -- Recheck scope after waiting for any concurrent case update.
  PERFORM public._accident_rpc_context(p_accident_id);
  IF v_closure_status IS DISTINCT FROM 'pending_closure' THEN
    RAISE EXCEPTION 'Accident closure is no longer pending review.'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.accidents
     SET closure_status      = 'closed',
         status              = 'closed',
         closure_approved_by = auth.uid(),
         closure_approved_at = now()
   WHERE id = p_accident_id;

  INSERT INTO public.accident_remarks (accident_id, author_id, author_name, remark, remark_type)
  VALUES (p_accident_id, auth.uid(), v_name, 'Closure approved', 'closure_approved');

  IF v_requester IS NOT NULL AND v_requester <> auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
    VALUES (v_requester, 'closure_approved', 'Closure approved',
            'Your accident closure was approved by ' || v_name || '.', 'accident', p_accident_id);
  END IF;
END;
$function$;

-- Owner decision #11: the V417 closure-review engine stays dormant; the UI uses the legacy flow.
comment on function public.accident_request_closure(uuid, text, text, uuid)
  is 'V417 closure reviews dormant; UI uses legacy closure_status flow (2026-11-10)';
comment on function public.accident_decide_closure(uuid, text, text, uuid, text, jsonb)
  is 'V417 closure reviews dormant; UI uses legacy closure_status flow (2026-11-10)';

-- ============================================================================
-- VERIFY (run in a SEPARATE call AFTER apply; rolled back; real Manager with scope).
-- Manager 34793423 (KSA, sites ALL); KSA case 604eaf24 (JEDDAH, status 'reported').
-- begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','34793423-43df-4b6f-9270-9d1e8be6fa30','role','authenticated')::text, true);
--   set local role authenticated;
--   select public.request_accident_closure('604eaf24-e8ed-4079-996b-80ead4d56a9b','audit probe');
--   select public.approve_accident_closure('604eaf24-e8ed-4079-996b-80ead4d56a9b');
--   reset role;
--   select status, closure_status, workflow_stage
--     from public.accidents where id='604eaf24-e8ed-4079-996b-80ead4d56a9b';
-- rollback;
--   EXPECT: closed / closed / closed  (was: every approve raised 23514).
-- ============================================================================

-- ============================================================================
-- ROLLBACK: re-create the previous (broken) body with status = 'Closed':
--   copy the function body above and change the one line back to
--     status              = 'Closed',
--   then re-create. (Rolling back reinstates the 23514-on-every-approval defect.)
--   The COMMENTs may be dropped with:
--     comment on function public.accident_request_closure(uuid, text, text, uuid) is null;
--     comment on function public.accident_decide_closure(uuid, text, text, uuid, text, jsonb) is null;
-- ============================================================================
