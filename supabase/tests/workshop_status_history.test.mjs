import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { groupHistory, formatValue } from '../../src/lib/workshopStatus/history.js'

// PGlite harness for the Loop 9 vehicle history (spec section 14). No new
// migration: the history is a plain RLS-scoped read of the append-only
// workshop_status_events table. This proves, on the four real migrations:
//   - who can read which record's history (org / country / site / removed),
//   - that nobody (authenticated, the actor, a super admin, or the table
//     owner) can UPDATE, DELETE or TRUNCATE an event,
//   - that a manual save then an upload confirm come back as two ordered
//     actions with the right old and new values.
// Stubs copied from workshop_status_manual_update.test.mjs.

const read = f => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const FOUNDATION = read('20261007090000_workshop_status_foundation.sql')
const PERMISSIONS = read('20261007100000_workshop_status_permissions.sql')
const CONFIRM = read('20261007110000_workshop_status_upload_confirm.sql')
const MANUAL = read('20261007120000_workshop_status_manual_update.sql')

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const org = id(900)
const otherOrg = id(901)
const U = { ground: id(1), supervisor: id(2), admin: id(3), helper: id(7), superAdmin: id(8) }
const R = { tm1: id(301), tm2: id(302), foreign: id(303), removed: id(304), uae: id(305) }

const db = new PGlite()
const isCode = code => e => e?.code === code
const hasMsg = text => e => String(e?.message || '').includes(text)

async function asUser (uid, fn) {
  await db.exec(`set test.uid = '${uid}'`)
  try { return await fn() } finally { await db.exec('reset test.uid') }
}
// A PostgREST-like client: role authenticated, RLS and grants apply.
async function asClient (uid, fn) {
  await db.exec(`set test.uid = '${uid}'; set role authenticated`)
  try { return await fn() } finally { await db.exec('reset role; reset test.uid') }
}
const historyOf = (uid, rid) => asClient(uid, async () => (await db.query(
  `select * from workshop_status_events where record_id = $1 order by created_at desc, id desc`, [rid])).rows)

