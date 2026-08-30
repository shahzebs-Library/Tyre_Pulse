-- Trigger functions are invoked by installed triggers; they are not application
-- RPC endpoints. PostgreSQL does not re-check EXECUTE when a trigger fires, so
-- removing client execution is backward-compatible and closes needless
-- SECURITY DEFINER exposure through the Data API.
do $revoke_trigger_execution$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      r.signature
    );
  end loop;
end
$revoke_trigger_execution$;

-- Preserve the intended username/employee-ID login flow while ensuring the
-- resolver is not inherited by every present and future database role.
revoke execute on function public.get_email_by_identifier(text) from public;
grant execute on function public.get_email_by_identifier(text) to anon, authenticated;
