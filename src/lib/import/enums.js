/**
 * Import Center — controlled-vocabulary (CHECK constraint) domains.
 *
 * These mirror the LIVE Postgres CHECK constraints on the target tables exactly
 * (verified against information_schema / pg_constraint on project
 * jhssdmeruxtrlqnwfksc). They exist so the import pipeline can:
 *   1. canonicalise a source value to the DB's exact casing/spelling
 *      (`canonicalizeEnum`, run in transform), and
 *   2. flag a genuinely out-of-domain value as a per-row ERROR *before* commit
 *      (validate), instead of the whole batch failing with an opaque HTTP 400
 *      at INSERT time.
 *
 * Keyed by import module → target column → allowed values (exact DB casing).
 * Only columns that carry a real CHECK constraint are listed; free-text columns
 * (e.g. gate_passes.status, suppliers.status) are intentionally absent.
 *
 * When the DB constraint changes, update this map in the same change.
 *
 * @module import/enums
 */

/** @type {Record<string, Record<string, string[]>>} */
export const ENUM_DOMAINS = {
  fleet: {
    status: ['Active', 'Inactive', 'Retired', 'Transferred'],
  },
  accident: {
    accident_type: ['collision', 'rollover', 'tyre_failure', 'mechanical', 'near_miss', 'property_damage', 'other'],
    severity: ['minor', 'moderate', 'severe', 'fatal'],
    status: ['reported', 'under_review', 'closed'],
  },
  inspection: {
    status: ['Scheduled', 'In Progress', 'Done', 'Overdue', 'Cancelled'],
    inspection_type: ['Routine', 'Pressure', 'Visual', 'Full', 'Pre-Trip'],
  },
  workorder: {
    work_type: [
      'Tyre Change', 'Inspection', 'Repair', 'Rotation', 'Balancing', 'Alignment',
      'Retread', 'Puncture Repair', 'Pressure Check', 'Emergency', 'Other',
    ],
    status: ['Open', 'In Progress', 'Awaiting Parts', 'Completed', 'Closed', 'Cancelled'],
    priority: ['Low', 'Medium', 'High', 'Critical'],
  },
}

/**
 * Loose comparison key: lower-cased, with runs of whitespace / underscores /
 * hyphens collapsed to a single space. Lets "Tyre Failure", "tyre_failure" and
 * "TYRE-FAILURE" all resolve to the same canonical domain value.
 * @param {*} v
 * @returns {string}
 */
export function enumNorm(v) {
  if (v == null) return ''
  return String(v).trim().toLowerCase().replace(/[\s_-]+/g, ' ').trim()
}

/**
 * Snap a value to its exact domain spelling when it matches loosely; otherwise
 * return it unchanged (validate will flag genuinely-unknown values). Blank/null
 * pass through untouched — enum columns here are all nullable.
 *
 * @param {*} value
 * @param {string[]} allowed   Exact DB-cased allowed values.
 * @returns {*}
 */
export function canonicalizeEnum(value, allowed) {
  if (value == null || value === '') return value
  const target = enumNorm(value)
  if (target === '') return value
  for (const a of allowed) {
    if (enumNorm(a) === target) return a
  }
  return value
}

/**
 * Whether a value is within the domain (loose match). Blank is considered valid
 * (nullable column — required-ness is enforced separately).
 * @param {*} value
 * @param {string[]} allowed
 * @returns {boolean}
 */
export function isInEnum(value, allowed) {
  if (value == null || value === '') return true
  const target = enumNorm(value)
  if (target === '') return true
  return allowed.some((a) => enumNorm(a) === target)
}
