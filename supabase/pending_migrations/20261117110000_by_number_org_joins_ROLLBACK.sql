-- =============================================================================
-- ROLLBACK for 20261117110000_by_number_org_joins.sql
-- STATUS: AUTHORED, NOT APPLIED. Tested on the local mirror: after this file the
--         9 objects hash byte-identical to their pre-migration definitions.
--
-- Re-executes the definitions the migration saved in
-- _bak.by_number_org_joins_defs before it changed anything. Nothing is retyped.
-- The backup table is left in place (it is the record of what ran).
-- =============================================================================
begin;

do $rb$
declare r record; n int := 0;
begin
  if to_regclass('_bak.by_number_org_joins_defs') is null then
    raise exception 'by-number-org rollback: no saved definitions; the migration did not run here';
  end if;
  for r in select object_name, kind, definition from _bak.by_number_org_joins_defs order by object_name loop
    if r.kind = 'function' then
      execute r.definition;
    else
      execute 'create or replace view ' || r.object_name || ' with (security_invoker = on) as ' || r.definition;
    end if;
    n := n + 1;
  end loop;
  if n <> 9 then
    raise exception 'by-number-org rollback: expected 9 saved objects, found %', n;
  end if;
end $rb$;

-- Post-condition: no object still carries the company condition.
do $chk$
begin
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
             where s.nspname = 'public' and p.prokind = 'f'
               and position('/* by-number-org */' in pg_get_functiondef(p.oid)) > 0) then
    raise exception 'by-number-org rollback: a function still carries the marker';
  end if;
  if position('(wo.org = f.organisation_id)' in pg_get_viewdef('public.v_tyre_fitment_evidence'::regclass)) > 0 then
    raise exception 'by-number-org rollback: v_tyre_fitment_evidence still patched';
  end if;
end $chk$;

commit;
