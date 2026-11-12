// Base PGlite harness for the commercial-readiness (COM-*) tests: roles, auth stubs, the
// organisations and profiles tables, and the identity helpers.
//
// This is a COPY of supabase/tests/fixtures/tenant_isolation_harness.mjs as drafted on branch
// claude/tenant-security-drafts-7rxp2t (commit 2615e927), minus its TEN-only function loader, so
// the COM suites run on a branch that does not carry the TEN drafts. If both land on one branch,
// import the tenant isolation harness instead and remove this file.
//
// FAITHFUL to production (project jhssdmeruxtrlqnwfksc, read 2026-11-12): app_current_org,
// get_my_role, app_role, is_super_admin, app_is_elevated, app_is_org_admin, app_can_admin_delete,
// _stg_pick (bodies copied from pg_proc.prosrc and checked by md5 in createDb).
// STUBS: auth.uid() reads a session setting instead of a JWT; auth.jwt() is empty; app_is_active(),
// _console_ip_allowed(), erp_parse_ts(), erp_is_footer(), _to_num(); tables carry only the columns
// the code under test touches; the anum_integration reader policies are not reproduced.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export const ORG_A = '00000000-0000-0000-0000-000000000001';
export const ORG_B = '00000000-0000-0000-0000-0000000000b2';

// Company A today: two super admins, no plain Admin. adminA is the hypothetical plain Admin.
export const USERS = {
  superA: '10000000-0000-0000-0000-00000000000a',
  adminA: '10000000-0000-0000-0000-00000000000b',
  mgrA: '10000000-0000-0000-0000-00000000000c',
  userA: '10000000-0000-0000-0000-00000000000d',
  adminB: '20000000-0000-0000-0000-00000000000a',
  mgrB: '20000000-0000-0000-0000-00000000000b',
};

// md5(prosrc) recorded from production on 2026-11-12.
export const LIVE_MD5 = {
  app_current_org: '84e2704f98ec5ec6f1473730843f7f6c',
  get_my_role: 'f26afe2459e18072956c83f822fc9f56',
  app_role: 'c635907cdc85eff5c3293a327f933cf0',
  is_super_admin: '7d44af76febf4e87cec124a4e875543a',
  app_is_elevated: '79227e099c169432aceea0ef85e78223',
  app_can_admin_delete: '853946a8f1f0ee6a1a680aad1489b590',
  _stg_pick: 'a561f6dda96a4b2a4a22fa279a76d146',
  guard_profile_privileged_cols: '81bbdac0b4c6b5a74879fb1cc6b1e744',
  admin_set_user_sites: 'ea3b45ce5a55ccaf3d47fa9e27c85180',
  admin_set_web_access: 'bbb210fd526c31eb9fdaa7519f9680d1',
  guard_organisation_configuration: 'f287c8a7c2b3a02a53dedd36368b04df',
  ensure_org_subscription: '59ceffe8549993ff41d78ed752161399',
  stamp_import_default_org: '5658ed8d74db306492c2122ef035e551',
  process_stg_job_cards: 'dfca52a9c6fd9ee4a70a20795c1204b2',
};

const CRLF = '\r\n';

const BASE_SQL = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema anum_integration;
  grant usage on schema auth, anum_integration to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create function auth.role() returns text language sql stable as
    $$ select case when auth.uid() is null then 'anon' else 'authenticated' end $$;
  create table auth.mfa_factors (user_id uuid, status text);
  grant select on auth.mfa_factors to authenticated;
  create function anum_integration.is_reader() returns boolean language sql stable as $$ select false $$;
  create function anum_integration.apply_reader_policies() returns void language sql as $$ select $$;

  create table public.organisations (
    id uuid primary key default gen_random_uuid(), name text not null, slug text not null,
    plan text default 'starter', active boolean default true, locked boolean default false,
    max_users integer default 100, parent_organisation_id uuid, settings jsonb default '{}'::jsonb,
    updated_at timestamptz default now());
  insert into public.organisations (id, name, slug) values
    ('${ORG_A}', 'Company A', 'company-a'), ('${ORG_B}', 'Tenant B', 'tenant-b');

  create table public.system_config (key text primary key, value text);
  insert into public.system_config values ('single_tenant_mode', 'true');

  create table public.profiles (
    id uuid primary key, org_id uuid default '${ORG_A}'::uuid, organisation_id uuid,
    role text default 'Reporter', approved boolean default true, locked boolean default false,
    is_super_admin boolean default false, country text[], site text, sites text[], countries text[],
    web_access boolean not null default true, module_overrides jsonb, employee_id text, email text,
    username text, full_name text);
  insert into public.profiles (id, org_id, organisation_id, role, is_super_admin, sites) values
    ('${USERS.superA}', '${ORG_A}', '${ORG_A}', 'Admin', true, '{ALL}'),
    ('${USERS.adminA}', '${ORG_A}', '${ORG_A}', 'Admin', false, '{ALL}'),
    ('${USERS.mgrA}', '${ORG_A}', '${ORG_A}', 'Manager', false, '{NHC}'),
    ('${USERS.userA}', '${ORG_A}', '${ORG_A}', 'Reporter', false, '{NHC}'),
    ('${USERS.adminB}', '${ORG_B}', '${ORG_B}', 'Admin', false, '{ALL}'),
    ('${USERS.mgrB}', '${ORG_B}', '${ORG_B}', 'Manager', false, '{ALL}');

  create function public.app_current_org() returns uuid language sql stable security definer set search_path to 'public' as
  $f$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$f$;
  create function public.get_my_role() returns text language sql stable security definer set search_path to 'public' as
  $f$
  SELECT role
    FROM public.profiles
   WHERE id     = auth.uid()
     AND locked = false
     AND (approved IS NULL OR approved = true)
   LIMIT 1;
