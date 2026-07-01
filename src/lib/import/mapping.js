/**
 * Import Center — column → canonical-field mapping suggester.
 *
 * Produces a per-source-header mapping plan with a 0–100 confidence and an
 * action, using (in priority order):
 *   1. saved profile rules (explicit, score 100),
 *   2. exact module-scoped alias match (score 100),
 *   3. fuzzy scoring (substring / word overlap / Levenshtein) seeded with
 *      sample-row type signals.
 *
 * Confidence → action bands:
 *   - >= 90        → 'auto'    (auto-map)
 *   - 60–89        → 'suggest' (pre-selected, user confirms)
 *   - 1–59 (>0)    → 'review'  (do NOT auto-map)
 *   - no match     → 'preserve_custom' (NEVER discarded)
 *
 * Two source headers are never mapped to the same target unless an explicit
 * combine rule in savedProfileRules says so. Unmatched headers are always
 * preserved as custom columns.
 *
 * @module import/mapping
 */

import { MODULE_FIELDS, exactAlias, normaliseToken, synonymsFor } from './synonyms.js'

/**
 * @typedef {Object} MappingSuggestion
 * @property {string} sourceHeader
 * @property {string|null} target
 * @property {number} confidence            0–100
 * @property {'auto'|'suggest'|'review'|'preserve_custom'} action
 * @property {string} [reason]              How the match was derived.
 */

/**
 * @typedef {Object} SavedProfileRules
 * @property {Record<string,string>} [columns]   normalised header → target key.
 * @property {Array<{ sources: string[], target: string }>} [combine]
 *   Explicit combine rules permitting many sources → one target.
 */

const AUTO_THRESHOLD = 90
const SUGGEST_THRESHOLD = 60

/* ── Fuzzy scoring (adapted from the proven legacy uploader) ─────────────────── */

/**
 * Levenshtein distance — fuzzy fallback when substring/word match fails.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let curr = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1])
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

/**
 * Identifier tokens that mark a column as a code/reference rather than a value.
 * Kept as whole-word tokens so we never trip on substrings inside real words
 * (e.g. "code" must not fire on "current km" — it won't, we match on words).
 */
const IDENTIFIER_TOKENS = new Set(['center', 'centre', 'code', 'id', 'no', 'number', 'ref'])

/**
 * Penalty (score points) applied when an identifier-like header is scored
 * against a currency-typed target. Large enough to push a strong substring
 * match (≤88) below SUGGEST_THRESHOLD (60) so it becomes 'review'.
 */
const IDENTIFIER_CURRENCY_PENALTY = 45

/**
 * True when a (normalised) header contains a stand-alone identifier token.
 * Uses whole-word matching so "Cost Center", "Store Code", "Ref No" fire but
 * "Total Cost" / "Parts Cost" (no identifier word) do not.
 * @param {string} normHeader   Already normalised via {@link normaliseToken}.
 * @returns {boolean}
 */
function hasIdentifierToken(normHeader) {
  for (const w of normHeader.split(' ')) {
    if (IDENTIFIER_TOKENS.has(w)) return true
  }
  return false
}

/**
 * True when sampled values look like codes/IDs rather than monetary numbers:
 * short, no decimal point, and either non-numeric (alphanumeric/dashes) or a
 * single constant repeated id. Conservative — an empty/decimal-bearing sample
 * returns false so legitimate currency columns are never penalised.
 * @param {Array<*>} [values]
 * @returns {boolean}
 */
function looksLikeCodeValues(values) {
  const seen = (values || []).map((v) => (v == null ? '' : String(v).trim())).filter((v) => v !== '')
  if (seen.length === 0) return false
  let codey = 0
  for (const v of seen) {
    const compact = v.replace(/\s/g, '')
    const hasDecimal = compact.includes('.')
    const isPlainNumber = NUM_RE.test(compact)
    // A code: no decimal point AND (non-numeric OR short constant-width id).
    if (!hasDecimal && (!isPlainNumber || compact.length <= 8)) codey++
  }
  if (codey / seen.length < 0.8) return false
  // A constant repeated value across the sample is a strong id signal.
  const distinct = new Set(seen)
  return distinct.size === 1 || codey === seen.length
}

