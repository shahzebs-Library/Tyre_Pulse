-- ROLLBACK of STEP 0: puts every anum_reader_* policy back exactly as snapshotted.
-- Contains "drop": the MCP confirm prompt appears.
begin;
do $do$
declare p record; s record;
begin
  for p in select schemaname, tablename, policyname from pg_policies where policyname like 'anum_reader_%' loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
  for s in select * from _bak.rb519_reader_policies_snapshot loop
    execute format('create policy %I on %I.%I as %s for %s to %s %s %s',
      s.policyname, s.schemaname, s.tablename, s.permissive, s.cmd,
      (select string_agg(quote_ident(r), ', ') from unnest(s.roles) r),
      case when s.qual is not null then 'using (' || s.qual || ')' else '' end,
      case when s.with_check is not null then 'with check (' || s.with_check || ')' else '' end);
  end loop;
end
$do$;
commit;
