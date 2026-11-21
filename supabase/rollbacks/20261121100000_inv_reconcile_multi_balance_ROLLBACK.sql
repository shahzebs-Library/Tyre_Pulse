-- ROLLBACK of 20261121100000_inv_reconcile_multi_balance.sql.
-- Restores _inv_audit_reconcile from the definition captured at apply time
-- (_bak.inv_121100_snapshot, executed verbatim; nothing retyped). Discrepancies
-- already recorded by the patched function are left as they are.
begin;

do $$
declare r record;
begin
  if to_regclass('_bak.inv_121100_snapshot') is null then
    raise notice '121100 rollback: no snapshot table; function left as it is.';
    return;
  end if;
  for r in select obj, def from _bak.inv_121100_snapshot loop
    if to_regprocedure(r.obj) is not null then
      execute r.def;
    end if;
  end loop;
end $$;

drop table if exists _bak.inv_121100_snapshot;

commit;
