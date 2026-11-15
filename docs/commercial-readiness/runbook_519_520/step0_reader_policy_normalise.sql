-- STEP 0 (narrow). Adds the four standard anum_reader_* RESTRICTIVE policies to exactly two tables:
--   public.observation_erp_links and public.observation_erp_link_events
-- (created by 20261115120000, which did not call anum_integration.apply_reader_policies()).
-- Nothing else changes: no grant, no other table, no function, no call to apply_reader_policies().
-- The policies are byte-identical to what apply_reader_policies() writes for a table that is NOT in
-- anum_integration.reader_tables, so the later steps 2, 6 and 8 (which call it) recreate them unchanged.
-- Effect: only the anum_integration reader identity (a user listed in anum_integration.readers) loses
-- read access to these two tables; every other user is unaffected (restrictive policies only narrow).
-- Note for the MCP tool: the policy name anum_reader_no_... and "for ... " clauses below contain the
-- word d-e-l-e-t-e, so the confirm prompt appears; the owner must be present.
begin;

-- Preflight guard: abort unless production is in exactly the measured state.
do $guard$
declare v_drift text[]; v_existing int; v_listed int; v_rls int;
begin
  select count(*) into v_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('observation_erp_links','observation_erp_link_events')
     and c.relkind = 'r' and c.relrowsecurity;
  if v_rls <> 2 then
    raise exception 'step 0 refused: both tables must exist with RLS enabled (found %)', v_rls;
  end if;

  select count(*) into v_existing from pg_policies
   where schemaname = 'public' and tablename in ('observation_erp_links','observation_erp_link_events')
     and policyname like 'anum\_reader\_%';
  if v_existing <> 0 then
    raise exception 'step 0 refused: % anum_reader_* policies already exist on the two tables', v_existing;
  end if;

  select count(*) into v_listed from anum_integration.reader_tables
   where table_name in ('observation_erp_links','observation_erp_link_events');
  if v_listed <> 0 then
    raise exception 'step 0 refused: a table is listed in anum_integration.reader_tables (expected not listed)';
  end if;

  with t as (
    select c.relname,
           exists (select 1 from anum_integration.reader_tables a where a.table_name = c.relname) as allowed,
           exists (select 1 from pg_attribute at where at.attrelid = c.oid and at.attname = 'organisation_id'
                     and not at.attisdropped and at.atttypid = 'uuid'::regtype) as has_org
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity)
  select coalesce(array_agg(t.relname::text order by t.relname), '{}') into v_drift
    from t left join pg_policies p
      on p.schemaname = 'public' and p.tablename = t.relname and p.policyname = 'anum_reader_select_scope'
   where p.qual is distinct from case when t.allowed and t.has_org
           then '((NOT ( SELECT anum_integration.is_reader() AS is_reader)) OR (organisation_id = ( SELECT anum_integration.reader_org() AS reader_org)))'
           else '(NOT ( SELECT anum_integration.is_reader() AS is_reader))' end;
  if v_drift is distinct from array['observation_erp_link_events','observation_erp_links'] then
    raise exception 'step 0 refused: reader-policy drift is % (expected exactly observation_erp_link_events, observation_erp_links)', v_drift;
  end if;
end
$guard$;

-- The 8 policies (4 per table). Text identical to anum_integration.apply_reader_policies().
create policy anum_reader_select_scope on public.observation_erp_links as restrictive for select to authenticated
  using (not (select anum_integration.is_reader()));
create policy anum_reader_no_insert on public.observation_erp_links as restrictive for insert to authenticated
  with check (not (select anum_integration.is_reader()));
create policy anum_reader_no_update on public.observation_erp_links as restrictive for update to authenticated
  using (not (select anum_integration.is_reader())) with check (not (select anum_integration.is_reader()));
create policy anum_reader_no_delete on public.observation_erp_links as restrictive for delete to authenticated
  using (not (select anum_integration.is_reader()));

create policy anum_reader_select_scope on public.observation_erp_link_events as restrictive for select to authenticated
  using (not (select anum_integration.is_reader()));
create policy anum_reader_no_insert on public.observation_erp_link_events as restrictive for insert to authenticated
  with check (not (select anum_integration.is_reader()));
create policy anum_reader_no_update on public.observation_erp_link_events as restrictive for update to authenticated
  using (not (select anum_integration.is_reader())) with check (not (select anum_integration.is_reader()));
create policy anum_reader_no_delete on public.observation_erp_link_events as restrictive for delete to authenticated
  using (not (select anum_integration.is_reader()));

commit;
