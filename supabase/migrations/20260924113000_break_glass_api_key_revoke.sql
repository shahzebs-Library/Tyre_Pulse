-- STATUS: APPLIED LIVE 2026-09-24.
-- Adds 'api_key_revoke' to the break-glass high-risk action list so every super admin is alerted.
-- VERIFY: select pg_get_functiondef('public.alert_console_break_glass()'::regprocedure) ~ 'api_key_revoke' -> t
-- ROLLBACK: same block replacing 'revoke_sessions','api_key_revoke' with 'revoke_sessions'.
do $mig$
declare
  v_def text := pg_get_functiondef('public.alert_console_break_glass()'::regprocedure);
  v_anchor text := '''revoke_sessions''];';
begin
  if v_def ~ 'api_key_revoke' then return; end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'anchor not found exactly once';
  end if;
  execute replace(v_def, v_anchor, '''revoke_sessions'',''api_key_revoke''];');
end $mig$;
