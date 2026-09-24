-- STATUS: APPLIED LIVE 2026-09-24.
-- Adds 'revoke_sessions' to the break-glass high-risk action list so every
-- super admin is alerted when another one signs a user out everywhere.
-- Anchored edit of the live function; aborts unless the anchor occurs once.
-- VERIFY: select pg_get_functiondef('public.alert_console_break_glass()'::regprocedure) ~ 'revoke_sessions'  -> t
-- ROLLBACK: re-run the same block replacing 'support_session_start','revoke_sessions' with 'support_session_start'.
do $mig$
declare
  v_def text := pg_get_functiondef('public.alert_console_break_glass()'::regprocedure);
  v_anchor text := '''support_session_start''];';
begin
  if v_def ~ 'revoke_sessions' then return; end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'anchor not found exactly once';
  end if;
  execute replace(v_def, v_anchor, '''support_session_start'',''revoke_sessions''];');
end $mig$;
