import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// PGlite harness for supabase/migrations/20261007140000_workshop_status_notifications.sql,
// applied on top of Loops 1, 2, 6, 8 and 11. Unlike the earlier harnesses the
// auth.uid() stub reads request.jwt.claim.sub FIRST (as Supabase's own does)
// and the country / site scope readers read the CALLER'S profile, so the
// per-recipient impersonation in workshop_status_recipient_scope is exercised
// against real per-user scopes.

const read = f => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const FOUNDATION = read('20261007090000_workshop_status_foundation.sql')
const PERMISSIONS = read('20261007100000_workshop_status_permissions.sql')
const CONFIRM = read('20261007110000_workshop_status_upload_confirm.sql')
const MANUAL = read('20261007120000_workshop_status_manual_update.sql')
const RECOVERY = read('20261007130000_workshop_status_removed_recovery.sql')
const NOTIFY = read('20261007140000_workshop_status_notifications.sql')

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const org = id(900)
const otherOrg = id(901)
const U = {
  mech1: id(1), mech2: id(2), sup: id(3), reporter: id(4), uaeSup: id(5),
  outsider: id(6), pending: id(7), revoked: id(8),
}

const db = new PGlite()
async function asUser (uid, fn) {
  await db.exec(`set test.uid = '${uid}'`)
  try { return await fn() } finally { await db.exec('reset test.uid') }
}
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const notesFor = uid => rows('select * from notifications where user_id = $1 order by created_at, title', [uid])
const recId = async asset => (await rows(
  "select id from workshop_status_records where asset_no = $1 and current_active order by created_at desc limit 1", [asset]))[0]?.id

let hashNo = 0
async function stage (uid, list, country = 'KSA') {
  return asUser(uid, async () => (await db.query(
    'select public.workshop_status_stage_upload($1, $2, $3, $4, $5, $6, $7, $8, $9) r',
    [country, 'daily.xlsx', `hash-${++hashNo}`, 1, 'Sheet1', '2026-10-07', JSON.stringify({}), [],
      JSON.stringify(list.map((x, i) => ({
        row_number: i + 1, asset_no: x.asset, site: x.site, outcome: x.outcome || 'new',
        data: { site: x.site, complaint: x.complaint || 'Fault' },
      })))])).rows[0].r)
}
const confirm = (uid, uploadId) => asUser(uid, async () => (await db.query(
  'select public.workshop_status_confirm_upload($1, false) r', [uploadId])).rows[0].r)