/**
 * Score a header against a list of synonym strings → { score, matchedGuess }.
 *
 * Optionally applies a negative cue: an identifier-like header (contains a
 * token such as "code", "center", "no", "ref") scored against a currency-typed
 * target is penalised so an ID column cannot masquerade as money. The penalty
 * also fires when sampled values look like codes/IDs.
 *
 * @param {string} header
 * @param {string[]} guesses
 * @param {Object} [opts]
 * @param {string} [opts.fieldType]        Logical type of the candidate target.
 * @param {Array<*>} [opts.sampleValues]   Sampled cell values for this column.
 * @returns {{ score: number, matchedGuess: string|null }}
 */
function scoreHeader(header, guesses, opts = {}) {
  const h = normaliseToken(header)
  if (!h) return { score: 0, matchedGuess: null }
  let best = 0
  let matchedGuess = null

  for (const raw of guesses) {
    const g = normaliseToken(raw)
    if (!g) continue
    if (h === g) return { score: 100, matchedGuess: raw }

    if (h.includes(g) || g.includes(h)) {
      // Longer overlaps relative to the header are more trustworthy.
      const ratio = Math.min(h.length, g.length) / Math.max(h.length, g.length)
      const s = Math.round(70 + ratio * 18) // 70–88
      if (s > best) {
        best = s
        matchedGuess = raw
      }
      continue
    }

    const hw = new Set(h.split(' ').filter(Boolean))
    const gw = g.split(' ').filter(Boolean)
    const overlap = gw.filter((w) => w.length > 1 && hw.has(w)).length
    if (overlap > 0) {
      const s = Math.round(55 * (overlap / Math.max(hw.size, gw.length)))
      if (s > best) {
        best = s
        matchedGuess = raw
      }
    }

    if (h.length <= 24 && g.length <= 24) {
      const dist = levenshtein(h, g)
      const maxLen = Math.max(h.length, g.length)
      const s = Math.round((1 - dist / maxLen) * 50)
      if (s >= 35 && s > best) {
        best = s
        matchedGuess = raw
      }
    }
  }

  // Negative cue: identifier column → currency target is dangerous (ID as money).
  if (best > 0 && opts.fieldType === 'currency') {
    const headerIsId = hasIdentifierToken(h)
    const valuesAreCodes = looksLikeCodeValues(opts.sampleValues)
    if (headerIsId || valuesAreCodes) {
      best = Math.max(0, best - IDENTIFIER_CURRENCY_PENALTY)
    }
  }

  return { score: best, matchedGuess }
}

/* ── Sample-row type signals ────────────────────────────────────────────────── */

const NUM_RE = /^-?[\d,]+(\.\d+)?$/
const DATE_RE = /^\d{1,4}[/\-.]\d{1,2}([/\-.]\d{1,4})?$/

/**
 * Infer a coarse value type from sampled cell values for a column.
 * @param {Array<*>} values
 * @returns {'number'|'date'|'string'|'empty'}
 */
function inferType(values) {
  const seen = values.map((v) => (v == null ? '' : String(v).trim())).filter((v) => v !== '')
  if (seen.length === 0) return 'empty'
  let nums = 0
  let dates = 0
  for (const v of seen) {
    if (v instanceof Date || DATE_RE.test(v)) dates++
    else if (NUM_RE.test(v.replace(/\s/g, ''))) nums++
  }
  if (dates / seen.length >= 0.6) return 'date'
  if (nums / seen.length >= 0.6) return 'number'
  return 'string'
}

/** Logical field types that read as numbers. */
const NUMERIC_FIELD_TYPES = new Set(['number', 'integer', 'currency', 'pressure', 'distance', 'mass'])

/**
 * Nudge a fuzzy score using sampled column type vs. the field's expected type.
 * Rewards agreement modestly, penalises a clear mismatch — never flips a strong
 * exact/substring match.
 * @param {number} score
 * @param {string} sampleType
 * @param {string} fieldType
 * @returns {number}
 */
function applyTypeSignal(score, sampleType, fieldType) {
  if (score >= 95 || sampleType === 'empty') return score
  const expectNumeric = NUMERIC_FIELD_TYPES.has(fieldType)
  const expectDate = fieldType === 'date'
  if (expectNumeric) {
    if (sampleType === 'number') return Math.min(99, score + 6)
    if (sampleType === 'date') return Math.max(0, score - 12)
    if (sampleType === 'string') return Math.max(0, score - 6)
  } else if (expectDate) {
    if (sampleType === 'date') return Math.min(99, score + 8)
    if (sampleType === 'number') return Math.max(0, score - 4)
  } else {
    // String/text field receiving numeric/date-only data is mildly suspicious.
    if (sampleType !== 'string') return Math.max(0, score - 4)
  }
  return score
}

