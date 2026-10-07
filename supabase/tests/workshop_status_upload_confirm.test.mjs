import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// PGlite harness for supabase/migrations/20261007110000_workshop_status_upload_confirm.sql,
// applied on top of the Loop 1 foundation and Loop 2 permissions. The
// permission stubs are real logic over stub tables (copied from the Loop 2
// harness), so stage / confirm / cancel go through workshop_status_can()
// exactly as in production.

const read = f => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const FOUNDATION = read('20261007090000_workshop_status_foundation.sql')
const PERMISSIONS = read('20261007100000_workshop_status_permissions.sql')
const CONFIRM = read('20261007110000_workshop_status_upload_confirm.sql')

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const org = id(900)
const U = { ground: id(1), supervisor: id(2), admin: id(3), manager: id(4) }
const V = { tm1: id(101), tm2a: id(102), tm2b: id(103) }
const BD = { tm1: id(201) }

const db = new PGlite()
const isCode = code => e => e?.code === code
const hasMsg = text => e => String(e?.message || '').includes(text)

async function asUser (uid, fn) {
  await db.exec(`set test.uid = '${uid}'`)
  try { return await fn() } finally { await db.exec('reset test.uid') }
}

const count = async (sql, params = []) => (await db.query(sql, params)).rows[0].n

const baseData = (asset, extra = {}) => ({
  asset_no: asset,
  reg_no: `REG-${asset}`,
  job_card_ref: `JC/${asset}`,
  vehicle_category: 'TRANSIT MIXER',
  site: 'NHC',
  department: 'WORKSHOP',
  complaint: `Complaint ${asset}`,
  diagnostics: 'Checked',
  ooc_since: '2026-10-01',
  excel_down_days: 6,
  excel_expected_release: null,
  excel_status_note: null,
  source_remarks: 'WAITING FOR PARTS',
  ...extra,
})
let rowNo = 0
const row = (asset, outcome, extra = {}) => ({
  row_number: ++rowNo,
  section: outcome === 'closed' ? 'JOB CARD CLOSED DETAILS' : 'TRANSIT MIXER',
  asset_no: asset,
  site: 'NHC',
  outcome,
  data: asset ? baseData(asset, extra) : { asset_no: null },
  raw: { 'ASSET NO.': asset },
  changes: {},
  errors: outcome === 'invalid' ? ['Missing vehicle number'] : [],
  record_id: null,
})

async function stage (uid, rows, { hash = null, country = 'KSA', fileName = 'daily.xlsx' } = {}) {
  return asUser(uid, async () => (await db.query(
    `select public.workshop_status_stage_upload($1, $2, $3, $4, $5, $6, $7, $8, $9) r`,
    [country, fileName, hash, 1234, 'Sheet1', '2026-10-07', JSON.stringify({ 'ASSET NO.': 'asset_no' }),
      ['Extra'], JSON.stringify(rows)])).rows[0].r)
}
async function confirm (uid, uploadId, ack = false) {
  return asUser(uid, async () => (await db.query(
    'select public.workshop_status_confirm_upload($1, $2) r', [uploadId, ack])).rows[0].r)
}
async function cancel (uid, uploadId) {
  return asUser(uid, async () => (await db.query(
    'select public.workshop_status_cancel_upload($1) r', [uploadId])).rows[0].r)
}
const record = async asset => (await db.query(
  `select * from workshop_status_records where asset_no = $1 order by created_at desc limit 1`, [asset])).rows[0]
const snapshot = async () => ({
  records: (await db.query('select to_jsonb(r) j from workshop_status_records r order by id')).rows,
  uploads: (await db.query('select to_jsonb(u) j from workshop_status_uploads u order by id')).rows,
  events: await count('select count(*)::int n from workshop_status_events'),
  rows: await count('select count(*)::int n from workshop_status_upload_rows'),
})

let breakdownSnapshot
const up = {}

