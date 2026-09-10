-- Local migration; deployment required. Not applied to any shared database.
-- Function bodies captured from the live schema on 2026-09-07.
-- Preserve existing signatures, tenant/RBAC gates, audit and notification behavior.
-- Closure retries and competing decisions must observe pending_closure under lock.
-- Claim registration serializes on the parent case, including when no claim exists.
-- Registration relies on PostgREST's READ COMMITTED isolation for the child
-- lookup after a lock wait to see the preceding caller's committed claim.
-- CREATE OR REPLACE preserves existing owners and EXECUTE grants.
-- This prevents duplicates through these RPCs; it does not merge historical claims
-- or impose one-claim-per-case on other writers.
BEGIN;

CREATE OR REPLACE FUNCTION public.accident_claim_register(p_accident_id uuid, p_insurer text, p_policy_no text, p_claim_no text, p_claim_amount numeric, p_deductible numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org       uuid;
  v_country   text;
  v_site      text;
  v_insurer   text := nullif(btrim(coalesce(p_insurer, '')), '');
  v_policy_no text := nullif(btrim(coalesce(p_policy_no, '')), '');
  v_claim_no  text := nullif(btrim(coalesce(p_claim_no, '')), '');
  v_existing  public.accident_insurance_claims%rowtype;
  v_claim     public.accident_insurance_claims%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  -- Capability gate: elevated OR the insurance-owning capability.
  if not (public.app_is_elevated()
          or public.app_user_can('accidents', 'edit_insurance')) then
    raise exception 'Not permitted to register an insurance claim.' using errcode = '42501';
  end if;

  -- Money validation: a claimed amount / deductible can never be negative.
  if p_claim_amount is not null and p_claim_amount < 0 then
    raise exception 'Claim amount cannot be negative.' using errcode = '22023';
  end if;
  if p_deductible is not null and p_deductible < 0 then
    raise exception 'Deductible cannot be negative.' using errcode = '22023';
  end if;

  -- The case row exists even before its first claim. Serialize callers here
  -- before looking for a claim; locking the child lookup cannot lock absence.
  -- This order also matches closure operations: case first, child rows second.
  perform 1 from public.accidents where id = p_accident_id for update;
  if not found then
    raise exception 'Incident % not found.', p_accident_id using errcode = 'P0002';
  end if;
  -- A concurrent case-scope edit may have committed while the lock waited.
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  -- Resolve the case's existing claim (latest first), if any.
  select * into v_existing
    from public.accident_insurance_claims c
   where c.accident_id = p_accident_id
   order by c.created_at desc, c.id desc
   limit 1;

  if v_existing.id is null then
    insert into public.accident_insurance_claims
      (organisation_id, accident_id, country, site, insurance_applicable,
       insurer, policy_no, claim_no, deductible, decision, claim_registered_date,
       created_by, created_at, updated_at)
    values
      (v_org, p_accident_id, v_country, v_site, true,
       v_insurer, v_policy_no, v_claim_no, p_deductible, 'registered', current_date,
       auth.uid(), now(), now())
    returning * into v_claim;
  else
    update public.accident_insurance_claims c set
       insurer               = coalesce(v_insurer, c.insurer),
       policy_no             = coalesce(v_policy_no, c.policy_no),
       claim_no              = coalesce(v_claim_no, c.claim_no),
       deductible            = coalesce(p_deductible, c.deductible),
       decision              = case
                                 when c.decision in ('not_required','under_review','documents_incomplete')
                                   then 'registered'
                                 else c.decision
                               end,
       claim_registered_date = coalesce(c.claim_registered_date, current_date),
       updated_at            = now()
     where c.id = v_existing.id
    returning * into v_claim;
  end if;

  -- Persist the claimed amount on the case root (its only real home; see header).
  if p_claim_amount is not null then
    update public.accidents
       set claim_amount = p_claim_amount
     where id = p_accident_id;
  end if;

  -- Move the insurance workstream to in_progress in the same transaction, so a
  -- registered claim never sits against an untouched insurance section.
  insert into public.accident_case_workstreams
    (organisation_id, accident_id, country, site, workstream_key, status,
     started_at, created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, 'insurance', 'in_progress',
     now(), auth.uid(), now(), now())
  on conflict (accident_id, workstream_key) do update set
     status     = case
                    when public.accident_case_workstreams.status
                         in ('not_required','not_started','assigned')
                      then 'in_progress'
                    else public.accident_case_workstreams.status
                  end,
     started_at = coalesce(public.accident_case_workstreams.started_at, now()),
     updated_at = now();

  return jsonb_build_object('ok', true, 'claim', to_jsonb(v_claim));
end
$function$;

CREATE OR REPLACE FUNCTION public.approve_accident_closure(p_accident_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name      text;
  v_requester uuid;
  v_closure_status text;
BEGIN
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
         status              = 'Closed',
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

CREATE OR REPLACE FUNCTION public.reject_accident_closure(p_accident_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name      text;
  v_requester uuid;
  v_closure_status text;
BEGIN
  IF NOT public.is_elevated_user() THEN
    RAISE EXCEPTION 'Only Admin, Manager or Director can reject closures';
  END IF;

  -- V570: tenant wall. Refuses a case outside the caller's org/country/site.
  PERFORM public._accident_rpc_context(p_accident_id);

  SELECT COALESCE(full_name, username, 'Reviewer') INTO v_name FROM public.profiles WHERE id = auth.uid();
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
     SET closure_status          = 'open',
         closure_rejected_reason = p_reason
   WHERE id = p_accident_id;

  INSERT INTO public.accident_remarks (accident_id, author_id, author_name, remark, remark_type)
  VALUES (p_accident_id, auth.uid(), v_name,
          'Closure rejected' || CASE WHEN p_reason IS NOT NULL AND p_reason <> '' THEN ': ' || p_reason ELSE '' END,
          'closure_rejected');

  IF v_requester IS NOT NULL AND v_requester <> auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
    VALUES (v_requester, 'closure_rejected', 'Closure rejected',
            'Your accident closure was rejected by ' || v_name ||
            CASE WHEN p_reason IS NOT NULL AND p_reason <> '' THEN ': ' || p_reason ELSE '' END,
            'accident', p_accident_id);
  END IF;
END;
$function$;

COMMIT;
