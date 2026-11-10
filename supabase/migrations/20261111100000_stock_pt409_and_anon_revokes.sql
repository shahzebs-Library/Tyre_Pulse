-- 20261111100000_stock_pt409_and_anon_revokes
-- Found by the enterprise deliverables pack (docs/enterprise-pack/16, 17).
--
-- 1. save_stock_entry / transfer_stock_entry refused a stale count with SQLSTATE 40001.
--    PostgREST auto-retries 40001 with no limit, so a deterministic refusal loops forever
--    (the September 2026 log flood, fixed for 19 functions by 20260926090000). Switch to
--    PT409 (HTTP 409, never retried). Bodies are rewritten from the LIVE definition with an
--    anchored replace that aborts unless each function holds exactly one 40001.
--    Clients: safeError.js maps both codes; Flutter supabase_error_mapper handles both.
-- 2. tyre_one_price_per_tyre is a TRIGGER function that kept the default PUBLIC execute
--    grant (a trigger fn needs no EXECUTE grant). reset_login_attempts is authenticated-only
--    by design (V287: an attacker who cannot sign in must not be able to clear the lock).
--    Grant order matters (V500): revoke PUBLIC, then anon, and keep authenticated where needed.
--
-- Verify: select proname, has_function_privilege('anon',oid,'EXECUTE') from pg_proc
--         where proname in ('tyre_one_price_per_tyre','reset_login_attempts');  -> f,f
--         select count(*) from pg_proc where proname in ('save_stock_entry','transfer_stock_entry')
--         and pg_get_functiondef(oid) like '%40001%';  -> 0
-- Rollback: replace PT409 with 40001 in both bodies; grant execute on reset_login_attempts to anon.

do $$
declare
  f record;
  def text;
  n int;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.proname in ('save_stock_entry','transfer_stock_entry')
  loop
    def := pg_get_functiondef(f.oid);
    n := (length(def) - length(replace(def, 'ERRCODE=''40001''', ''))) / length('ERRCODE=''40001''');
    if n <> 1 then
      raise exception 'expected exactly one 40001 in %, found %', f.oid::regprocedure, n;
    end if;
    execute replace(def, 'ERRCODE=''40001''', 'ERRCODE=''PT409''');
  end loop;
end $$;

revoke execute on function public.tyre_one_price_per_tyre() from public;
revoke execute on function public.tyre_one_price_per_tyre() from anon, authenticated;

grant execute on function public.reset_login_attempts() to authenticated, service_role;
revoke execute on function public.reset_login_attempts() from public;
revoke execute on function public.reset_login_attempts() from anon;
