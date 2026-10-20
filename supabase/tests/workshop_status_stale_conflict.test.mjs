import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// PGlite harness for supabase/pending_migrations/20261011140000_workshop_status_stale_conflict.sql
// (Loop 16: a stale daily Excel must not overwrite a newer manual update),
// applied on top of the foundation, permissions, upload confirm, manual update
// and removed-recovery migrations. Also covers the null-file-hash stage fix.

const read = f => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const FOUNDATION = read('20261007090000_workshop_status_foundation.sql')
const PERMISSIONS = read('20261007100000_workshop_status_permissions.sql')
const CONFIRM = read('20261007110000_workshop_status_upload_confirm.sql')
const MANUAL = read('20261007120000_workshop_status_manual_update.sql')
const RECOVERY = read('20261007130000_workshop_status_removed_recovery.sql')
const STALE = readFileSync(new URL('../pending_migrations/20261011140000_workshop_status_stale_conflict.sql', import.meta.url), 'utf8')

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const org = id(900)
const U = { supervisor: id(2), admin: id(3) }

const db = new PGlite()
const hasMsg = text => e => String(e?.message || '').includes(text)

async function asUser (uid, fn) {
  await db.exec(`set test.uid = '${uid}'`)
  try { return await fn() } finally { await db.exec('reset test.uid') }
}
const count = async (sql, params = []) => (await db.query(sql, params)).rows[0].n

const baseData = (asset, extra = {}) => ({
  asset_no: asset, reg_no: `REG-${asset}`, job_card_ref: `JC/${asset}`, vehicle_category: 'TRANSIT MIXER',
  site: 'NHC', department: 'WORKSHOP', complaint: `Complaint ${asset}`, diagnostics: 'Checked',
  ooc_since: '2026-10-01', excel_down_days: 6, excel_expected_release: null, excel_status_note: null,
  source_remarks: 'WAITING FOR PARTS', ...extra,
})
let rowNo = 0
const row = (asset, outcome, extra = {}, more = {}) => ({
  row_number: outcome === 'removed' ? null : ++rowNo,
  section: 'TRANSIT MIXER', asset_no: asset, site: 'NHC', outcome,
  data: outcome === 'removed' ? {} : baseData(asset, extra), raw: {}, changes: {}, errors: [],
  record_id: null, ...more,
})

async function stage (rows, { hash = null, reportDate = null } = {}) {
  return asUser(U.supervisor, async () => (await db.query(
    `select public.workshop_status_stage_upload($1, $2, $3, $4, $5, $6, $7, $8, $9) r`,
    ['KSA', 'daily.xlsx', hash, 1234, 'Sheet1', reportDate, '{}', [], JSON.stringify(rows)])).rows[0].r)
}
const confirm = (uploadId, ack = false) => asUser(U.supervisor, async () => (await db.query(
  'select public.workshop_status_confirm_upload($1, $2) r', [uploadId, ack])).rows[0].r)
const update = (recordId, patch) => asUser(U.supervisor, async () => (await db.query(
  'select public.workshop_status_update_record($1, $2, null) r', [recordId, JSON.stringify(patch)])).rows[0].r)
const record = async asset => (await db.query(
  `select * from workshop_status_records where asset_no = $1 order by created_at desc, id desc limit 1`, [asset])).rows[0]