const scan = async at => (await db.query('select public.workshop_status_notify_scan($1::timestamptz) r', [at])).rows[0].r
async function setRecord (asset, patch) {
  const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 2}`).join(', ')
  await db.exec("select set_config('workshop.source', 'system', false)")
  await db.query(`update workshop_status_records set ${sets} where asset_no = $1 and current_active`,
    [asset, ...Object.values(patch)])
  await db.exec("select set_config('workshop.source', '', false)")
}

before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                      nullif(current_setting('test.uid', true), ''))::uuid $$;
    create table public.profiles(id uuid primary key, full_name text, username text, role text,
      organisation_id uuid, org_id uuid, is_super_admin boolean default false, approved boolean default true,
      locked boolean default false, country text[], sites text[], push_token text);
    create function public.app_current_org() returns uuid language sql stable as $$ select '${org}'::uuid $$;
    create function public.app_is_active() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.profiles where id = auth.uid()
                      and coalesce(approved, true) and not coalesce(locked, false)) $$;
    create function public.is_super_admin() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.profiles where id = auth.uid()
                      and coalesce(is_super_admin, false) and not coalesce(locked, false)) $$;
    create function public.app_sees_all_countries() returns boolean language sql stable security definer as $$
      select coalesce((select exists (select 1 from unnest(p.country) x where lower(btrim(x)) = 'all')
                         from public.profiles p where p.id = auth.uid()), false) $$;
    create function public.app_country_scope() returns text[] language sql stable security definer as $$
      select coalesce((select array_agg(lower(btrim(x))) from public.profiles p, unnest(p.country) x
                        where p.id = auth.uid()), '{}'::text[]) $$;
    create function public.app_sees_all_sites() returns boolean language sql stable security definer as $$
      select coalesce((select p.is_super_admin or p.role = 'Admin'
                              or exists (select 1 from unnest(p.sites) s where upper(btrim(s)) in ('ALL', '*'))
                         from public.profiles p where p.id = auth.uid()), false) $$;
    create function public.app_site_scope() returns text[] language sql stable security definer as $$
      select coalesce((select array_agg(upper(btrim(s))) from public.profiles p, unnest(p.sites) s
                        where p.id = auth.uid()), '{}'::text[]) $$;
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
    create table public.notifications(id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.profiles(id) on delete cascade, type text default 'info',
      title text not null, body text, entity_type text, entity_id uuid, read boolean default false,
      created_at timestamptz default clock_timestamp());
    create table public.domain_events(id bigint generated always as identity primary key, event_type text not null,
      entity_type text, entity_id text, organisation_id uuid, actor_id uuid, payload jsonb not null default '{}'::jsonb,
      status text not null default 'pending', processed_at timestamptz, created_at timestamptz default now());
    create table public.workflow_notifications(id bigint generated always as identity primary key,
      event_id bigint not null unique, organisation_id uuid, instance_id uuid, event_type text not null,
      payload jsonb not null default '{}'::jsonb, recipient_count int not null default 0,
      status text not null default 'pending');
    insert into public.profiles (id, full_name, role, organisation_id, org_id, approved, country, sites, push_token) values
      ('${U.mech1}', 'Mech One', 'Mechanic', '${org}', '${org}', true, '{KSA}', '{NHC}', 'tok-mech1'),
      ('${U.mech2}', 'Mech Two', 'Mechanic', '${org}', '${org}', true, '{KSA}', '{JED}', null),
      ('${U.sup}', 'Sajid Kamboh', 'Workshop Supervisor', '${org}', '${org}', true, '{KSA}', '{ALL}', null),
      ('${U.reporter}', 'Reggie', 'Reporter', '${org}', '${org}', true, '{KSA}', '{ALL}', null),
      ('${U.uaeSup}', 'UAE Sup', 'Workshop Supervisor', '${org}', '${org}', true, '{UAE}', '{ALL}', null),
      ('${U.outsider}', 'Outside', 'Workshop Supervisor', '${otherOrg}', '${otherOrg}', true, '{KSA}', '{ALL}', null),
      ('${U.pending}', 'Pending', 'Workshop Supervisor', '${org}', '${org}', false, '{KSA}', '{ALL}', null),
      ('${U.revoked}', 'Revoked', 'Workshop Supervisor', '${org}', '${org}', true, '{KSA}', '{ALL}', null);
    insert into public.user_access_grants (user_id, module_key, capability, effect) values
      ('${U.revoked}', 'daily_ops:workshop', 'view', 'revoke');
    grant usage on schema public, auth to authenticated;
  `)
  await db.exec(FOUNDATION)
  await db.exec(PERMISSIONS)
  await db.exec(CONFIRM)
  await db.exec(MANUAL)
  await db.exec(RECOVERY)
  await db.exec(NOTIFY)
})

after(async () => { await db.close() })

test('migration is marked not applied and grants nothing to clients', async () => {
  assert.match(NOTIFY, /STATUS: NOT APPLIED/)
  const fns = ['workshop_status_notify_scan(timestamptz)', 'workshop_status_notify_upload(uuid,jsonb)',
    'workshop_status_recipient_scope(uuid)', 'workshop_status_notice_candidates(uuid)',
    'workshop_status_notice_send(uuid,uuid,text,text,text,text,uuid,text)']
  for (const f of fns) {
    const r = (await rows(`select has_function_privilege('anon', 'public.${f}', 'execute') a,
      has_function_privilege('authenticated', 'public.${f}', 'execute') b`))[0]
    assert.deepEqual(r, { a: false, b: false }, f)
  }
  const t = (await rows(`select has_table_privilege('authenticated', 'public.workshop_status_notices', 'select') s`))[0]
  assert.equal(t.s, false)
})

test('wait categories only use the controlled delay vocabulary', async () => {
  const vocab = (await rows("select public.workshop_status_manual_vocab('delay') v"))[0].v
  for (const d of ['Waiting for Spare Parts', 'Spare Parts Not Available', 'MR Pending', 'PO Pending',
    'Supplier Delivery Pending', 'Waiting for Manpower', 'Technician Not Available',
    'Specialist Technician Required', 'Waiting for Approval', 'Waiting for Budget Approval']) {
    assert.ok(vocab.includes(d), d)
  }
  const r = (await rows(`select public.workshop_status_wait_category(null, 'PO Pending') a,
    public.workshop_status_wait_category('Waiting for Manpower', null) b,
    public.workshop_status_wait_category(null, 'Waiting for Budget Approval') c,
    public.workshop_status_wait_category('Repair in Progress', 'Electrical Issue') d`))[0]
  assert.deepEqual(r, { a: 'parts', b: 'manpower', c: 'approval', d: null })
})

