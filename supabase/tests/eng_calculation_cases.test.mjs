import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// Engineering calculation cases, SQL side (PGlite only, never production).
//
// The functions under test are the LIVE production bodies, transcribed into
// fixtures/eng_live_functions.sql. Each draft in supabase/pending_migrations/
// 2026111312x000_eng*.sql is then applied on top by its own anchored
// replacement, so a draft is proven against the text production holds:
//   BEFORE state reproduces the audit failure, AFTER state is the fix.
//
// Case ids are the ones in docs/commercial-readiness/audit/calculation_test_cases.md.
// C22 is the case the audit could not run (it needs a write); it runs here.
//
// NOT covered here: draft 20261113120000 (get_fleet_cpk / get_cost_cpk_overview).
// Those two functions read a dozen tables and helper RPCs; their anchors were
// counted on the live text (each exactly once) but the patched bodies have not
// been executed anywhere. The JS half of that change is covered by
// src/test/cpkMetrics.test.js.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const LIVE = read('./fixtures/eng_live_functions.sql')
const DRAFT = (name) => read(`../pending_migrations/${name}`)
const ENG2 = '20261113121000_eng2_running_life_baseline_km_rule.sql'
const ENG3 = '20261113122000_eng3_calc_cpk_km_rule.sql'
const ENG4 = '20261113123000_eng4_unit_rule_road_vehicles.sql'
const ENG5 = '20261113124000_eng5_warranty_spelling_and_tyre_spend_kinds.sql'

