import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// PGlite harness for supabase/migrations/20261007130000_workshop_status_removed_recovery.sql,
// applied on top of Loops 1, 2, 6 and 8. The permission stubs are real logic over stub tables
// (copied from the earlier harnesses), so the writer goes through
// workshop_status_can() exactly as in production.

const read = f => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const FOUNDATION = read('20261007090000_workshop_status_foundation.sql')
const PERMISSIONS = read('20261007100000_workshop_status_permissions.sql')
const CONFIRM = read('20261007110000_workshop_status_upload_confirm.sql')
const MANUAL = read('20261007120000_workshop_status_manual_update.sql')
const RECOVERY = read('20261007130000_workshop_status_removed_recovery.sql')

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const org = id(900)
const otherOrg = id(901)
const U = {
  ground: id(1), supervisor: id(2), admin: id(3), reporter: id(4),
  pending: id(5), outsider: id(6), helper: id(7), manager: id(8), superAdmin: id(9),
}
const R = { tm1: id(301), tm2: id(302), foreign: id(303), removed: id(304), uae: id(305), removed2: id(306), dupActive: id(307), oldEpisode: id(308) }

const db = new PGlite()
const isCode = code => e => e?.code === code
const hasMsg = text => e => String(e?.message || '').includes(text)

async function asUser (uid, fn) {
  await db.exec(`set test.uid = '${uid}'`)
  try { return await fn() } finally { await db.exec('reset test.uid') }
}
const count = async (sql, params = []) => (await db.query(sql, params)).rows[0].n
const rec = async rid => (await db.query('select * from workshop_status_records where id = $1', [rid])).rows[0]
const events = async (rid, type) => (await db.query(
  'select * from workshop_status_events where record_id = $1 and event_type = $2 order by created_at, id',
  [rid, type])).rows

