/**
 * costSummary - single source for the Tyres vs Maintenance spend split.
 *
 * Feeds a one-click switch between "tyre spend" and "maintenance spend" over the
 * last 12 calendar months. Tyre cost comes from tyre_records (cost_per_tyre x
 * qty, bucketed by issue_date); maintenance cost is the sum of pm_service_records
 * total_cost (by service_date) plus the non-tyre work_orders cost components
 * (labour + parts + lubricant + outside repair, by completed_at or created_at).
 * tyre_cost on a work order is deliberately EXCLUDED so it is never double
 * counted against tyre spend.
 *
 * Every source degrades independently: a missing relation (org not migrated) or
 * a read error contributes 0 rather than throwing, so one absent table never
 * sinks the whole split.
 */
import { supabase, applyCountry, fetchAllPages } from './_client'

/** True when a Supabase error means the table/relation is not deployed yet. */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const m = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' || code === 'PGRST202' ||
    m.includes('does not exist') ||
    m.includes('could not find the table') ||
    m.includes('schema cache') ||
    m.includes('relation')
  )
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 'YYYY-MM' key for a date-ish value (uses the leading date portion). */
function monthKeyOf(value) {
  if (!value) return null
  const s = String(value)
  // Fast path for ISO date / timestamp strings.
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The 12 month keys ending at `now` (oldest to newest). */
function last12MonthKeys(now) {
  const d = now instanceof Date ? now : new Date(now)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const keys = []
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - i, 1))
    keys.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

/** Parse a date-ish value to a Date, or null when invalid/empty. */
function toDate(v) {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Continuous 'YYYY-MM' keys spanning [from, to] inclusive (oldest to newest).
 * A missing bound is clamped: no `from` starts 11 months before `to`; no `to`
 * ends at `from`. Capped at 120 months so a stray range can never blow up.
 */
function monthKeysBetween(from, to) {
  const end = toDate(to) || new Date()
  let start = toDate(from)
  if (!start) start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1))
  let sy = start.getUTCFullYear()
  let sm = start.getUTCMonth()
  const ey = end.getUTCFullYear()
  const em = end.getUTCMonth()
  const keys = []
  while ((sy < ey || (sy === ey && sm <= em)) && keys.length < 120) {
    keys.push(`${sy}-${String(sm + 1).padStart(2, '0')}`)
    sm += 1
    if (sm > 11) { sm = 0; sy += 1 }
  }
  return keys.length ? keys : [`${ey}-${String(em + 1).padStart(2, '0')}`]
}

/**
 * Compute the tyre vs maintenance spend split.
 *
 * Default (no from/to): the last 12 calendar months ending at `now` - identical
 * to the original behaviour, so existing callers are unaffected.
 *
 * Range mode (from and/or to given): buckets tyre + maintenance spend by month
 * across the [from, to] window instead. When `site` is given the spend is scoped
 * to that site. All three cost tables carry a `site` column (tyre_records,
 * pm_service_records, work_orders), so the site filter applies to every source.
 *
 * Every source degrades independently: a missing relation contributes 0 rather
 * than throwing, so one absent table never sinks the whole split.
 *
 * @param {{ country?:string, now?:Date|string|number, from?:string, to?:string,
 *   site?:string }} [opts]
 * @returns {Promise<{ tyre:number, maintenance:number,
 *   totals:{ tyre:number, maintenance:number },
 *   byMonth:Array<{ month:string, tyre:number, maintenance:number }> }>}
 */
