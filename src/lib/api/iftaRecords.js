/**
 * IFTA Fuel Tax Reporting service — the single seam between the IFTA Reporting
 * page (/ifta-reporting) and Supabase (table `ifta_records`, V173). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping, and
 * input validation. RLS enforces org isolation; this layer never trusts client
 * input blindly.
 *
 * Mirrors odometerLogs.js. A missing `ifta_records` relation (org has not run
 * the migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../iftaRecords'

export const COLS =
  'id,organisation_id,country,asset_no,driver_name,jurisdiction,quarter,' +
  'travel_date,distance_km,fuel_litres,fuel_cost,currency,tax_rate,taxable_km,' +
  'notes,created_by,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('ifta_records'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Coerce a value to a non-negative finite number, throwing on invalid input. */
function asNonNegNumber(v, label) {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/**
 * List records (newest first by travel_date, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listIftaRecords({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('ifta_records').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('travel_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getIftaRecord(id) {
  return unwrap(await supabase.from('ifta_records').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Capture a jurisdiction fuel-tax record. Requires an asset number (which
 * vehicle). Numeric fields (distance, fuel, cost, tax rate, taxable distance)
 * are validated non-negative. Travel date defaults to today when omitted.
 */
export async function createIftaRecord(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  const payload = {
    asset_no,
    driver_name: asText(values.driver_name, 200),
    jurisdiction: asText(values.jurisdiction, 120),
    quarter: asText(values.quarter, 40),
    travel_date: asDate(values.travel_date) || new Date().toISOString().slice(0, 10),
    distance_km: asNonNegNumber(values.distance_km, 'Distance (km)'),
    fuel_litres: asNonNegNumber(values.fuel_litres, 'Fuel (litres)'),
    fuel_cost: asNonNegNumber(values.fuel_cost, 'Fuel cost'),
    currency: asText(values.currency, 10),
    tax_rate: asNonNegNumber(values.tax_rate, 'Tax rate'),
    taxable_km: asNonNegNumber(values.taxable_km, 'Taxable distance (km)'),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('ifta_records').insert(payload).select(COLS).single())
}

/**
 * Patch a record. Strips immutable/ownership fields; coerces each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateIftaRecord(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 200)
  if (patch.jurisdiction !== undefined) clean.jurisdiction = asText(patch.jurisdiction, 120)
  if (patch.quarter !== undefined) clean.quarter = asText(patch.quarter, 40)
  if (patch.travel_date !== undefined) clean.travel_date = asDate(patch.travel_date)
  if (patch.distance_km !== undefined) clean.distance_km = asNonNegNumber(patch.distance_km, 'Distance (km)')
  if (patch.fuel_litres !== undefined) clean.fuel_litres = asNonNegNumber(patch.fuel_litres, 'Fuel (litres)')
  if (patch.fuel_cost !== undefined) clean.fuel_cost = asNonNegNumber(patch.fuel_cost, 'Fuel cost')
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 10)
  if (patch.tax_rate !== undefined) clean.tax_rate = asNonNegNumber(patch.tax_rate, 'Tax rate')
  if (patch.taxable_km !== undefined) clean.taxable_km = asNonNegNumber(patch.taxable_km, 'Taxable distance (km)')
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('ifta_records').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteIftaRecord(id) {
  return unwrap(await supabase.from('ifta_records').delete().eq('id', id))
}