$f$;
  create function public.app_role() returns text language sql stable security definer set search_path to 'public' as
  $f$${CRLF}  select lower(replace(coalesce(role, 'reporter'), ' ', '_'))${CRLF}  from public.profiles${CRLF}  where id = auth.uid()${CRLF}$f$;
  create function public.is_super_admin() returns boolean language sql stable security definer set search_path to 'public' as
  $f$
  select coalesce((select p.is_super_admin from public.profiles p
                   where p.id = auth.uid() and p.locked = false), false)
     and (
       coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
       or not exists (select 1 from auth.mfa_factors f
                      where f.user_id = auth.uid() and f.status = 'verified')
     );
$f$;
  create function public.app_is_elevated() returns boolean language sql stable security definer set search_path to 'public' as
  $f$${CRLF}  select public.app_role() in ('admin', 'manager', 'director')${CRLF}$f$;
  create function public.app_is_org_admin() returns boolean language sql stable security definer set search_path to 'public' as
  $f$
  SELECT public.is_super_admin() OR public.app_role() = 'admin';
$f$;
  create function public.app_can_admin_delete() returns boolean language sql stable security definer set search_path to 'public' as
  $f$
  select coalesce((
    select p.is_super_admin is true or lower(btrim(coalesce(p.role, ''))) = 'admin'
    from public.profiles p
    where p.id = auth.uid()
      and p.locked is false
      and coalesce(p.approved, true) is true
    limit 1
  ), false);
$f$;
  create function public._stg_pick(p_row jsonb, p_key text) returns text language sql immutable set search_path to 'public' as
  $f$
  select nullif(btrim(kv.value), '')
    from jsonb_each_text(p_row) as kv(key, value)
   where lower(btrim(regexp_replace(replace(kv.key, chr(160), ' '), '\\s+', ' ', 'g')))
       = lower(btrim(regexp_replace(replace(p_key,  chr(160), ' '), '\\s+', ' ', 'g')))
     and nullif(btrim(kv.value), '') is not null
   limit 1;
$f$;
  -- STUBS (not the production bodies).
  create function public.app_is_active() returns boolean language sql stable security definer set search_path to 'public' as
    $$ select coalesce((select not p.locked and coalesce(p.approved, true) from public.profiles p where p.id = auth.uid()), false) $$;
  create function public._console_ip_allowed() returns boolean language sql stable as $$ select true $$;
  create function public.erp_parse_ts(t text) returns timestamptz language sql immutable as $$ select nullif(btrim(t), '')::timestamptz $$;
  create function public.erp_is_footer(t text) returns boolean language sql immutable as $$ select t ilike '%grand total%' $$;
  create function public._to_num(t text) returns numeric language sql immutable as $$ select nullif(regexp_replace(coalesce(t, ''), '[^0-9.\\-]', '', 'g'), '')::numeric $$;
  grant usage on schema public to anon, authenticated, service_role;
`;

export async function pendingMigration(file) {
  return readFile(new URL(`../../pending_migrations/${file}`, import.meta.url), 'utf8');
}

export async function createDb() {
  const db = new PGlite();
  await db.exec(BASE_SQL);
  await assertLiveMd5(db, ['app_current_org', 'get_my_role', 'app_role', 'is_super_admin',
    'app_is_elevated', 'app_can_admin_delete', '_stg_pick']);
  return db;
}

/** Fail unless each named function's body is byte-identical to production's (by md5). */
export async function assertLiveMd5(db, names) {
  for (const name of names) {
    const { rows } = await db.query(
      "select md5(prosrc) m from pg_proc where pronamespace = 'public'::regnamespace and proname = $1", [name]);
    assert.equal(rows.length, 1, `${name} must exist exactly once`);
    assert.equal(rows[0].m, LIVE_MD5[name], `${name} is not a faithful copy of the live function`);
  }
}

/** Run fn as an authenticated user (RLS applies), then return to the privileged role. */
export async function asUser(db, uid, fn) {
  await db.exec('reset role');
  await db.query("select set_config('test.uid', $1, false)", [uid ?? '']);
  await db.exec('set role authenticated');
  try { return await fn(); } finally {
    await db.exec('reset role');
    await db.query("select set_config('test.uid', '', false)");
  }
}

/** Run fn as service_role (no profile, RLS bypassed), like the webhook or a backend job. */
export async function asService(db, fn) {
  await db.exec('reset role');
  await db.query("select set_config('test.uid', '', false)");
  await db.exec('set role service_role');
  try { return await fn(); } finally { await db.exec('reset role'); }
}

export const code = (c) => (e) => e.code === c;

/** Rows written by an UPDATE/DELETE: a blocked write under RLS returns 0 rows, it does not raise. */
export async function written(db, sql, params = []) {
  return (await db.query(`with w as (${sql} returning 1) select count(*)::int n from w`, params)).rows[0].n;
}
