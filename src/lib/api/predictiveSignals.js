/**
 * Reads for the Predictive Maintenance page that no other service covers:
 *  - job cards opened in a recent window (for "repeat work on one asset")
 *  - how many rows actually carry each signal (tread, pressure, risk level,
 *    monthly budget, current odometer), so the page can state coverage
 *  - recent fitment history for the by-month demand view
 *
 * Country-scoped with the null-safe applyCountry convention. Paged with a
 * unique tiebreak; a hit ceiling is reported as `truncated`, never hidden.
 */
import { supabase, applyCountry, fetchAllPages, toServiceError } from './_client'

const DAY_MS = 86400000
const JOB_CARD_CEILING = 20000

/** Job cards opened in the last `days`, newest first. Throws on failure. */
export async function listRecentJobCards({ country, days = 90, now = new Date() } = {}) {
  const until = new Date(now).toISOString()
  const since = new Date(new Date(now).getTime() - days * DAY_MS).toISOString()
  const { data, error, truncated } = await fetchAllPages((from, to) => applyCountry(
    supabase.from('work_orders').select('id,asset_no,country,site,work_type,status,opened_at')
      .gte('opened_at', since).lte('opened_at', until),
    country,
  ).order('opened_at', { ascending: false }).order('id').range(from, to), { max: JOB_CARD_CEILING })
  if (error) throw toServiceError(error, 'Could not load job cards.')
  return { rows: data || [], truncated: !!truncated }
}

async function headCount(table, country, narrow) {
  try {
    let q = applyCountry(supabase.from(table).select('id', { count: 'exact', head: true }), country)
    if (narrow) q = narrow(q)
    const { count, error } = await q
    return error || count == null ? null : count
  } catch {
    return null
  }
}

/**
 * Row counts behind each signal. Each figure is null when its own read failed,
 * so the page says "could not be checked" instead of "none recorded".
 */
export async function getSignalCoverage({ country } = {}) {
  const filled = (col) => (q) => q.not(col, 'is', null)
  const [tyres, withTread, withPressure, withRisk, fleet, withKm, withBudget] = await Promise.all([
    headCount('tyre_records', country),
    headCount('tyre_records', country, filled('tread_depth')),
    headCount('tyre_records', country, filled('pressure_reading')),
    headCount('tyre_records', country, filled('risk_level')),
    headCount('vehicle_fleet', country),
    headCount('vehicle_fleet', country, (q) => q.gt('current_km', 0)),
    headCount('vehicle_fleet', country, (q) => q.gt('monthly_tyre_budget', 0)),
  ])
  return { tyres, withTread, withPressure, withRisk, fleet, withKm, withBudget }
}

/** Tyre fitments in the last `months`, for the fitment-history demand view. */
export async function listFitmentHistory({ country, months = 13, now = new Date() } = {}) {
  const d = new Date(now)
  const since = new Date(d.getFullYear(), d.getMonth() - months, 1)
  const sinceDay = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-01`
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const { data, error, truncated } = await fetchAllPages((from, to) => applyCountry(
    supabase.from('tyre_records').select('id,size,qty,issue_date,cost_per_tyre')
      .gte('issue_date', sinceDay).lte('issue_date', today),
    country,
  ).order('issue_date', { ascending: false }).order('id').range(from, to), { max: 50000 })
  if (error) throw toServiceError(error, 'Could not load the fitment history.')
  return { rows: data || [], truncated: !!truncated }
}
