/**
 * Import Center - automatic module (destination table) detector.
 *
 * Given only a file's column headers (and optional sample rows), decide which
 * business module the sheet most likely belongs to - fleet / tyre / stock /
 * accident / inspection / workorder / warranty / gatepass / supplier / driver -
 * so a non-technical operator can just upload a file and let the system route it.
 *
 * It does NOT introduce a second mapping engine: it reuses the SAME
 * `suggestMapping` scorer against each module's `MODULE_FIELDS`, then ranks the
 * modules by a blended score of (a) how much confidence the mapping accrued and
 * (b) how many of that module's REQUIRED fields were covered. Required-field
 * coverage is weighted heavily because a file that satisfies a module's required
 * keys is almost certainly that module.
 *
 * Pure + synchronous (no I/O), so it is unit-testable and safe to run on every
 * keystroke of a preview.
 *
 * @module import/detectModule
 */

import { MODULES, MODULE_FIELDS, MODULE_TABLES } from './synonyms.js'
import { suggestMapping, AUTO_THRESHOLD, SUGGEST_THRESHOLD } from './mapping.js'

/**
 * @typedef {Object} ModuleScore
 * @property {string}  module          Module key (e.g. 'fleet').
 * @property {string}  table           Destination table for the module.
 * @property {number}  score           Blended 0-100 confidence.
 * @property {number}  mappedCount     Headers mapped at >= suggest confidence.
 * @property {number}  requiredTotal   Count of required fields for the module.
 * @property {number}  requiredCovered Required fields satisfied by the mapping.
 * @property {string[]} requiredMissing Labels of required fields still missing.
 */

/** A mapping is "usable" (counts toward a module) at suggest confidence or above. */
const USABLE = SUGGEST_THRESHOLD

/**
 * Score a single module against the given headers.
 * @param {string} module
 * @param {Array<{index:number, header:string}>|string[]} columns
 * @param {Array<Record<string,*>>} sampleRows
 * @returns {ModuleScore}
 */
function scoreModule(module, columns, sampleRows) {
  const fields = MODULE_FIELDS[module] || []
  const requiredFields = fields.filter((f) => f.required)
  let plan
  try {
    plan = suggestMapping({ columns, module, sampleRows })
  } catch {
    plan = []
  }

  const usable = plan.filter((p) => p.target && p.confidence >= USABLE)
  const coveredTargets = new Set(usable.map((p) => p.target))

  // Average confidence of the usable mappings (0 when none).
  const avgConfidence = usable.length
    ? usable.reduce((s, p) => s + p.confidence, 0) / usable.length
    : 0

  // Required-field coverage ratio (a file that meets a module's required keys is
  // very likely that module). Modules with no required field fall back to the
  // share of headers that mapped, so they are not unfairly favoured.
  const requiredCovered = requiredFields.filter((f) => coveredTargets.has(f.key)).length
  const requiredTotal = requiredFields.length
  const requiredRatio = requiredTotal ? requiredCovered / requiredTotal : 0
  const mappedShare = plan.length ? usable.length / plan.length : 0

  // Blend: required coverage dominates (0.55), then how confidently things
  // mapped (0.30), then how much of the file was consumed (0.15). Scaled 0-100.
  const coverageComponent = requiredTotal ? requiredRatio : mappedShare
  const score = Math.round(
    100 * (0.55 * coverageComponent + 0.30 * (avgConfidence / 100) + 0.15 * mappedShare),
  )

  return {
    module,
    table: MODULE_TABLES[module] || module,
    score: Math.max(0, Math.min(100, score)),
    mappedCount: usable.length,
    requiredTotal,
    requiredCovered,
    requiredMissing: requiredFields.filter((f) => !coveredTargets.has(f.key)).map((f) => f.label),
  }
}

/**
 * Rank every known module for a set of columns, best first.
 *
 * @param {Array<{index:number, header:string}>|string[]} columns
 * @param {Array<Record<string,*>>} [sampleRows]  Header-keyed sample rows.
 * @returns {ModuleScore[]}  Sorted descending by score (ties broken by required coverage then mappedCount).
 */
export function rankModules(columns, sampleRows = []) {
  const headers = (columns || []).filter(Boolean)
  if (!headers.length) return []
  return MODULES
    .map((m) => scoreModule(m, headers, sampleRows))
    .sort((a, b) =>
      b.score - a.score ||
      (b.requiredCovered / (b.requiredTotal || 1)) - (a.requiredCovered / (a.requiredTotal || 1)) ||
      b.mappedCount - a.mappedCount,
    )
}

/**
 * Minimum blended score for the detector to auto-select a module without asking
 * the operator to confirm. Below this, the UI should surface the ranked options.
 */
export const DETECT_CONFIDENCE = 45

/**
 * Detect the single most likely module for a file.
 *
 * @param {Array<{index:number, header:string}>|string[]} columns
 * @param {Array<Record<string,*>>} [sampleRows]
 * @returns {{ module: string|null, confident: boolean, ranked: ModuleScore[] }}
 *   `module` is the best pick (null when no headers), `confident` is true when
 *   the top score clears DETECT_CONFIDENCE and beats the runner-up clearly.
 */
export function detectModule(columns, sampleRows = []) {
  const ranked = rankModules(columns, sampleRows)
  if (!ranked.length) return { module: null, confident: false, ranked }
  const top = ranked[0]
  const second = ranked[1]
  // Confident when the leader is strong AND meaningfully ahead of the runner-up
  // (>= 12 points) or already covers all of its required fields.
  const clearLead = !second || top.score - second.score >= 12
  const fullyRequired = top.requiredTotal > 0 && top.requiredCovered === top.requiredTotal
  const confident = top.score >= DETECT_CONFIDENCE && (clearLead || fullyRequired)
  return { module: top.module, confident, ranked }
}

export { AUTO_THRESHOLD, SUGGEST_THRESHOLD }
