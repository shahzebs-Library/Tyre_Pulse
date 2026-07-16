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

/**
 * Compute the tyre vs maintenance spend split for the last 12 calendar months.
 * @param {{ country?:string, now?:Date|string|number }} [opts]
 * @returns {Promise<{ tyre:number, maintenance:number,
 *   byMonth:Array<{ month:string, tyre:number, maintenance:number }> }>}
 */
export async function loadCostSplit({ country, now } = {}) {
  const keys = last12MonthKeys(now || new Date())
  const inWindow = new Set(keys)
  const tyreByMonth = Object.fromEntries(keys.map((k) => [k, 0]))
  const maintByMonth = Object.fromEntries(keys.map((k) => [k, 0]))

  const add = (bucket, key, amount) => {
    if (key && inWindow.has(key)) bucket[key] += num(amount)
  }

  // TYRE spend: cost_per_tyre x (qty || 1), bucketed by issue_date.
  try {
    const { data, error } = await fetchAllPages((from, to) => {
      const q = supabase.from('tyre_records').select('cost_per_tyre,qty,issue_date')
        .order('id', { ascending: true }).range(from, to)
      return applyCountry(q, country)
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
    const { data, error } = await fetchAllPages((from, to) => {
      const q = supabase.from('pm_service_records').select('total_cost,service_date')
        .order('service_date', { ascending: true }).range(from, to)
      return applyCountry(q, country)
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
    const { data, error } = await fetchAllPages((from, to) => {
      const q = supabase.from('work_orders')
        .select('labour_cost,parts_cost,lubricant_cost,outside_repair_cost,tyre_cost,completed_at,created_at')
        .order('created_at', { ascending: true }).range(from, to)
      return applyCountry(q, country)
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
  return { tyre, maintenance, byMonth }
}
