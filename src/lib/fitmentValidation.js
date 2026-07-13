/**
 * Fitment validation — pure helpers (no I/O) for the Fitment Validation module.
 * For every fleet asset that declares a specified tyre size (the SPEC), we
 * compare that spec against the size(s) of the tyres actually fitted to the
 * asset (in-service `tyre_records`). A vehicle is:
 *
 *   - MATCH    — it has a spec, has fitted tyres, and every fitted size equals
 *                the spec after normalisation.
 *   - MISMATCH — it has a spec and at least one fitted tyre whose size differs
 *                from the spec (wrong size fitted).
 *   - UNKNOWN  — no spec on the asset, or no fitted tyres to compare against.
 *
 * Size comparison is normalisation-tolerant: trim, upper-case, and strip all
 * whitespace so "295/80 R22.5" and "295/80r22.5" compare equal. These functions
 * are unit-tested; the page and service consume them so the classification logic
 * lives in exactly one place.
 */

export const FITMENT_BANDS = ['match', 'mismatch', 'unknown']

export const FITMENT_BAND_META = {
  match: { label: 'Correct size', tone: 'green' },
  mismatch: { label: 'Wrong size', tone: 'red' },
  unknown: { label: 'No data', tone: 'slate' },
}

/**
 * Normalise a tyre size for equality comparison: trim, upper-case, and remove
 * every whitespace character. Returns '' for null/undefined/blank input so
 * callers can treat "" as "no usable size".
 */
export function normalizeSize(size) {
  if (size == null) return ''
  return String(size).toUpperCase().replace(/\s+/g, '').trim()
}

const serialOf = (r) => r?.serial_no || r?.serial_number || r?.tyre_serial || ''
const positionOf = (r) => r?.position || r?.tyre_position || ''

/**
 * Classify one vehicle against its fitted tyre rows.
 * @param {object} vehicle  a `vehicle_fleet` row (needs asset_no, tyre_size, …)
 * @param {Array<object>} [fittedRows]  in-service `tyre_records` for this asset
 * @returns {{
 *   asset_no:string, make:string, model:string, vehicle_type:string,
 *   site:string, country:string, status:string,
 *   spec:string, specNorm:string, fittedCount:number,
 *   fittedSizes:string[], mismatchSizes:string[],
 *   band:'match'|'mismatch'|'unknown', fitted:Array<object>
 * }}
 */
export function classifyFitment(vehicle, fittedRows = []) {
  const rows = Array.isArray(fittedRows) ? fittedRows : []
  const spec = vehicle?.tyre_size == null ? '' : String(vehicle.tyre_size).trim()
  const specNorm = normalizeSize(spec)

  // Unique raw fitted sizes (preserve a display form), and their normalised set.
  const fittedSizes = []
  const seen = new Set()
  const mismatchSizes = []
  const mismatchSeen = new Set()
  let anyMatch = false

  for (const r of rows) {
    const raw = r?.size == null ? '' : String(r.size).trim()
    const norm = normalizeSize(raw)
    if (raw && !seen.has(norm)) { seen.add(norm); fittedSizes.push(raw) }
    if (specNorm && norm) {
      if (norm === specNorm) anyMatch = true
      else if (!mismatchSeen.has(norm)) { mismatchSeen.add(norm); mismatchSizes.push(raw) }
    }
  }

  const fitted = rows.map((r) => ({
    id: r?.id,
    serial: serialOf(r) || '—',
    position: positionOf(r) || '—',
    size: r?.size == null ? '' : String(r.size).trim(),
    sizeNorm: normalizeSize(r?.size),
    site: r?.site || '',
    matches: !!specNorm && normalizeSize(r?.size) === specNorm,
  }))

  let band
  if (!specNorm || rows.length === 0) band = 'unknown'
  else if (mismatchSizes.length > 0) band = 'mismatch'
  else band = 'match'

  return {
    asset_no: vehicle?.asset_no || '',
    make: vehicle?.make || '',
    model: vehicle?.model || '',
    vehicle_type: vehicle?.vehicle_type || '',
    site: vehicle?.site || '',
    country: vehicle?.country || '',
    status: vehicle?.status || '',
    spec,
    specNorm,
    fittedCount: rows.length,
    fittedSizes,
    mismatchSizes,
    band,
    fitted,
    _anyMatch: anyMatch,
  }
}

