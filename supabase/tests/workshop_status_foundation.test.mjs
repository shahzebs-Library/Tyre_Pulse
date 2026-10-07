import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// PGlite harness for supabase/migrations/20261007090000_workshop_status_foundation.sql.
// Every permission/scope stub reads a session setting, so a test can switch the
// user, module permission, org, country and site scope without new functions.

const MIGRATION = readFileSync(
  new URL('../migrations/20261007090000_workshop_status_foundation.sql', import.meta.url), 'utf8')

const user = '00000000-0000-0000-0000-000000000001'
const other = '00000000-0000-0000-0000-000000000002'
const org = '00000000-0000-0000-0000-000000000003'
const otherOrg = '00000000-0000-0000-0000-000000000004'
const vehicle = '00000000-0000-0000-0000-0000000000a1'
const missing = '00000000-0000-0000-0000-0000000000ff'
const bdOpen = '00000000-0000-0000-0000-0000000000b1'
const bdReturned = '00000000-0000-0000-0000-0000000000b2'
const bdDupA = '00000000-0000-0000-0000-0000000000b3'
const bdDupB = '00000000-0000-0000-0000-0000000000b4'
const bdOtherCountry = '00000000-0000-0000-0000-0000000000b5'

const db = new PGlite()
let breakdownSnapshot

const isCode = code => e => e?.code === code

// One write with workshop.* settings scoped to the transaction (set_config(..., true)).
async function withCtx (settings, fn) {
  return db.transaction(async tx => {
    for (const [k, v] of Object.entries(settings)) {
      await tx.query('select set_config($1, $2, true)', [`workshop.${k}`, v])
    }
    return fn(tx)
  })
}
const withSource = (source, fn) => withCtx({ source }, fn)

async function insertRow (q, table, fields) {
  const cols = Object.keys(fields)
  const sql = `insert into ${table} (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning *`
  return (await q.query(sql, Object.values(fields))).rows[0]
}

async function asUser (uid, fn) {
  await db.exec(`set test.uid = '${uid}'`)
  try { return await fn() } finally { await db.exec('reset test.uid') }
}

const count = async (sql, params = []) => (await db.query(sql, params)).rows[0].n

