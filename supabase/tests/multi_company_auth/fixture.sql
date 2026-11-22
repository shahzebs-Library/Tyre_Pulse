-- Multi-company sign-in / invitation staging fixture. LOCAL staging copy only.
-- Adds a tiny assertion helper schema and synthetic field accounts. Every test
-- file runs inside a transaction that is rolled back, so this fixture is the
-- only thing that persists in the copy.

create schema if not exists tt;
grant usage on schema tt to authenticated, anon;

-- 'ok - name' / 'not ok - name | detail'. A NULL condition is a failure.
create or replace function tt.ok(p_name text, p_cond boolean, p_detail text default '')
returns text language sql immutable as $$
  select case when p_cond is true then 'ok - ' || p_name
              else 'not ok - ' || p_name || ' | ' || coalesce(p_detail, 'null') end
$$;

-- Run one statement as the CURRENT role and report 'OK' or 'SQLSTATE: message'.
create or replace function tt.try(p_sql text)
returns text language plpgsql security invoker as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- The old (pre TEN-9b) lookup: exact username, then exact employee id,
-- case-insensitive, first match. This is what get_email_by_identifier and the
-- sign-in edge function did before the resolver existed.
create or replace function tt.legacy_lookup(p_identifier text)
returns uuid language sql stable as $$
  select coalesce(
    (select p.id from public.profiles p where lower(p.username) = lower(btrim(p_identifier)) limit 1),
    (select p.id from public.profiles p where lower(p.employee_id) = lower(btrim(p_identifier)) limit 1))
$$;

grant execute on all functions in schema tt to authenticated, anon;

-- Field accounts with made-up sign-in addresses (the only kind
-- get_email_by_identifier ever hands out). Created through the real
-- auth.users trigger chain (handle_new_user -> _signup_context).
insert into auth.users (id, email, raw_user_meta_data)
values ('a1111111-0000-4000-8000-000000000001', 'field.ali@users.tyrepulse.app',
        '{"username":"field.ali","employee_id":"GC-7001","full_name":"Ali Field"}'::jsonb)
on conflict (id) do nothing;

alter table public.profiles disable trigger trg_guard_profile_privileged;
update public.profiles set approved = true where id = 'a1111111-0000-4000-8000-000000000001';
alter table public.profiles enable trigger trg_guard_profile_privileged;

-- Simulate a GoTrue sign-up (insert into auth.users, runs handle_new_user).
-- 'ACCEPTED:<org>:<role>' when the account landed approved in a company,
-- 'ORPHAN' when an account was created with no company and no approval,
-- 'REFUSED:<sqlstate>' when the sign-up was aborted (no account at all).
create or replace function tt.signup(p_id uuid, p_email text, p_meta jsonb)
returns text language plpgsql security invoker as $$
declare r public.profiles%rowtype;
begin
  begin
    insert into auth.users(id, email, raw_user_meta_data) values (p_id, p_email, p_meta);
  exception when others then
    return 'REFUSED:' || sqlstate;
  end;
  select * into r from public.profiles where id = p_id;
  if r.org_id is not null and r.approved then return 'ACCEPTED:' || r.org_id || ':' || r.role; end if;
  return 'ORPHAN';
end $$;