test('recipient scope uses the real decisions per user and restores the caller', async () => {
  const s = await asUser(U.sup, async () => {
    const scope = (await rows('select public.workshop_status_recipient_scope($1) s', [U.mech1]))[0].s
    const after = (await rows('select auth.uid()::text u'))[0].u
    return { scope, after }
  })
  assert.equal(s.after, U.sup, 'caller restored')
  assert.equal(s.scope.view, true)
  assert.equal(s.scope.update, true)
  assert.equal(s.scope.assign, false)
  assert.deepEqual(s.scope.sites, ['NHC'])
  const cands = (await rows('select public.workshop_status_notice_candidates($1) c', [org]))[0].c
  const ids = cands.map(c => c.user_id).sort()
  assert.deepEqual(ids, [U.mech1, U.mech2, U.sup, U.uaeSup].sort(),
    'reporter, outsider, pending and revoked are never candidates')
})

let upload1
test('first confirmed upload: assigners told once about vehicles nobody owns', async () => {
  const st = await stage(U.sup, [
    { asset: 'TM1', site: 'NHC' }, { asset: 'TM2', site: 'JED' }, { asset: 'TM3', site: 'NHC' },
  ])
  upload1 = st.upload_id
  await confirm(U.sup, upload1)
  const sup = await notesFor(U.sup)
  assert.equal(sup.length, 1)
  assert.equal(sup[0].type, 'workshop_status_upload_unassigned')
  assert.match(sup[0].title, /3 vehicles have no responsible person/)
  assert.match(sup[0].body, /TM1, TM2, TM3/)
  assert.equal(sup[0].entity_type, 'workshop_status_upload')
  for (const u of [U.mech1, U.mech2, U.reporter, U.uaeSup, U.outsider, U.pending, U.revoked]) {
    assert.equal((await notesFor(u)).length, 0, `no notice for ${u}`)
  }
  // Re-running the notifier for the same upload sends nothing.
  const details = (await rows("select details from workshop_status_events where upload_id = $1 and event_type = 'upload_confirmed'", [upload1]))[0].details
  const again = (await rows('select public.workshop_status_notify_upload($1, $2) r', [upload1, details]))[0].r
  assert.equal(again.sent, 0)
})

test('second upload: each responsible person gets ONE notice for their vehicles; released named to assigners', async () => {
  await setRecord('TM1', { responsible_user_id: U.mech1 })
  await setRecord('TM2', { responsible_user_id: U.mech2 })
  await setRecord('TM3', { responsible_user_id: U.mech2 })
  const st = await stage(U.sup, [
    { asset: 'TM1', site: 'NHC', outcome: 'changed', complaint: 'Gearbox noise now' },
    { asset: 'TM2', site: 'JED', outcome: 'unchanged' },
    { asset: 'TM4', site: 'NHC' },
  ])
  await confirm(U.sup, st.upload_id)
  const tm1 = await recId('TM1')

  const m1 = await notesFor(U.mech1)
  assert.equal(m1.length, 1)
  assert.equal(m1[0].type, 'workshop_status_upload_mine')
  assert.match(m1[0].title, /1 vehicle needs your update today/)
  assert.match(m1[0].body, /TM1 \(1 changed\)/)
  assert.equal(m1[0].entity_type, 'workshop_status_record')
  assert.equal(m1[0].entity_id, tm1, 'deep link to the exact vehicle')

  const m2 = await notesFor(U.mech2)
  assert.equal(m2.length, 1)
  assert.match(m2[0].body, /Assigned to you: TM2\./)
  assert.doesNotMatch(m2[0].body, /Released/, 'mechanic without view_removed is not told released assets')

  const sup = await notesFor(U.sup)
  assert.equal(sup.length, 2)
  const last = sup[1]
  assert.equal(last.type, 'workshop_status_upload_unassigned')
  assert.match(last.body, /No responsible person: TM4\./)
  assert.match(last.body, /Released from the daily file: TM3\./)
  assert.doesNotMatch(`${last.title} ${last.body}`, /removed/i)

  // Push queued through the existing pipeline for the person with a device.
  const wn = await rows('select * from workflow_notifications order by id')
  assert.equal(wn.length, 1)
  assert.equal(wn[0].payload.push.title, m1[0].title)
  assert.deepEqual(wn[0].payload.recipients, [{ user_id: U.mech1, push_token: 'tok-mech1' }])
  assert.equal(wn[0].payload.link, `/daily-ops/workshop?record=${tm1}`)
  assert.equal(wn[0].status, 'pending')
  const ev = await rows('select * from domain_events where id = $1', [wn[0].event_id])
  assert.equal(ev[0].status, 'processed')
})

