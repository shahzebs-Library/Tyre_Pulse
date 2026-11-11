-- 20261110146000 import_org_resolver  (DRAFT - NOT APPLIED; lead applies)
-- F-K-01 (owner decision 6): safe import resolver. Order: tp.import_org setting -> Company A ONLY while
-- system_config.single_tenant_mode='true' -> otherwise refuse (PT409, never 40001: PostgREST retries 40001).
-- handle_new_user is UNCHANGED. Authenticated inserts already carry app_current_org(); this only affects NULL-org writes.

insert into public.system_config (key, value, description)
values ('single_tenant_mode', 'true',
        'true = a NULL-org import is stamped to the first tenant (Company A). Set false before onboarding a second tenant; imports must then set tp.import_org.')
on conflict (key) do nothing;

create or replace function public.stamp_import_default_org()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
declare
  v_setting text := nullif(btrim(coalesce(current_setting('tp.import_org', true), '')), '');
  v_org uuid;
begin
  if new.organisation_id is not null then
    return new;
  end if;
  if v_setting is not null then
    begin
      v_org := v_setting::uuid;
    exception when invalid_text_representation then
      raise exception 'tp.import_org is not a valid uuid' using errcode = 'PT409';
    end;
    if not exists (select 1 from public.organisations o where o.id = v_org) then
      raise exception 'tp.import_org does not name an existing organisation' using errcode = 'PT409';
    end if;
    new.organisation_id := v_org;
  elsif coalesce((select value from public.system_config where key = 'single_tenant_mode'), 'false') = 'true' then
    new.organisation_id := '00000000-0000-0000-0000-000000000001'::uuid;
  else
    raise exception 'Import refused: organisation_id is null, tp.import_org is not set and single_tenant_mode is off' using errcode = 'PT409';
  end if;
  return new;
end
$fn$;

-- VERIFY (run in ONE rolled-back call; replace nothing - the org is looked up):
--   begin;
--   -- 1) setting -> that org
--   select set_config('tp.import_org', (select id::text from organisations where id <> '00000000-0000-0000-0000-000000000001' limit 1), true);
--   insert into suppliers (supplier_name) values ('zz-verify-1') returning organisation_id;   -- = the demo org
--   -- 2) flag true, no setting -> Company A
--   select set_config('tp.import_org','',true);
--   insert into suppliers (supplier_name) values ('zz-verify-2') returning organisation_id;   -- 00000000-...-0001
--   -- 3) flag false, no setting -> refused PT409
--   update system_config set value='false' where key='single_tenant_mode';
--   insert into suppliers (supplier_name) values ('zz-verify-3');                              -- ERROR PT409
--   rollback;
--   (run step 3 as its own call inside begin/rollback, since the error aborts the txn)
--   select value from system_config where key='single_tenant_mode';                   -- 'true' after rollback
-- ROLLBACK (restore V290 body):
--   create or replace function public.stamp_import_default_org() returns trigger language plpgsql set search_path to 'public' as
--   $b$ begin if new.organisation_id is null then new.organisation_id := '00000000-0000-0000-0000-000000000001'::uuid; end if; return new; end; $b$;
--   delete from system_config where key='single_tenant_mode';
