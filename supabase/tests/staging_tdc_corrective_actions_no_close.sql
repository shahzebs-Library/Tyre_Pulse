-- With 20261117114000 applied: a Tyre Data Collector closing, editing or deleting an action changes 0 rows (2026-11-16: 0/0/0).
begin;
insert into corrective_actions(id,title, priority, site, country, status, organisation_id, assigned_to) values ('11111111-1111-4111-8111-111111111111','TDC own','Medium','NHC','KSA','Open','00000000-0000-0000-0000-000000000001','x');
select set_config('request.jwt.claims', json_build_object('sub','63e831d7-f511-5432-976d-439af4ccaf18','role','authenticated')::text, true);
set local role authenticated;
do $$ declare n int; begin
  update corrective_actions set status='Closed' where id='11111111-1111-4111-8111-111111111111'; get diagnostics n=row_count; raise notice 'close by update: % rows', n;
  update corrective_actions set title='changed' where id='11111111-1111-4111-8111-111111111111'; get diagnostics n=row_count; raise notice 'edit: % rows', n;
  delete from corrective_actions where id='11111111-1111-4111-8111-111111111111'; get diagnostics n=row_count; raise notice 'delete: % rows', n;
exception when others then raise notice 'refused %', sqlstate; end $$;
rollback;
