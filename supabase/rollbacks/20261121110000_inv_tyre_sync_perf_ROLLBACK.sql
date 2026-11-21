-- ROLLBACK of 20261121110000_inv_tyre_sync_perf.sql.
-- Restores _inv_tyre_item_sync from the definition captured at apply time
-- (_bak.inv_121110_snapshot, executed verbatim; nothing retyped), then removes the
-- sync-run cache table. tyre_items / tyre_custody_conflicts / tyre_item_events rows
-- written by the faster function are left as they are (they are the same derivation).
begin;

do $$
declare r record;
begin
  if to_regclass('_bak.inv_121110_snapshot') is null then
    raise notice '121110 rollback: no snapshot table; function left as it is.';
    return;
  end if;
  for r in select obj, def from _bak.inv_121110_snapshot loop
    if to_regprocedure(r.obj) is not null then
      execute r.def;
      execute format('revoke all on function %s from public, anon, authenticated', r.obj);
    end if;
  end loop;
  if position('inv_tyre_sync_runs' in pg_get_functiondef('public._inv_tyre_item_sync(text)'::regprocedure)) > 0 then
    raise exception '121110 rollback: original definition was not restored.';
  end if;
end $$;

drop table if exists public.inv_tyre_sync_runs;
drop table if exists _bak.inv_121110_snapshot;

commit;

-- VERIFY:
-- select md5(replace(pg_get_functiondef('public._inv_tyre_item_sync(text)'::regprocedure), chr(13), ''));  -- 92e69b6622a88dddc3358ddea0ff1276
-- select to_regclass('public.inv_tyre_sync_runs');                                                          -- null