/**
 * Group in-service tyre records by asset number.
 * @param {Array<object>} tyreRecords
 * @returns {Map<string, Array<object>>}
 */
export function groupFittedByAsset(tyreRecords) {
  const map = new Map()
  for (const r of Array.isArray(tyreRecords) ? tyreRecords : []) {
    const key = r?.asset_no
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }
  return map
}

/**
 * Classify a whole fleet: join `vehicle_fleet` rows to their in-service tyres
 * and band each. Returns the enriched rows plus summary counts.
 * @param {Array<object>} vehicles     `vehicle_fleet` rows
 * @param {Array<object>} tyreRecords  in-service `tyre_records` rows
 */
export function summarizeFitments(vehicles, tyreRecords) {
  const byAsset = groupFittedByAsset(tyreRecords)
  const rows = (Array.isArray(vehicles) ? vehicles : []).map((v) =>
    classifyFitment(v, byAsset.get(v?.asset_no) || []),
  )
  const counts = { total: rows.length, match: 0, mismatch: 0, unknown: 0 }
  for (const r of rows) counts[r.band] += 1
  const checked = counts.match + counts.mismatch
  const compliancePct = checked > 0 ? Math.round((counts.match / checked) * 100) : null
  return { rows, counts, compliancePct }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLE-FITMENT VALIDATION ENGINE (ported from tyre_saas fitment_engine.py)
// ════════════════════════════════════════════════════════════════════════════
// Validates ONE tyre against the position it is about to be fitted to, using the
// org's fitment rule (approved sizes, minimum tread, retread/pairing policy).
// The original engine reads many fields this app's flat `tyre_records` does not
// carry (per-groove tread, manufacture date / DOT code, retread count, wheel
// position layout). Rather than fabricate them, only the checks that map to REAL
// columns (size, tread_depth, status) are enforced; the age / retread / dual-pair
// checks are surfaced HONESTLY as "unavailable" (see FITMENT_UNAVAILABLE_CHECKS)
// and their functions no-op when the required inputs are absent. Pure (no I/O),
// unit-tested; the page and service consume these so the logic lives in one place.

/** Engine thresholds — GCC-standard defaults (mirror threshold_config.py). */
export const FITMENT_ENGINE_DEFAULTS = Object.freeze({
  min_tread_depth_mm: 3.0,
  tread_warning_buffer_mm: 2.0,
  max_tyre_age_years: 6,
  max_retread_count: 2,
  max_tread_delta_dual_mm: 2.0,
})

/** Statuses that make a tyre unfit to install (substring match, lower-cased). */
export const FITMENT_UNFIT_STATUS_TERMS = Object.freeze(['scrap', 'removed', 'damaged'])

/**
 * Checks the original engine performs that CANNOT be honoured here because the
 * required data is not present in `tyre_records`. The page renders these as an
 * honest note rather than pretending the check passed.
 */
export const FITMENT_UNAVAILABLE_CHECKS = Object.freeze([
  { rule: 'age', label: 'Tyre age vs maximum age', needs: 'manufacture date / DOT code' },
  { rule: 'retread', label: 'Retread count & steer-axle retread policy', needs: 'retread count' },
  { rule: 'dual_pair', label: 'Dual-wheel pairing (size / brand / tread match)', needs: 'wheel-position layout' },
])

export const FITMENT_UNAVAILABLE_NOTE =
  'Age, retread and dual-wheel pairing checks require manufacture date, retread ' +
  'count and wheel-position data that are not present in this dataset, so they ' +
  'are not evaluated here.'

const toNum = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1)

