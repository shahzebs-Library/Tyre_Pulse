-- =============================================================================
-- ROLLBACK for 20261117113000_company_pinned_lookups.sql
-- STATUS: AUTHORED, NOT APPLIED. Tested on the local mirror: after this file the
--         5 functions hash byte-identical to their pre-migration definitions
--         (supabase/tests/staging_company_pinned_lookups.sh).
--
-- Re-executes the definitions the migration saved in
-- _bak.company_pinned_lookups_defs before it changed anything. Nothing is
-- retyped. The backup table is left in place (it is the record of what ran).
-- =============================================================================
begin;

do $rb$
declare r record; n int := 0;
begin
  if to_regclass('_bak.company_pinned_lookups_defs') is null then
    raise exception 'company-pinned rollback: no saved definitions; the migration did not run here';
  end if;
  for r in select object_name, definition from _bak.company_pinned_lookups_defs order by object_name loop
    execute r.definition;
    n := n + 1;
  end loop;
  if n <> 5 then
    raise exception 'company-pinned rollback: expected 5 saved functions, found %', n;
  end if;
end $rb$;

do $chk$
begin
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
                and position('/* company-pinned */' in pg_get_functiondef(p.oid)) > 0) then
    raise exception 'company-pinned rollback: a function still carries the marker';
  end if;
end $chk$;

commit;