before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('test.uid', true), ''), '${user}')::uuid $$;
    create function public.app_current_org() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('test.org', true), ''), '${org}')::uuid $$;
    create function public.is_super_admin() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.super', true), ''), 'false') = 'true' $$;
    create function public.app_is_active() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.active', true), ''), 'true') = 'true' $$;
    create function public.app_user_can(p_module text, p_cap text) returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.can_view', true), ''), 'true') = 'true' $$;
    create function public.app_sees_all_countries() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.country', true), ''), 'ALL') = 'ALL' $$;
    create function public.app_country_scope() returns text[] language sql stable as $$
      select string_to_array(lower(nullif(current_setting('test.country', true), '')), ',') $$;
    create function public.app_sees_all_sites() returns boolean language sql stable as $$
      select coalesce(nullif(current_setting('test.site', true), ''), 'ALL') = 'ALL' $$;
    create function public.app_site_scope() returns text[] language sql stable as $$
      select string_to_array(upper(nullif(current_setting('test.site', true), '')), ',') $$;
    create function public.normalize_asset_no() returns trigger language plpgsql as $$
    begin
      if NEW.asset_no is not null then NEW.asset_no := upper(regexp_replace(NEW.asset_no, '\\s', '', 'g')); end if;
      return NEW;
    end $$;
    create function public.normalize_site() returns trigger language plpgsql as $$
    begin
      if NEW.site is not null then NEW.site := regexp_replace(upper(btrim(NEW.site)), '-ST$', ''); end if;
      return NEW;
    end $$;
    create table public.profiles(id uuid primary key, full_name text, username text);
    insert into public.profiles values ('${user}', 'Workshop Lead', 'lead'), ('${other}', '  ', 'second');
    create table public.vehicle_fleet(id uuid primary key);
    insert into public.vehicle_fleet values ('${vehicle}');
    create table public.asset_breakdowns(id uuid primary key, organisation_id uuid, country text,
      asset_no text, returned_to_service boolean);
    insert into public.asset_breakdowns values
      ('${bdOpen}', '${org}', 'KSA', 'TM 514', false),
      ('${bdReturned}', '${org}', 'KSA', 'TM600', true),
      ('${bdDupA}', '${org}', 'KSA', 'MP001', false),
      ('${bdDupB}', '${org}', 'KSA', 'mp 001', null),
      ('${bdOtherCountry}', '${org}', 'UAE', 'TM700', false);
    create table public.module_permissions(role text, module_key text, enabled boolean, org_id uuid);
    insert into public.module_permissions values
      ('Manager', 'daily_ops', true, null),
      ('Reporter', 'daily_ops', false, null),
      ('Manager', 'daily_ops', true, '${org}'),
      ('Manager', 'fleet_master', true, null);
    grant usage on schema public, auth to authenticated;
  `)
  breakdownSnapshot = (await db.query('select * from asset_breakdowns order by id')).rows
})

after(async () => { await db.close() })

test('1. migration applies cleanly, is re-runnable, and seeds daily_ops:workshop once', async () => {
  await db.exec(MIGRATION)
  const tables = (await db.query(`select table_name from information_schema.tables
    where table_schema = 'public' and table_name like 'workshop_status_%' order by 1`)).rows.map(r => r.table_name)
  assert.deepEqual(tables, ['workshop_status_attachments', 'workshop_status_events', 'workshop_status_records',
    'workshop_status_upload_rows', 'workshop_status_uploads'])
  const seeded = async () => (await db.query(`select role, enabled, org_id from module_permissions
    where module_key = 'daily_ops:workshop' order by role`)).rows
  // Only roles with Daily Ops ENABLED are copied; Reporter (off) gets no row.
  assert.deepEqual(await seeded(), [
    { role: 'Manager', enabled: true, org_id: null }
  ])
  await db.exec(MIGRATION) // re-running must not duplicate the seed
  assert.equal((await seeded()).length, 1)
})

test('1b. the seed block is skipped when module_permissions does not exist', async () => {
  const fresh = new PGlite()
  try {
    await fresh.exec(`create role authenticated; create role anon; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create function public.app_current_org() returns uuid language sql stable as $$ select '${org}'::uuid $$;
      create function public.is_super_admin() returns boolean language sql stable as $$ select false $$;
      create function public.app_is_active() returns boolean language sql stable as $$ select true $$;
      create function public.app_user_can(text, text) returns boolean language sql stable as $$ select true $$;
      create function public.app_sees_all_countries() returns boolean language sql stable as $$ select true $$;
      create function public.app_country_scope() returns text[] language sql stable as $$ select null::text[] $$;
      create function public.app_sees_all_sites() returns boolean language sql stable as $$ select true $$;
      create function public.app_site_scope() returns text[] language sql stable as $$ select null::text[] $$;
      create table public.profiles(id uuid primary key, full_name text, username text);
      create table public.vehicle_fleet(id uuid primary key);
      create table public.asset_breakdowns(id uuid primary key, organisation_id uuid, country text,
        asset_no text, returned_to_service boolean);`)
    await fresh.exec(MIGRATION)
    assert.equal((await fresh.query("select to_regclass('public.module_permissions') t")).rows[0].t, null)
    // Without the optional normalisers the asset is stored as given.
    const r = (await fresh.query("insert into workshop_status_records (country, asset_no) values ('KSA', 'tm 1') returning asset_no")).rows[0]
    assert.equal(r.asset_no, 'tm 1')
  } finally { await fresh.close() }
})

test('2. owner insert: normalised, stamped from auth.uid, attributed "added" event, one active per vehicle', async () => {
  const rec = await withSource('excel', tx => insertRow(tx, 'workshop_status_records', {
    country: 'KSA', asset_no: 'tm 514', site: ' nhc-st ', vehicle_id: vehicle, complaint: 'Brake noise',
    reg_no: '1234 ABC', job_card_ref: 'GCKR/JC/1/0826', vehicle_category: 'TRANSIT MIXER',
    diagnostics: 'Pads worn', excel_down_days: 4, excel_expected_release: 'Next week', excel_status_note: 'Waiting',
    first_seen_by: other, first_seen_at: '2001-01-01', last_updated_by: other, last_updated_by_name: 'Forged',
    created_at: '2001-01-01'
  }))
  assert.equal(rec.asset_no, 'TM514')
  assert.equal(rec.site, 'NHC')
  assert.equal(rec.organisation_id, org)
  assert.equal(rec.reg_no, '1234 ABC')
  assert.equal(rec.job_card_ref, 'GCKR/JC/1/0826')
  assert.equal(rec.excel_down_days, 4)
  assert.equal(rec.first_seen_by, user)
  assert.ok(rec.first_seen_at.getFullYear() > 2001)
  assert.ok(rec.created_at.getFullYear() > 2001)
  assert.equal(rec.last_updated_by, user)
  assert.equal(rec.last_updated_by_name, 'Workshop Lead')
  assert.equal(rec.last_update_source, 'excel')
  assert.equal(rec.last_manual_update_at, null)

  const ev = (await db.query('select * from workshop_status_events where record_id = $1', [rec.id])).rows
  assert.equal(ev.length, 1)
  assert.equal(ev[0].event_type, 'added')
  assert.equal(ev[0].source, 'excel')
  assert.equal(ev[0].actor_id, user)
  assert.equal(ev[0].actor_name, 'Workshop Lead')
  assert.equal(ev[0].site, 'NHC')
  assert.match(ev[0].details.message, /Excel upload/)

  await assert.rejects(
    withSource('excel', tx => insertRow(tx, 'workshop_status_records', { country: 'KSA', asset_no: 'TM514', site: 'NHC' })),
    isCode('23505'))
})

test('3. identity changes raise 42501; a manual update audits fields and stamps the actor', async () => {
  const rec = (await db.query("select * from workshop_status_records where asset_no = 'TM514'")).rows[0]
  const attempts = [
    ["asset_no = 'HIJACK'"], ["country = 'UAE'"], [`organisation_id = '${otherOrg}'`],
    ["first_seen_at = '2000-01-01'"], [`first_seen_by = '${other}'`],
    ["created_at = '2000-01-01'"], [`first_seen_upload_id = '${missing}'`]
  ]
  for (const [set] of attempts) {
    await assert.rejects(
      withSource('manual', tx => tx.query(`update workshop_status_records set ${set} where id = $1`, [rec.id])),
      isCode('42501'), set)
  }
  // Identity is untouched and no events leaked from the rolled-back attempts.
  const same = (await db.query('select * from workshop_status_records where id = $1', [rec.id])).rows[0]
  assert.equal(same.asset_no, 'TM514')
  assert.equal(same.country, 'KSA')
  assert.equal(await count('select count(*)::int n from workshop_status_events where record_id = $1', [rec.id]), 1)

  await asUser(other, () => withSource('manual', tx => tx.query(
    "update workshop_status_records set current_stage = 'Waiting parts', diagnostics = 'Pads + discs' where id = $1",
    [rec.id])))
  const after = (await db.query('select * from workshop_status_records where id = $1', [rec.id])).rows[0]
  assert.equal(after.current_stage, 'Waiting parts')
  assert.equal(after.last_update_source, 'manual')
  assert.ok(after.last_manual_update_at instanceof Date)
  assert.equal(after.last_updated_by, other)
  assert.equal(after.last_updated_by_name, 'second') // blank full_name falls back to username
  assert.equal(after.first_seen_by, user)
  assert.equal(after.first_seen_at.getTime(), rec.first_seen_at.getTime())

  const ev = (await db.query(`select * from workshop_status_events
    where record_id = $1 and event_type = 'field_change' order by field_name`, [rec.id])).rows
  assert.deepEqual(ev.map(e => e.field_name), ['current_stage', 'diagnostics'])
  assert.equal(ev[0].old_value, null)
  assert.equal(ev[0].new_value, 'Waiting parts')
  assert.equal(ev[1].old_value, 'Pads worn')
  assert.ok(ev.every(e => e.source === 'manual' && e.actor_id === other && e.actor_name === 'second'))
  assert.ok(ev.every(e => e.country === 'KSA' && e.site === 'NHC' && e.asset_no === 'TM514'))
})

test('4. inactive record stays queryable; a new episode is allowed only after it', async () => {
  const rec = (await db.query("select * from workshop_status_records where asset_no = 'TM514'")).rows[0]
  const uae = await withSource('excel', tx => insertRow(tx, 'workshop_status_records', { country: 'UAE', asset_no: 'TM514', site: 'JEBEL ALI' }))
  assert.ok(uae.id, 'the same asset in another country is another machine')

  await withSource('system', tx => tx.query(
    "update workshop_status_records set current_active = false, daily_report_status = 'removed_from_current_report' where id = $1",
    [rec.id]))
  assert.equal((await db.query('select current_active from workshop_status_records where id = $1', [rec.id])).rows[0].current_active, false)
  const fields = (await db.query(`select field_name from workshop_status_events
    where record_id = $1 and event_type = 'field_change'`, [rec.id])).rows.map(r => r.field_name)
  assert.ok(fields.includes('current_active'))
  assert.ok(fields.includes('daily_report_status'))

  const second = await withSource('excel', tx => insertRow(tx, 'workshop_status_records', { country: 'KSA', asset_no: 'TM514', site: 'NHC' }))
  assert.notEqual(second.id, rec.id)
  assert.equal(await count("select count(*)::int n from workshop_status_records where country = 'KSA' and asset_no = 'TM514'"), 2)
})

test('5. clients get scoped SELECT only on records', async () => {
  const rec = (await db.query("select * from workshop_status_records where country = 'KSA' and current_active")).rows[0]
  try {
    await db.exec('set role authenticated')
    assert.equal(await count('select count(*)::int n from workshop_status_records'), 3)
    assert.ok(await count('select count(*)::int n from workshop_status_events') > 0)

    await assert.rejects(db.query("insert into workshop_status_records (country, asset_no) values ('KSA', 'X1')"), isCode('42501'))
    await assert.rejects(db.query("update workshop_status_records set remarks = 'x' where id = $1", [rec.id]), isCode('42501'))
    await assert.rejects(db.query('delete from workshop_status_records where id = $1', [rec.id]), isCode('42501'))
    await assert.rejects(db.query("insert into workshop_status_events (event_type) values ('export')"), isCode('42501'))
    await assert.rejects(db.query("insert into workshop_status_uploads (country, file_name) values ('KSA', 'x.xlsx')"), isCode('42501'))

    await db.exec("set test.can_view = 'false'")
    assert.equal(await count('select count(*)::int n from workshop_status_records'), 0)
    assert.equal(await count('select count(*)::int n from workshop_status_events'), 0)
    await db.exec('reset test.can_view')

    await db.exec("set test.site = 'OTHER SITE'")
    assert.equal(await count('select count(*)::int n from workshop_status_records'), 0)
    await db.exec("set test.site = 'nhc'")
    const nhc = (await db.query('select site from workshop_status_records')).rows
    assert.equal(nhc.length, 2)
    assert.ok(nhc.every(r => r.site === 'NHC'))
    await db.exec('reset test.site')

    await db.exec("set test.country = 'UAE'")
    const uae = (await db.query('select country from workshop_status_records')).rows
    assert.deepEqual(uae.map(r => r.country), ['UAE'])
    await db.exec("set test.country = 'KSA,UAE'")
    assert.equal(await count('select count(*)::int n from workshop_status_records'), 3)
    await db.exec("set test.country = 'Egypt'")
    assert.equal(await count('select count(*)::int n from workshop_status_records'), 0)
    await db.exec("set test.super = 'true'")
    assert.equal(await count('select count(*)::int n from workshop_status_records'), 3, 'super admin sees every country')
    await db.exec('reset test.super; reset test.country')

    await db.exec(`set test.org = '${otherOrg}'`)
    assert.equal(await count('select count(*)::int n from workshop_status_records'), 0)
    await db.exec('reset test.org')

    await db.exec("set test.active = 'false'")
    assert.equal(await count('select count(*)::int n from workshop_status_records'), 0)
    await db.exec('reset test.active')
  } finally {
    await db.exec('reset role; reset test.can_view; reset test.site; reset test.country; reset test.org; reset test.active; reset test.super')
  }
})

test('6. "who" columns are stamped from auth.uid, never from the caller', async () => {
  const rec = (await db.query("select * from workshop_status_records where country = 'KSA' and not current_active")).rows[0]
  await assert.rejects(
    withSource('manual', tx => tx.query("update workshop_status_records set final_disposition = 'other' where id = $1", [rec.id])),
    isCode('23514'))
  await assert.rejects(
    withSource('manual', tx => tx.query(
      "update workshop_status_records set final_disposition = 'other', final_disposition_remarks = '   ' where id = $1", [rec.id])),
    isCode('23514'))

  await asUser(other, () => withSource('manual', tx => tx.query(
    `update workshop_status_records
        set final_disposition = 'other', final_disposition_remarks = 'Moved to yard',
            final_disposition_by = $2, final_disposition_by_name = 'Forged', final_disposition_at = '2001-01-01',
            removed_at = now(), removed_by_user_id = $3, archived_at = now(), archived_by = $3,
            deleted_at = now(), deleted_by = $3
      where id = $1`, [rec.id, user, missing])))
  const r = (await db.query('select * from workshop_status_records where id = $1', [rec.id])).rows[0]
  assert.equal(r.final_disposition, 'other')
  assert.equal(r.final_disposition_by, other)
  assert.equal(r.final_disposition_by_name, 'second')
  assert.ok(r.final_disposition_at.getFullYear() > 2001)
  assert.equal(r.removed_by_user_id, other)
  assert.equal(r.archived_by, other)
  assert.equal(r.deleted_by, other)

  // An unrelated later change keeps the existing who-columns.
  await withSource('manual', tx => tx.query("update workshop_status_records set remarks = 'note' where id = $1", [rec.id]))
  const r2 = (await db.query('select * from workshop_status_records where id = $1', [rec.id])).rows[0]
  assert.equal(r2.final_disposition_by, other)
  assert.equal(r2.deleted_by, other)
  assert.equal(r2.last_updated_by, user)

  // Insert with forged who-columns.
  const ins = await withSource('manual', tx => insertRow(tx, 'workshop_status_records', {
    country: 'KSA', asset_no: 'WHO1', final_disposition: 'wrong_entry', final_disposition_by: other,
    archived_at: '2026-01-01', archived_by: other, current_active: false
  }))
  assert.equal(ins.final_disposition_by, user)
  assert.equal(ins.final_disposition_by_name, 'Workshop Lead')
  assert.equal(ins.archived_by, user)
  assert.equal(ins.last_manual_update_at instanceof Date, true)
})

test('7. an update with no workshop context (FK set-null) keeps last_updated_* but is still audited', async () => {
  const rec = (await db.query('select * from workshop_status_records where vehicle_id = $1', [vehicle])).rows[0]
  assert.ok(rec)
  await asUser(other, () => db.query('delete from vehicle_fleet where id = $1', [vehicle]))
  const r = (await db.query('select * from workshop_status_records where id = $1', [rec.id])).rows[0]
  assert.equal(r.vehicle_id, null)
  assert.equal(r.last_updated_by, rec.last_updated_by)
  assert.equal(r.last_updated_by_name, rec.last_updated_by_name)
  assert.equal(r.last_update_source, rec.last_update_source)
  const ev = (await db.query(`select * from workshop_status_events
    where record_id = $1 and field_name = 'vehicle_id'`, [rec.id])).rows
  assert.equal(ev.length, 1)
  assert.equal(ev[0].old_value, vehicle)
  assert.equal(ev[0].new_value, null)
  assert.equal(ev[0].actor_id, other)
  assert.equal(ev[0].source, 'system')
})

test('8. a malformed workshop.upload_id does not abort the write', async () => {
  const rec = (await db.query("select id from workshop_status_records where country = 'KSA' and current_active and asset_no = 'TM514'")).rows[0]
  await withCtx({ source: 'manual', upload_id: 'not-a-uuid', reason: 'typo fix' }, tx => tx.query(
    "update workshop_status_records set blocker = 'Supplier' where id = $1", [rec.id]))
  const ev = (await db.query(`select * from workshop_status_events
    where record_id = $1 and field_name = 'blocker'`, [rec.id])).rows[0]
  assert.equal(ev.new_value, 'Supplier')
  assert.equal(ev.upload_id, null)
  assert.equal(ev.reason, 'typo fix')
})

test('9. uploads: uploader and confirmer come from auth.uid; confirmed uploads are frozen', async () => {
  const up = await insertRow(db, 'workshop_status_uploads', {
    country: 'KSA', file_name: 'workshop.xlsx', file_hash: 'abc', sheet_name: 'Sheet1', report_date: '2026-10-07',
    uploaded_by: other, uploaded_by_name: 'Forged', uploaded_at: '2001-01-01',
    confirmed_by: other, confirmed_at: '2001-01-01', closed_count: 2
  })
  assert.equal(up.status, 'previewed')
  assert.equal(up.uploaded_by, user)
  assert.equal(up.uploaded_by_name, 'Workshop Lead')
  assert.ok(up.uploaded_at.getFullYear() > 2001)
  assert.equal(up.confirmed_by, null)
  assert.equal(up.confirmed_at, null)
  assert.equal(up.sheet_name, 'Sheet1')
  assert.equal(up.closed_count, 2)

  await asUser(other, () => db.query(
    "update workshop_status_uploads set status = 'confirmed', confirmed_by = $2, confirmed_by_name = 'Forged', uploaded_by = $2 where id = $1",
    [up.id, user]))
  const c = (await db.query('select * from workshop_status_uploads where id = $1', [up.id])).rows[0]
  assert.equal(c.status, 'confirmed')
  assert.equal(c.confirmed_by, other)
  assert.equal(c.confirmed_by_name, 'second')
  assert.ok(c.confirmed_at instanceof Date)
  assert.equal(c.uploaded_by, user)

  await assert.rejects(db.query("update workshop_status_uploads set status = 'cancelled' where id = $1", [up.id]), isCode('42501'))
  await assert.rejects(db.query("update workshop_status_uploads set status = 'previewed' where id = $1", [up.id]), isCode('42501'))

  await db.query("update workshop_status_uploads set file_hash = 'zzz', country = 'UAE', notes = 'ok' where id = $1", [up.id])
  const f = (await db.query('select * from workshop_status_uploads where id = $1', [up.id])).rows[0]
  assert.equal(f.file_hash, 'abc')
  assert.equal(f.country, 'KSA')
  assert.equal(f.notes, 'ok')
  assert.equal(f.confirmed_by, other, 'a later edit does not re-stamp the confirmer')

  const cancel = await insertRow(db, 'workshop_status_uploads', { country: 'KSA', file_name: 'b.xlsx' })
  await asUser(other, () => db.query("update workshop_status_uploads set status = 'cancelled', cancelled_by = $2 where id = $1", [cancel.id, user]))
  const cc = (await db.query('select * from workshop_status_uploads where id = $1', [cancel.id])).rows[0]
  assert.equal(cc.cancelled_by, other)
  await assert.rejects(db.query("update workshop_status_uploads set status = 'confirmed' where id = $1", [cancel.id]), isCode('42501'))
})

test('10. upload rows inherit the upload scope and are append-only', async () => {
  const ksa = (await db.query("select * from workshop_status_uploads where file_name = 'workshop.xlsx'")).rows[0]
  const uaeUp = await insertRow(db, 'workshop_status_uploads', { country: 'UAE', file_name: 'uae.xlsx' })
  const row = await insertRow(db, 'workshop_status_upload_rows', {
    upload_id: ksa.id, country: 'UAE', organisation_id: otherOrg, row_number: 1, section: 'TRANSIT MIXER',
    asset_no: 'TM514', outcome: 'closed', record_id: missing
  })
  assert.equal(row.country, 'KSA')
  assert.equal(row.organisation_id, org)
  assert.equal(row.section, 'TRANSIT MIXER')
  assert.equal(row.outcome, 'closed')
  assert.equal(row.record_id, missing, 'record_id has no foreign key')
  await insertRow(db, 'workshop_status_upload_rows', { upload_id: uaeUp.id, asset_no: 'TM514', outcome: 'new' })

  await assert.rejects(db.query("update workshop_status_upload_rows set outcome = 'new' where id = $1", [row.id]), isCode('42501'))
  await assert.rejects(db.query('delete from workshop_status_upload_rows where id = $1', [row.id]), isCode('42501'))
  await assert.rejects(db.exec('truncate workshop_status_upload_rows'), isCode('42501'))
  await assert.rejects(db.query("insert into workshop_status_upload_rows (upload_id, outcome) values ($1, 'bogus')", [ksa.id]), isCode('23514'))

  try {
    await db.exec("set role authenticated; set test.country = 'KSA'")
    const vis = (await db.query('select country from workshop_status_upload_rows')).rows
    assert.deepEqual(vis.map(r => r.country), ['KSA'])
    assert.deepEqual((await db.query('select country from workshop_status_uploads order by country')).rows.map(r => r.country),
      ['KSA', 'KSA'])
  } finally {
    await db.exec('reset role; reset test.country')
  }
})

test('11. events: forged actor overwritten, scope filled, append-only incl. TRUNCATE', async () => {
  const rec = (await db.query("select * from workshop_status_records where country = 'UAE'")).rows[0]
  const forged = await insertRow(db, 'workshop_status_events', {
    record_id: rec.id, event_type: 'export', actor_id: other, actor_name: 'Somebody Else',
    created_at: '2001-01-01', source: 'manual'
  })
  assert.equal(forged.actor_id, user)
  assert.equal(forged.actor_name, 'Workshop Lead')
  assert.ok(forged.created_at.getFullYear() > 2001)
  assert.equal(forged.organisation_id, org)
  assert.equal(forged.country, 'UAE')
  assert.equal(forged.site, 'JEBEL ALI')
  assert.equal(forged.asset_no, 'TM514')

  const uaeUp = (await db.query("select id from workshop_status_uploads where file_name = 'uae.xlsx'")).rows[0]
  const byUpload = await insertRow(db, 'workshop_status_events', { upload_id: uaeUp.id, event_type: 'upload_previewed' })
  assert.equal(byUpload.country, 'UAE')

  const ev = (await db.query('select id from workshop_status_events limit 1')).rows[0]
  await assert.rejects(db.query("update workshop_status_events set reason = 'x' where id = $1", [ev.id]), isCode('42501'))
  await assert.rejects(db.query('delete from workshop_status_events where id = $1', [ev.id]), isCode('42501'))
  await assert.rejects(db.query('delete from workshop_status_events'), isCode('42501'))
  await assert.rejects(db.exec('truncate workshop_status_events'), isCode('42501'))
})

test('12. attachments copy scope from the record and stamp the uploader / deleter', async () => {
  const rec = (await db.query("select * from workshop_status_records where country = 'KSA' and current_active and asset_no = 'TM514'")).rows[0]
  const att = await insertRow(db, 'workshop_status_attachments', {
    record_id: rec.id, storage_path: 'p/1.jpg', file_name: '1.jpg', category: 'damage_photo',
    organisation_id: otherOrg, country: 'UAE', site: 'ELSEWHERE', asset_no: 'NOPE',
    uploaded_by: other, uploaded_by_name: 'Forged', deleted_at: '2026-01-01', deleted_by: other
  })
  assert.equal(att.organisation_id, org)
  assert.equal(att.country, 'KSA')
  assert.equal(att.site, 'NHC')
  assert.equal(att.asset_no, 'TM514')
  assert.equal(att.uploaded_by, user)
  assert.equal(att.uploaded_by_name, 'Workshop Lead')
  assert.equal(att.deleted_at, null)
  assert.equal(att.deleted_by, null)

  await assert.rejects(insertRow(db, 'workshop_status_attachments', {
    record_id: missing, storage_path: 'p/2.jpg', file_name: '2.jpg'
  }), isCode('23503'))

  await asUser(other, () => db.query(
    "update workshop_status_attachments set deleted_at = now(), deleted_by = $2, delete_reason = 'blurry', storage_path = 'x', record_id = $3 where id = $1",
    [att.id, user, missing]))
  const d = (await db.query('select * from workshop_status_attachments where id = $1', [att.id])).rows[0]
  assert.ok(d.deleted_at instanceof Date)
  assert.equal(d.deleted_by, other)
  assert.equal(d.delete_reason, 'blurry')
  assert.equal(d.storage_path, 'p/1.jpg')
  assert.equal(d.record_id, rec.id)
  assert.equal(d.uploaded_by, user)
})

test('13. a hard DELETE leaves a permanently_deleted event; upload rows survive', async () => {
  const rec = await withSource('excel', tx => insertRow(tx, 'workshop_status_records', { country: 'KSA', asset_no: 'DEL1', site: 'NHC' }))
  const up = (await db.query("select id from workshop_status_uploads where file_name = 'workshop.xlsx'")).rows[0]
  const row = await insertRow(db, 'workshop_status_upload_rows', { upload_id: up.id, asset_no: 'DEL1', outcome: 'new', record_id: rec.id })

  await withCtx({ source: 'system', reason: 'wrong entry' }, tx => tx.query('delete from workshop_status_records where id = $1', [rec.id]))
  assert.equal(await count('select count(*)::int n from workshop_status_records where id = $1', [rec.id]), 0)
  const ev = (await db.query(`select * from workshop_status_events
    where record_id = $1 and event_type = 'permanently_deleted'`, [rec.id])).rows
  assert.equal(ev.length, 1)
  assert.equal(ev[0].details.record.asset_no, 'DEL1')
  assert.equal(ev[0].details.record.id, rec.id)
  assert.equal(ev[0].reason, 'wrong entry')
  assert.equal(ev[0].actor_id, user)
  assert.equal(ev[0].country, 'KSA')
  const kept = (await db.query('select * from workshop_status_upload_rows where id = $1', [row.id])).rows[0]
  assert.equal(kept.record_id, rec.id)
})

test('14. breakdown link is found only when exactly one open breakdown matches; register never written', async () => {
  const pick = async (o, c, a) => (await db.query('select workshop_status_breakdown_for($1,$2,$3) id', [o, c, a])).rows[0].id
  assert.equal(await pick(org, 'KSA', 'tm514'), bdOpen, 'whitespace and case insensitive')
  assert.equal(await pick(org, 'KSA', ' TM 514 '), bdOpen)
  assert.equal(await pick(org, 'KSA', 'TM600'), null, 'returned_to_service rows are ignored')
  assert.equal(await pick(org, 'KSA', 'MP001'), null, 'two open breakdowns is never a guess')
  assert.equal(await pick(org, 'KSA', 'TM700'), null, 'other country')
  assert.equal(await pick(org, 'UAE', 'TM700'), bdOtherCountry)
  assert.equal(await pick(otherOrg, 'KSA', 'TM514'), null, 'other organisation')
  assert.equal(await pick(org, 'KSA', 'NOPE'), null)

  const rec = (await db.query("select id from workshop_status_records where country = 'KSA' and current_active and asset_no = 'TM514'")).rows[0]
  await withSource('system', tx => tx.query(
    'update workshop_status_records set asset_breakdown_id = workshop_status_breakdown_for(organisation_id, country, asset_no) where id = $1',
    [rec.id]))
  assert.equal((await db.query('select asset_breakdown_id from workshop_status_records where id = $1', [rec.id])).rows[0].asset_breakdown_id, bdOpen)
  const ev = (await db.query(`select new_value from workshop_status_events
    where record_id = $1 and field_name = 'asset_breakdown_id'`, [rec.id])).rows
  assert.deepEqual(ev.map(e => e.new_value), [bdOpen])

  try {
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select workshop_status_breakdown_for($1,$2,$3)', [org, 'KSA', 'TM514']), isCode('42501'))
  } finally {
    await db.exec('reset role')
  }

  assert.deepEqual((await db.query('select * from asset_breakdowns order by id')).rows, breakdownSnapshot)
})
