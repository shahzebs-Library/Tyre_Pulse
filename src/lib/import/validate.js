/**
 * Import Center - row validation + duplicate classification.
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
import { ENUM_DOMAINS, isInEnum } from './enums.js'

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

  // Controlled-vocabulary (CHECK constraint) domains: a non-blank value outside
  // the target column's allowed set is a WARNING, not a hard error - the import
  // must not be blocked because one mapped column carries a foreign vocabulary
  // (e.g. a "Tracking Category" of "Active" mapped onto work_orders.status). The
  // pipeline preserves the original in custom_data and drops the column before
  // commit (so the DB CHECK can't reject the batch); the warning surfaces the
  // allowed values for review. transformRow has already canonicalised
  // casing/separators, so only genuinely out-of-domain values reach here.
  const enumFields = ENUM_DOMAINS[module]
  if (enumFields) {
    const fieldByKey = new Map(fields.map((f) => [f.key, f]))
    for (const [key, allowed] of Object.entries(enumFields)) {
      const val = row[key]
      if (isBlank(val) || isInEnum(val, allowed)) continue
      const label = fieldByKey.get(key)?.label || key
      issues.push({
        field: key,
        severity: 'warning',
        code: 'ENUM_INVALID',
        message: `${label} "${val}" is not an accepted value (preserved, not imported to that column). Allowed: ${allowed.join(', ')}.`,
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
        message: 'Cost supplied without a currency - defaulting may be required.',
      })
    }
  }

  // Accident / insurance financial integrity.
  if (module === 'accident') {
    const claim = row.claim_amount
    const approved = row.claim_approved_amount
    const recovered = row.recovered_amount
    const repair = row.repair_cost
    // Recovery cannot exceed the claim - a hard data error (block).
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
        message: 'Claim raised without an estimate - follow-up required.',
      })
    }
    // No identifier at all → cannot dedup or trace; flag for review match.
    if (isBlank(row.insurance_claim_no) && isBlank(row.police_report_no)) {
      issues.push({
        field: 'insurance_claim_no',
        severity: 'warning',
        code: 'NO_IDENTIFIER',
        message: 'No claim or police report number - duplicate detection limited; review match required.',
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

  // Warranty: removal cannot precede fitment (date or km).
  if (module === 'warranty') {
    const fk = row.km_at_fitment
    const rk = row.km_at_removal
    if (typeof fk === 'number' && typeof rk === 'number' && rk < fk) {
      issues.push({
        field: 'km_at_removal',
        severity: 'error',
        code: 'REMOVAL_BEFORE_FITMENT',
        message: `Removal KM (${rk}) is less than fitment KM (${fk}).`,
      })
    }
    const fd = row.fitment_date
    const rd = row.removal_date
    if (!isBlank(fd) && !isBlank(rd) && isPlausibleDate(String(fd)) && isPlausibleDate(String(rd)) && String(rd) < String(fd)) {
      issues.push({
        field: 'removal_date',
        severity: 'warning',
        code: 'REMOVAL_DATE_BEFORE_FITMENT',
        message: `Removal date (${rd}) precedes fitment date (${fd}).`,
      })
    }
  }

  // Work orders: total cost should not be less than its components.
  if (module === 'workorder') {
    const labour = typeof row.labour_cost === 'number' ? row.labour_cost : 0
    const parts = typeof row.parts_cost === 'number' ? row.parts_cost : 0
    const total = row.total_cost
    if (typeof total === 'number' && (labour > 0 || parts > 0) && total + 0.01 < labour + parts) {
      issues.push({
        field: 'total_cost',
        severity: 'warning',
        code: 'TOTAL_LT_COMPONENTS',
        message: `Total cost (${total}) is less than labour + parts (${labour + parts}).`,
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
  // Inspection event: asset + type + date + inspector.
  inspection: (r) => keyParts([r.country, r.asset_no, r.inspection_type, r.inspection_date, r.inspector]),
  // Work order: WO number is the identity.
  workorder: (r) => keyParts([r.country, r.work_order_no]),
  // Warranty: serial + claim ref (serial required).
  warranty: (r) => keyParts([r.country, r.serial_number, r.claim_no]),
  // Gate pass: no pass number column - asset + pass date.
  gatepass: (r) => keyParts([r.country, r.asset_no, r.pass_date]),
  // Supplier master: code preferred, else name.
  supplier: (r) => keyParts([r.country, r.supplier_code || r.supplier_name]),
  // Driver master: badge/employee id.
  driver: (r) => keyParts([r.country, r.driver_id]),
}

/** Fields whose disagreement on a shared natural key constitutes a conflict. */
const CONFLICT_FIELDS = {
  fleet: ['make', 'model', 'vehicle_type', 'registration_no'],
  tyre: ['asset_no', 'issue_date', 'km_at_fitment'],
  stock: ['stock_qty'],
  accident: ['asset_no', 'incident_date', 'claim_amount'],
  inspection: ['status', 'severity', 'findings'],
  workorder: ['asset_no', 'status', 'total_cost'],
  warranty: ['asset_no', 'claim_status', 'credit_amount'],
  gatepass: ['site', 'status'],
  supplier: ['supplier_name', 'supplier_type', 'phone', 'email'],
  driver: ['driver_name', 'license_no', 'status'],
}

function norm(v) {
  if (v == null) return ''
  return String(v).trim().toLowerCase()
}

/**
 * Whole-row fingerprint: a stable, order-independent signature of ALL of a row's
 * transformed values. Two rows with the same fingerprint are byte-for-byte the
 * same record; a differing fingerprint means the rows differ somewhere — even if
 * they share a natural key. This is what separates a true duplicate (identical
 * row) from a conflict (same key, different data), matching how a human reads it.
 */