test('a failing notifier never blocks the confirm', async () => {
  await db.exec('alter table notifications add constraint no_inserts check (false) not valid')
  try {
    const st = await stage(U.sup, [
      { asset: 'TM1', site: 'NHC', outcome: 'unchanged', complaint: 'Gearbox noise now' },
      { asset: 'TM2', site: 'JED', outcome: 'unchanged' },
      { asset: 'TM4', site: 'NHC', outcome: 'unchanged' },
    ])
    const res = await confirm(U.sup, st.upload_id)
    assert.equal(res.active_after, 3)
    const n = (await rows("select count(*)::int n from workshop_status_notices where subject_id = $1", [st.upload_id]))[0].n
    assert.equal(n, 0, 'undelivered notices are not remembered')
  } finally {
    await db.exec('alter table notifications drop constraint no_inserts')
  }
})

test('scan: thresholds, fallback to assigners, bundling and once-per-period dedupe', async () => {
  // A preview left unconfirmed (KSA), for the review reminder.
  await stage(U.sup, [{ asset: 'TM9', site: 'NHC' }])
  await setRecord('TM1', { ooc_since: '2030-01-05', delay_reason: 'Waiting for Spare Parts' })
  await setRecord('TM2', { ooc_since: '2030-01-14', expected_release_date: '2030-01-15' })
  // TM4 is assigned to someone who cannot see its site -> goes to assigners.
  await setRecord('TM4', { ooc_since: '2030-01-14', site: 'JED', responsible_user_id: U.mech1 })
  await db.exec('delete from notifications; delete from workflow_notifications; delete from domain_events;')

  const noon = '2030-01-15T09:00:00Z' // 12:00 Riyadh, after the 10:00 deadline
  const r1 = await scan(noon)
  assert.ok(r1.sent > 0)

  const m1 = await notesFor(U.mech1)
  const m1types = m1.map(n => n.type).sort()
  assert.deepEqual(m1types, ['workshop_status_missing_eta', 'workshop_status_update_missing', 'workshop_status_waiting_long'])
  const upd = m1.find(n => n.type === 'workshop_status_update_missing')
  assert.match(upd.body, /TM1/)
  assert.doesNotMatch(upd.body, /TM4/, 'never notified about a site they cannot see')

  const m2 = (await notesFor(U.mech2)).map(n => n.type).sort()
  assert.deepEqual(m2, ['workshop_status_release_today', 'workshop_status_update_missing'])

  const sup = await notesFor(U.sup)
  const supUpd = sup.find(n => n.type === 'workshop_status_update_missing')
  assert.match(supUpd.body, /TM4/, 'fallback to the assigner')
  assert.ok(sup.some(n => n.type === 'workshop_status_upload_review'))
  assert.ok(!sup.some(n => n.type === 'workshop_status_no_responsible'), 'upload already told them')

  for (const u of [U.reporter, U.uaeSup, U.outsider, U.pending, U.revoked]) {
    assert.equal((await notesFor(u)).length, 0, `no notice for ${u}`)
  }

  // Same hour again: nothing new.
  assert.equal((await scan(noon)).sent, 0)
  // Next day: only the daily conditions come back.
  const nextDay = await scan('2030-01-16T09:00:00Z')
  assert.ok(nextDay.sent > 0)
  const m1b = (await notesFor(U.mech1)).filter(n => !m1.some(o => o.id === n.id)).map(n => n.type)
  assert.deepEqual(m1b, ['workshop_status_update_missing'])
  const m2b = (await notesFor(U.mech2)).map(n => n.type)
  assert.ok(m2b.includes('workshop_status_release_overdue'))
})

test('before the deadline hour, no update reminders', async () => {
  await db.exec('delete from notifications')
  await scan('2030-01-17T05:00:00Z') // 08:00 Riyadh
  const all = await rows("select count(*)::int n from notifications where type = 'workshop_status_update_missing'")
  assert.equal(all[0].n, 0)
})

test('the master switch turns every notice off', async () => {
  await db.exec(`create table public.system_config(key text primary key, value text);
    insert into public.system_config values ('workshop_status_notifications', 'false')`)
  try {
    const r = await scan('2030-01-20T09:00:00Z')
    assert.equal(r.disabled, true)
  } finally {
    await db.exec('drop table public.system_config')
  }
})
