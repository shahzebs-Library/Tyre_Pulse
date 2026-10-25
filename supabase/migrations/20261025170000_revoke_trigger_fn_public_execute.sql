-- Security audit 2026-10-25: two trigger functions had inherited Supabase's default PUBLIC/anon EXECUTE
-- grant. A trigger function needs no EXECUTE grant (the trigger fires as the table writer), so the grant
-- only widened the anon-callable surface beyond the reviewed allowlist. Order matters: PUBLIC first, then anon.
-- Rollback: grant execute on function public.<name>() to public;
revoke execute on function public.tp_notify_action_assignee() from public;
revoke execute on function public.tp_notify_action_assignee() from anon;
revoke execute on function public.tp_record_broadcast_recipient() from public;
revoke execute on function public.tp_record_broadcast_recipient() from anon;
