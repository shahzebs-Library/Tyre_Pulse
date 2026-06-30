/**
 * Import Center — row validation + duplicate classification.
 *
 * validateRow grades a transformed row 'ready' | 'warning' | 'error' with a list
 * of structured issues (required-field, date, numeric, lifecycle, currency).
 *
 * classifyDuplicates annotates rows with dup_status using module NATURAL KEYS:
 *   - fleet       : country + asset_no
 *   - tyre-master : country + serial_no
 *   - stock       : country + site + description
 *
 * A repeated tyre serial across a lifecycle is flagged as an EVENT
 * ('conflict' when key fields disagree), never silently skipped.
 *
 * @module import/validate
 */

import { MODULE_FIELDS } from './synonyms.js'

/**
 * @typedef {Object} ValidationIssue
 * @property {string} field
 * @property {'error'|'warning'} severity
 * @property {string} code
 * @property {string} message
 */

/**
 * @typedef {Object} ValidationResult
 * @property {'ready'|'warning'|'error'} status
 * @property {ValidationIssue[]} issues
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Empty if null/undefined/blank string. */
function isBlank(v) {
  return v == null || (typeof v === 'string' && v.trim() === '')
}

/** True when an ISO date is a valid calendar date and not absurdly far out. */
function isPlausibleDate(iso) {
  if (!ISO_DATE_RE.test(iso)) return false
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  const year = d.getUTCFullYear()
  return year >= 1970 && year <= 2100
}

/**
 * Validate a single transformed row for a module.
 *
 * @param {Record<string,*>} transformed   Output of transformRow().transformed.
 * @param {'fleet'|'tyre'|'stock'} module
 * @returns {ValidationResult}
 */
