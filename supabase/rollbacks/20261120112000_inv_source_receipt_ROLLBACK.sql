-- ROLLBACK of 20261120112000_inv_source_receipt.sql.
-- Restores _inv_issue and _inv_transfer_dispatch from the definitions captured
-- at apply time (_bak.inv_112000_snapshot, executed verbatim; nothing retyped)
-- and drops the read-only view. No ledger row is touched: a movement that was
-- posted with a named source receipt keeps it (the column belongs to P0).
begin;

drop view if exists public.v_inv_receipt_sources;

do $$
declare r record;
begin
  if to_regclass('_bak.inv_112000_snapshot') is null then
    raise notice '112000 rollback: no snapshot table; functions left as they are.';
    return;
  end if;
  for r in select obj, def from _bak.inv_112000_snapshot order by obj loop
    if to_regprocedure(r.obj) is not null then
      execute r.def;
    end if;
  end loop;
end $$;

drop table if exists _bak.inv_112000_snapshot;

commit;
