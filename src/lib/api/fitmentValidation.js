/**
 * Fitment Validation service — reads the two datasets the Fitment Validation
 * screen joins in the browser: fleet assets (the specified tyre size) and the
 * currently-fitted tyres (in-service `tyre_records`, i.e. `removal_date IS
 * NULL`). Country-scoped (null-safe) and fully paginated so large fleets are
 * never silently truncated. Classification lives in `src/lib/fitmentValidation.js`.
 */
import { supabase, applyCountry, fetchAllPages, unwrap } from './_client'

const VEHICLE_COLS =
  'id,asset_no,make,model,vehicle_type,site,country,status,is_active,tyre_size'

const TYRE_COLS =
  'id,asset_no,serial_no,serial_number,tyre_serial,size,position,tyre_position,' +
  'site,region,country,status,removal_date'

/**
 * Every fleet asset (paginated), newest first, country-scoped. These carry the
 * SPEC (`tyre_size`) that fitted tyres are validated against.
 * @param {{ country?:string }} [opts]
 */
export async function listFleetForFitment({ country } = {}) {
  return fetchAllPages((from, to) => {
    const q = supabase
      .from('vehicle_fleet')
      .select(VEHICLE_COLS)
      .order('asset_no', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
}

/**
 * Every in-service tyre record (paginated), country-scoped. Only tyres still on
 * a vehicle (`removal_date IS NULL`) are relevant to the fitment question.
 * @param {{ country?:string }} [opts]
 */
export async function listFittedTyres({ country } = {}) {
  return fetchAllPages((from, to) => {
    const q = supabase
      .from('tyre_records')
      .select(TYRE_COLS)
      .is('removal_date', null)
      .order('asset_no', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
}

/**
 * Convenience loader: fetch both datasets in parallel for the page.
 * @param {{ country?:string }} [opts]
 * @returns {Promise<{ vehicles:object[], tyres:object[] }>}
 */
export async function loadFitmentData({ country } = {}) {
  const [vehicles, tyres] = await Promise.all([
    listFleetForFitment({ country }),
    listFittedTyres({ country }),
  ])
  return {
    vehicles: Array.isArray(vehicles) ? vehicles : [],
    tyres: Array.isArray(tyres) ? tyres : [],
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLE-FITMENT VALIDATION ENGINE — rules + validation ledger (V208)
// ════════════════════════════════════════════════════════════════════════════
// Backs the "Validate", "Rules" and "History" tabs. RLS enforces org isolation
// and elevated-role writes; this layer keeps explicit column lists, validates
// input, and degrades a missing relation (org has not run V208) to an empty list
// so the page can show its "apply the migration" state instead of erroring.

export const RULE_COLS =
  'id,organisation_id,rule_name,applies_to_vehicle_types,applies_to_axle_roles,' +
  'approved_sizes,min_tread_depth_mm,max_tyre_age_years,allow_retread,' +
  'max_retread_count,require_matching_pair,max_tread_delta_dual_mm,is_active,' +
  'notes,created_by,country,created_at,updated_at'

export const VALIDATION_COLS =
  'id,organisation_id,tyre_serial,asset_no,position_code,axle_role,is_valid,' +
  'violations,warnings,validated_by,validated_at,country,created_at,updated_at'

// Columns needed to resolve a single tyre for validation (only real columns).
const TYRE_LOOKUP_COLS =
  'id,brand,serial_no,serial_number,tyre_serial,asset_no,size,status,' +
  'tread_depth,pressure_reading,fitment_date,removal_date,reason_for_removal,' +
  'position,tyre_position,country'

const VEHICLE_LOOKUP_COLS =
  'id,asset_no,make,model,vehicle_type,tyre_size,site,country,status'

/** True when the failure is "table does not exist yet" (pre-V208). */
export function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && (msg.includes('fitment_rules') || msg.includes('fitment_validations')))
  )
}

const asText = (v, max = 200) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asBool = (v, dflt = false) => (v == null ? dflt : Boolean(v))
const asNum = (v, field) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number.`)
  return n
}
const asInt = (v, field) => {
  const n = asNum(v, field)
  return n == null ? null : Math.round(n)
}
/** Normalise a text[] input from an array or a comma/newline-separated string. */
const asTextArray = (v) => {
  if (v == null || v === '') return []
  const parts = Array.isArray(v) ? v : String(v).split(/[,\n]/)
  return [...new Set(parts.map((x) => String(x).trim()).filter(Boolean))].slice(0, 200)
}
/** Escape a value for a PostgREST `.or()` filter (guard against injection). */
const safeFilterValue = (v) => String(v).replace(/[(),*"\\]/g, '').trim()

// ── Fitment rules ────────────────────────────────────────────────────────────

/**
 * List fitment rules (active first, then newest). Country-scoped (null-safe).
 * Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listRules({ country, limit = 500 } = {}) {
  try {
    const q = supabase
      .from('fitment_rules')
      .select(RULE_COLS)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)
    return unwrap(await applyCountry(q, country)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Build a clean, validated rule payload from raw form values. */
function rulePayload(values = {}) {
  const rule_name = asText(values.rule_name, 200)
  if (!rule_name) throw new Error('A rule name is required.')
  const clean = {
    rule_name,
    applies_to_vehicle_types: asTextArray(values.applies_to_vehicle_types),
    applies_to_axle_roles: asTextArray(values.applies_to_axle_roles),
    approved_sizes: asTextArray(values.approved_sizes),
    min_tread_depth_mm: asNum(values.min_tread_depth_mm, 'Minimum tread depth') ?? 3.0,
    max_tyre_age_years: asNum(values.max_tyre_age_years, 'Maximum tyre age') ?? 6,
    allow_retread: asBool(values.allow_retread, true),
    max_retread_count: asInt(values.max_retread_count, 'Maximum retread count') ?? 2,
    require_matching_pair: asBool(values.require_matching_pair, true),
    max_tread_delta_dual_mm: asNum(values.max_tread_delta_dual_mm, 'Maximum dual tread delta') ?? 2.0,
    is_active: asBool(values.is_active, true),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: asText(values.country, 120),
  }
  return clean
}

export async function createRule(values = {}) {
  return unwrap(
    await supabase.from('fitment_rules').insert(rulePayload(values)).select(RULE_COLS).single(),
  )
}

export async function updateRule(id, patch = {}) {
  if (!id) throw new Error('A rule id is required.')
  // Rebuild from the full patch (the modal always submits the whole form).
  const payload = rulePayload(patch)
  return unwrap(
    await supabase.from('fitment_rules').update(payload).eq('id', id).select(RULE_COLS).single(),
  )
}

export async function deleteRule(id) {
  if (!id) throw new Error('A rule id is required.')
  return unwrap(await supabase.from('fitment_rules').delete().eq('id', id))
}

// ── Validation ledger ────────────────────────────────────────────────────────

/**
 * List recent persisted validations (newest first). Country-scoped (null-safe).
 * Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listValidations({ country, limit = 100 } = {}) {
  try {
    const q = supabase
      .from('fitment_validations')
      .select(VALIDATION_COLS)
      .order('validated_at', { ascending: false })
      .limit(limit)
    return unwrap(await applyCountry(q, country)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Persist a validation result. `is_valid` is derived from the violations when a
 * `result` object is supplied, otherwise from the explicit `is_valid` field.
 * @param {object} values { tyre_serial, asset_no, position_code, axle_role, country, result }
 */
export async function createValidation(values = {}) {
  const result = values.result || {}
  const violations = Array.isArray(values.violations) ? values.violations : (result.violations || [])
  const warnings = Array.isArray(values.warnings) ? values.warnings : (result.warnings || [])
  const is_valid = values.is_valid != null
    ? Boolean(values.is_valid)
    : (result.is_valid != null ? Boolean(result.is_valid) : !violations.some((v) => v?.severity === 'critical'))

  const payload = {
    tyre_serial: asText(values.tyre_serial, 200),
    asset_no: asText(values.asset_no, 200),
    position_code: asText(values.position_code, 60),
    axle_role: asText(values.axle_role, 60),
    is_valid,
    violations,
    warnings,
    country: asText(values.country, 120),
  }
  return unwrap(
    await supabase.from('fitment_validations').insert(payload).select(VALIDATION_COLS).single(),
  )
}

// ── Lookups for the Validate form ────────────────────────────────────────────

/**
 * Resolve a single tyre by serial across the three serial columns
 * (`serial_no` / `serial_number` / `tyre_serial`). Country-scoped; prefers the
 * most recently fitted record. Returns null when not found.
 * @param {string} serial
 * @param {{ country?:string }} [opts]
 */
export async function findTyreBySerial(serial, { country } = {}) {
  const s = safeFilterValue(serial || '')
  if (!s) return null
  const q = supabase
    .from('tyre_records')
    .select(TYRE_LOOKUP_COLS)
    .or(`serial_no.eq.${s},serial_number.eq.${s},tyre_serial.eq.${s}`)
    .order('fitment_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(1)
  const rows = unwrap(await applyCountry(q, country)) || []
  return rows[0] || null
}

/**
 * Resolve a single fleet asset by asset number. Country-scoped. Returns null
 * when not found.
 * @param {string} assetNo
 * @param {{ country?:string }} [opts]
 */
export async function findVehicleByAsset(assetNo, { country } = {}) {
  const a = asText(assetNo, 200)
  if (!a) return null
  const q = supabase
    .from('vehicle_fleet')
    .select(VEHICLE_LOOKUP_COLS)
    .eq('asset_no', a)
    .limit(1)
  const rows = unwrap(await applyCountry(q, country)) || []
  return rows[0] || null
}

/**
 * Probe whether the V208 fitment tables are provisioned. Returns false on a
 * missing relation so the page can show its "apply the migration" banner
 * (listRules/listValidations deliberately swallow that error to []).
 * @returns {Promise<boolean>}
 */
export async function isFitmentProvisioned() {
  try {
    await unwrap(await supabase.from('fitment_rules').select('id', { count: 'exact', head: true }))
    return true
  } catch (err) {
    if (isMissingRelation(err)) return false
    throw err
  }
}