/* ── Public API ─────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} SuggestMappingInput
 * @property {Array<{ index:number, header:string }>|string[]} columns
 * @property {'fleet'|'tyre'|'stock'} module
 * @property {Array<Record<string,*>>} [sampleRows]   Header-keyed sample rows.
 * @property {SavedProfileRules} [savedProfileRules]
 */

/**
 * Suggest a mapping plan for a set of source columns within a module.
 *
 * @param {SuggestMappingInput} input
 * @returns {MappingSuggestion[]}
 */
export function suggestMapping({ columns, module, sampleRows = [], savedProfileRules = {} }) {
  const fields = MODULE_FIELDS[module]
  if (!fields) throw new Error(`suggestMapping: unknown module "${module}"`)

  const headers = (columns || []).map((c) => (typeof c === 'string' ? c : c.header))

  // Build per-target combine allow-list from explicit rules.
  const combineTargets = new Set()
  const profileColumns = savedProfileRules.columns || {}
  const combineRules = savedProfileRules.combine || []
  for (const rule of combineRules) {
    if (rule && rule.target) combineTargets.add(rule.target)
  }
  /** normalised header → forced target (from combine rules). */
  const combineForced = new Map()
  for (const rule of combineRules) {
    if (!rule || !rule.target || !Array.isArray(rule.sources)) continue
    for (const src of rule.sources) combineForced.set(normaliseToken(src), rule.target)
  }

  // Pre-compute sampled type per header.
  /** @type {Map<string,string>} */
  const typeByHeader = new Map()
  for (const h of headers) {
    const vals = sampleRows.map((r) => (r ? r[h] : undefined))
    typeByHeader.set(h, inferType(vals))
  }

  // Score every (header, field) pair once.
  /** @type {Array<{ header:string, target:string, score:number, reason:string }>} */
  const candidates = []
  for (const h of headers) {
    const norm = normaliseToken(h)

    // 1. Saved profile rule (explicit).
    if (profileColumns[norm] && fields.some((f) => f.key === profileColumns[norm])) {
      candidates.push({ header: h, target: profileColumns[norm], score: 100, reason: 'profile' })
      continue
    }
    // Combine rule forces a target (many-to-one allowed).
    if (combineForced.has(norm) && fields.some((f) => f.key === combineForced.get(norm))) {
      candidates.push({ header: h, target: combineForced.get(norm), score: 100, reason: 'combine' })
      continue
    }

    // 2. Exact alias (module-scoped).
    const alias = exactAlias(h, module)
    if (alias) {
      candidates.push({ header: h, target: alias, score: 100, reason: 'alias' })
      continue
    }

    // 3. Fuzzy against every field; keep best per field for this header.
    const sampleType = typeByHeader.get(h) || 'empty'
    const sampleValues = sampleRows.map((r) => (r ? r[h] : undefined))
    for (const field of fields) {
      const { score } = scoreHeader(h, synonymsFor(field.key, module), {
        fieldType: field.type,
        sampleValues,
      })
      if (score <= 0) continue
      const adj = applyTypeSignal(score, sampleType, field.type)
      candidates.push({ header: h, target: field.key, score: adj, reason: 'fuzzy' })
    }
  }

  // Greedy assignment: highest score first; each target used once unless it is a
  // combine target. Each header maps to at most one target.
  candidates.sort((a, b) => b.score - a.score)
  const targetTaken = new Set()
  /** header → chosen candidate */
  const chosen = new Map()
  for (const c of candidates) {
    if (chosen.has(c.header)) continue
    const targetFree = !targetTaken.has(c.target) || combineTargets.has(c.target)
    if (!targetFree) continue
    chosen.set(c.header, c)
    targetTaken.add(c.target)
  }

  // Emit one suggestion per source header (order preserved). Unmatched → custom.
  return headers.map((h) => {
    const c = chosen.get(h)
    if (!c) {
      return { sourceHeader: h, target: null, confidence: 0, action: 'preserve_custom', reason: 'unmatched' }
    }
    const confidence = Math.max(0, Math.min(100, Math.round(c.score)))
    let action
    if (confidence >= AUTO_THRESHOLD) action = 'auto'
    else if (confidence >= SUGGEST_THRESHOLD) action = 'suggest'
    else action = 'review'
    return { sourceHeader: h, target: c.target, confidence, action, reason: c.reason }
  })
}

export { AUTO_THRESHOLD, SUGGEST_THRESHOLD, scoreHeader }
