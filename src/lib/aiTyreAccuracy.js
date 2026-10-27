/**
 * AI tyre accuracy proof against an EXPERT-LABELLED dataset (pure, deterministic, no network, no clock).
 *
 * Complements aiTyreAdjudication.js (golden + review gate). Ingests an expert-labelled export (JSON or CSV
 * of photo_ref, expected conditions, reviewer, optional position) plus AI predictions keyed by photo_ref and
 * reports per-condition precision/recall/F1, per-position agreement, a confusion matrix, confidence
 * calibration and a pass/fail gate.
 *
 * Honesty rules: a metric with too small a sample is null (never 0/1); a gate on a null metric is
 * 'insufficient' (not pass). Nothing here ships data: callers must supply real labels; test fixtures are synthetic.
 *
 * Labelled row (JSON): { photo_ref, expected: ['bulge', ...] | 'bulge;cracking', assessable?: bool, reviewer, position? }
 *   CSV headers accepted: photo_ref, expected (or expected_conditions/expected_findings), assessable, reviewer, position
 * Prediction row: { photo_ref, assessable?, defects: [{type, confidence?}|type], confidence? }
 */
import { DEFECT_TYPES, DANGEROUS_TYPES } from './aiTyreAdjudication.js'

export const ACCURACY_THRESHOLDS = Object.freeze({
  minCases: 50,
  minSupportPerCondition: 8,
  minMicroPrecision: 0.8,
  minMicroRecall: 0.85,
  minConditionRecall: 0.7,     // applied to each condition with enough support
  maxDangerousMisses: 0,
  minAssessableAgreement: 0.9,
  minReviewers: 1,
  maxEce: 0.15,                // expected calibration error
  minCalibrationSamples: 30,
  maxMissingPredictions: 0,
  failOnInsufficient: true,
})

const NONE = 'none'
const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
const round = (v, d = 4) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)))
const ratio = (n, d, min = 1) => (d > 0 && d >= min ? round(n / d) : null)
const cond = (t) => (DEFECT_TYPES.includes(str(t)) ? str(t) : 'uncertain')
const truthy = (v) => v === true || /^(true|yes|1|y)$/i.test(str(v))

/** Minimal RFC4180 CSV parser (quotes, escaped quotes, CRLF). Returns array of header-keyed objects. */
export function parseCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x !== '')) rows.push(row)
  if (!rows.length) return []
  const head = rows[0].map((h) => str(h).toLowerCase())
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

function splitList(v) {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x ? x.type : x))
  return str(v).split(/[;|,]/).map((x) => x.trim()).filter(Boolean)
}

/** Normalize an expert-labelled dataset (array of rows, or CSV text). Unknown condition names become 'uncertain'. */
export function normalizeLabelled(input) {
  const rows = typeof input === 'string' ? parseCsv(input) : (Array.isArray(input) ? input : [])
  return rows.map((r) => {
    const exp = r.expected ?? r.expected_conditions ?? r.expected_findings ?? r.conditions ?? []
    const list = splitList(exp).filter((t) => str(t).toLowerCase() !== NONE).map(cond)
    return {
      photoRef: str(r.photo_ref ?? r.photoRef),
      expected: Array.from(new Set(list)).sort(),
      assessable: r.assessable === undefined || r.assessable === '' ? true : truthy(r.assessable),
      reviewer: str(r.reviewer),
      position: str(r.position),
    }
  })
}

export function normalizePredictions(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const defects = (Array.isArray(r?.defects) ? r.defects : r?.analysis?.defects || []).map((d) => {
      const c = typeof d === 'object' && d ? Number(d.confidence) : NaN
      return { type: cond(typeof d === 'object' && d ? d.type : d), confidence: Number.isFinite(c) && c >= 0 && c <= 1 ? c : null }
    })
    const a = r?.assessable ?? r?.analysis?.assessable
    return { photoRef: str(r?.photo_ref ?? r?.photoRef), assessable: a === undefined ? true : a === true, defects }
  })
}

export function validateAccuracyInputs(labelled, predictions) {
  const issues = []
  const dupes = (rows, label) => {
    const ids = rows.map((r) => r.photoRef)
    if (ids.some((x) => !x)) issues.push({ code: 'missing_ref', message: `${label} has a row without photo_ref` })
    const d = Array.from(new Set(ids.filter((x, i) => x && ids.indexOf(x) !== i)))
    if (d.length) issues.push({ code: 'duplicate_refs', message: `${label} has duplicate photo_ref: ${d.slice(0, 5).join(', ')}` })
  }
  dupes(labelled, 'Labelled set'); dupes(predictions, 'Predictions')
  if (labelled.some((l) => !l.reviewer)) issues.push({ code: 'missing_reviewer', message: 'Labelled rows must name the expert reviewer' })
  return issues
}