/**
 * SIZE check. When the rule declares an approved-size whitelist, the fitted
 * tyre's size must (after normalisation) be one of them. A missing/blank tyre
 * size cannot be compared and is skipped (not fabricated as a mismatch).
 */
export function checkSize(tyre, rule, violations) {
  const approved = Array.isArray(rule?.approved_sizes) ? rule.approved_sizes : []
  if (!approved.length) return
  const size = normalizeSize(tyre?.size)
  if (!size) return
  const approvedNorm = approved.map(normalizeSize).filter(Boolean)
  if (!approvedNorm.includes(size)) {
    violations.push({
      rule: 'size_mismatch',
      severity: 'critical',
      message: `Size "${String(tyre.size).trim()}" is not in the approved list: ${approved.join(', ')}`,
    })
  }
}

/**
 * TREAD check. Reads the single `tread_depth` (mm) this dataset carries. At or
 * below the minimum → critical; within `tread_warning_buffer_mm` of it → warning.
 */
export function checkTread(tyre, rule, cfg, violations, warnings) {
  const c = { ...FITMENT_ENGINE_DEFAULTS, ...(cfg || {}) }
  const min = rule?.min_tread_depth_mm != null ? Number(rule.min_tread_depth_mm) : c.min_tread_depth_mm
  const buffer = c.tread_warning_buffer_mm ?? 2.0
  const tread = toNum(tyre?.tread_depth)
  if (tread == null) return
  if (tread <= min) {
    violations.push({
      rule: 'below_min_tread',
      severity: 'critical',
      message: `Tread ${fmt1(tread)}mm is at or below the minimum ${min}mm`,
    })
  } else if (tread <= min + buffer) {
    warnings.push({
      rule: 'low_tread_warning',
      severity: 'warning',
      message: `Tread ${fmt1(tread)}mm is approaching the minimum ${min}mm`,
    })
  }
}

/**
 * LIFECYCLE / condition check. A tyre whose status indicates it is scrapped,
 * removed or damaged is unfit for installation.
 */
export function checkLifecycle(tyre, violations) {
  const status = String(tyre?.status || '').toLowerCase().trim()
  if (!status) return
  const hit = FITMENT_UNFIT_STATUS_TERMS.find((term) => status.includes(term))
  if (hit) {
    violations.push({
      rule: 'unfit_condition',
      severity: 'critical',
      message: `Tyre status "${tyre.status}" is not fit for installation`,
    })
  }
}

/**
 * AGE check — requires a manufacture date / DOT code that `tyre_records` does
 * not carry. No-op by design (see FITMENT_UNAVAILABLE_CHECKS); kept so the
 * engine's shape matches the original without fabricating an age.
 */
export function checkAge(/* tyre, rule, cfg, violations, warnings */) {
  return null
}

/**
 * RETREAD check — requires a retread count that this dataset does not carry.
 * No-op by design (see FITMENT_UNAVAILABLE_CHECKS).
 */
export function checkRetread(/* tyre, axleRole, rule, violations */) {
  return null
}

/**
 * DUAL-PAIR check. There is no wheel-position layout in this dataset, so the
 * page never has a partner to pass — the function no-ops when `partner` is null.
 * When a partner IS supplied (e.g. a future data source or a test), it enforces
 * matching size and flags a tread imbalance beyond the rule's threshold.
 */
