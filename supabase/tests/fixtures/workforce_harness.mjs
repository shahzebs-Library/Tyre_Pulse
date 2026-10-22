// Shared PGlite harness for the workforce assignment tests.
// Applies the REAL workforce migrations (daily work, assignments, evidence, execution,
// manager permissions, transition guard, transitions + estimation) over minimal stubs of the
// Supabase platform pieces they depend on (auth.uid, profiles, org/role helpers, storage).
// The stubs mirror production semantics: app_current_org() is the caller's profile org,
// app_is_org_admin() is Admin or super admin, get_my_role() is profiles.role.
// Not applied here: 20261022112000 / 124500 (notification + push triggers), 120000 (planning).
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

export const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
export const ORG_A = id(900)
export const ORG_B = id(901)
export const U = {
  employee: id(1), employee2: id(2), supervisor: id(3), manager: id(4), director: id(5), admin: id(6),
  employeeB: id(7), managerB: id(8),
}

const MIGRATIONS = [
  '20261022093000_workforce_daily_work.sql',
  '20261022095000_workforce_assignments.sql',
  '20261022104000_workforce_evidence.sql',
  '20261022111000_workforce_assignment_execution.sql',
  '20261022112500_workforce_manager_permissions.sql',
  '20261022113000_workforce_transition_guard.sql',
  '20261023090000_workforce_transitions_and_estimation.sql',
]
export const migrationSql = Object.fromEntries(MIGRATIONS.map(f =>
  [f, readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8')]))

export async function createWorkforceDb () {
  const db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles(id uuid primary key, organisation_id uuid, employee_id text, full_name text,
      role text, is_super_admin boolean default false, approved boolean default true, locked boolean default false);
    create function public.app_current_org() returns uuid language sql stable security definer set search_path=public as $$
      select organisation_id from public.profiles where id = auth.uid() $$;
    create function public.is_super_admin() returns boolean language sql stable security definer set search_path=public as $$
      select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false) $$;
    create function public.get_my_role() returns text language sql stable security definer set search_path=public as $$
      select role from public.profiles where id = auth.uid() $$;
    create function public.app_is_org_admin() returns boolean language sql stable security definer set search_path=public as $$
      select public.is_super_admin() or lower(coalesce(public.get_my_role(), '')) = 'admin' $$;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:cardinality(string_to_array(name, '/')) - 1] $$;
    grant usage on schema public, auth, storage to authenticated;
    grant select on public.profiles to authenticated;
    grant select, insert, delete on storage.objects to authenticated;
    grant select on storage.buckets to authenticated;
    insert into public.profiles(id, organisation_id, employee_id, full_name, role, is_super_admin) values
      ('${U.employee}', '${ORG_A}', 'E-001', 'Emp One', 'Tyre Man', false),
      ('${U.employee2}', '${ORG_A}', 'E-002', 'Emp Two', 'Tyre Man', false),
      ('${U.supervisor}', '${ORG_A}', 'E-003', 'Sam Supervisor', 'Workshop Supervisor', false),
      ('${U.manager}', '${ORG_A}', 'E-004', 'Mia Manager', 'Manager', false),
      ('${U.director}', '${ORG_A}', 'E-005', 'Dee Director', 'Director', false),
      ('${U.admin}', '${ORG_A}', 'E-006', 'Ada Admin', 'Admin', false),
      ('${U.employeeB}', '${ORG_B}', 'B-001', 'Other Org Emp', 'Tyre Man', false),
      ('${U.managerB}', '${ORG_B}', 'B-002', 'Other Org Mgr', 'Manager', false);
  `)
  for (const f of MIGRATIONS) await db.exec(migrationSql[f])
  return db
}

/** Run fn as `uid` under the authenticated role (RLS applies). */
export async function asClient (db, uid, fn) {
  await db.exec(`set test.uid = '${uid}'; set role authenticated`)
  try { return await fn() } finally { await db.exec('reset role; reset test.uid') }
}

/** Run fn as a privileged session impersonating `uid` (RLS bypassed; auth.uid() still set). */
export async function asUser (db, uid, fn) {
  await db.exec(`set test.uid = '${uid}'`)
  try { return await fn() } finally { await db.exec('reset test.uid') }
}

export async function createAssignment (db, uid, over = {}) {
  const v = { title: 'Replace tyre', assigned_to: U.employee, ...over }
  return asClient(db, uid, async () => (await db.query(
    `insert into public.workforce_assignments(title, assigned_to, assigned_by, task_type, vehicle_type, created_at)
     values ($1, $2, auth.uid(), $3, $4, coalesce($5::timestamptz, now())) returning id`,
    [v.title, v.assigned_to, v.task_type ?? null, v.vehicle_type ?? null, v.created_at ?? null])).rows[0].id)
}

let keySeq = 0
export const newKey = () => `test-key-${String(++keySeq).padStart(8, '0')}`

export async function transition (db, uid, assignmentId, action, { key = newKey(), note = null, clientAt = null } = {}) {
  return asClient(db, uid, async () => (await db.query(
    'select public.workforce_assignment_transition($1, $2, $3, $4, $5) r',
    [assignmentId, action, key, note, clientAt])).rows[0].r)
}
