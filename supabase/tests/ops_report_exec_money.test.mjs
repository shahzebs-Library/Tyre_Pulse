import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// PGlite harness for the DRAFT migration
// supabase/pending_migrations/20261113140000_ops_report_exec_money_by_country.sql
// (MODC-05). Proves the per-country money aggregate never blends currencies,
// reads the expense grid (not tyre record prices), stays inside one
// organisation, and is not callable by a signed-in user.

const SQL = readFileSync(new URL('../pending_migrations/20261113140000_ops_report_exec_money_by_country.sql', import.meta.url), 'utf8')
const ORG = '00000000-0000-0000-0000-000000000001'
const OTHER = '00000000-0000-0000-0000-000000000002'
const db = new PGlite()

const call = async (org, days = 30) =>
  (await db.query('select public.report_exec_money_by_country($1::uuid, $2) r', [org, days])).rows[0].r
const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.country_currency(country text primary key, currency text not null);
    insert into public.country_currency values ('KSA','SAR'),('UAE','AED'),('Egypt','EGP');
    create function public.currency_for_country(p_country text) returns text language sql stable as $$
      select c.currency from public.country_currency c
       where upper(btrim(c.country)) = upper(btrim(coalesce(p_country, ''))) limit 1 $$;
    create table public.parts_consumption(id serial primary key, organisation_id uuid, country text,
      currency text, event_date date, tyre_cost numeric, line_cost numeric, site text, asset_code text);
    create table public.work_orders(id serial primary key, organisation_id uuid, country varchar, total_cost numeric);
    create table public.accidents(id serial primary key, organisation_id uuid, country text,
      repair_cost numeric, estimated_damage_cost numeric);
    create table public.vehicle_fleet(id serial primary key, organisation_id uuid, country text, monthly_tyre_budget numeric);
  `)
  await db.exec(SQL)
  const ins = (org, country, currency, d, tyre, site, asset) => db.query(
    'insert into parts_consumption(organisation_id,country,currency,event_date,tyre_cost,line_cost,site,asset_code) values ($1,$2,$3,$4,$5,$5,$6,$7)',
    [org, country, currency, d, tyre, site, asset])
  // KSA: 1000 in the current 30 days, 400 in the prior 30, 250 two years ago.
  await ins(ORG, 'KSA', 'SAR', day(2), 600, 'NHC', 'TM001')
  await ins(ORG, 'KSA', 'SAR', day(10), 400, 'JED', 'TM002')
  await ins(ORG, 'KSA', 'SAR', day(40), 400, 'NHC', 'TM001')
  await ins(ORG, 'KSA', 'SAR', day(800), 250, 'NHC', 'TM003')
  // UAE: currency column blank on purpose, must resolve from the country.
  await ins(ORG, 'UAE', null, day(5), 70, 'DXB', 'RM1')
  // Egypt
  await ins(ORG, 'Egypt', 'EGP', day(3), 90000, 'CAI', 'EG1')
  // A spare-part line (no tyre cost) must not count as tyre spend.
  await db.query("insert into parts_consumption(organisation_id,country,currency,event_date,tyre_cost,line_cost) values ($1,'KSA','SAR',$2,0,5000)", [ORG, day(1)])
  // A future-dated typo must not move the window anchor.
  await ins(ORG, 'KSA', 'SAR', day(-200), 1, 'NHC', 'TM009')
  // Another organisation must never leak in.
  await ins(OTHER, 'KSA', 'SAR', day(2), 999999, 'X', 'X1')
  await db.query("insert into work_orders(organisation_id,country,total_cost) values ($1,'KSA',300),($1,'UAE',20),($2,'KSA',777777)", [ORG, OTHER])
  await db.query("insert into accidents(organisation_id,country,repair_cost,estimated_damage_cost) values ($1,'Egypt',null,1500),($1,'KSA',50,9999)", [ORG])
  await db.query("insert into vehicle_fleet(organisation_id,country,monthly_tyre_budget) values ($1,'KSA',100),($1,'KSA',50)", [ORG])
})

const byCountry = (r) => Object.fromEntries(r.countries.map((c) => [c.country, c]))

test('one element per country, each in its own currency, and no total anywhere', async () => {
  const r = await call(ORG)
  assert.equal(r.basis, 'expense_grid')
  assert.deepEqual(r.countries.map((c) => `${c.country}:${c.currency}`), ['Egypt:EGP', 'KSA:SAR', 'UAE:AED'])
  // The payload has no key that could be read as a cross-currency total.
  assert.deepEqual(Object.keys(r).sort(), ['basis', 'countries', 'period_days', 'win_from', 'win_to'])
})

test('tyre spend comes from the expense grid tyre_cost, per country', async () => {
  const c = byCountry(await call(ORG))
  assert.equal(Number(c.KSA.tyre_spend_all), 1651)   // 600 + 400 + 400 + 250 + 1 (future typo is real money, counted all time)
  assert.equal(Number(c.UAE.tyre_spend_all), 70)
  assert.equal(Number(c.Egypt.tyre_spend_all), 90000)
  assert.equal(Number(c.KSA.expense_lines), 5)       // the spare line with tyre_cost 0 is not a tyre line
})

test('current and prior windows are separate and the future row does not move the anchor', async () => {
  const c = byCountry(await call(ORG))
  assert.equal(Number(c.KSA.tyre_spend_cur), 1000)
  assert.equal(Number(c.KSA.tyre_spend_prev), 400)
  assert.equal(Number(c.KSA.tyre_spend_12m), 1400)
  assert.equal(Number(c.Egypt.tyre_spend_cur), 90000)
})

test('a blank currency column resolves from the country, never from another country', async () => {
  const c = byCountry(await call(ORG))
  assert.equal(c.UAE.currency, 'AED')
})

test('work order cost, accident cost and budget are per country too', async () => {
  const c = byCountry(await call(ORG))
  assert.equal(Number(c.KSA.wo_cost), 300)
  assert.equal(Number(c.UAE.wo_cost), 20)
  assert.equal(Number(c.Egypt.wo_cost), 0)
  assert.equal(Number(c.Egypt.accident_cost), 1500)  // estimate used when no repair cost
  assert.equal(Number(c.KSA.accident_cost), 50)      // repair cost wins over the estimate
  assert.equal(Number(c.KSA.monthly_budget), 150)
  assert.equal(c.UAE.monthly_budget, null)           // not set is null, never zero
})

test('top sites and assets are ranked inside one country', async () => {
  const c = byCountry(await call(ORG))
  assert.deepEqual(c.KSA.top_sites.map((s) => s.label), ['NHC', 'JED'])
  assert.equal(c.KSA.top_assets[0].label, 'TM001')
  assert.ok(c.KSA.monthly_trend.length >= 1)
})

test('another organisation never leaks in and a null organisation returns nothing', async () => {
  const mine = byCountry(await call(ORG))
  assert.ok(Number(mine.KSA.tyre_spend_all) < 999999)
  assert.ok(Number(mine.KSA.wo_cost) < 777777)
  const none = await call(null)
  assert.deepEqual(none.countries, [])
})

test('a country with no currency mapping is reported with a null currency, not merged', async () => {
  await db.query("insert into parts_consumption(organisation_id,country,currency,event_date,tyre_cost) values ($1,'Oman',null,$2,10)", [ORG, day(1)])
  const c = byCountry(await call(ORG))
  assert.equal(c.Oman.currency, null)
  assert.equal(Number(c.Oman.tyre_spend_all), 10)
  assert.equal(Number(c.KSA.tyre_spend_all), 1651)
})

test('only the service role may execute it', async () => {
  const rows = (await db.query(`select
      has_function_privilege('anon', 'public.report_exec_money_by_country(uuid,integer)', 'EXECUTE') a,
      has_function_privilege('authenticated', 'public.report_exec_money_by_country(uuid,integer)', 'EXECUTE') b,
      has_function_privilege('service_role', 'public.report_exec_money_by_country(uuid,integer)', 'EXECUTE') c`)).rows[0]
  assert.deepEqual(rows, { a: false, b: false, c: true })
})