export function validateRow(transformed, module) {
  const fields = MODULE_FIELDS[module]
  if (!fields) throw new Error(`validateRow: unknown module "${module}"`)
  const row = transformed || {}
  /** @type {ValidationIssue[]} */
  const issues = []

  // Required fields present.
  for (const f of fields) {
    if (f.required && isBlank(row[f.key])) {
      issues.push({
        field: f.key,
        severity: 'error',
        code: 'REQUIRED_MISSING',
        message: `${f.label} is required but missing.`,
      })
    }
  }

  // Date plausibility (only when a value was supplied but failed to normalise,
  // or normalised to an implausible date).
  for (const f of fields) {
    if (f.type !== 'date') continue
    const val = row[f.key]
    const original = row[`${f.key}_original`]
    if (isBlank(val) && !isBlank(original)) {
      issues.push({
        field: f.key,
        severity: 'error',
        code: 'DATE_INVALID',
        message: `${f.label} "${original}" is not a recognisable date.`,
      })
    } else if (!isBlank(val) && !isPlausibleDate(String(val))) {
      issues.push({
        field: f.key,
        severity: 'warning',
        code: 'DATE_AMBIGUOUS',
        message: `${f.label} "${val}" is ambiguous or out of expected range.`,
      })
    }
  }

  // Numeric sanity: negative quantities / counts / costs.
  const numericKeys = fields
    .filter((f) => ['number', 'integer', 'currency', 'pressure', 'distance', 'mass'].includes(f.type))
    .map((f) => f.key)
  for (const key of numericKeys) {
    const val = row[key]
    if (val == null || val === '') continue
    if (typeof val === 'number' && val < 0) {
      const isQty = /qty|quantity|level|cost|price|km|tread|pressure/i.test(key)
      issues.push({
        field: key,
        severity: isQty ? 'error' : 'warning',
        code: 'NEGATIVE_VALUE',
        message: `${key} is negative (${val}).`,
      })
    }
  }

  // Lifecycle: removal km must not precede fitment km.
  if (module === 'tyre') {
    const fit = row.km_at_fitment
    const rem = row.km_at_removal
    if (typeof fit === 'number' && typeof rem === 'number' && rem < fit) {
      issues.push({
        field: 'km_at_removal',
        severity: 'error',
        code: 'REMOVAL_BEFORE_FITMENT',
        message: `Removal KM (${rem}) is less than fitment KM (${fit}).`,
      })
    }
    // Currency present but no code captured.
    if (typeof row.cost_per_tyre === 'number' && row.cost_per_tyre > 0 && isBlank(row.currency_original)) {
      issues.push({
        field: 'cost_per_tyre',
        severity: 'warning',
        code: 'CURRENCY_MISSING',
        message: 'Cost supplied without a currency — defaulting may be required.',
      })
    }
  }

  // Accident / insurance financial integrity.
  if (module === 'accident') {
    const claim = row.claim_amount
    const approved = row.claim_approved_amount
    const recovered = row.recovered_amount
    const repair = row.repair_cost
    // Recovery cannot exceed the claim — a hard data error (block).
    if (typeof recovered === 'number' && typeof claim === 'number' && claim > 0 && recovered > claim) {
      issues.push({
        field: 'recovered_amount',
        severity: 'error',
        code: 'RECOVERY_GT_CLAIM',
        message: `Recovered (${recovered}) exceeds claim amount (${claim}).`,
      })
    }
    // Approved should not exceed claimed.
    if (typeof approved === 'number' && typeof claim === 'number' && claim > 0 && approved > claim) {
      issues.push({
        field: 'claim_approved_amount',
        severity: 'warning',
        code: 'APPROVED_GT_CLAIM',
        message: `Approved (${approved}) exceeds claim amount (${claim}).`,
      })
    }
    // Actual repair above the approved claim → cost overrun to review.
    if (typeof repair === 'number' && typeof approved === 'number' && approved > 0 && repair > approved) {
      issues.push({
        field: 'repair_cost',
        severity: 'warning',
        code: 'ACTUAL_GT_APPROVED',
        message: `Actual repair (${repair}) exceeds approved amount (${approved}).`,
      })
    }
    // A claim with no estimate captured → follow-up needed.
    if (typeof claim === 'number' && claim > 0 && isBlank(row.estimated_damage_cost)) {
      issues.push({
        field: 'estimated_damage_cost',
        severity: 'warning',
        code: 'ESTIMATE_MISSING',
        message: 'Claim raised without an estimate — follow-up required.',
      })
    }
    // No identifier at all → cannot dedup or trace; flag for review match.
    if (isBlank(row.insurance_claim_no) && isBlank(row.police_report_no)) {
      issues.push({
        field: 'insurance_claim_no',
        severity: 'warning',
        code: 'NO_IDENTIFIER',
        message: 'No claim or police report number — duplicate detection limited; review match required.',
      })
    }
  }

  // Stock: critical level should not exceed min level.
  if (module === 'stock') {
    const min = row.min_level
    const crit = row.critical_level
    if (typeof min === 'number' && typeof crit === 'number' && crit > min) {
      issues.push({
        field: 'critical_level',
        severity: 'warning',
        code: 'CRITICAL_GT_MIN',
        message: `Critical level (${crit}) exceeds minimum level (${min}).`,
      })
    }
  }

  const hasError = issues.some((i) => i.severity === 'error')
  const hasWarning = issues.some((i) => i.severity === 'warning')
  const status = hasError ? 'error' : hasWarning ? 'warning' : 'ready'
  return { status, issues }
}

/* ── Duplicate classification ───────────────────────────────────────────────── */

/**
 * Natural-key extractors per module. The "tyre" master key is serial-based; a
 * repeated serial is treated as a lifecycle event candidate (not skipped).
 * @type {Record<string, (row: Record<string,*>) => string|null>}
 */
