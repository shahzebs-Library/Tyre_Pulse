/**
 * Pure conditional-routing evaluator for the Universal Approval & Workflow
 * Engine. Mirrors the server-side `workflow_step_condition_passes` /
 * `_workflow_next_runnable_step` logic (V117) so the client can preview which
 * steps a document will hit before it is submitted.
 *
 * The server remains authoritative — this is convenience/preview only. Keep
 * the operator set and semantics IN SYNC with MIGRATIONS_V117_WORKFLOW_ACTIONS.
 *
 * No imports, no side effects — trivially unit-testable.
 */

/** Supported comparison operators (must match the SQL op set). */
export const CONDITION_OPS = Object.freeze(['=', '!=', '>', '>=', '<', '<='])

/**
 * Coerce a raw value to a finite number, or return null when it is not
 * numeric. Booleans and null are intentionally NOT treated as numbers.
 * @param {*} v
 * @returns {number|null}
 */
function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Compare two already-resolved values with an operator. Numeric comparison is
 * used when BOTH sides parse as numbers; otherwise a locale-agnostic string
 * comparison on their String() projection is used.
 * @param {*} actual
 * @param {string} op
 * @param {*} expected
 * @returns {boolean}
 */
function compare(actual, op, expected) {
  const a = toNumber(actual)
  const e = toNumber(expected)
  const numeric = a !== null && e !== null

  if (numeric) {
    switch (op) {
      case '=':
        return a === e
      case '!=':
        return a !== e
      case '>':
        return a > e
      case '>=':
        return a >= e
      case '<':
        return a < e
      case '<=':
        return a <= e
      default:
        return false
    }
  }

  const as = String(actual)
  const es = String(expected)
  switch (op) {
    case '=':
      return as === es
    case '!=':
      return as !== es
    case '>':
      return as > es
    case '>=':
      return as >= es
    case '<':
      return as < es
    case '<=':
      return as <= es
    default:
      return false
  }
}

/**
 * Evaluate a single step condition against an instance context.
 *
 * Semantics (match the server):
 *  - A missing / null / non-object condition → `true` (the step always runs).
 *  - A malformed condition (missing field or unsupported op) → `true`
 *    (write-time validation guards this; at runtime we never block).
 *  - A referenced field absent (or null) in `context` → `false`
 *    (the conditional step is skipped).
 *
 * @param {{field?:string, op?:string, value?:*}|null|undefined} condition
 * @param {Record<string,*>|null|undefined} context
 * @returns {boolean}
 */
export function evaluateCondition(condition, context) {
  if (condition === null || condition === undefined) return true
  if (typeof condition !== 'object') return true

  const { field, op, value } = condition
  if (!field || typeof field !== 'string' || !op || !CONDITION_OPS.includes(op)) {
    return true
  }

  const ctx = context && typeof context === 'object' ? context : {}
  const has = Object.prototype.hasOwnProperty.call(ctx, field)
  const actual = has ? ctx[field] : undefined
  if (!has || actual === null || actual === undefined) return false

  return compare(actual, op, value)
}

/**
 * Given a snapshot of steps and the instance context, return the indices of
 * the steps that will actually run (conditional-false steps auto-skipped).
 * Useful for the builder's live preview and for tests.
 * @param {Array<object>} steps
 * @param {Record<string,*>} [context]
 * @returns {number[]} runnable step indices, in order
 */
export function runnableStepIndices(steps, context = {}) {
  if (!Array.isArray(steps)) return []
  const out = []
  for (let i = 0; i < steps.length; i += 1) {
    const cond = steps[i] ? steps[i].condition : null
    if (evaluateCondition(cond, context)) out.push(i)
  }
  return out
}