let rowNo = 0
const baseData = (asset, extra = {}) => ({
  asset_no: asset, reg_no: null, job_card_ref: null, vehicle_category: null, site: 'NHC', department: null,
  complaint: `Complaint ${asset}`, diagnostics: null, ooc_since: null, excel_down_days: 3,
  excel_expected_release: null, excel_status_note: null, source_remarks: null, ...extra,
})
const row = (asset, outcome, extra = {}) => ({
  row_number: ++rowNo, section: 'TRANSIT MIXER', asset_no: asset, site: extra.site || 'NHC', outcome,
  data: baseData(asset, extra), raw: { 'ASSET NO.': asset }, changes: {}, errors: [], record_id: null,
})
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
      ('${U.helper}', 'Helper Tech', 'Electrician', '${org}', true);
    insert into public.profiles (id, full_name, role, organisation_id, approved, is_super_admin) values
      ('${U.superAdmin}', 'Owner', 'Admin', '${org}', true, true);
    grant usage on schema public, auth to authenticated;
  `)
  await db.exec(FOUNDATION)
  await db.exec(PERMISSIONS)
  await db.exec(CONFIRM)
  await db.exec(MANUAL)
  await db.exec(`
    select set_config('workshop.source', 'excel', false);
    insert into workshop_status_records (id, organisation_id, country, asset_no, site, complaint) values
      ('${R.tm1}', '${org}', 'KSA', 'TM1', 'NHC', 'Gearbox noise'),
      ('${R.tm2}', '${org}', 'KSA', 'TM2', 'JED', 'Brakes'),
      ('${R.foreign}', '${otherOrg}', 'KSA', 'TM9', 'NHC', 'Other org'),
      ('${R.removed}', '${org}', 'KSA', 'TM3', 'NHC', 'Released'),
      ('${R.uae}', '${org}', 'UAE', 'TM1', 'DXB', 'UAE machine');
    update workshop_status_records set current_active = false, daily_report_status = 'removed_from_current_report'
     where id = '${R.removed}';
    select set_config('workshop.source', '', false);
  `)
})

after(async () => { await db.close() })

test('a manual save then an upload confirm read back as two ordered actions with old and new values', async () => {
  const saved = await asUser(U.supervisor, async () => (await db.query(
    'select public.workshop_status_update_record($1, $2, null) r',
    [R.tm1, JSON.stringify({ current_stage: 'Waiting for Parts', responsible_user_id: U.helper, expected_release_date: '2026-10-20' })])).rows[0].r)
  assert.equal(saved.changed, 3)

  const st = await asUser(U.supervisor, async () => (await db.query(
    'select public.workshop_status_stage_upload($1, $2, $3, $4, $5, $6, $7, $8, $9) r',
    ['KSA', 'daily.xlsx', 'hash-H', 10, 'Sheet1', '2026-10-07', JSON.stringify({ 'ASSET NO.': 'asset_no' }), [],
      JSON.stringify([row('TM1', 'changed', { complaint: 'Gearbox replaced' }), row('TM2', 'unchanged', { site: 'JED', complaint: 'Brakes' })])])).rows[0].r)
  const conf = await asUser(U.supervisor, async () => (await db.query(
    'select public.workshop_status_confirm_upload($1, false) r', [st.upload_id])).rows[0].r)
  assert.ok(conf)

  const rows = await historyOf(U.ground, R.tm1)
  assert.ok(rows.length >= 6, `history rows: ${rows.length}`)
  const entries = groupHistory(rows)
  // Newest first: the upload, then the manual save, then the original add.
  assert.equal(entries[0].source, 'excel')
  assert.ok(entries[0].eventTypes.includes('excel_updated'))
  assert.equal(entries[0].uploadId, st.upload_id)
  const comp = entries[0].changes.find(c => c.field === 'complaint')
  assert.deepEqual(comp, { field: 'complaint', oldValue: 'Gearbox noise', newValue: 'Gearbox replaced' })
  assert.equal(entries[0].actorName, 'Sajid Kamboh')

  const manual = entries[1]
  assert.equal(manual.source, 'manual')
  assert.ok(manual.eventTypes.includes('manual_update'))
  assert.equal(manual.actorId, U.supervisor)
  assert.deepEqual(manual.changes.map(c => c.field), ['current_stage', 'responsible_user_id', 'expected_release_date'])
  assert.deepEqual(manual.categories, ['manual', 'assignment', 'eta'])
  const resp = manual.changes.find(c => c.field === 'responsible_user_id')
  assert.equal(resp.oldValue, null)
  assert.equal(resp.newValue, U.helper)
  assert.equal(formatValue('responsible_user_id', resp.newValue, { userNames: { [U.helper]: 'Helper Tech' } }), 'Helper Tech')

  const last = entries[entries.length - 1]
  assert.ok(last.eventTypes.includes('added'))
  assert.ok(Date.parse(entries[0].at) > Date.parse(manual.at) && Date.parse(manual.at) > Date.parse(last.at))
})

test('an ordinary user reads the history of a record they can see', async () => {
  const rows = await historyOf(U.ground, R.tm1)
  assert.ok(rows.length > 0)
  assert.ok(rows.every(r => r.record_id === R.tm1))
})

test('history outside the caller org, country or site is not readable', async () => {
  assert.equal((await historyOf(U.ground, R.foreign)).length, 0, 'other org')
  assert.equal((await historyOf(U.supervisor, R.foreign)).length, 0, 'other org, even with view_activity')
  await db.exec("set test.cscope = 'ksa'")
  try {
    assert.equal((await historyOf(U.ground, R.uae)).length, 0, 'other country')
    assert.ok((await historyOf(U.ground, R.tm1)).length > 0)
  } finally { await db.exec('reset test.cscope') }
  assert.ok((await historyOf(U.ground, R.uae)).length > 0, 'visible once the country is in scope')
  await db.exec("set test.sscope = 'JED'")
  try {
    assert.equal((await historyOf(U.ground, R.tm1)).length, 0, 'other site')
    assert.equal((await historyOf(U.supervisor, R.tm1)).length, 0, 'other site, even with view_activity')
  } finally { await db.exec('reset test.sscope') }
})

test('UPDATE, DELETE and TRUNCATE on events fail for authenticated users, the actor and a super admin', async () => {
  const evId = (await db.query(
    "select id from workshop_status_events where record_id = $1 and actor_id = $2 order by created_at limit 1",
    [R.tm1, U.supervisor])).rows[0].id
  const before = (await db.query('select count(*)::int n from workshop_status_events')).rows[0].n
  for (const uid of [U.ground, U.supervisor, U.admin, U.superAdmin]) {
    await assert.rejects(asClient(uid, () => db.query("update workshop_status_events set new_value = 'x' where id = $1", [evId])), isCode('42501'), `update ${uid}`)
    await assert.rejects(asClient(uid, () => db.query('delete from workshop_status_events where id = $1', [evId])), isCode('42501'), `delete ${uid}`)
    await assert.rejects(asClient(uid, () => db.query('truncate workshop_status_events')), isCode('42501'), `truncate ${uid}`)
  }
  // Even the table owner (service role) is stopped by the append-only trigger.
  await assert.rejects(asUser(U.superAdmin, () => db.query("update workshop_status_events set new_value = 'x' where id = $1", [evId])),
    e => isCode('42501')(e) && hasMsg('cannot be changed')(e))
  await assert.rejects(db.query('delete from workshop_status_events where id = $1', [evId]), hasMsg('cannot be changed'))
  await assert.rejects(db.query('truncate workshop_status_events'), hasMsg('cannot be changed'))
  assert.equal((await db.query('select count(*)::int n from workshop_status_events')).rows[0].n, before)
  const still = (await db.query('select new_value from workshop_status_events where id = $1', [evId])).rows[0]
  assert.notEqual(still.new_value, 'x')
})

test('authenticated holds SELECT only on events; anon holds nothing', async () => {
  const p = (await db.query(`select
      has_table_privilege('authenticated', 'public.workshop_status_events', 'select') s,
      has_table_privilege('authenticated', 'public.workshop_status_events', 'insert') i,
      has_table_privilege('authenticated', 'public.workshop_status_events', 'update') u,
      has_table_privilege('authenticated', 'public.workshop_status_events', 'delete') d,
      has_table_privilege('anon', 'public.workshop_status_events', 'select') a`)).rows[0]
  assert.deepEqual(p, { s: true, i: false, u: false, d: false, a: false })
})
