/**
 * Fleet Master extras: the reads and writes the redesigned register needs on
 * top of the core fleet service in assets.js (which re-exports everything here
 * so the page reaches it through the one `assets` namespace).
 *
 * Every read is bounded. A value that cannot be read comes back as null, never
 * as a flattering zero, so the page can say "N/A".
 */
import { supabase, applyCountry, ServiceError, fetchAllPages } from './_client'
import { toUserMessage } from '../safeError'

const fail = (error) => { throw new ServiceError(toUserMessage(error), error.code, error) }

/** Distinct vehicle types in the country scope, for the Type filter. */
export async function listFleetTypes({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    let q = supabase
      .from('vehicle_fleet')
      .select('vehicle_type')
      .not('vehicle_type', 'is', null)
      .order('id')
      .range(from, to)
    q = applyCountry(q, country)
    return q
  }, { max: 20000 })
  if (error) fail(error)
  return [...new Set((data ?? []).map(r => String(r.vehicle_type || '').trim()).filter(Boolean))].sort()
}

/**
 * Fields a bulk action may write. Anything else in a patch is dropped, so a
 * bulk edit can never re-key a vehicle or move it to another tenant or country.
 */
export const BULK_EDITABLE = ['status', 'expected_km_per_tyre', 'min_days_between_changes', 'max_tyres_per_day']

/**
 * Apply one patch to many vehicles. RLS decides which rows the user may
 * change; the count returned is the rows actually written, so a partial
 * permission is reported honestly instead of claimed as a full success.
 */
export async function bulkUpdateFleetRecords(ids, patch) {
  const clean = {}
  for (const k of BULK_EDITABLE) if (k in (patch || {})) clean[k] = patch[k]
  if (!Object.keys(clean).length) throw new Error('Nothing to update.')
  clean.updated_at = new Date().toISOString()
  let updated = 0
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { data, error } = await supabase
      .from('vehicle_fleet')
      .update(clean)
      .in('id', chunk)
      .select('id')
    if (error) fail(error)
    updated += data?.length ?? 0
  }
  return updated
}

/**
 * Latest completed job card per vehicle, for the rows on screen only. One
 * `limit(1)` read per vehicle (bounded by the page size), because a vehicle can
 * carry hundreds of job cards and reading them all to keep one would blow past
 * the server's 1,000 row cap. Scoped by the row's own country: an asset number
 * is unique per country only, so the same code elsewhere is another machine.
 *
 * @returns {Promise<Record<string, string>>} key `${country}|${asset_no}` -> ISO date
 */
export async function getLastServiceByAsset(rows = []) {
  const out = {}
  const todo = rows.filter(r => r?.asset_no)
  const one = async (r) => {
    let q = supabase
      .from('work_orders')
      .select('completed_at')
      .eq('asset_no', r.asset_no)
      .not('completed_at', 'is', null)
    if (r.country) q = q.eq('country', r.country)
    const { data, error } = await q.order('completed_at', { ascending: false }).limit(1)
    if (error) fail(error)
    if (data?.[0]?.completed_at) out[`${r.country || ''}|${r.asset_no}`] = data[0].completed_at
  }
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(todo.slice(i, i + 6).map(one))
  }
  return out
}

const isoDay = (d) => {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Active preventive maintenance plans due in the next 7 days, plus how many are
 * already overdue. Head-only counts. null when the plans cannot be read.
 */
export async function countPmDueSoon({ country, now = new Date() } = {}) {
  const today = isoDay(now)
  const in7 = isoDay(new Date(now.getTime() + 7 * 86_400_000))
  const base = () => applyCountry(
    supabase.from('pm_programs').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    country,
  )
  const [due, overdue] = await Promise.all([
    base().gte('next_due', today).lte('next_due', in7),
    base().lt('next_due', today),
  ])
  if (due.error) fail(due.error)
  if (overdue.error) fail(overdue.error)
  return { dueSoon: due.count ?? null, overdue: overdue.count ?? null }
}

/**
 * Average telematics utilisation across the vehicles that report one. Returns
 * null when no vehicle has a reading, never 0.
 */
export async function getUtilisationSummary({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) =>
    applyCountry(supabase.from('asset_utilization').select('utilization_pct'), country)
      .not('utilization_pct', 'is', null)
      .order('id')
      .range(from, to), { max: 20000 })
  if (error) fail(error)
  const vals = (data ?? []).map(r => Number(r.utilization_pct)).filter(Number.isFinite)
  if (!vals.length) return { avg: null, assets: 0 }
  return { avg: vals.reduce((s, v) => s + v, 0) / vals.length, assets: vals.length }
}