before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles(id uuid primary key, full_name text, username text, role text,
      organisation_id uuid, is_super_admin boolean default false, approved boolean default true,
      locked boolean default false);
    create function public.app_current_org() returns uuid language sql stable as $$ select '${org}'::uuid $$;
    create function public.app_is_active() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.profiles where id = auth.uid()
                      and coalesce(approved, true) and not coalesce(locked, false)) $$;
    create function public.is_super_admin() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.profiles where id = auth.uid()
                      and coalesce(is_super_admin, false) and not coalesce(locked, false)) $$;
    -- Country / site scope driven by test settings (default: sees everything).
    create function public.app_sees_all_countries() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.cscope', true), ''), '*') = '*' $$;
    create function public.app_country_scope() returns text[] language sql stable as $$
      select string_to_array(nullif(current_setting('test.cscope', true), ''), ',') $$;
    create function public.app_sees_all_sites() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.sscope', true), ''), '*') = '*' $$;
    create function public.app_site_scope() returns text[] language sql stable as $$
      select string_to_array(nullif(current_setting('test.sscope', true), ''), ',') $$;
    create function public.normalize_asset_no() returns trigger language plpgsql as $$
    begin
      if NEW.asset_no is not null then NEW.asset_no := upper(regexp_replace(NEW.asset_no, '\\s', '', 'g')); end if;
      return NEW;
    end $$;
    create function public.normalize_site() returns trigger language plpgsql as $$
    begin
      if NEW.site is not null then NEW.site := regexp_replace(upper(btrim(NEW.site)), '[-_]ST$', ''); end if;
      return NEW;
    end $$;
    create table public.module_permissions(role text, module_key text, enabled boolean, org_id uuid,
      updated_at timestamptz default now());
    create table public.user_access_grants(user_id uuid, module_key text, capability text default 'view',
      effect text, expires_at timestamptz);
    create function public.app_user_can(p_key text, p_cap text) returns boolean
    language plpgsql stable security definer set search_path = public as $$
    declare v_uid uuid := auth.uid(); v_role text; v_super boolean := false;
      v_cap text := coalesce(nullif(btrim(p_cap), ''), 'view'); v_default boolean := false;
    begin
      if v_uid is null then return false; end if;
      select role, coalesce(is_super_admin, false) into v_role, v_super from public.profiles
       where id = v_uid and coalesce(approved, true) = true and coalesce(locked, false) = false;
      if not found then return false; end if;
      if v_super is true or v_role = 'Admin' then return true; end if;
      if v_cap = 'delete' then return false; end if;
      if v_cap = 'view' then
        v_default := coalesce((select enabled from public.module_permissions
          where org_id is null and role = v_role and module_key = p_key
          order by updated_at desc nulls last limit 1), false);
      end if;
      if exists (select 1 from public.user_access_grants g where g.user_id = v_uid and g.module_key = p_key
                 and g.capability = v_cap and g.effect = 'revoke'
                 and (g.expires_at is null or g.expires_at > now())) then return false; end if;
      if v_default then return true; end if;
      return exists (select 1 from public.user_access_grants g where g.user_id = v_uid and g.module_key = p_key
                 and g.capability = v_cap and g.effect = 'grant'
                 and (g.expires_at is null or g.expires_at > now()));
    end $$;
    create table public.vehicle_fleet(id uuid primary key, organisation_id uuid, country text, asset_no text);
    create table public.asset_breakdowns(id uuid primary key, organisation_id uuid, country text,
      asset_no text, returned_to_service boolean);
    insert into public.profiles (id, full_name, role, organisation_id, approved) values
      ('${U.ground}', 'Ground Mechanic', 'Mechanic', '${org}', true),
      ('${U.supervisor}', 'Sajid Kamboh', 'Workshop Supervisor', '${org}', true),
      ('${U.admin}', 'Addie', 'Admin', '${org}', true),
      ('${U.reporter}', 'Reggie', 'Reporter', '${org}', true),
      ('${U.pending}', 'Pending Person', 'Mechanic', '${org}', false),
      ('${U.outsider}', 'Outside Org', 'Mechanic', '${otherOrg}', true),
      ('${U.helper}', 'Helper Tech', 'Electrician', '${org}', true),
      ('${U.manager}', 'Mona Manager', 'Manager', '${org}', true);
    insert into public.profiles (id, full_name, role, organisation_id, approved, is_super_admin) values
      ('${U.superAdmin}', 'Super Sam', 'Admin', '${org}', true, true);
    grant usage on schema public, auth to authenticated;
  `)
  await db.exec(FOUNDATION)
  await db.exec(PERMISSIONS)
  await db.exec(CONFIRM)
  await db.exec(MANUAL)
  await db.exec(RECOVERY)
  // Seed records as an Excel upload would have (source excel, no actor).
  await db.exec(`
    select set_config('workshop.source', 'excel', false);
    insert into workshop_status_records (id, organisation_id, country, asset_no, site, complaint) values
      ('${R.tm1}', '${org}', 'KSA', 'TM1', 'NHC', 'Gearbox noise'),
      ('${R.tm2}', '${org}', 'KSA', 'TM2', 'JED', 'Brakes'),
      ('${R.foreign}', '${otherOrg}', 'KSA', 'TM9', 'NHC', 'Other org'),
      ('${R.removed}', '${org}', 'KSA', 'TM3', 'NHC', 'Released'),
      ('${R.removed2}', '${org}', 'KSA', 'TM4', 'JED', 'Released two'),
      ('${R.oldEpisode}', '${org}', 'KSA', 'TM5', 'NHC', 'Old episode');
    insert into workshop_status_records (id, organisation_id, country, asset_no, site, complaint) values
      ('${R.uae}', '${org}', 'UAE', 'TM1', 'DXB', 'UAE machine');
    update workshop_status_records set current_active = false, daily_report_status = 'removed_from_current_report'
     where id in ('${R.removed}', '${R.removed2}', '${R.oldEpisode}');
    update workshop_status_records set removed_at = now(), removed_reason = 'missing_from_upload'
     where id = '${R.removed}';
    insert into workshop_status_records (id, organisation_id, country, asset_no, site, complaint) values
      ('${R.dupActive}', '${org}', 'KSA', 'TM5', 'NHC', 'New episode');
    select set_config('workshop.source', '', false);
  `)
})


after(async () => { await db.close() })

const act = (uid, recordId, action, opts = {}) => asUser(uid, async () => (await db.query(
  'select public.workshop_status_record_action($1, $2, $3, $4, $5, $6) r',
  [recordId, action, opts.reason ?? null, opts.disposition ?? null, opts.remarks ?? null, opts.expected ?? null])).rows[0].r)

test('unknown action and missing permission are refused; nothing written', async () => {
  const before = await count('select count(*)::int n from workshop_status_events')
  await assert.rejects(act(U.supervisor, R.removed, 'explode', { reason: 'because' }), isCode('22023'))
  await assert.rejects(act(U.reporter, R.removed, 'restore', { reason: 'by mistake' }), isCode('42501'))
  await assert.rejects(act(U.ground, R.removed, 'disposition', { disposition: 'repair_completed' }), isCode('42501'))
  await assert.rejects(act(U.supervisor, R.removed, 'archive', { reason: 'old record' }), isCode('42501'))
  await assert.rejects(act(U.manager, R.removed, 'soft_delete', { reason: 'duplicate' }), isCode('42501'))
  await assert.rejects(act(U.admin, R.removed, 'permanent_delete', { reason: 'erase it' }), isCode('42501'))
  assert.equal(await count('select count(*)::int n from workshop_status_events'), before)
})

test('active, foreign and out-of-scope records are not handled here', async () => {
  await assert.rejects(act(U.supervisor, R.tm1, 'disposition', { disposition: 'repair_completed' }), hasMsg('still in the active report'))
  await assert.rejects(act(U.supervisor, R.foreign, 'restore', { reason: 'by mistake' }), isCode('P0002'))
  await db.exec("set test.sscope = 'JED'")
  try {
    await assert.rejects(act(U.supervisor, R.removed, 'disposition', { disposition: 'repair_completed' }), isCode('P0002'))
  } finally { await db.exec('reset test.sscope') }
})

test('disposition: validated, stamped from auth uid, event written', async () => {
  await assert.rejects(act(U.supervisor, R.removed, 'disposition', { disposition: 'teleported' }), isCode('22023'))
  await assert.rejects(act(U.supervisor, R.removed, 'disposition', { disposition: 'other' }), hasMsg('Remarks are required'))
  const res = await act(U.supervisor, R.removed, 'disposition', { disposition: 'repair_completed', remarks: ' Done ' })
  assert.equal(res.changed, 1)
  const r = await rec(R.removed)
  assert.equal(r.final_disposition, 'repair_completed')
  assert.equal(r.final_disposition_remarks, 'Done')
  assert.equal(r.final_disposition_by, U.supervisor)
  assert.equal(r.final_disposition_by_name, 'Sajid Kamboh')
  assert.ok(r.final_disposition_at)
  const ev = await events(R.removed, 'final_disposition')
  assert.equal(ev.length, 1)
  assert.equal(ev[0].actor_id, U.supervisor)
  assert.equal(ev[0].details.disposition, 'repair_completed')
  const again = await act(U.supervisor, R.removed, 'disposition', { disposition: 'repair_completed', remarks: 'Done' })
  assert.equal(again.changed, 0, 'no-op writes nothing')
  assert.equal((await events(R.removed, 'final_disposition')).length, 1)
})

test('restore: reason required, stale write refused, removal kept, restored event written', async () => {
  await assert.rejects(act(U.supervisor, R.removed, 'restore'), hasMsg('Enter a reason'))
  await assert.rejects(act(U.supervisor, R.removed, 'restore', { reason: 'no' }), hasMsg('Enter a reason'))
  await assert.rejects(act(U.supervisor, R.removed, 'restore',
    { reason: 'Vehicle was omitted from Excel by mistake.', expected: '2000-01-01T00:00:00Z' }), isCode('PT409'))
  const removedBefore = await events(R.removed, 'removed')
  const res = await act(U.supervisor, R.removed, 'restore', { reason: 'Vehicle was omitted from Excel by mistake.' })
  assert.equal(res.ok, true)
  const r = await rec(R.removed)
  assert.equal(r.current_active, true)
  assert.equal(r.daily_report_status, 'restored')
  assert.equal(r.final_disposition, null, 'disposition cleared on restore')
  assert.ok(r.removed_at, 'last removal kept on the record')
  assert.equal(r.removed_reason, 'missing_from_upload')
  assert.equal((await events(R.removed, 'removed')).length, removedBefore.length, 'removal event not erased')
  const ev = await events(R.removed, 'restored')
  assert.equal(ev.length, 1)
  assert.equal(ev[0].reason, 'Vehicle was omitted from Excel by mistake.')
  assert.equal(ev[0].actor_id, U.supervisor)
  assert.equal(ev[0].details.removed_reason, 'missing_from_upload')
  assert.equal(ev[0].details.cleared_disposition, 'repair_completed')
})

test('restore refused when the vehicle already has an active record', async () => {
  await assert.rejects(act(U.manager, R.oldEpisode, 'restore', { reason: 'Omitted by mistake' }), isCode('23505'))
  assert.equal((await rec(R.oldEpisode)).current_active, false)
})

test('archive and unarchive (manager); restore of an archived record refused', async () => {
  await act(U.manager, R.removed2, 'archive', { reason: 'Closed long ago' })
  let r = await rec(R.removed2)
  assert.ok(r.archived_at)
  assert.equal(r.archived_by, U.manager)
  assert.equal(r.archive_reason, 'Closed long ago')
  assert.equal(r.daily_report_status, 'archived')
  await assert.rejects(act(U.manager, R.removed2, 'restore', { reason: 'Omitted by mistake' }), hasMsg('Unarchive it first'))
  await assert.rejects(act(U.manager, R.removed2, 'archive', { reason: 'again please' }), hasMsg('Unarchive it first'))
  await act(U.manager, R.removed2, 'unarchive', { reason: 'Needed again' })
  r = await rec(R.removed2)
  assert.equal(r.archived_at, null)
  assert.equal(r.daily_report_status, 'removed_from_current_report')
  assert.equal((await events(R.removed2, 'archived')).length, 1)
  assert.equal((await events(R.removed2, 'unarchived')).length, 1)
})

test('soft delete, undelete and permanent delete (super admin only, deleted records only)', async () => {
  await assert.rejects(act(U.superAdmin, R.removed2, 'permanent_delete', { reason: 'Erase this one' }), hasMsg('not deleted'))
  await act(U.admin, R.removed2, 'soft_delete', { reason: 'Duplicate entry' })
  let r = await rec(R.removed2)
  assert.ok(r.deleted_at)
  assert.equal(r.deleted_by, U.admin)
  await assert.rejects(act(U.admin, R.removed2, 'disposition', { disposition: 'wrong_entry' }), hasMsg('Undelete it first'))
  await act(U.admin, R.removed2, 'undelete', { reason: 'Not a duplicate' })
  assert.equal((await rec(R.removed2)).deleted_at, null)
  await act(U.admin, R.removed2, 'soft_delete', { reason: 'Duplicate entry' })
  await assert.rejects(act(U.admin, R.removed2, 'permanent_delete', { reason: 'Erase this one' }), isCode('42501'))
  const res = await act(U.superAdmin, R.removed2, 'permanent_delete', { reason: 'Erase this one' })
  assert.equal(res.deleted, true)
  assert.equal(await rec(R.removed2), undefined)
  const gone = await events(R.removed2, 'permanently_deleted')
  assert.equal(gone.length, 1)
  assert.equal(gone[0].reason, 'Erase this one')
  assert.equal(gone[0].details.record.asset_no, 'TM4')
  assert.equal((await events(R.removed2, 'soft_deleted')).length, 2, 'history survives the erase')
})

test('anon cannot execute the writer', async () => {
  const r = await db.query(`select has_function_privilege('anon',
    'public.workshop_status_record_action(uuid, text, text, text, text, timestamptz)', 'execute') a`)
  assert.equal(r.rows[0].a, false)
})
