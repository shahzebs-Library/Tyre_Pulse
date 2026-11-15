// Helpers for the engineering staging tests. LOCAL staging database only.
//
// Nothing here can reach production: the host must be a loopback address and
// every script runs inside a transaction that ends in ROLLBACK.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export const HOST = process.env.PGHOST || '127.0.0.1'
export const PORT = process.env.PGPORT || '54329'
export const USER = process.env.PGUSER || 'postgres'
export const DB_AFTER = process.env.ENG_DB || 'tp_eng' // copy of the baseline with drafts 120000 to 125000 applied
export const DB_BEFORE = process.env.ENG_BASELINE_DB || 'tyrepulse_staging' // untouched baseline, read inside rolled back transactions

if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
  throw new Error(`Engineering staging tests refuse host ${HOST}: local staging only.`)
}

export const FIXTURE = JSON.parse(
  readFileSync(new URL('../fixtures/eng_golden_fixture.json', import.meta.url), 'utf8'))

/** Run a script through psql. Returns { ok, out, err }. */
export function psql(db, sql) {
  const r = spawnSync('psql', ['-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-h', HOST, '-p', PORT, '-U', USER, '-d', db],
    { input: sql, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' }
}

export function reachable(db) {
  const r = psql(db, 'select 1;')
  return r.ok
}

/** `select '@@name|' || json` lines back into an object of parsed values. */
export function parseEmits(out) {
  const res = {}
  for (const line of out.split('\n')) {
    if (!line.startsWith('@@')) continue
    const i = line.indexOf('|')
    const name = line.slice(2, i)
    const body = line.slice(i + 1)
    try { res[name] = JSON.parse(body) } catch { res[name] = body }
  }
  return res
}

export const emit = (name, expr) => `select '@@${name}|' || coalesce((${expr})::text, 'null');\n`

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const n = (v) => (v === null || v === undefined ? 'null' : String(Number(v)))
export const fitId = (k) => `00000000-0000-4000-9000-${String(k).padStart(12, '0')}`

/** Act as a signed in user for the rest of the transaction. */
export const asUser = (userId) =>
  `set local role authenticated;\n` +
  `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: 'authenticated', aal: 'aal1' })}', true);\n`
export const asOwner = () => `reset role;\n`

/**
 * Load the golden fixture as stored rows. Triggers are switched off for the
 * load so the rows keep the exact shapes production holds (a factory fitment at
 * 0 km, a placeholder 1, a repeated price, two active tyres on one wheel): the
 * import triggers would otherwise rewrite them. Triggers are back on afterwards.
 */
export function loadFixtureSql(fx = FIXTURE) {
  const org = q(fx.org)
  let s = `set local session_replication_role = replica;\n`
  for (const f of fx.fleet) {
    s += `insert into public.vehicle_fleet (organisation_id, country, asset_no, vehicle_type, current_km, site, status)
          values (${org}, ${q(f.country)}, ${q(f.asset_no)}, ${q(f.vehicle_type)}, ${n(f.current_km)}, 'GOLDEN YARD', 'Active');\n`
  }
  for (const e of fx.engine_hours) {
    s += `insert into public.engine_hours_logs (organisation_id, country, asset_no, reading_date, engine_hours, source)
          values (${org}, ${q(e.country)}, ${q(e.asset_no)}, ${q(e.reading_date)}, ${n(e.engine_hours)}, 'golden');\n`
  }
  for (const t of fx.targets) {
    s += `insert into public.tyre_life_targets (organisation_id, country, size, vehicle_type, target_km, target_hours)
          values (${org}, ${q(t.country)}, ${q(t.size)}, ${q(t.vehicle_type)}, ${n(t.target_km)}, ${n(t.target_hours)});\n`
  }
  for (const t of fx.fitments) {
    s += `insert into public.tyre_records (id, organisation_id, country, site, asset_no, tyre_position, serial_no, vehicle_type, size, brand,
            issue_date, removal_date, km_at_fitment, km_at_removal, total_km, status, cost_per_tyre, qty, job_card)
          values (${q(fitId(t.n))}, ${org}, ${q(t.country)}, 'GOLDEN YARD', ${q(t.asset_no)}, ${q(t.tyre_position)}, ${q(t.serial_no)},
            ${q(t.vehicle_type)}, ${q(t.size)}, ${q(t.brand)}, ${q(t.issue_date)}, ${q(t.removal_date)}, ${n(t.km_at_fitment)},
            ${n(t.km_at_removal)}, ${n(t.total_km)}, ${q(t.status)}, ${n(t.cost_per_tyre)}, ${n(t.qty)}, ${q(t.job_card)});\n`
  }
  for (const l of fx.expense_lines) {
    s += `insert into public.parts_consumption (organisation_id, country, currency, work_order_no, asset_code, event_date, item_description,
            qty, tyre_cost, spare_cost, oil_cost, line_cost, site)
          values (${org}, ${q(l.country)}, ${q(l.currency)}, ${q(l.work_order_no)}, ${q(l.asset_code)}, ${q(l.event_date)}, ${q(l.item_description)},
            ${q(l.qty)}, ${n(l.tyre_cost)}, ${n(l.spare_cost)}, ${n(l.oil_cost)}, ${n(l.line_cost)}, 'GOLDEN YARD');\n`
  }
  s += `set local session_replication_role = origin;\n`
  return s
}

/** One md5 per public table (row order independent). The registry tables draft 120000 writes are left out. */
export const HASH_SQL = `
do $$
declare r record; h text; c bigint;
begin
  create temp table _eng_hash(tbl text, n bigint, h text) on commit drop;
  for r in select c.oid::regclass::text as t from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
            where ns.nspname = 'public' and c.relkind = 'r'
              and c.relname not in ('metric_registry', 'metric_versions') order by 1 loop
    execute format('select count(*), md5(coalesce(string_agg(md5(t::text), '''' order by md5(t::text)), '''')) from %s t', r.t) into c, h;
    insert into _eng_hash values (r.t, c, h);
  end loop;
end $$;
select '@@hash|' || jsonb_object_agg(tbl, jsonb_build_array(n, h))::text from _eng_hash;
`

export const num = (v) => (v === null || v === undefined ? null : Number(v))