export function rowFingerprint(view) {
  const obj = view && typeof view === 'object' ? view : {}
  return Object.keys(obj)
    .filter((k) => obj[k] != null && String(obj[k]).trim() !== '')
    .sort()
    .map((k) => `${k}=${norm(obj[k])}`)
    .join('')
}

function keyParts(parts) {
  const cleaned = parts.map(norm)
  if (cleaned.every((p) => p === '')) return null
  // A key is only usable when its identifying component is present.
  if (cleaned[cleaned.length - 1] === '' && parts.length > 1 && norm(parts[1]) === '') return null
  return cleaned.join('')
}

/**
 * Annotate rows with dup_status by natural key + whole-row fingerprint:
 *   'none'      first row of a key, or a key seen only once (the keeper)
 *   'duplicate' an exact whole-row copy of a row already seen (redundant), OR a
 *               same-key row that only adds complementary data with no conflict-
 *               field disagreement (mergeable)
 *   'conflict'  same natural key AND a designated conflict field disagrees with the
 *               keeper — a genuinely different record for the operator to resolve
 * Sharing a key is NOT enough to be a hard conflict: the keeper is preserved and
 * only a real conflict-field disagreement is escalated. Accepts rows shaped as
 * either the full transform result ({ transformed }) or a flat transformed object.
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

  // Per-ROW status (not per-key), so one key group can hold both an exact copy
  // and a genuinely different record. Three realistic tiers:
  //   · first row of a key                         → 'none'      (the keeper)
  //   · exact whole-row copy of a row already seen → 'duplicate' (redundant — safe to skip)
  //   · same key, no conflict-field disagreement   → 'duplicate' (complementary/mergeable —
  //                                                   e.g. same accident under claim_no on one
  //                                                   row and police_report_no on another)
  //   · same key AND a designated conflict field   → 'conflict'  (a real disagreement the
  //     disagrees with the keeper                     operator must resolve — never a silent skip)
  const status = new Array(list.length).fill('none')
  for (const [, idxs] of groups) {
    if (idxs.length <= 1) continue
    const seenFingerprints = new Set()
    // Keeper's value for each conflict field — a later row that sets a DIFFERENT
    // non-empty value on any of these is a true conflict.
    const keeperConflictVals = {}
    let keeperSet = false
    for (const i of idxs) {
      const v = view(list[i]) || {}
      const fp = rowFingerprint(v)
      if (seenFingerprints.has(fp)) {
        status[i] = 'duplicate' // exact whole-row copy of a row already seen
        continue
      }
      seenFingerprints.add(fp)
      if (!keeperSet) {
        // First unique row of the key = keeper.
        status[i] = 'none'
        for (const field of conflictFields) {
          const val = norm(v[field])
          if (val !== '') keeperConflictVals[field] = val
        }
        keeperSet = true
        continue
      }
      // Same key, not an exact copy: a conflict only when a designated conflict
      // field is present on both and disagrees. Otherwise it is complementary
      // data on the same record → 'duplicate' (mergeable, not a hard conflict).
      let conflict = false
      for (const field of conflictFields) {
        const val = norm(v[field])
        if (val !== '' && keeperConflictVals[field] != null && keeperConflictVals[field] !== val) {
          conflict = true
          break
        }
      }
      status[i] = conflict ? 'conflict' : 'duplicate'
      // Let the keeper accrue any conflict-field values it did not yet carry, so a
      // later row disagreeing with an earlier complementary value is still caught.
      for (const field of conflictFields) {
        const val = norm(v[field])
        if (val !== '' && keeperConflictVals[field] == null) keeperConflictVals[field] = val
      }
    }
  }

  return list.map((r, i) => ({ ...r, dup_status: status[i] }))
}

/**
 * Compute the natural key for a single row in a module - the SAME key the
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

/* ── Country-scope guard ──────────────────────────────────────────────────────
 * The directive's first rule: never mix one country's records into another. When
 * a source row carries its OWN country value that disagrees with the country the
 * import is scoped to, it must be flagged for review - never silently re-filed.
 */
const COUNTRY_ALIASES = {
  ksa:     ['ksa', 'sa', 'sau', 'saudi', 'saudi arabia', 'kingdom of saudi arabia', 'k s a', 'المملكة العربية السعودية', 'السعودية'],
  uae:     ['uae', 'ae', 'are', 'u a e', 'united arab emirates', 'emirates', 'الإمارات', 'الامارات'],
  qatar:   ['qatar', 'qa', 'qat', 'قطر'],
  bahrain: ['bahrain', 'bh', 'bhr', 'البحرين'],
  kuwait:  ['kuwait', 'kw', 'kwt', 'الكويت'],
  oman:    ['oman', 'om', 'omn', 'عمان'],
}

/** Canonicalise a country token via aliases; unknown values compare literally. */
function countryCanon(v) {
  const s = norm(v).replace(/[.\-_]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  for (const [canon, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (canon === s || aliases.includes(s)) return canon
  }
  return s
}

/**
 * True when a row's own country value clearly disagrees with the selected import
 * country. A blank row country (the common case) never conflicts.
 *
 * @param {Record<string,*>} transformed   Transformed row (or { transformed }).
 * @param {string} selectedCountry         The country the import is scoped to.
 * @returns {boolean}
 */
export function countryConflict(transformed, selectedCountry) {
  const view = transformed && transformed.transformed && typeof transformed.transformed === 'object'
    ? transformed.transformed : (transformed || {})
  const rowC = countryCanon(view.country)
  const selC = countryCanon(selectedCountry)
  if (!rowC || !selC) return false
  return rowC !== selC
}

export { NATURAL_KEY }
