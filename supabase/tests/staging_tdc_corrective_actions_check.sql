-- Run on a tp_* staging copy whose Company A settings carry the production-shaped permission_overrides string.
-- Before 20261117114000: create=false and the own-site insert is refused. After: create=true, edit=false,
-- approve=false, own-site insert OK, other-site insert refused (42501). Result 2026-11-16: as described.
-- Closing stays with ca_reviewer_roles (corrective_action_review_guard); not exercised here.
begin;
select set_config('request.jwt.claims', json_build_object('sub','63e831d7-f511-5432-976d-439af4ccaf18','role','authenticated')::text, true);
set local role authenticated;
select 'caps create='||app_user_can('corrective_actions','create')||' edit='||app_user_can('corrective_actions','edit')||' approve='||app_user_can('corrective_actions','approve');
savepoint s1;
insert into corrective_actions(title, priority, site, country, status, organisation_id) values ('TDC test','Medium','NHC','KSA','Open','00000000-0000-0000-0000-000000000001');
select 'insert own site: OK';
rollback to s1;
savepoint s2;
do $$ begin
  begin insert into corrective_actions(title, priority, site, country, status, organisation_id) values ('TDC other site','Medium','DIRIYAH','KSA','Open','00000000-0000-0000-0000-000000000001'); raise notice 'insert other site: ALLOWED (bad)';
  exception when others then raise notice 'insert other site: refused (%)', sqlstate; end;
end $$;
rollback;
