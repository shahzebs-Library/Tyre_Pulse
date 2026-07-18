/**
 * Vehicle Washing service (V270) - wash_records is the log of every vehicle
 * wash. RLS enforces org isolation (read for any active member; write for
 * Admin/Manager/Director) plus country + site scoping. This layer keeps an
 * explicit least-privilege column list and null-safe country scoping, mirroring
 * pmPrograms.js / gatePasses.js.
 *
 * Before the migration is applied the lister degrades to [] so the page can
 * surface an "apply MIGRATIONS_V270_WASH_MODULE.sql" hint instead of throwing.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'

export const COLS =
  'id,organisation_id,country,site,area,asset_no,vehicle_type,wash_date,wash_time,' +
  'wash_type,bay,washed_by,water_liters,cost,duration_min,status,odometer_km,notes,' +
  'created_by,created_at,updated_at'

/** Controlled vocabularies (mirror the DB CHECK constraints). */
export const WASH_TYPES = ['Exterior', 'Interior', 'Full', 'Engine Bay', 'Undercarriage', 'Steam', 'Waterless']
export const WASH_STATUSES = ['Scheduled', 'In Progress', 'Completed', 'Cancelled']

/** Coerce a value to a finite number or null (empty string / null / NaN -> null). */
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Trim + slice a text value, or null when empty. */
function textOrNull(v, max = 200) {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

/** True when a Supabase error means the table/relation is not deployed yet. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

/**
 * List wash records (newest wash first). All filters optional. Country-scoped
 * (null-safe). Returns [] when the table is missing so the UI prompts for the
 * migration rather than erroring.
 * @param {{country?:string, from?:string, to?:string, site?:string, area?:string,
 *   type?:string, assetNo?:string, status?:string, limit?:number }} [opts]
 */
export async function listWashRecords({
  country, from, to, site, area, type, assetNo, status, limit = 20000,
} = {}) {
  const pageFn = (pFrom, pTo) => {
    let q = supabase.from('wash_records').select(COLS)
    q = applyCountry(q, country)
    if (from) q = q.gte('wash_date', String(from).slice(0, 10))
    if (to) q = q.lte('wash_date', String(to).slice(0, 10))
    if (site && site !== 'All') q = q.eq('site', site)
    if (area && area !== 'All') q = q.eq('area', area)
    if (type && type !== 'All') q = q.eq('wash_type', type)
    if (assetNo) q = q.eq('asset_no', assetNo)
    if (status && status !== 'All') q = q.eq('status', status)
    return q
      .order('wash_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(pFrom, pTo)
  }
  try {
    const { data, error } = await fetchAllPages(pageFn, { pageSize: 1000, max: limit })
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Whitelist + coerce a create/update payload against the wash_records schema. */
function buildPayload(values = {}) {
  const washType = WASH_TYPES.includes(values.wash_type) ? values.wash_type : null
  const status = WASH_STATUSES.includes(values.status) ? values.status : 'Completed'
  return {
    asset_no: textOrNull(values.asset_no, 120),
    vehicle_type: textOrNull(values.vehicle_type, 120),
    site: textOrNull(values.site, 120),
    area: textOrNull(values.area, 120),
    wash_date: values.wash_date || null,
    wash_time: textOrNull(values.wash_time, 20),
    wash_type: washType,
    bay: textOrNull(values.bay, 60),
    washed_by: textOrNull(values.washed_by, 120),
    water_liters: numOrNull(values.water_liters),
    cost: numOrNull(values.cost),
    duration_min: numOrNull(values.duration_min),
    status,
    odometer_km: numOrNull(values.odometer_km),
    notes: textOrNull(values.notes, 4000),
    country: values.country ?? null,
  }
}

/** Create a wash record. `asset_no` is required. */
export async function createWashRecord(values = {}) {
  const payload = buildPayload(values)
  if (!payload.asset_no) throw new Error('An asset number is required.')
  if (!payload.wash_date) payload.wash_date = new Date().toISOString().slice(0, 10)
  return unwrap(await supabase.from('wash_records').insert(payload).select(COLS).single())
}

/** Patch a wash record. Immutable / generated columns are stripped. */
export async function updateWashRecord(id, patch = {}) {
  if (!id) throw new Error('A record id is required.')
  const clean = buildPayload(patch)
  // Only send keys that were actually present in the patch (avoid nulling
  // untouched columns), while keeping the coercion above.
  const out = {}
  for (const k of Object.keys(clean)) {
    if (Object.prototype.hasOwnProperty.call(patch, k) || (k === 'status' && 'status' in patch)) {
      out[k] = clean[k]
    }
  }
  // country is only sent when explicitly provided.
  if (!('country' in patch)) delete out.country
  return unwrap(await supabase.from('wash_records').update(out).eq('id', id).select(COLS).single())
}

/** Delete a wash record by id. */
export async function deleteWashRecord(id) {
  if (!id) throw new Error('A record id is required.')
  return unwrap(await supabase.from('wash_records').delete().eq('id', id))
}

/** Distinct non-empty site values from a set of loaded rows (sorted). */
export function distinctSites(rows) {
  return distinctField(rows, 'site')
}

/** Distinct non-empty area values from a set of loaded rows (sorted). */
export function distinctAreas(rows) {
  return distinctField(rows, 'area')
}

function distinctField(rows, key) {
  const set = new Set()
  for (const r of Array.isArray(rows) ? rows : []) {
    const v = r && r[key]
    if (v != null && String(v).trim() !== '') set.add(String(v).trim())
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}