export async function loadCostSplit({ country, now, from, to, site } = {}) {
  const rangeMode = Boolean(from || to)
  const keys = rangeMode ? monthKeysBetween(from, to) : last12MonthKeys(now || new Date())
  const inWindow = new Set(keys)
  const tyreByMonth = Object.fromEntries(keys.map((k) => [k, 0]))
  const maintByMonth = Object.fromEntries(keys.map((k) => [k, 0]))
  const siteEq = site && site !== 'All' ? String(site) : null

  const add = (bucket, key, amount) => {
    if (key && inWindow.has(key)) bucket[key] += num(amount)
  }

  // AUTHORITATIVE EXPENSE SOURCE: the parts_consumption grid (the Ramco expense
  // export), via the server-aggregated get_parts_expense_snapshot RPC. When the
  // grid holds spend for this scope it is the single source for the Tyres vs
  // Maintenance split everywhere this service feeds (Dashboard, Analytics, Board
  // Overview, Executive, Cost Center, PM, Engineering KPI) - tyre = tyre_cost,
  // maintenance = spare_cost + oil_cost. It is applied org-wide only: the grid's
  // store codes differ from the app's site vocabulary, so a site-scoped call keeps
  // the legacy per-site sources. Any miss (no grid data, unknown country, RPC
  // absent) falls through to the legacy tyre_records / work_orders / PM sources.
  if (!siteEq) {
    try {
      const first = keys[0]
      const [ly, lm] = keys[keys.length - 1].split('-').map(Number)
      const from = `${first}-01`
      const to = new Date(Date.UTC(ly, lm, 0)).toISOString().slice(0, 10)
      const { data } = await supabase.rpc('get_parts_expense_snapshot', {
        p_site: null,
        p_country: country && country !== 'All' ? country : null,
        p_from: from,
        p_to: to,
      })
      if (data && data.ok && Array.isArray(data.monthly) && num(data.kpis?.total_expense) > 0) {
        for (const m of data.monthly) {
          add(tyreByMonth, m.m, m.tyre)
          add(maintByMonth, m.m, num(m.spare) + num(m.oil))
        }
        const byMonth = keys.map((k) => ({ month: k, tyre: tyreByMonth[k], maintenance: maintByMonth[k] }))
        const tyre = byMonth.reduce((s, m) => s + m.tyre, 0)
        const maintenance = byMonth.reduce((s, m) => s + m.maintenance, 0)
        return { tyre, maintenance, totals: { tyre, maintenance }, byMonth, source: 'parts_consumption' }
      }
    } catch { /* grid unavailable for this scope - fall through to legacy sources */ }
  }

  // TYRE spend: cost_per_tyre x (qty || 1), bucketed by issue_date.
  try {
    const { data, error } = await fetchAllPages((f, t) => {
      let q = supabase.from('tyre_records').select('cost_per_tyre,qty,issue_date')
        .order('id', { ascending: true }).range(f, t)
      q = applyCountry(q, country)
      if (siteEq) q = q.eq('site', siteEq)
      return q
    })
    if (error) throw error
    for (const r of data || []) {
      const qty = r?.qty == null || r.qty === '' ? 1 : num(r.qty)
      add(tyreByMonth, monthKeyOf(r?.issue_date), num(r?.cost_per_tyre) * (qty || 1))
    }
  } catch (err) {
    if (!isMissingRelation(err)) throw err
  }

  // MAINTENANCE spend part 1: pm_service_records total_cost by service_date.
  try {
    const { data, error } = await fetchAllPages((f, t) => {
      let q = supabase.from('pm_service_records').select('total_cost,service_date,site')
        .order('service_date', { ascending: true }).range(f, t)
      q = applyCountry(q, country)
      if (siteEq) q = q.eq('site', siteEq)
      return q
    })
    if (error) throw error
    for (const r of data || []) {
      add(maintByMonth, monthKeyOf(r?.service_date), num(r?.total_cost))
    }
  } catch (err) {
    if (!isMissingRelation(err)) throw err
  }

  // MAINTENANCE spend part 2: work_orders non-tyre cost (labour + parts +
  // lubricant + outside repair), EXCLUDING tyre_cost, by completed_at||created_at.
  try {
    const { data, error } = await fetchAllPages((f, t) => {
      let q = supabase.from('work_orders')
        .select('labour_cost,parts_cost,lubricant_cost,outside_repair_cost,tyre_cost,completed_at,created_at,site')
        .order('created_at', { ascending: true }).range(f, t)
      q = applyCountry(q, country)
      if (siteEq) q = q.eq('site', siteEq)
      return q
    })
    if (error) throw error
    for (const r of data || []) {
      const maintenance = num(r?.labour_cost) + num(r?.parts_cost) +
        num(r?.lubricant_cost) + num(r?.outside_repair_cost)
      add(maintByMonth, monthKeyOf(r?.completed_at || r?.created_at), maintenance)
    }
  } catch (err) {
    if (!isMissingRelation(err)) throw err
  }

  const byMonth = keys.map((k) => ({ month: k, tyre: tyreByMonth[k], maintenance: maintByMonth[k] }))
  const tyre = byMonth.reduce((s, m) => s + m.tyre, 0)
  const maintenance = byMonth.reduce((s, m) => s + m.maintenance, 0)
  return { tyre, maintenance, totals: { tyre, maintenance }, byMonth }
}

/**
 * Authoritative per-asset TYRE cost from the parts_consumption grid (the classified
 * expense export), via the get_tyre_cost_by_asset RPC (V347). This is THE source for
 * any per-asset tyre-cost total, so the Tyre module reconciles to the Expense module
 * instead of summing tyre_records.cost_per_tyre (null on ~36% of rows). Asset keys are
 * canonical UPPER(TRIM()) (V337), matching tyre_records.asset_no.
 *
 * Returns null when the grid is unavailable for this scope (RPC absent, empty, or org
 * not migrated) so callers can fall back to their legacy tyre_records sum.
 *
 * @param {{ country?:string, from?:string, to?:string }} [opts]
 * @returns {Promise<{ map: Map<string, number>, total:number } | null>}
 */
export async function loadGridTyreByAsset({ country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_tyre_cost_by_asset', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null,
      p_to: to || null,
    })
    if (error) return null
    if (!Array.isArray(data) || data.length === 0) return null
    const map = new Map()
    let total = 0
    for (const r of data) {
      const key = String(r.asset_code || '').trim().toUpperCase()
      const cost = num(r.tyre_cost)
      if (!key) continue
      map.set(key, cost)
      total += cost
    }
    return { map, total }
  } catch {
    return null
  }
}
