-- ROLLBACK of 20261120115000_inv_hardening.sql: removes the lifecycle guards and
-- returns the four pure helpers to their default EXECUTE (PUBLIC).
begin;

do $$
declare t text;
begin
  foreach t in array array['inventory_cost_reconciliations','inventory_approval_requests','tyre_custody_conflicts'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_inv_lifecycle_guard on public.%I', t);
    end if;
  end loop;
end $$;
drop function if exists public.inv_lifecycle_guard();

do $$
declare r record;
begin
  for r in select * from (values ('public._inv_posting_on()'), ('public._inv_cap_for(text)'),
                                 ('public.inv_movement_kind(text)'), ('public.inv_canon_serial(text)')) v(sig) loop
    if to_regprocedure(r.sig) is not null then
      execute format('grant execute on function %s to public', r.sig);
      execute format('revoke all on function %s from authenticated, service_role, anon', r.sig);
    end if;
  end loop;
end $$;

commit;