/** Pair expected vs predicted types for one case into confusion cells. */
function pairCase(exp, pred) {
  const E = new Set(exp), P = new Set(pred)
  const cells = []
  for (const t of E) if (P.has(t)) cells.push([t, t])
  const eLeft = [...E].filter((t) => !P.has(t)).sort()
  const pLeft = [...P].filter((t) => !E.has(t)).sort()
  const n = Math.max(eLeft.length, pLeft.length)
  for (let i = 0; i < n; i++) cells.push([eLeft[i] ?? NONE, pLeft[i] ?? NONE])
  if (!cells.length) cells.push([NONE, NONE])
  return cells
}

function calibration(points, bins = 5) {
  const n = points.length
  if (!n) return { n: 0, brier: null, ece: null, bins: [] }
  const out = []
  let ece = 0, brier = 0
  for (const p of points) brier += (p.conf - (p.correct ? 1 : 0)) ** 2
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins
    const inBin = points.filter((p) => p.conf >= lo && (b === bins - 1 ? p.conf <= hi : p.conf < hi))
    if (!inBin.length) { out.push({ lo, hi, n: 0, meanConfidence: null, accuracy: null }); continue }
    const mc = inBin.reduce((s, p) => s + p.conf, 0) / inBin.length
    const acc = inBin.filter((p) => p.correct).length / inBin.length
    ece += (inBin.length / n) * Math.abs(mc - acc)
    out.push({ lo, hi, n: inBin.length, meanConfidence: round(mc), accuracy: round(acc) })
  }
  return { n, brier: round(brier / n), ece: round(ece), bins: out }
}

const prf = (tp, fp, fn) => {
  const precision = ratio(tp, tp + fp), recall = ratio(tp, tp + fn)
  const f1 = precision != null && recall != null && precision + recall > 0 ? round((2 * precision * recall) / (precision + recall)) : null
  return { tp, fp, fn, precision, recall, f1 }
}

/** Full accuracy report. labelledInput may be rows or CSV text; predictions are AI results keyed by photo_ref. */
export function buildAccuracyReport({ labelled, predictions } = {}, thresholds = {}) {
  const th = { ...ACCURACY_THRESHOLDS, ...thresholds }
  const L = normalizeLabelled(labelled)
  const P = normalizePredictions(predictions)
  const issues = validateAccuracyInputs(L, P)
  const byRef = new Map(P.map((p) => [p.photoRef, p]))

  const perCond = new Map(DEFECT_TYPES.map((t) => [t, { tp: 0, fp: 0, fn: 0, support: 0 }]))
  const perPos = new Map()
  const confusion = new Map()
  const points = []
  const reviewers = new Set()
  let missing = 0, assessAgree = 0, assessN = 0, dangerousMisses = 0
  const missed = []

  for (const l of L) {
    if (l.reviewer) reviewers.add(l.reviewer)
    const p = byRef.get(l.photoRef)
    if (!p) { missing++; continue }
    assessN++; if (p.assessable === l.assessable) assessAgree++
    const pt = new Set(p.defects.map((d) => d.type))
    const E = new Set(l.assessable ? l.expected : [])
    const Pr = l.assessable || p.assessable ? pt : new Set()
    for (const t of E) { const c = perCond.get(t); c.support++; if (Pr.has(t)) c.tp++; else { c.fn++; if (DANGEROUS_TYPES.includes(t)) { dangerousMisses++; missed.push({ photoRef: l.photoRef, type: t }) } } }
    for (const t of Pr) if (!E.has(t)) perCond.get(t).fp++
    for (const [e, pr] of pairCase([...E], [...Pr])) {
      const row = confusion.get(e) || new Map(); row.set(pr, (row.get(pr) || 0) + 1); confusion.set(e, row)
    }
    const key = l.position || 'unknown'
    const pp = perPos.get(key) || { cases: 0, exact: 0, tp: 0, fp: 0, fn: 0 }
    pp.cases++
    const same = E.size === Pr.size && [...E].every((t) => Pr.has(t))
    if (same) pp.exact++
    for (const t of E) Pr.has(t) ? pp.tp++ : pp.fn++
    for (const t of Pr) if (!E.has(t)) pp.fp++
    perPos.set(key, pp)
    for (const d of p.defects) if (d.confidence != null) points.push({ conf: d.confidence, correct: E.has(d.type) })
  }

  const conditions = {}
  let TP = 0, FP = 0, FN = 0
  for (const [t, c] of perCond) {
    if (!c.support && !c.fp) continue
    TP += c.tp; FP += c.fp; FN += c.fn
    const m = prf(c.tp, c.fp, c.fn)
    conditions[t] = { ...m, support: c.support, reliable: c.support >= th.minSupportPerCondition, recall: c.support >= th.minSupportPerCondition ? m.recall : null }
  }
  const positions = {}
  for (const [k, v] of [...perPos].sort((a, b) => a[0].localeCompare(b[0]))) {
    positions[k] = { cases: v.cases, exactAgreement: ratio(v.exact, v.cases, 5), ...prf(v.tp, v.fp, v.fn) }
  }
  const labels = Array.from(new Set([...confusion.keys(), ...[...confusion.values()].flatMap((m) => [...m.keys()])])).sort((a, b) => (a === NONE) - (b === NONE) || a.localeCompare(b))
  const matrix = labels.map((e) => labels.map((p) => confusion.get(e)?.get(p) || 0))

  return {
    thresholds: th,
    issues,
    cases: L.length,
    scored: assessN,
    missingPredictions: missing,
    reviewers: [...reviewers].sort(),
    assessableAgreement: ratio(assessAgree, assessN, 10),
    micro: { ...prf(TP, FP, FN), precision: ratio(TP, TP + FP, 10), recall: ratio(TP, TP + FN, 10) },
    conditions,
    positions,
    confusion: { labels, matrix, expectedRows: true },
    calibration: calibration(points),
    dangerousMisses,
    dangerousMissed: missed.slice(0, 20),
  }
}

