-- The public policy reader is SECURITY INVOKER and composes the static default
-- JSON. Authenticated callers therefore need EXECUTE on that harmless helper.
grant execute on function public.checklist_governance_defaults() to authenticated;

-- Trigger helpers are never callable client APIs.
revoke all on function public.evaluate_checklist_submission_evidence()
  from public, anon, authenticated;