before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles(id uuid primary key, full_name text, username text, role text,
      is_super_admin boolean default false, approved boolean default true, locked boolean default false);
    create function public.app_current_org() returns uuid language sql stable as $$ select '${org}'::uuid $$;
    create function public.app_is_active() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.profiles where id = auth.uid()
                      and coalesce(approved, true) and not coalesce(locked, false)) $$;
    create function public.is_super_admin() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.profiles where id = auth.uid()
                      and coalesce(is_super_admin, false) and not coalesce(locked, false)) $$;
    create function public.app_sees_all_countries() returns boolean language sql stable as $$ select true $$;
    create function public.app_country_scope() returns text[] language sql stable as $$ select null::text[] $$;
    create function public.app_sees_all_sites() returns boolean language sql stable as $$ select true $$;
    create function public.app_site_scope() returns text[] language sql stable as $$ select null::text[] $$;
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
    insert into public.vehicle_fleet values
      ('${V.tm1}', '${org}', 'KSA', 'TM1'),
      ('${V.tm2a}', '${org}', 'KSA', 'TM2'),
      ('${V.tm2b}', '${org}', 'KSA', 'tm 2');
    create table public.asset_breakdowns(id uuid primary key, organisation_id uuid, country text,
      asset_no text, returned_to_service boolean);
    insert into public.asset_breakdowns values ('${BD.tm1}', '${org}', 'KSA', 'TM 1', false);
    insert into public.profiles (id, full_name, role) values
      ('${U.ground}', 'Ground', 'Mechanic'),
      ('${U.supervisor}', 'Super Visor', 'Workshop Supervisor'),
      ('${U.admin}', 'Addie', 'Admin'),
      ('${U.manager}', 'Manny', 'Manager');
    insert into public.module_permissions (role, module_key, enabled, org_id) values
      ('Manager', 'daily_ops', true, null);
    grant usage on schema public, auth to authenticated;
  `)
  await db.exec(FOUNDATION)
  await db.exec(PERMISSIONS)
  await db.exec(CONFIRM)
  breakdownSnapshot = (await db.query('select * from asset_breakdowns order by id')).rows
})

after(async () => { await db.close() })

test('1. first upload: every vehicle new, vehicle + breakdown linked, breakdown register untouched', async () => {
  const rows = [row('TM1', 'new'), row('TM2', 'new'), row('MP1', 'new', { vehicle_category: 'M-PUMPS' }),
    row('CL9', 'closed'), row(null, 'invalid'), row('TM1', 'duplicate')]
  const st = await stage(U.supervisor, rows, { hash: 'hash-A' })
  assert.ok(st.upload_id)
  assert.ok(Number(st.upload_no) > 0)
  assert.equal(st.duplicate_of, null)
  up.first = st.upload_id

  const u = (await db.query('select * from workshop_status_uploads where id = $1', [up.first])).rows[0]
  assert.equal(u.status, 'previewed')
  assert.equal(u.uploaded_by, U.supervisor)
  assert.deepEqual([u.total_rows, u.new_count, u.closed_count, u.invalid_count, u.duplicate_count, u.previous_active_count],
    [6, 3, 1, 1, 1, 0])
  assert.equal(await count('select count(*)::int n from workshop_status_upload_rows where upload_id = $1', [up.first]), 6)
  assert.equal(await count(`select count(*)::int n from workshop_status_events
    where upload_id = $1 and event_type = 'upload_previewed' and actor_id = $2`, [up.first, U.supervisor]), 1)

  const sum = await confirm(U.supervisor, up.first)
  assert.deepEqual(sum, {
    upload_id: up.first, new: 3, updated: 0, unchanged: 0, removed: 0, closed: 1, invalid: 1, duplicate: 1,
    previous_active: 0, active_after: 3,
  })
  const tm1 = await record('TM1')
  assert.equal(tm1.vehicle_id, V.tm1, 'exactly one fleet match is linked')
  assert.equal(tm1.asset_breakdown_id, BD.tm1, 'the single open breakdown is linked')
  assert.equal(tm1.first_seen_upload_id, up.first)
  assert.equal(tm1.last_seen_upload_id, up.first)
  assert.equal(tm1.complaint, 'Complaint TM1')
  assert.equal(tm1.excel_down_days, 6)
  assert.equal(tm1.ooc_since.toISOString().slice(0, 10), '2026-10-01')
  assert.equal((await record('TM2')).vehicle_id, null, 'two fleet matches -> no link')
  assert.equal(await record('CL9'), undefined, 'a closed-only vehicle is never added')
  assert.deepEqual((await db.query('select * from asset_breakdowns order by id')).rows, breakdownSnapshot)

  const done = (await db.query('select * from workshop_status_uploads where id = $1', [up.first])).rows[0]
  assert.equal(done.status, 'confirmed')
  assert.equal(done.confirmed_by, U.supervisor)
  assert.equal(done.new_count, 3)
  const evs = (await db.query('select event_type, actor_id from workshop_status_events where upload_id = $1', [up.first])).rows
  assert.equal(evs.filter(e => e.event_type === 'added').length, 3)
  assert.equal(evs.filter(e => e.event_type === 'upload_confirmed').length, 1)
  assert.ok(evs.every(e => e.actor_id === U.supervisor), 'every event carries the actor')
})

test('2. the same file again: duplicate_file without acknowledgement, all unchanged with it', async () => {
  const rows = [row('TM1', 'unchanged'), row('TM2', 'unchanged'), row('MP1', 'unchanged', { vehicle_category: 'M-PUMPS' })]
  const st = await stage(U.supervisor, rows, { hash: 'hash-A' })
  assert.equal(st.duplicate_of.id, up.first)
  assert.equal(st.duplicate_of.status, 'confirmed')
  assert.equal(st.duplicate_of.uploaded_by_name, 'Super Visor')
  const before = await snapshot()
  await assert.rejects(confirm(U.supervisor, st.upload_id), hasMsg('duplicate_file'))
  assert.deepEqual(await snapshot(), before, 'a refused confirm changes nothing')

  const sum = await confirm(U.supervisor, st.upload_id, true)
  assert.equal(sum.unchanged, 3)
  assert.equal(sum.updated + sum.new + sum.removed, 0)
  const u = (await db.query('select * from workshop_status_uploads where id = $1', [st.upload_id])).rows[0]
  assert.equal(u.duplicate_acknowledged, true)
  assert.equal(u.duplicate_of_upload_id, up.first)
  const ev = (await db.query(`select details from workshop_status_events
    where upload_id = $1 and event_type = 'upload_confirmed'`, [st.upload_id])).rows[0]
  assert.equal(ev.details.duplicate_acknowledged, true)
  assert.equal(await count(`select count(*)::int n from workshop_status_events
    where upload_id = $1 and event_type = 'field_change'`, [st.upload_id]), 0)
})

test('3. changed complaint updates only Excel fields; down-days-only difference counts as unchanged', async () => {
  const before = await record('TM1')
  // TyrePulse-owned fields maintained in the app.
  await db.transaction(async tx => {
    await tx.query(`select set_config('test.uid', '${U.supervisor}', true), set_config('workshop.source', 'manual', true)`)
    await tx.query(`update workshop_status_records set current_stage = 'Waiting parts', delay_reason = 'Parts',
      expected_release_date = '2026-10-20', responsible_user_id = $1, remarks = 'keep me' where id = $2`, [U.ground, before.id])
    await tx.query(`update workshop_status_records set current_stage = 'Diagnosis' where asset_no = 'TM2' and current_active`)
  })
  const mp1Before = await record('MP1')
  const tm2Before = await record('TM2')

  const st = await stage(U.supervisor, [
    row('TM1', 'changed', { complaint: 'Gearbox noise', excel_down_days: 7 }),
    row('TM2', 'unchanged', { excel_down_days: 7 }),
    // Case and spacing only: not a change (mirrors the preview).
    row('MP1', 'unchanged', { vehicle_category: 'M-PUMPS', complaint: '  complaint   mp1 ', excel_down_days: 7 }),
  ], { hash: 'hash-B' })
  const sum = await confirm(U.admin, st.upload_id)
  assert.deepEqual([sum.updated, sum.unchanged, sum.new, sum.removed], [1, 2, 0, 0])

  const tm1 = await record('TM1')
  assert.equal(tm1.id, before.id)
  assert.equal(tm1.complaint, 'Gearbox noise')
  assert.equal(tm1.excel_down_days, 7)
  assert.equal(tm1.current_stage, 'Waiting parts')
  assert.equal(tm1.delay_reason, 'Parts')
  assert.equal(tm1.expected_release_date.toISOString().slice(0, 10), '2026-10-20')
  assert.equal(tm1.responsible_user_id, U.ground)
  assert.equal(tm1.remarks, 'keep me')
  assert.equal(tm1.last_seen_upload_id, st.upload_id)
  assert.equal(tm1.last_updated_by, U.admin)

  const tm2 = await record('TM2')
  assert.equal(tm2.excel_down_days, 7, 'down days is still stored')
  assert.equal(tm2.last_seen_upload_id, st.upload_id)
  assert.equal(tm2.last_updated_by, tm2Before.last_updated_by, 'an unchanged vehicle keeps its last-updated stamp')
  assert.equal(tm2.last_update_source, tm2Before.last_update_source)
  const mp1 = await record('MP1')
  assert.equal(mp1.complaint, mp1Before.complaint, 'a case-only difference is not written')

  const changes = (await db.query(`select record_id, field_name, source, actor_id from workshop_status_events
    where upload_id = $1 and event_type = 'field_change' order by field_name`, [st.upload_id])).rows
  assert.ok(changes.every(c => c.record_id === tm1.id), 'no field_change for the down-days-only vehicles')
  assert.deepEqual(changes.map(c => c.field_name).sort(), ['complaint', 'excel_down_days'])
  assert.ok(changes.every(c => c.source === 'excel' && c.actor_id === U.admin))
  assert.equal(await count(`select count(*)::int n from workshop_status_events
    where upload_id = $1 and event_type = 'excel_updated' and record_id = $2`, [st.upload_id, tm1.id]), 1)
})

test('4. a vehicle that disappears is removed (missing / listed as closed), never deleted', async () => {
  const tm2Before = await record('TM2')
  const st = await stage(U.supervisor, [
    row('TM1', 'unchanged', { complaint: 'Gearbox noise', excel_down_days: 8 }),
    row('MP1', 'closed'),
  ], { hash: 'hash-C' })
  const sum = await confirm(U.supervisor, st.upload_id)
  assert.deepEqual([sum.removed, sum.unchanged, sum.closed, sum.active_after, sum.previous_active], [2, 1, 0, 1, 3])

  const tm2 = await record('TM2')
  assert.equal(tm2.id, tm2Before.id, 'the record still exists')
  assert.equal(tm2.current_active, false)
  assert.equal(tm2.daily_report_status, 'removed_from_current_report')
  assert.equal(tm2.removed_reason, 'missing_from_upload')
  assert.equal(tm2.removed_by_upload_id, st.upload_id)
  assert.equal(tm2.removed_by_user_id, U.supervisor)
  assert.equal(tm2.previous_current_stage, 'Diagnosis')
  assert.equal(tm2.current_stage, 'Diagnosis', 'TyrePulse stage is not cleared')
  assert.equal(tm2.final_disposition, null)
  const mp1 = await record('MP1')
  assert.equal(mp1.removed_reason, 'listed_as_closed')
  assert.equal(mp1.final_disposition, null)

  const removed = (await db.query(`select record_id, reason, details from workshop_status_events
    where upload_id = $1 and event_type = 'removed' order by asset_no`, [st.upload_id])).rows
  assert.equal(removed.length, 2)
  const mpEv = removed.find(e => e.record_id === mp1.id)
  assert.equal(mpEv.details.reason, 'listed_as_closed')
  assert.match(mpEv.details.message, /closed details/)
  assert.ok(mpEv.details.closed_row.row_number > 0)
  const tmEv = removed.find(e => e.record_id === tm2.id)
  assert.equal(tmEv.details.message,
    'Vehicle removed from current workshop report because it was not present in the latest confirmed Excel upload.')
  const fc = (await db.query(`select reason from workshop_status_events where upload_id = $1
    and event_type = 'field_change' and field_name = 'current_active' and record_id = $2`, [st.upload_id, tm2.id])).rows
  assert.deepEqual(fc, [{ reason: 'missing_from_upload' }])
  assert.equal(await count(`select count(*)::int n from workshop_status_records`), 3, 'nothing deleted')
})

test('5. permissions: ground cannot stage or confirm; supervisor can; cancelled or confirmed uploads are final', async () => {
  await assert.rejects(stage(U.ground, [row('TM1', 'unchanged')], { hash: 'g' }), isCode('42501'))
  const st = await stage(U.supervisor, [row('TM1', 'unchanged', { complaint: 'Gearbox noise' })], { hash: 'hash-D' })
  await assert.rejects(confirm(U.ground, st.upload_id), isCode('42501'))
  await assert.rejects(confirm(U.manager, st.upload_id), isCode('42501'), 'managers do not confirm by default')
  await assert.rejects(cancel(U.ground, st.upload_id), isCode('42501'))
  assert.equal((await cancel(U.supervisor, st.upload_id)).status, 'cancelled')
  const u = (await db.query('select status, cancelled_by from workshop_status_uploads where id = $1', [st.upload_id])).rows[0]
  assert.deepEqual(u, { status: 'cancelled', cancelled_by: U.supervisor })
  assert.equal(await count(`select count(*)::int n from workshop_status_events
    where upload_id = $1 and event_type = 'upload_cancelled'`, [st.upload_id]), 1)
  await assert.rejects(confirm(U.supervisor, st.upload_id), hasMsg('upload_not_previewed'))
  await assert.rejects(cancel(U.supervisor, st.upload_id), hasMsg('upload_not_previewed'))
  await assert.rejects(confirm(U.supervisor, up.first, true), hasMsg('upload_not_previewed'))
  await assert.rejects(confirm(U.supervisor, id(999)), isCode('P0002'))
})

test('6. stale preview: an older preview cannot be confirmed after a newer one', async () => {
  const a = await stage(U.supervisor, [row('TM1', 'unchanged', { complaint: 'A' })], { hash: 'hash-E1' })
  const b = await stage(U.supervisor, [row('TM1', 'changed', { complaint: 'Gearbox noise' }), row('TM5', 'new')], { hash: 'hash-E2' })
  await confirm(U.supervisor, b.upload_id)
  const before = await snapshot()
  await assert.rejects(confirm(U.supervisor, a.upload_id), hasMsg('stale_preview'))
  assert.deepEqual(await snapshot(), before)
  assert.equal((await db.query('select status from workshop_status_uploads where id = $1', [a.upload_id])).rows[0].status, 'previewed')
})

test('7. atomic: a failure midway leaves the live list, uploads and events exactly as before', async () => {
  await db.exec(`create function public.test_boom() returns trigger language plpgsql as $$
    begin if NEW.asset_no = 'ZZBOOM' then raise exception 'boom'; end if; return NEW; end $$;
    create trigger trg_test_boom before insert on public.workshop_status_records
      for each row execute function public.test_boom();`)
  try {
    const st = await stage(U.supervisor, [
      row('TM1', 'changed', { complaint: 'Different again' }),
      row('TM5', 'unchanged'),
      row('AA1', 'new'),
      row('ZZBOOM', 'new'),
    ], { hash: 'hash-F' })
    const before = await snapshot()
    await assert.rejects(confirm(U.supervisor, st.upload_id), hasMsg('boom'))
    assert.deepEqual(await snapshot(), before)
    assert.equal(await record('AA1'), undefined)
    assert.equal((await record('TM1')).complaint, 'Gearbox noise')
  } finally {
    await db.exec('drop trigger trg_test_boom on public.workshop_status_records; drop function public.test_boom()')
  }
})

test('8. workshop.* settings do not leak past the call', async () => {
  const st = await stage(U.supervisor, [row('TM1', 'unchanged', { complaint: 'Gearbox noise' }), row('TM5', 'unchanged')], { hash: 'hash-G' })
  await confirm(U.supervisor, st.upload_id)
  const s = (await db.query(`select coalesce(current_setting('workshop.source', true), '') src,
    coalesce(current_setting('workshop.upload_id', true), '') up,
    coalesce(current_setting('workshop.reason', true), '') rsn,
    coalesce(current_setting('workshop.suppress_fields', true), '') sup`)).rows[0]
  assert.deepEqual(s, { src: '', up: '', rsn: '', sup: '' })
})

test('9. validation and grants', async () => {
  await assert.rejects(stage(U.supervisor, [], { country: '  ' }), isCode('22023'))
  await assert.rejects(stage(U.supervisor, [{ ...row('X1', 'new'), outcome: 'bogus' }]), isCode('22023'))
  const many = Array.from({ length: 5001 }, (_, i) => ({ asset_no: `A${i}`, outcome: 'invalid' }))
  await assert.rejects(stage(U.supervisor, many), isCode('22023'))
  // Garbage values never abort: bad date / int become null.
  const st = await stage(U.supervisor, [
    row('TM1', 'unchanged', { complaint: 'Gearbox noise' }), row('TM5', 'unchanged'),
    row('BAD1', 'new', { ooc_since: '2026-13-45', excel_down_days: 'lots' }),
  ], { hash: 'hash-H' })
  await confirm(U.supervisor, st.upload_id)
  const bad = await record('BAD1')
  assert.equal(bad.ooc_since, null)
  assert.equal(bad.excel_down_days, null)

  const g = (await db.query(`select
    has_function_privilege('anon', 'public.workshop_status_stage_upload(text,text,text,bigint,text,date,jsonb,text[],jsonb)', 'execute') a1,
    has_function_privilege('anon', 'public.workshop_status_confirm_upload(uuid,boolean)', 'execute') a2,
    has_function_privilege('anon', 'public.workshop_status_cancel_upload(uuid)', 'execute') a3,
    has_function_privilege('authenticated', 'public.workshop_status_stage_upload(text,text,text,bigint,text,date,jsonb,text[],jsonb)', 'execute') b1,
    has_function_privilege('authenticated', 'public.workshop_status_confirm_upload(uuid,boolean)', 'execute') b2,
    has_function_privilege('authenticated', 'public.workshop_status_cancel_upload(uuid)', 'execute') b3,
    has_function_privilege('authenticated', 'public.workshop_status_cmp(text,text)', 'execute') c1`)).rows[0]
  assert.deepEqual(g, { a1: false, a2: false, a3: false, b1: true, b2: true, b3: true, c1: false })
})
