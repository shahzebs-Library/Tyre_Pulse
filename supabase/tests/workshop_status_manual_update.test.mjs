import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { SELECTABLE_STAGES, DELAY_REASONS, PARTS_STATUSES } from '../../src/lib/workshopStatus/vocab.js'

// PGlite harness for supabase/migrations/20261007120000_workshop_status_manual_update.sql,
// applied on top of the Loop 1 foundation, Loop 2 permissions and Loop 6
// upload confirmation. The permission stubs are real logic over stub tables
// (copied from the earlier harnesses), so the writer goes through
// workshop_status_can() exactly as in production.

const read = f => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const FOUNDATION = read('20261007090000_workshop_status_foundation.sql')
const PERMISSIONS = read('20261007100000_workshop_status_permissions.sql')
const CONFIRM = read('20261007110000_workshop_status_upload_confirm.sql')
const MANUAL = read('20261007120000_workshop_status_manual_update.sql')

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const org = id(900)
const otherOrg = id(901)
const U = {
  ground: id(1), supervisor: id(2), admin: id(3), reporter: id(4),
  pending: id(5), outsider: id(6), helper: id(7),
}
const R = { tm1: id(301), tm2: id(302), foreign: id(303), removed: id(304), uae: id(305) }

const db = new PGlite()
const isCode = code => e => e?.code === code
const hasMsg = text => e => String(e?.message || '').includes(text)

async function asUser (uid, fn) {
  await db.exec(`set test.uid = '${uid}'`)
  try { return await fn() } finally { await db.exec('reset test.uid') }
}
const count = async (sql, params = []) => (await db.query(sql, params)).rows[0].n
const update = (uid, recordId, patch, expected = null) => asUser(uid, async () => (await db.query(
  'select public.workshop_status_update_record($1, $2, $3) r',
  [recordId, JSON.stringify(patch), expected])).rows[0].r)