let today, tomorrow, yesterday

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
    create table public.asset_breakdowns(id uuid primary key, organisation_id uuid, country text,
      asset_no text, returned_to_service boolean);
    insert into public.profiles (id, full_name, role, organisation_id) values
      ('${U.supervisor}', 'Super Visor', 'Workshop Supervisor', '${org}'),
      ('${U.admin}', 'Addie', 'Admin', '${org}');
    grant usage on schema public, auth to authenticated;
  `)
  await db.exec(FOUNDATION)
  await db.exec(PERMISSIONS)
  await db.exec(CONFIRM)
  await db.exec(MANUAL)
  await db.exec(RECOVERY)
  await db.exec(STALE)
  const d = (await db.query(`select (now() at time zone 'Asia/Riyadh')::date::text t,
    ((now() at time zone 'Asia/Riyadh')::date + 1)::text n, ((now() at time zone 'Asia/Riyadh')::date - 1)::text y`)).rows[0]
  today = d.t; tomorrow = d.n; yesterday = d.y

  // Baseline: four vehicles in the report, from a file two days old.
  const st = await stage([row('TM1', 'new'), row('TM2', 'new'), row('TM3', 'new'), row('TM4', 'new')],
    { hash: 'base', reportDate: yesterday })
  await confirm(st.upload_id)
})

after(async () => { await db.close() })

test('1. null file hash no longer breaks staging (no duplicate check)', async () => {
  const st = await stage([row('TM1', 'unchanged')], { hash: null, reportDate: yesterday })
  assert.ok(st.upload_id)
  assert.equal(st.duplicate_of, null)
  assert.equal(st.conflicts, 0)
  await asUser(U.supervisor, () => db.query('select public.workshop_status_cancel_upload($1)', [st.upload_id]))
  const blank = await stage([row('TM1', 'unchanged')], { hash: '   ', reportDate: yesterday })
  assert.equal(blank.duplicate_of, null)
  await asUser(U.supervisor, () => db.query('select public.workshop_status_cancel_upload($1)', [blank.upload_id]))
})

test('2. newer manual update is KEPT by default: no Excel overwrite, no release', async () => {
  const tm1 = await record('TM1')
  const tm2 = await record('TM2')
  await update(tm1.id, { current_stage: 'Repair in Progress', remarks: 'Engine opened today' })
  await update(tm2.id, { current_stage: 'Testing' })
  const tm1Before = await record('TM1')

  // Same-day file: TM1 complaint differs, TM2 missing (would be released).
  const st = await stage([
    row('TM1', 'changed', { complaint: 'Stale complaint' }),
    row('TM3', 'unchanged'), row('TM4', 'unchanged'),
    row('TM2', 'removed', {}, { record_id: tm2.id }),
  ], { hash: 'c1', reportDate: today })
  assert.equal(st.conflicts, 2, 'both the changed and the removed row are flagged at stage')
  const flagged = (await db.query(`select asset_no, outcome, conflict, resolution, conflict_details
    from workshop_status_upload_rows where upload_id = $1 and conflict is not null order by asset_no`, [st.upload_id])).rows
  assert.deepEqual(flagged.map(r => [r.asset_no, r.outcome, r.conflict, r.resolution]),
    [['TM1', 'changed', 'manual_newer', null], ['TM2', 'removed', 'manual_newer', null]])
  assert.equal(flagged[0].conflict_details.last_updated_by_name, 'Super Visor')

  const sum = await confirm(st.upload_id)
  assert.equal(sum.kept_manual, 2)
  assert.equal(sum.conflicts, 2)
  assert.equal(sum.updated, 0)
  assert.equal(sum.removed, 0)
  assert.equal(sum.active_after, 4)

  const tm1After = await record('TM1')
  assert.equal(tm1After.complaint, tm1Before.complaint, 'Excel field not overwritten')
  assert.equal(tm1After.current_stage, 'Repair in Progress')
  assert.equal(tm1After.remarks, 'Engine opened today')
  assert.equal(tm1After.last_update_source, 'manual', 'still the manual update stamp')
  assert.equal(tm1After.last_seen_upload_id, st.upload_id)
  const tm2After = await record('TM2')
  assert.equal(tm2After.current_active, true, 'not released')
  assert.equal(tm2After.daily_report_status, 'active')
  assert.equal(await count(`select count(*)::int n from workshop_status_events
    where upload_id = $1 and event_type in ('field_change', 'removed', 'excel_updated')`, [st.upload_id]), 0)
  const u = (await db.query('select conflict_count, kept_manual_count from workshop_status_uploads where id = $1', [st.upload_id])).rows[0]
  assert.deepEqual([u.conflict_count, u.kept_manual_count], [2, 2])
  const ev = (await db.query(`select details from workshop_status_events
    where upload_id = $1 and event_type = 'upload_confirmed'`, [st.upload_id])).rows[0]
  assert.equal(ev.details.record_ids.kept_manual.length, 2)
  assert.deepEqual(ev.details.conflict_rows.map(c => [c.asset_no, c.kind, c.resolution]).sort(),
    [['TM1', 'changed', 'keep_manual'], ['TM2', 'removed', 'keep_manual']])
  // Upload rows stay append-only evidence.
  await assert.rejects(db.query(`update workshop_status_upload_rows set resolution = 'take_file' where upload_id = $1`,
    [st.upload_id]), hasMsg('cannot be changed'))
})

test('3. take_file overrides the newer manual update (Excel fields refreshed, vehicle released)', async () => {
  const tm1 = await record('TM1')
  const tm2 = await record('TM2')
  const st = await stage([
    row('TM1', 'changed', { complaint: 'File wins' }, { resolution: 'take_file' }),
    row('TM3', 'unchanged'), row('TM4', 'unchanged'),
    row('TM2', 'removed', {}, { record_id: tm2.id, resolution: 'take_file' }),
  ], { hash: 'c2', reportDate: today })
  assert.equal(st.conflicts, 2)
  const sum = await confirm(st.upload_id)
  assert.deepEqual([sum.updated, sum.removed, sum.kept_manual, sum.conflicts], [1, 1, 0, 2])
  const tm1After = await record('TM1')
  assert.equal(tm1After.complaint, 'File wins')
  assert.equal(tm1After.current_stage, 'Repair in Progress', 'TyrePulse-owned fields still untouched')
  assert.equal(tm1After.id, tm1.id)
  const tm2After = (await db.query('select * from workshop_status_records where id = $1', [tm2.id])).rows[0]
  assert.equal(tm2After.current_active, false)
  assert.equal(tm2After.daily_report_status, 'removed_from_current_report')
  const rem = (await db.query(`select details from workshop_status_events
    where upload_id = $1 and event_type = 'removed'`, [st.upload_id])).rows[0]
  assert.equal(rem.details.conflict, 'manual_newer')
  assert.equal(rem.details.resolution, 'take_file')
})

test('4. a manual update OLDER than the report date is overwritten normally (no conflict)', async () => {
  const tm3 = await record('TM3')
  await update(tm3.id, { current_stage: 'Waiting for Parts' })
  const st = await stage([
    row('TM1', 'unchanged', { complaint: 'File wins' }),
    row('TM3', 'changed', { complaint: 'Next-day complaint' }),
  ], { hash: 'c3', reportDate: tomorrow })
  assert.equal(st.conflicts, 0)
  const sum = await confirm(st.upload_id)
  assert.equal(sum.conflicts, 0)
  assert.equal(sum.kept_manual, 0)
  assert.equal(sum.updated, 1)
  assert.equal(sum.removed, 1, 'TM4 (never manually updated) is released normally')
  assert.equal((await record('TM3')).complaint, 'Next-day complaint')
  assert.equal((await record('TM4')).current_active, false)
})

test('5. no report date: cannot be judged, the file applies; a bad choice is refused', async () => {
  const tm3 = await record('TM3')
  await update(tm3.id, { remarks: 'today' })
  const st = await stage([row('TM1', 'unchanged', { complaint: 'File wins' }), row('TM3', 'changed', { complaint: 'Undated' })],
    { hash: 'c4', reportDate: null })
  assert.equal(st.conflicts, 0)
  const sum = await confirm(st.upload_id)
  assert.equal(sum.updated, 1)
  assert.equal((await record('TM3')).complaint, 'Undated')
  await assert.rejects(stage([row('TM1', 'unchanged', {}, { resolution: 'whatever' })], { hash: 'c5', reportDate: today }),
    hasMsg('Unknown conflict choice'))
})

test('6. the confirm re-checks the live record: a manual update after staging still defaults to keep', async () => {
  const st = await stage([row('TM1', 'unchanged', { complaint: 'File wins' }), row('TM3', 'changed', { complaint: 'Late file' })],
    { hash: 'c6', reportDate: today })
  // TM3 was manually updated in test 5, so it is flagged already.
  assert.equal(st.conflicts, 1)
  const sum = await confirm(st.upload_id)
  assert.equal(sum.kept_manual, 1)
  assert.equal((await record('TM3')).complaint, 'Undated')
})

test('7. local day: helper follows the country time zone; grants are closed', async () => {
  const r = (await db.query(`select public.workshop_status_local_date('2026-10-07T22:30:00Z', 'KSA')::text k,
    public.workshop_status_local_date('2026-10-07T22:30:00Z', 'Egypt')::text e,
    public.workshop_status_local_date('2026-10-07T22:30:00Z', null)::text z,
    public.workshop_status_manual_newer(null, 'KSA', '2026-10-07') a,
    public.workshop_status_manual_newer('2026-10-07T22:30:00Z', 'KSA', '2026-10-08') b,
    public.workshop_status_manual_newer('2026-10-07T20:00:00Z', 'KSA', '2026-10-08') c`)).rows[0]
  assert.deepEqual([r.k, r.e, r.z, r.a, r.b, r.c], ['2026-10-08', '2026-10-08', '2026-10-07', false, true, false])
  const g = (await db.query(`select
    has_function_privilege('anon', 'public.workshop_status_stage_upload(text, text, text, bigint, text, date, jsonb, text[], jsonb)', 'execute') a1,
    has_function_privilege('anon', 'public.workshop_status_confirm_upload(uuid, boolean)', 'execute') a2,
    has_function_privilege('authenticated', 'public.workshop_status_confirm_upload(uuid, boolean)', 'execute') au,
    has_function_privilege('authenticated', 'public.workshop_status_manual_newer(timestamptz, text, date)', 'execute') h`)).rows[0]
  assert.deepEqual([g.a1, g.a2, g.au, g.h], [false, false, true, false])
  assert.doesNotMatch(STALE.replace(/--.*$/gm, ''), /\bdelete\s+from\b/i, 'the migration has no DELETE statement')
})