const ORG = '00000000-0000-0000-0000-000000000001'
const db = new PGlite()
const one = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0]
const num = (v) => (v == null ? null : Number(v))

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.tyre_records(
      id uuid primary key default gen_random_uuid(), organisation_id uuid, country text, site text,
      asset_no text, asset_number text, serial_no text, tyre_position text, position text,
      brand text, size text, vehicle_type text, issue_date date, fitment_date date, removal_date date,
      km_at_fitment numeric, km_at_removal numeric, total_km numeric,
      hrs_at_fitment numeric, hrs_at_removal numeric, total_hrs numeric,
      status text, cost_per_tyre numeric, extra_fields jsonb);
    create table public.vehicle_fleet(organisation_id uuid, country text, asset_no text, vehicle_type text, current_km numeric);
    create table public.engine_hours_logs(asset_no text, country text, engine_hours numeric, reading_date date);
    create table public.tyre_life_targets(size text, vehicle_type text, country text, target_km numeric, target_hours numeric);
    create table public.tyre_replacement_log(
      id uuid primary key default gen_random_uuid(), organisation_id uuid, batch_id uuid, tyre_id uuid,
      country text, asset_no text, position text, old_serial text, new_serial text, replaced_on date,
      old_values jsonb, new_values jsonb, source text, undone_at timestamptz, created_at timestamptz default now());
    create table public.parts_consumption(id serial primary key, organisation_id uuid, country text, currency text,
      event_date date, item_description text, tyre_cost numeric, line_cost numeric);
  `)
  await db.exec(LIVE)
})

// ── A. Tyre km of one fitment (rule T7), live SQL, no draft needed ───────────
test('C01 to C10: tyre_km_life applies placeholder, factory zero, class cap, reversed readings', async () => {
  const life = (fit, rem, total, type) =>
    one('select public.tyre_km_life($1::numeric,$2::numeric,$3::numeric,$4::text)', [fit, rem, total, type]).then(num)
  assert.equal(await life(52000, 96500, null, 'TR-MIXER'), 44500) // C01
  assert.equal(await life(1, 184300, 184299, 'TR-MIXER'), null) // C02 placeholder
  assert.equal(await life(0, 38200, null, 'TR-MIXER'), 38200) // C03 factory fitment
  assert.equal(await life(10000, 95000, null, 'TR-MIXER'), null) // C04 over the 80,000 mixer cap
  assert.equal(await life(10000, 95000, null, 'TRAILER'), 85000) // C05
  assert.equal(await life(20000, 77000, null, 'PUMPS'), null) // C06 over the 56,000 pump cap
  assert.equal(await life(null, null, 15000, 'WHEEL LOADER'), 15000) // C07 cap is inclusive
  assert.equal(await life(null, null, 15001, 'WHEEL LOADER'), null)
  assert.equal(await life(10000, 95000, null, null), 85000) // C08 no class known
  assert.equal(await life(null, null, null, null), null) // C09 never 0
  assert.equal(await life(90000, 60000, null, 'TRAILER'), null) // C10 reversed
  assert.equal(await life(90000, 60000, 30000, 'TRAILER'), 30000)
})

test('C19: tyre_serial_is_strong accepts a real serial and refuses the six junk shapes', async () => {
  const strong = (s) => one('select public.tyre_serial_is_strong($1)', [s])
  assert.equal(await strong('YMA55312'), true)
  for (const s of ['FEB-62', '315/80R22.5', '1.25121E+11', '111111', 'NO SERIAL', '12345']) {
    assert.equal(await strong(s), false, s)
  }
})

test('C23 and C24: warranty and repair lines are never a tyre price (live rule)', async () => {
  assert.equal(await one("select public.tyre_price_is_warranty('TYRE 315/80R22.5 FOC WARRANTY REPLACEMENT')"), true)
  assert.equal(await one("select public.tyre_price_is_repair('Repair TIRE 315/80R22.5')"), true)
  assert.equal(await one("select public.tyre_price_is_repair('TYRE 315/80R22.5 BRIDGESTONE')"), false)
  assert.equal(await one("select public.tyre_cost_line_kind('Repair TIRE 315/80R22.5')"), 'repair')
  assert.equal(await one("select public.tyre_cost_line_kind('TYRE 315/80R22.5 BRIDGESTONE')"), 'tyre')
  assert.equal(await one("select public.tyre_cost_line_kind('TUBE 12.00R24')"), 'tube')
  assert.equal(await one("select public.tyre_cost_line_kind('TYRE FLAP 1200-24')"), 'flap')
  assert.equal(await one("select public.tyre_cost_line_kind('TYRE 12.00R24 WITH TUBE & FLAP')"), 'mixed')
})

// ── C29 / ENG-3: calc_cpk ────────────────────────────────────────────────────
test('C29: calc_cpk gave a CPK on a placeholder fitment; draft eng3 returns null', async () => {
  const cpk = (c, f, r) => one('select public.calc_cpk($1::numeric,$2::numeric,$3::numeric)', [c, f, r]).then(num)
  // BEFORE: the audit failure, reproduced on the live body.
  assert.equal(await cpk(1800, 1, 184300), 0.0098)
  assert.equal(await cpk(1800, 52000, 96500), 0.0404)

  await db.exec(DRAFT(ENG3))

  assert.equal(await cpk(1800, 1, 184300), null) // placeholder: km unknown
  assert.equal(await cpk(1800, 52000, 96500), 0.0404) // a real fitment is unchanged
  assert.equal(await cpk(1500, 0, 30000), 0.05) // factory fitment is a real reading
  assert.equal(await cpk(1500, 10000, 200000), null) // over the general 100,000 cap
  assert.equal(await cpk(null, 52000, 96500), null) // no price, no CPK
  assert.equal(await cpk(0, 52000, 96500), null)
  assert.equal(await cpk(1800, 96500, 52000), null) // reversed
  // the previous body is kept for rollback
  assert.equal(await one("select count(*)::int from _bak.fn_defs_eng_20261113 where fn = 'calc_cpk'"), 1)
})

// ── C20 / C20b / ENG-4: unit rule ────────────────────────────────────────────
test('C20 and C20b: road vehicles with a plant word in the name; draft eng4 puts them on km', async () => {
  const unit = (t) => one('select public.cpk_unit_for_asset_type($1)', [t])
  // BEFORE
  assert.equal(await unit('WHEEL LOADER'), 'engine_hours') // C20
  for (const t of ['WATER TANKER', 'LOW LOADER TRAILER', 'CONCRETE MIXER TRUCK']) {
    assert.equal(await unit(t), 'engine_hours', `${t} (audit failure reproduced)`)
  }

  await db.exec(DRAFT(ENG4))

  for (const t of ['WATER TANKER', 'LOW LOADER TRAILER', 'CONCRETE MIXER TRUCK']) assert.equal(await unit(t), 'km', t)
  // Unchanged: real plant, and a truck that carries an hour-metered machine.
  for (const t of ['WHEEL LOADER', 'PUMPS', 'CONCRETE PUMP TRUCK', 'GENERATOR', 'SKID LOADER', 'EXCAVATOR']) {
    assert.equal(await unit(t), 'engine_hours', t)
  }
  // BT-PLANT is km on the live rule too (the list says batching, not plant): unchanged, recorded as is.
  for (const t of ['TR-MIXER', 'TRAILER', 'PICKUP', 'BUS', 'BT-PLANT', null, '']) assert.equal(await unit(t), 'km', String(t))
  // whole words only: "carrier" is not "car", "vanguard" is not "van"
  assert.equal(await unit('WATER CARRIER'), 'engine_hours')
})

// ── C23b / ENG-6 and ENG-5 ───────────────────────────────────────────────────
test('C23b: the ERP spelling WARRENTY is not detected; draft eng5 detects it, whole words only', async () => {
  const w = (s) => one('select public.tyre_price_is_warranty($1)', [s])
  assert.equal(await w('TIRE -WARRENTY -315/80 R 22.5'), false) // BEFORE

  await db.exec(DRAFT(ENG5))

  assert.equal(await w('TIRE -WARRENTY -315/80 R 22.5'), true)
  assert.equal(await w('TYRE 315/80 R22.5 FREE ISSUE'), true)
  assert.equal(await w('TYRE GAURANTEE CLAIM 12.00R24'), true)
  assert.equal(await w('TYRE 315/80R22.5 FOC WARRANTY REPLACEMENT'), true) // C23 still holds
  assert.equal(await w('TYRE 315/80R22.5 BRIDGESTONE'), false)
  assert.equal(await w('WARRANTYLESS TYRE 315/80R22.5'), false)
  assert.equal(await one("select public.tyre_cost_line_kind('TIRE -WARRENTY -315/80 R 22.5')"), 'warranty')
})

test('ENG-5: get_tyre_spend_breakdown splits the tyre bucket by line kind, per country, never blended', async () => {
  const ins = (country, cur, desc, tyre) => db.query(
    'insert into parts_consumption(organisation_id,country,currency,event_date,item_description,tyre_cost,line_cost) values ($1,$2,$3,$4,$5,$6,$6)',
    [ORG, country, cur, '2026-03-10', desc, tyre])
  await ins('KSA', 'SAR', 'TYRE 315/80R22.5 BRIDGESTONE', 1800)
  await ins('KSA', 'SAR', 'TYRE 315/80R22.5 BRIDGESTONE', 1700)
  await ins('KSA', 'SAR', 'Repair TIRE 315/80R22.5', 400)
  await ins('KSA', 'SAR', 'TUBE 12.00R24', 62)
  await ins('KSA', 'SAR', 'ENGINE OIL 15W40', 0) // not in the tyre bucket
  await ins('UAE', 'AED', 'TYRE 12.00R24', 900)

  const rows = await one("select public.get_tyre_spend_breakdown(null, null, null)")
  const key = (c, k) => rows.find((r) => r.country === c && r.kind === k)
  assert.equal(Number(key('KSA', 'tyre').amount), 3500)
  assert.equal(key('KSA', 'tyre').lines, 2)
  assert.equal(Number(key('KSA', 'repair').amount), 400)
  assert.equal(Number(key('KSA', 'tube').amount), 62)
  assert.equal(key('KSA', 'tyre').currency, 'SAR')
  assert.equal(Number(key('UAE', 'tyre').amount), 900)
  assert.equal(key('UAE', 'tyre').currency, 'AED')
  assert.equal(rows.length, 4) // one row per country and kind, no cross-country total

  const ksa = await one("select public.get_tyre_spend_breakdown('KSA', '2026-01-01', '2026-12-31')")
  assert.ok(ksa.every((r) => r.country === 'KSA'))
  const none = await one("select public.get_tyre_spend_breakdown('KSA', '2027-01-01', null)")
  assert.deepEqual(none, [])

  assert.equal(await one("select has_function_privilege('anon', 'public.get_tyre_spend_breakdown(text,date,date)', 'EXECUTE')"), false)
  assert.equal(await one("select has_function_privilege('authenticated', 'public.get_tyre_spend_breakdown(text,date,date)', 'EXECUTE')"), true)
})

// ── C22: replacement linkage (the case the audit could not run) ──────────────
test('C22: a later fitment closes the tyre on the wheel; a same-day row with a lower meter is held', async () => {
  await db.query(
    `insert into tyre_records(organisation_id,country,asset_no,tyre_position,serial_no,vehicle_type,issue_date,km_at_fitment,status)
     values ($1,'KSA','TM900','LHF1','OLD12345','TR-MIXER','2026-03-01',40000,'Active')`, [ORG])
  const close = (serial, date, km, dry = false) => one(
    `select public._tyre_close_replaced($1::uuid,'KSA','TM900','LHF1',$2,$3::date,$4::numeric,null,'test',gen_random_uuid(),$5,false)`,
    [ORG, serial, date, km, dry])

  // dry run reports and writes nothing
  const dry = await close('NEW67890', '2026-06-01', 62000, true)
  assert.equal(dry.status, 'would_close')
  assert.equal(await one("select status from tyre_records where serial_no = 'OLD12345'"), 'Active')
  assert.equal(await one('select count(*)::int from tyre_replacement_log'), 0)

  const first = await close('NEW67890', '2026-06-01', 62000)
  assert.equal(first.status, 'closed')
  assert.equal(first.old_serial, 'OLD12345')
  const old = (await db.query(
    "select status, removal_date::text d, km_at_removal, total_km, extra_fields from tyre_records where serial_no = 'OLD12345'")).rows[0]
  assert.equal(old.status, 'Removed')
  assert.equal(old.d, '2026-06-01')
  assert.equal(Number(old.km_at_removal), 62000)
  assert.equal(Number(old.total_km), 22000) // 62,000 - 40,000, by the km rule
  assert.equal(old.extra_fields.replaced_by_serial, 'NEW67890')
  assert.equal(await one('select count(*)::int from tyre_replacement_log'), 1) // one undoable log row
  const log = (await db.query('select old_values, new_values from tyre_replacement_log')).rows[0]
  assert.equal(log.old_values.status, 'Active') // the before image is kept
  assert.equal(log.new_values.status, 'Removed')

  // The importer then inserts the new tyre as the active one on that wheel.
  await db.query(
    `insert into tyre_records(organisation_id,country,asset_no,tyre_position,serial_no,vehicle_type,issue_date,km_at_fitment,status)
     values ($1,'KSA','TM900','LHF1','NEW67890','TR-MIXER','2026-06-01',62000,'Active')`, [ORG])

  // Second arrival: same day as the tyre now on the wheel, odometer below it.
  const second = await close('LATE4444', '2026-06-01', 39000)
  assert.equal(second.status, 'ambiguous_same_day_stale')
  assert.equal(second.reason, 'meter_below_current_fitment')
  assert.equal(await one("select status from tyre_records where serial_no = 'NEW67890'"), 'Active') // nothing changed
  assert.equal(await one('select count(*)::int from tyre_replacement_log'), 1)

  // The removed serial coming back on the same day is also held, not re-fitted.
  const stale = await close('OLD12345', '2026-06-01', 62000)
  assert.equal(stale.status, 'ambiguous_same_day_stale')
  assert.equal(stale.reason, 'serial_already_removed_from_wheel')

  // A backdated row (before the current fitment) never closes a newer tyre.
  const back = await close('BACK5555', '2026-03-01', 39000)
  assert.equal(back.status, 'ambiguous_not_later')
  // The same serial arriving again is the same tyre.
  assert.equal((await close('NEW67890', '2026-07-01', 70000)).status, 'same_tyre')
  // A placeholder closing meter never becomes a removal km.
  const ph = await close('NEXT7777', '2026-09-01', 1, true)
  assert.equal(ph.status, 'would_close')
  assert.equal(ph.removal.km_at_removal, undefined)
  assert.equal(ph.removal.total_km, undefined)
})

// ── ENG-2: expected life baseline ────────────────────────────────────────────
test('ENG-2: the expected life baseline read raw total_km; draft eng2 applies the km rule', async () => {
  await db.exec('truncate tyre_records; truncate tyre_replacement_log')
  const removed = (fit, rem, total, type = 'TR-MIXER') => db.query(
    `insert into tyre_records(organisation_id,country,asset_no,tyre_position,serial_no,size,vehicle_type,issue_date,removal_date,km_at_fitment,km_at_removal,total_km,status)
     values ($1,'KSA','TM100','LHF1','R'||floor(random()*1e9)::text,'315/80 R22.5',$2,'2025-01-01','2025-09-01',$3,$4,$5,'Removed')`,
    [ORG, type, fit, rem, total])
  // Three honest mixer lives: 30,000, 40,000, 50,000 km (mean 40,000).
  await removed(10000, 40000, 30000)
  await removed(20000, 60000, 40000)
  await removed(5000, 55000, 50000)
  // A placeholder fitment: total_km is the machine odometer, not a tyre life.
  await removed(1, 184300, 184299)
  // Over the 80,000 mixer cap: not a believable tyre life.
  await removed(10000, 105000, 95000)

  await db.query("insert into vehicle_fleet values ($1,'KSA','TM200','TR-MIXER',70000), ($1,'KSA','TM201','TR-MIXER',25000)", [ORG])
  await db.query(
    `insert into tyre_records(organisation_id,country,asset_no,tyre_position,serial_no,size,vehicle_type,issue_date,km_at_fitment,status) values
     ($1,'KSA','TM200','LHF1','ACT00001','315/80R22.5','TR-MIXER','2026-01-01',32000,'Active'),
     ($1,'KSA','TM201','LHF1','ACT00002','315/80R22.5','TR-MIXER','2026-01-01',0,'Active')`, [ORG])

  const rows = async (dueOnly = false) => {
    const j = await one('select public.get_tyre_running_life($1, null, 0, null, $2)', ['KSA', dueOnly])
    return Object.fromEntries(j.rows.map((r) => [r.serial_no, r]))
  }

  // BEFORE: mean of 30,000 40,000 50,000 184,299 95,000 = 79,860.
  let r = await rows()
  assert.equal(r.ACT00001.expected_life_km, 79860)
  assert.equal(r.ACT00001.life_basis, 'measured_type')
  assert.equal(r.ACT00001.life_sample, 5)
  assert.equal(r.ACT00001.km_run, 38000)
  assert.equal(r.ACT00001.life_used_pct, 48) // told it is half way through
  assert.equal((await rows(true)).ACT00001, undefined) // not due
  assert.equal(r.ACT00002.km_run, null) // factory fitment was given no km run

  await db.exec(DRAFT(ENG2))

  // AFTER: only the three believable lives count. Mean 40,000.
  r = await rows()
  assert.equal(r.ACT00001.expected_life_km, 40000)
  assert.equal(r.ACT00001.life_sample, 3)
  assert.equal(r.ACT00001.remaining_km, 2000)
  assert.equal(r.ACT00001.life_used_pct, 95)
  assert.ok((await rows(true)).ACT00001, 'now flagged due')
  // Factory fitment (odometer 0) is a real reading: 25,000 km run.
  assert.equal(r.ACT00002.km_run, 25000)
  assert.equal(r.ACT00002.remaining_km, 15000)

  // The baseline equals the average of tyre_km_life over the removed tyres.
  const expected = await one(
    `select round(avg(public.tyre_km_life(km_at_fitment, km_at_removal, total_km, vehicle_type)))
       from tyre_records where status = 'Removed'
        and public.tyre_km_life(km_at_fitment, km_at_removal, total_km, vehicle_type) >= 1000`)
  assert.equal(Number(expected), 40000)

  // A manual target still wins and is untouched by the change.
  await db.query("insert into tyre_life_targets values ('315/80R22.5','TR-MIXER','KSA',60000,null)")
  r = await rows()
  assert.equal(r.ACT00001.expected_life_km, 60000)
  assert.equal(r.ACT00001.life_basis, 'manual')
})

test('every draft refuses to run twice on text it has already changed (the guard is real)', async () => {
  for (const d of [ENG2, ENG3, ENG4, ENG5]) {
    await assert.rejects(() => db.exec(DRAFT(d)), /ENG guard/, d)
  }
})
