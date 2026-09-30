-- Support-team notes on a reported problem stay internal.
-- STATUS: APPLIED live 2026-09-30.
-- Before: user_issue_events_select let the REPORTER read every event of their own report through the API,
-- including the free-text note of 'comment' events written by the support team. The web page only showed
-- "Note added by the support team", but the text itself was reachable.
-- After: a RESTRICTIVE select policy hides 'comment' events from anyone who is not a super admin or an Admin
-- (Admins are still limited to their own company by the user_issues policies). Status, assignment, fixed-in
-- version, breach and created events stay visible to the reporter.
-- Rollback: drop policy user_issue_events_comment_private on public.user_issue_events;

drop policy if exists user_issue_events_comment_private on public.user_issue_events;
create policy user_issue_events_comment_private on public.user_issue_events
  as restrictive
  for select to authenticated
  using (
    event_type <> 'comment'
    or (select public.is_super_admin())
    or (select public.app_role()) = 'admin'
  );
-- VERIFIED live 2026-09-30 by impersonation (not kept): a Tyre Man report + a super-admin comment; super admin sees created,comment; the reporter sees created only.