/** Pass/fail gate. status: pass | fail | insufficient. */
export function evaluateAccuracyGate(report, thresholds = {}) {
  const th = { ...report.thresholds, ...thresholds }
  const checks = []
  const add = (id, label, value, ok, insufficient = false) => checks.push({ id, label, value, status: insufficient ? 'insufficient' : ok ? 'pass' : 'fail' })
  const lt = (v, min) => v == null ? [null, true] : [v, v >= min]
  const hard = report.issues.length
  add('inputs', 'Inputs valid', hard, hard === 0)
  add('cases', `At least ${th.minCases} labelled cases`, report.scored, report.scored >= th.minCases, report.scored < th.minCases)
  add('reviewers', 'Expert reviewers named', report.reviewers.length, report.reviewers.length >= th.minReviewers)
  add('missing', 'Labelled cases without a prediction', report.missingPredictions, report.missingPredictions <= th.maxMissingPredictions)
  { const [v, bad] = lt(report.micro.precision, th.minMicroPrecision); add('precision', 'Micro precision', v, !!(v != null && bad), v == null) }
  { const [v, bad] = lt(report.micro.recall, th.minMicroRecall); add('recall', 'Micro recall', v, !!(v != null && bad), v == null) }
  { const [v, bad] = lt(report.assessableAgreement, th.minAssessableAgreement); add('assessable', 'Assessable agreement', v, !!(v != null && bad), v == null) }
  add('dangerous', 'Dangerous defects missed', report.dangerousMisses, report.dangerousMisses <= th.maxDangerousMisses)
  const weak = Object.entries(report.conditions).filter(([, c]) => c.recall != null && c.recall < th.minConditionRecall).map(([t]) => t)
  add('condition_recall', `Every supported condition recall >= ${th.minConditionRecall}`, weak.join(', ') || null, weak.length === 0)
  const cal = report.calibration
  add('calibration', 'Expected calibration error', cal.ece, cal.ece != null && cal.ece <= th.maxEce, cal.n < th.minCalibrationSamples)
  const status = checks.some((c) => c.status === 'fail') ? 'fail'
    : checks.some((c) => c.status === 'insufficient') && th.failOnInsufficient ? 'insufficient' : 'pass'
  return { status, checks }
}

export function formatAccuracyReport(report, gate) {
  const pct = (v) => (v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`)
  const out = [`Gate: ${gate.status.toUpperCase()}  cases=${report.scored}/${report.cases}  reviewers=${report.reviewers.join(', ') || 'none'}`]
  for (const c of gate.checks) out.push(`  [${c.status}] ${c.label}: ${c.value ?? 'N/A'}`)
  out.push(`Micro P=${pct(report.micro.precision)} R=${pct(report.micro.recall)} F1=${pct(report.micro.f1)}`)
  out.push('Per condition:')
  for (const [t, c] of Object.entries(report.conditions)) out.push(`  ${t}: P=${pct(c.precision)} R=${pct(c.recall)} support=${c.support}${c.reliable ? '' : ' (low support)'}`)
  out.push('Per position:')
  for (const [k, p] of Object.entries(report.positions)) out.push(`  ${k}: cases=${p.cases} P=${pct(p.precision)} R=${pct(p.recall)} exact=${pct(p.exactAgreement)}`)
  out.push(`Calibration: ECE=${report.calibration.ece ?? 'N/A'} Brier=${report.calibration.brier ?? 'N/A'} n=${report.calibration.n}`)
  return out.join('\n')
}