export function checkDualPair(tyre, partner, rule, cfg, violations, warnings) {
  if (!partner) return null
  const c = { ...FITMENT_ENGINE_DEFAULTS, ...(cfg || {}) }
  if (rule?.require_matching_pair) {
    const a = normalizeSize(tyre?.size)
    const b = normalizeSize(partner?.size)
    if (a && b && a !== b) {
      violations.push({
        rule: 'dual_size_mismatch',
        severity: 'critical',
        message: 'Dual pair: fitted tyre size must match its partner',
      })
    }
  }
  const maxDelta = rule?.max_tread_delta_dual_mm != null
    ? Number(rule.max_tread_delta_dual_mm)
    : c.max_tread_delta_dual_mm
  const ta = toNum(tyre?.tread_depth)
  const tb = toNum(partner?.tread_depth)
  if (ta != null && tb != null) {
    const delta = Math.abs(ta - tb)
    if (delta > maxDelta) {
      warnings.push({
        rule: 'dual_tread_imbalance',
        severity: 'warning',
        message: `Dual pair tread difference ${fmt1(delta)}mm exceeds ${maxDelta}mm`,
      })
    }
  }
  return { checked: true }
}

/** A permissive default rule used when no configured rule matches the vehicle. */
export function defaultRule(cfg) {
  const c = { ...FITMENT_ENGINE_DEFAULTS, ...(cfg || {}) }
  return {
    rule_name: 'Default policy',
    applies_to_vehicle_types: [],
    applies_to_axle_roles: [],
    approved_sizes: [],
    min_tread_depth_mm: c.min_tread_depth_mm,
    max_tyre_age_years: c.max_tyre_age_years,
    allow_retread: true,
    max_retread_count: c.max_retread_count,
    require_matching_pair: true,
    max_tread_delta_dual_mm: c.max_tread_delta_dual_mm,
    is_active: true,
    _default: true,
  }
}

/**
 * Select the fitment rules that apply to a vehicle: active rules whose
 * `applies_to_vehicle_types` is empty (all types) or includes the vehicle's
 * `vehicle_type`. When none match, the permissive default rule is returned.
 * @returns {Array<object>} always at least one rule
 */
export function matchRules(rules, vehicle, cfg) {
  const active = (Array.isArray(rules) ? rules : []).filter((r) => r && r.is_active !== false)
  const vtype = vehicle?.vehicle_type
  const matched = active.filter((r) => {
    const types = Array.isArray(r.applies_to_vehicle_types) ? r.applies_to_vehicle_types : []
    return types.length === 0 || (vtype && types.includes(vtype))
  })
  return matched.length ? matched : [defaultRule(cfg)]
}

/**
 * Validate a single tyre for fitment against a rule. Runs the checks that map to
 * real `tyre_records` columns (lifecycle, size, tread). `is_valid` is true when
 * no CRITICAL violation was raised (warnings do not block).
 *
 * @param {object} tyre     a `tyre_records` row (or the resolved tyre)
 * @param {object} vehicle  the target `vehicle_fleet` row (for context/rule match)
 * @param {object} [rule]   the fitment rule to apply (defaults to the default rule)
 * @param {object} [cfg]    threshold overrides (defaults to FITMENT_ENGINE_DEFAULTS)
 * @returns {{ is_valid:boolean, violations:object[], warnings:object[], unavailable:object[] }}
 */
export function validateFitment(tyre, vehicle, rule, cfg = {}) {
  const violations = []
  const warnings = []

  if (!tyre) {
    return {
      is_valid: false,
      violations: [{ rule: 'tyre_not_found', severity: 'critical', message: 'Tyre not found for the given serial.' }],
      warnings: [],
      unavailable: FITMENT_UNAVAILABLE_CHECKS,
    }
  }

  const activeRule = rule || defaultRule(cfg)

  checkLifecycle(tyre, violations)
  checkSize(tyre, activeRule, violations)
  checkTread(tyre, activeRule, cfg, violations, warnings)
  // Age / retread / dual-pair intentionally omitted — data not present in this
  // dataset (surfaced via FITMENT_UNAVAILABLE_CHECKS, never fabricated).

  const is_valid = !violations.some((v) => v.severity === 'critical')
  return { is_valid, violations, warnings, unavailable: FITMENT_UNAVAILABLE_CHECKS }
}