const NATURAL_KEY = {
  fleet: (r) => keyParts([r.country, r.asset_no]),
  tyre: (r) => keyParts([r.country, r.serial_no]),
  stock: (r) => keyParts([r.country, r.site, r.description]),
  // Accident identity = claim no (preferred) else police report no.
  accident: (r) => keyParts([r.country, r.insurance_claim_no || r.police_report_no]),
}

/** Fields whose disagreement on a shared natural key constitutes a conflict. */
const CONFLICT_FIELDS = {
  fleet: ['make', 'model', 'vehicle_type', 'registration_no'],
  tyre: ['asset_no', 'issue_date', 'km_at_fitment'],
  stock: ['stock_qty'],
  accident: ['asset_no', 'incident_date', 'claim_amount'],
}

function norm(v) {
  if (v == null) return ''
  return String(v).trim().toLowerCase()
}

function keyParts(parts) {
  const cleaned = parts.map(norm)
  if (cleaned.every((p) => p === '')) return null
  // A key is only usable when its identifying component is present.
  if (cleaned[cleaned.length - 1] === '' && parts.length > 1 && norm(parts[1]) === '') return null
  return cleaned.join('')
}

/**
 * Annotate rows with dup_status by natural key. Accepts rows shaped as either
 * the full transform result ({ transformed }) or a flat transformed object.
 *
 * @param {Array<Record<string,*>>} rows
 * @param {'fleet'|'tyre'|'stock'} module
 * @returns {Array<Record<string,*> & { dup_status:'none'|'duplicate'|'conflict' }>}
 */
export function classifyDuplicates(rows, module) {
  const keyFn = NATURAL_KEY[module]
  if (!keyFn) throw new Error(`classifyDuplicates: unknown module "${module}"`)
  const conflictFields = CONFLICT_FIELDS[module] || []
  const list = Array.isArray(rows) ? rows : []

  /** Pick the transformed view whether rows are wrapped or flat. */
  const view = (r) => (r && r.transformed && typeof r.transformed === 'object' ? r.transformed : r)

  // First pass: group row indices by natural key.
  /** @type {Map<string, number[]>} */
  const groups = new Map()
  list.forEach((r, i) => {
    const k = keyFn(view(r) || {})
    if (k == null) return
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(i)
  })

  // Determine per-key status: a group of >1 is a duplicate; if any conflict
  // field disagrees across the group it is a conflict.
  /** @type {Map<string, 'none'|'duplicate'|'conflict'>} */
  const keyStatus = new Map()
  for (const [k, idxs] of groups) {
    if (idxs.length <= 1) {
      keyStatus.set(k, 'none')
      continue
    }
    let conflict = false
    for (const field of conflictFields) {
      const seen = new Set()
      for (const i of idxs) {
        const val = norm(view(list[i])[field])
        if (val !== '') seen.add(val)
      }
      if (seen.size > 1) {
        conflict = true
        break
      }
    }
    keyStatus.set(k, conflict ? 'conflict' : 'duplicate')
  }

  return list.map((r) => {
    const k = keyFn(view(r) || {})
    const dup_status = k != null ? keyStatus.get(k) || 'none' : 'none'
    return { ...r, dup_status }
  })
}

/**
 * Compute the natural key for a single row in a module — the SAME key the
 * server RPC import_existing_keys() builds, so UI live-dedup and tests stay in
 * lockstep with the database. Returns null when the identifying component is
 * absent (key not usable for matching).
 *
 *   fleet : country + asset_no
 *   tyre  : country + serial_no
 *   stock : country + site + description
 *
 * @param {Record<string,*>} row    Transformed row (flat) or { transformed }.
 * @param {'fleet'|'tyre'|'stock'} module
 * @returns {string|null}
 */
export function naturalKey(row, module) {
  const keyFn = NATURAL_KEY[module]
  if (!keyFn) throw new Error(`naturalKey: unknown module "${module}"`)
  const view = row && row.transformed && typeof row.transformed === 'object' ? row.transformed : row
  return keyFn(view || {})
}

export { NATURAL_KEY }
