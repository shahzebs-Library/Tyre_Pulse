-- =============================================================================
-- ROLLBACK for 20261117112000_complaints_missing_in_date_reject.sql
-- STATUS: AUTHORED, NOT APPLIED. Tested on a private copy of the local mirror:
--         after this file process_stg_complaints hashes byte-identical to its
--         pre-migration (by-number) definition.
-- ORDER: run this BEFORE 20261117110000_by_number_org_joins_ROLLBACK.sql.
--
-- Re-executes the definition the migration saved before it changed anything.
-- Nothing is retyped. Reject rows already written stay (they are a record).
-- =============================================================================
begin;

do $rb$
declare v_def text;
begin
  if to_regclass('_bak.complaints_in_date_defs') is null then
    raise exception 'complaints-in-date rollback: no saved definition; the migration did not run here';
  end if;
  select definition into v_def from _bak.complaints_in_date_defs
   where object_name = 'public.process_stg_complaints()';
  if v_def is null then
    raise exception 'complaints-in-date rollback: saved definition missing';
  end if;
  execute v_def;
  if position('/* complaints-in-date */' in pg_get_functiondef('public.process_stg_complaints()'::regprocedure)) > 0 then
    raise exception 'complaints-in-date rollback: function still patched';
  end if;
end $rb$;

commit;