const rec = async rid => (await db.query('select * from workshop_status_records where id = $1', [rid])).rows[0]
const updatedAtText = async rid => (await db.query(
  'select updated_at::text t from workshop_status_records where id = $1', [rid])).rows[0].t
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
      ('${U.helper}', 'Helper Tech', 'Electrician', '${org}', true);
    grant usage on schema public, auth to authenticated;
  `)
  await db.exec(FOUNDATION)
  await db.exec(PERMISSIONS)
  await db.exec(CONFIRM)
  await db.exec(MANUAL)
  // Seed records as an Excel upload would have (source excel, no actor).
  await db.exec(`
    select set_config('workshop.source', 'excel', false);
    insert into workshop_status_records (id, organisation_id, country, asset_no, site, complaint) values
      ('${R.tm1}', '${org}', 'KSA', 'TM1', 'NHC', 'Gearbox noise'),
      ('${R.tm2}', '${org}', 'KSA', 'TM2', 'JED', 'Brakes'),
      ('${R.foreign}', '${otherOrg}', 'KSA', 'TM9', 'NHC', 'Other org'),
      ('${R.removed}', '${org}', 'KSA', 'TM3', 'NHC', 'Released');
    insert into workshop_status_records (id, organisation_id, country, asset_no, site, complaint) values
      ('${R.uae}', '${org}', 'UAE', 'TM1', 'DXB', 'UAE machine');
    update workshop_status_records set current_active = false, daily_report_status = 'removed_from_current_report'
     where id = '${R.removed}';
    select set_config('workshop.source', '', false);
  `)
})

after(async () => { await db.close() })

test('vocabulary in SQL matches src/lib/workshopStatus/vocab.js', async () => {
  const v = async kind => (await db.query('select public.workshop_status_manual_vocab($1) a', [kind])).rows[0].a
  assert.deepEqual(await v('stage'), [...SELECTABLE_STAGES])
  assert.deepEqual(await v('delay'), [...DELAY_REASONS])
  assert.deepEqual(await v('parts'), [...PARTS_STATUSES])
})

test('permission denied without update; nothing written', async () => {
  const before = await count('select count(*)::int n from workshop_status_events')
  await assert.rejects(update(U.reporter, R.tm1, { remarks: 'x' }), isCode('42501'))
  await assert.rejects(update(U.pending, R.tm1, { remarks: 'x' }), isCode('42501'))
  assert.equal(await count('select count(*)::int n from workshop_status_events'), before)
  assert.equal((await rec(R.tm1)).remarks, null)
})

test('ground user updates: who/when stamped from auth uid, field_change + manual_update events', async () => {
  const res = await update(U.ground, R.tm1, {
    current_stage: 'Waiting for Parts',
    delay_reason: 'Waiting for Spare Parts',
    parts_status: 'MR Raised',
    mr_number: '  MR-1001 ',
    expected_release_date: '2026-10-20',
    work_done: 'Removed gearbox cover',
    // A caller-supplied "who" is not an accepted field at all (tested below);
    // here it is simply absent and the server stamps it.
  })
  assert.equal(res.ok, true)
  assert.equal(res.changed, 6)
  assert.deepEqual([...res.fields].sort(), ['current_stage', 'delay_reason', 'expected_release_date',
    'mr_number', 'parts_status', 'work_done'])
  assert.equal(res.record.last_updated_by, U.ground)
  assert.equal(res.record.last_updated_by_name, 'Ground Mechanic')
  assert.ok(res.record.last_updated_at)
  assert.equal(res.record.mr_number, 'MR-1001', 'trimmed')

  const r = await rec(R.tm1)
  assert.equal(r.last_updated_by, U.ground)
  assert.equal(r.last_update_source, 'manual')
  assert.ok(r.last_manual_update_at, 'last_manual_update_at stamped')
  assert.equal(r.current_stage, 'Waiting for Parts')
  assert.equal(r.complaint, 'Gearbox noise', 'Excel field untouched')

  const fc = await events(R.tm1, 'field_change')
  assert.deepEqual(fc.map(e => e.field_name).sort(), [...res.fields].sort())
  assert.ok(fc.every(e => e.actor_id === U.ground && e.source === 'manual'))
  const stage = fc.find(e => e.field_name === 'current_stage')
  assert.equal(stage.old_value, null)
  assert.equal(stage.new_value, 'Waiting for Parts')
  const mu = await events(R.tm1, 'manual_update')
  assert.equal(mu.length, 1)
  assert.equal(mu[0].actor_id, U.ground)
  assert.equal(mu[0].actor_name, 'Ground Mechanic')
  assert.equal(mu[0].details.changed, 6)
  assert.equal(mu[0].country, 'KSA')
  assert.equal(mu[0].site, 'NHC')
})

test('no-op patch writes nothing (same values, blank stays blank)', async () => {
  const before = await count('select count(*)::int n from workshop_status_events')
  const stamp = await updatedAtText(R.tm1)
  const res = await update(U.ground, R.tm1, { current_stage: 'Waiting for Parts', mr_number: 'MR-1001 ', blocker: '  ' })
  assert.deepEqual(res, { ok: true, changed: 0, fields: [] })
  assert.equal(await count('select count(*)::int n from workshop_status_events'), before)
  assert.equal(await updatedAtText(R.tm1), stamp, 'row not touched')
  assert.deepEqual(await update(U.ground, R.tm1, {}), { ok: true, changed: 0, fields: [] })
})

test('blank string clears a value', async () => {
  const res = await update(U.ground, R.tm1, { work_done: '' })
  assert.equal(res.changed, 1)
  assert.equal((await rec(R.tm1)).work_done, null)
})

test('delay reason Other requires a detailed reason', async () => {
  await assert.rejects(update(U.ground, R.tm1, { delay_reason: 'Other' }), e => isCode('22023')(e) && hasMsg('detailed reason')(e))
  await assert.rejects(update(U.ground, R.tm1, { delay_reason: 'Other', detailed_reason: '   ' }), isCode('22023'))
  const ok = await update(U.ground, R.tm1, { delay_reason: 'Other', detailed_reason: 'Waiting for crane' })
  assert.equal(ok.changed, 2)
  await assert.rejects(update(U.ground, R.tm1, { detailed_reason: '' }), isCode('22023'), 'cannot clear the detail while Other')
  await update(U.ground, R.tm1, { delay_reason: 'Waiting for Spare Parts' })
})

test('bad vocabulary and dates are refused', async () => {
  await assert.rejects(update(U.ground, R.tm1, { current_stage: 'Nonsense' }), isCode('22023'))
  await assert.rejects(update(U.ground, R.tm1, { current_stage: 'Removed From Current Report' }), isCode('22023'))
  await assert.rejects(update(U.ground, R.tm1, { delay_reason: 'Because' }), isCode('22023'))
  await assert.rejects(update(U.ground, R.tm1, { parts_status: 'Lost' }), isCode('22023'))
  await assert.rejects(update(U.ground, R.tm1, { expected_part_date: '2026-02-30' }), isCode('22023'))
  await assert.rejects(update(U.ground, R.tm1, { expected_part_date: '20/10/2026' }), isCode('22023'))
  await assert.rejects(update(U.ground, R.tm1, { expected_release_date: '1990-01-01' }), isCode('22023'))
  await assert.rejects(update(U.ground, R.tm1, { remarks: 'x'.repeat(4001) }), isCode('22023'))
})

test('Excel-owned, identity and "who" fields are rejected', async () => {
  for (const key of ['complaint', 'site', 'excel_down_days', 'asset_no', 'country', 'current_active',
    'last_updated_by', 'last_updated_by_name', 'organisation_id', 'final_disposition']) {
    await assert.rejects(update(U.supervisor, R.tm1, { [key]: 'x' }), e => isCode('22023')(e) && hasMsg(key)(e), key)
  }
  await assert.rejects(update(U.supervisor, R.tm1, ['remarks']), isCode('22023'), 'array patch')
  assert.equal((await rec(R.tm1)).complaint, 'Gearbox noise')
})

test('assigning people needs assign permission and a real approved person in the org', async () => {
  await assert.rejects(update(U.ground, R.tm1, { responsible_user_id: U.helper }), isCode('42501'))
  await assert.rejects(update(U.ground, R.tm1, { supporting_user_id: U.helper }), isCode('42501'))
  await assert.rejects(update(U.supervisor, R.tm1, { responsible_user_id: U.outsider }), isCode('22023'))
  await assert.rejects(update(U.supervisor, R.tm1, { responsible_user_id: U.pending }), isCode('22023'))
  await assert.rejects(update(U.supervisor, R.tm1, { responsible_user_id: id(999) }), isCode('22023'))
  await assert.rejects(update(U.supervisor, R.tm1, { responsible_user_id: 'not-a-uuid' }), isCode('22023'))
  const res = await update(U.supervisor, R.tm1, { responsible_user_id: U.helper, supporting_user_id: U.ground })
  assert.equal(res.changed, 2)
  assert.equal(res.record.responsible_user_name, 'Helper Tech')
  assert.equal(res.record.supporting_user_name, 'Ground Mechanic')
  assert.equal(res.record.last_updated_by_name, 'Sajid Kamboh')
  // Unchanged person in the patch is fine for a user without assign.
  const same = await update(U.ground, R.tm1, { responsible_user_id: U.helper, remarks: 'checked' })
  assert.equal(same.changed, 1)
  assert.deepEqual(same.fields, ['remarks'])
})

test('stale expected_updated_at is refused with PT409 record_changed', async () => {
  const stamp = await updatedAtText(R.tm2)
  const ok = await update(U.ground, R.tm2, { remarks: 'first' }, stamp)
  assert.equal(ok.changed, 1)
  const before = await count('select count(*)::int n from workshop_status_events')
  await assert.rejects(update(U.ground, R.tm2, { remarks: 'second' }, stamp),
    e => isCode('PT409')(e) && hasMsg('record_changed')(e))
  assert.equal(await count('select count(*)::int n from workshop_status_events'), before)
  assert.equal((await rec(R.tm2)).remarks, 'first')
  const fresh = await updatedAtText(R.tm2)
  assert.equal((await update(U.ground, R.tm2, { remarks: 'second' }, fresh)).changed, 1)
})

test('cross-org, removed, missing and out-of-scope records are refused as not found', async () => {
  await assert.rejects(update(U.supervisor, R.foreign, { remarks: 'x' }), isCode('P0002'))
  await assert.rejects(update(U.supervisor, R.removed, { remarks: 'x' }), isCode('P0002'))
  await assert.rejects(update(U.supervisor, id(777), { remarks: 'x' }), isCode('P0002'))
  assert.equal((await rec(R.foreign)).remarks, null)

  await db.exec("set test.cscope = 'ksa'")
  try {
    await assert.rejects(update(U.supervisor, R.uae, { remarks: 'x' }), isCode('P0002'))
    assert.equal((await update(U.supervisor, R.tm1, { remarks: 'ksa ok' })).changed, 1)
  } finally { await db.exec('reset test.cscope') }
  await db.exec("set test.sscope = 'NHC'")
  try {
    await assert.rejects(update(U.supervisor, R.tm2, { remarks: 'x' }), isCode('P0002'))
  } finally { await db.exec('reset test.sscope') }
})

test('privileges: authenticated may execute the writer, anon may not; helper is internal', async () => {
  const p = (await db.query(`select
      has_function_privilege('authenticated', 'public.workshop_status_update_record(uuid, jsonb, timestamptz)', 'execute') a,
      has_function_privilege('anon', 'public.workshop_status_update_record(uuid, jsonb, timestamptz)', 'execute') b,
      has_function_privilege('authenticated', 'public.workshop_status_manual_vocab(text)', 'execute') c`)).rows[0]
  assert.deepEqual(p, { a: true, b: false, c: false })
})
