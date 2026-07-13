/**
 * Heat Intelligence service — the single seam between the Heat Intelligence page
 * (/heat-intelligence) and Supabase (table `tyre_temperature_readings`, V188).
 * Keeps an explicit column list (least-privilege selects), null-safe country
 * scoping, input validation, and a whitelisted status. RLS enforces org
 * isolation; this layer never trusts client input blindly.
 *
 * Mirrors odometerLogs.js / coldChain.js. A missing
 * `tyre_temperature_readings` relation (org has not run the migration) degrades
 * listing to an empty array so the page can render its "apply the migration"
 * empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'
import { toFiniteNumber } from '../heatIntelligence'

export const COLS =
  'id,organisation_id,country,asset_no,tyre_position,tyre_serial,temperature_c,' +
  'ambient_c,pressure_bar,speed_kmh,threshold_c,status,location,recorded_at,' +
  'notes,created_by,created_at,updated_at'

/** Severity bands accepted by the DB CHECK constraint. */
const STATUSES = new Set(['normal', 'elevated', 'high', 'critical'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('tyre_temperature_readings'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asStatus = (v) => {
  const s = asText(v, 20)
  return s && STATUSES.has(s.toLowerCase()) ? s.toLowerCase() : null
}
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Validate an optional non-negative numeric field. Blank/absent → null;
 * present-but-non-numeric or negative → throws with the field's label.
 */
function nonNegativeNumber(v, label) {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/**
 * List readings (newest first by recorded_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listTemperatureReadings({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('tyre_temperature_readings').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('recorded_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getTemperatureReading(id) {
  return unwrap(
    await supabase.from('tyre_temperature_readings').select(COLS).eq('id', id).maybeSingle(),
  )
}

/**
 * Least-privilege column set for the fleet blowout-risk assessment. Pulled from
 * the canonical operational table `tyre_records` (same source the Tyre Passport
 * reads) — the heat engine scores these installed tyres against the current
 * desert-heat condition. No new table is introduced.
 */
export const TYRE_RISK_COLS =
  'id,serial_no,serial_number,tyre_serial,brand,size,asset_no,asset_number,site,country,' +
  'position,tyre_position,status,current_status,tread_depth,pressure_reading,cost_per_tyre,' +
  'total_km,fitment_date,issue_date,removal_date'

/**
 * Every tyre_records row in scope for the heat risk assessment (paginated,
 * country-scoped). The installed/active filter + scoring live in the pure lib
 * (`assessFleetRisk`). A missing `tyre_records` relation degrades to [] so the
 * page renders an honest empty state instead of erroring.
 *
 * @param {{ country?:string }} [opts]
 */
export async function listTyresForHeatRisk({ country } = {}) {
  try {
    const { data, error } = await fetchAllPages((from, to) => {
      const q = supabase
        .from('tyre_records')
        .select(TYRE_RISK_COLS)
        .order('id', { ascending: true })
        .range(from, to)
      return applyCountry(q, country)
    })
    if (error) {
      if (isMissingRelation(error)) return []
      throw error
    }
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Ingest a thermal reading. Requires an asset number (which vehicle). Numeric
 * fields are validated non-negative; status is whitelisted against the DB CHECK
 * constraint. Recorded_at defaults to now() at the DB when omitted.
 */
export async function createTemperatureReading(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  const payload = {
    asset_no,
    tyre_position: asText(values.tyre_position, 60),
    tyre_serial: asText(values.tyre_serial, 120),
    temperature_c: nonNegativeNumber(values.temperature_c, 'Temperature (°C)'),
    ambient_c: nonNegativeNumber(values.ambient_c, 'Ambient (°C)'),
    pressure_bar: nonNegativeNumber(values.pressure_bar, 'Pressure (bar)'),
    speed_kmh: nonNegativeNumber(values.speed_kmh, 'Speed (km/h)'),
    threshold_c: nonNegativeNumber(values.threshold_c, 'Threshold (°C)'),
    status: asStatus(values.status),
    location: asText(values.location, 200),
    recorded_at: asTimestamp(values.recorded_at),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  if (payload.recorded_at == null) delete payload.recorded_at

  return unwrap(
    await supabase.from('tyre_temperature_readings').insert(payload).select(COLS).single(),
  )
}

/**
 * Patch a reading. Strips immutable/ownership fields; coerces each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateTemperatureReading(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.tyre_position !== undefined) clean.tyre_position = asText(patch.tyre_position, 60)
  if (patch.tyre_serial !== undefined) clean.tyre_serial = asText(patch.tyre_serial, 120)
  if (patch.temperature_c !== undefined) clean.temperature_c = nonNegativeNumber(patch.temperature_c, 'Temperature (°C)')
  if (patch.ambient_c !== undefined) clean.ambient_c = nonNegativeNumber(patch.ambient_c, 'Ambient (°C)')
  if (patch.pressure_bar !== undefined) clean.pressure_bar = nonNegativeNumber(patch.pressure_bar, 'Pressure (bar)')
  if (patch.speed_kmh !== undefined) clean.speed_kmh = nonNegativeNumber(patch.speed_kmh, 'Speed (km/h)')
  if (patch.threshold_c !== undefined) clean.threshold_c = nonNegativeNumber(patch.threshold_c, 'Threshold (°C)')
  if (patch.status !== undefined) clean.status = asStatus(patch.status)
  if (patch.location !== undefined) clean.location = asText(patch.location, 200)
  if (patch.recorded_at !== undefined) clean.recorded_at = asTimestamp(patch.recorded_at)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(
    await supabase.from('tyre_temperature_readings').update(clean).eq('id', id).select(COLS).single(),
  )
}

export async function deleteTemperatureReading(id) {
  return unwrap(await supabase.from('tyre_temperature_readings').delete().eq('id', id))
}
