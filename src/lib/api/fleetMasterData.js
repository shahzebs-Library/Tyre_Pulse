/**
 * Fleet Master extras: the reads and writes the redesigned register needs on
 * top of the core fleet service in assets.js (which re-exports everything here
 * so the page reaches it through the one `assets` namespace).
 *
 * Every read is bounded. A value that cannot be read comes back as null, never
 * as a flattering zero, so the page can say "N/A".
 */
import { supabase, applyCountry, ServiceError, fetchAllPages, isNotProvisioned } from './_client'
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

// ── Add / Edit form: required fields ─────────────────────────────────────────

/** Fields a vehicle cannot be saved without, in the order they appear on the form. */
export const REQUIRED_FLEET_FIELDS = ['asset_no', 'country']

/**
 * Required fields still blank on the form, as display labels (falling back to
 * the field key). Whitespace counts as blank, matching the save check.
 */
export function missingRequiredFields(form, labels = {}) {
  return REQUIRED_FLEET_FIELDS
    .filter(k => !String(form?.[k] ?? '').trim())
    .map(k => labels[k] || k)
}

/** One short line naming what is still missing, or '' when nothing is. */
export function missingFieldsMessage(missing) {
  return missing && missing.length ? `Fill in: ${missing.join(', ')}` : ''
}

// ── Delete: linked history ───────────────────────────────────────────────────

/**
 * Tables whose rows point at a vehicle by asset_no. Deleting a vehicle that
 * still has rows here leaves history that refers to a vehicle that no longer
 * exists, so the page offers Mark Inactive instead.
 */
export const HISTORY_TABLES = [
  { table: 'inspections',  one: 'inspection',  many: 'inspections' },
  { table: 'tyre_records', one: 'tyre record', many: 'tyre records' },
  { table: 'work_orders',  one: 'work order',  many: 'work orders' },
  { table: 'accidents',    one: 'accident',    many: 'accidents' },
]

/**
 * Pure: turn per-table counts into a delete decision.
 * counts: { [table]: number | null }  (null = could not be checked)
 * Returns { state: 'none' | 'history' | 'unknown', total, text }.
 *  - 'history'  at least one linked record: permanent delete is withheld
 *  - 'unknown'  a table could not be read and nothing was found elsewhere:
 *               withheld too, because "we could not look" is not "there is none"
 *  - 'none'     every table checked and empty: permanent delete is allowed
 */
/** [{ table, count }] for the tables that hold at least one linked record. */
function nonZero(counts) {
  return HISTORY_TABLES
    .map(t => ({ table: t.table, count: Number(counts[t.table]) }))
    .filter(x => Number.isFinite(x.count) && x.count > 0)
}

export function summarizeLinkedRecords(counts = {}) {
  const parts = []
  let total = 0
  let unknown = false
  for (const t of HISTORY_TABLES) {
    const n = counts[t.table]
    if (n == null || !Number.isFinite(Number(n))) { unknown = true; continue }
    const v = Number(n)
    if (v > 0) {
      total += v
      parts.push(`${v.toLocaleString()} ${v === 1 ? t.one : t.many}`)
    }
  }
  if (total > 0) {
    return { state: 'history', total, text: parts.join(', '), counts: nonZero(counts) }
  }
  if (unknown) return { state: 'unknown', total: 0, text: '', counts: [] }
  return { state: 'none', total: 0, text: '', counts: [] }
}

/**
 * Head-only counts of records linked to one vehicle (asset_no + country).
 * A table that is not provisioned counts as 0; any other failure is null so the
 * page can refuse a permanent delete it could not verify.
 */
export async function countLinkedRecords({ assetNo, country } = {}) {
  const code = String(assetNo || '').trim()
  const out = {}
  if (!code) {
    for (const t of HISTORY_TABLES) out[t.table] = null
    return out
  }
  await Promise.all(HISTORY_TABLES.map(async ({ table }) => {
    try {
      const q = applyCountry(
        supabase.from(table).select('id', { count: 'exact', head: true }).eq('asset_no', code),
        country,
      )
      const { count, error } = await q
      if (error) { out[table] = isNotProvisioned(error) ? 0 : null; return }
      out[table] = Number.isFinite(count) ? count : null
    } catch {
      out[table] = null
    }
  }))
  return out
}

// ── Bulk delete: linked history for many vehicles at once ───────────────────

const normCode = (v) => String(v ?? '').trim().toUpperCase()

/**
 * Pure: per-vehicle counts from the linked rows each history table returned.
 * vehicles: [{ id, asset_no, country }]
 * tableRows: { [table]: [{ asset_no, country }] | null }  (null = unreadable)
 * A row counts for a vehicle when the asset number matches and the countries
 * agree, a row with no country counts for every country (the same rule as
 * applyCountry, so the bulk check never finds less than the single one).
 * Returns { [vehicleId]: { [table]: number | null } }.
 */
export function linkedCountsForVehicles(vehicles = [], tableRows = {}) {
  const out = {}
  for (const v of vehicles) {
    const code = normCode(v.asset_no)
    const vc = v.country && v.country !== 'All' ? v.country : null
    const counts = {}
    for (const { table } of HISTORY_TABLES) {
      const rows = tableRows[table]
      if (!code || rows == null) { counts[table] = null; continue }
      counts[table] = rows.filter(r =>
        normCode(r.asset_no) === code && (!vc || !r.country || r.country === vc)).length
    }
    out[v.id] = counts
  }
  return out
}

/**
 * Pure: split the selected vehicles into the three bulk-delete groups.
 * clean   = checked and no history: may be deleted permanently
 * history = has linked records: Mark Inactive only
 * unknown = a count could not be read: Mark Inactive only
 */
export function groupBulkDelete(vehicles = [], countsById = {}) {
  const groups = { clean: [], history: [], unknown: [] }
  for (const v of vehicles) {
    const s = summarizeLinkedRecords(countsById[v.id] || {}).state
    if (s === 'none') groups.clean.push(v)
    else if (s === 'history') groups.history.push(v)
    else groups.unknown.push(v)
  }
  return groups
}

const LINKED_ROW_CAP = 50000

/**
 * Linked-record counts for many vehicles: one bounded read per table per 100
 * asset numbers (asset_no + country only). A failed or capped read marks that
 * table unreadable, so no vehicle is ever cleared for deletion on a partial look.
 */
export async function countLinkedRecordsBulk(vehicles = []) {
  const codes = [...new Set(vehicles.map(v => String(v.asset_no ?? '').trim()).filter(Boolean))]
  const tableRows = {}
  await Promise.all(HISTORY_TABLES.map(async ({ table }) => {
    const rows = []
    try {
      for (let i = 0; i < codes.length; i += 100) {
        const chunk = codes.slice(i, i + 100)
        const { data, error, truncated } = await fetchAllPages((from, to) =>
          supabase.from(table).select('id, asset_no, country').in('asset_no', chunk)
            .order('id').range(from, to), { max: LINKED_ROW_CAP })
        if (error) {
          if (isNotProvisioned(error)) { tableRows[table] = []; return }
          tableRows[table] = null; return
        }
        if (truncated) { tableRows[table] = null; return }
        rows.push(...(data ?? []))
      }
      tableRows[table] = rows
    } catch {
      tableRows[table] = null
    }
  }))
  return linkedCountsForVehicles(vehicles, tableRows)
}
