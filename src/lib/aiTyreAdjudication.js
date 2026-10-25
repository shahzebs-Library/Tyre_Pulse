/**
 * AI tyre inspection adjudication harness (pure, deterministic, no network, no clock).
 *
 * Question it answers: "Is this model / prompt / engine change safe to ship?" It scores AI findings
 * against (a) an expert-labelled GOLDEN set and (b) HUMAN REVIEW decisions (accepted / rejected /
 * corrected), flags clusters of disagreement, and gates the change on thresholds.
 *
 * Honesty rules:
 *  - A metric with too small a sample is null, never 0 and never 1. A gate that depends on a null
 *    metric is 'insufficient' (not a pass) unless explicitly waived.
 *  - Reviewer "accepted" is one person's opinion, not ground truth. Golden labels are ground truth.
 *  - The AI must never certify millimetre tread depth from a photo (policy in
 *    supabase/functions/ai-tyre-inspection/logic.ts). Any result carrying an exact depth fails the gate.
 *  - Nothing here trains or tunes a model.
 *
 * Input shapes (all plain JSON):
 *   golden : [{ id, position?, vehicleType?, expert: { assessable: bool, defects: [type | {type, severity}], depthMm?: number|null } }]
 *   results: [{ caseId, analysis: { assessable, defects: [{type, severity}], exactTreadDepthMm? }, predictedDepthMm? }]
 *   reviews: [{ caseId, decision: 'accepted'|'rejected'|'corrected', correctedDefects?: [type], correctedDepthMm?, note? }]
 */

export const DEFECT_TYPES = Object.freeze([
  'uneven_wear', 'shoulder_wear', 'center_wear', 'tread_wear', 'sidewall_cut', 'tread_cut', 'cracking',
  'bulge', 'exposed_cord', 'suspected_separation', 'embedded_object', 'puncture_evidence',
  'other_visible_damage', 'uncertain',
])
/** Types where a miss is a safety event regardless of the expert's severity label. */
export const DANGEROUS_TYPES = Object.freeze(['exposed_cord', 'bulge', 'suspected_separation'])
const HIGH_SEVERITY = new Set(['high', 'urgent'])
const DECISIONS = Object.freeze(['accepted', 'rejected', 'corrected'])

export const DEFAULT_THRESHOLDS = Object.freeze({
  minCases: 30,                 // golden cases required before defect metrics mean anything
  minSupportPerType: 5,         // expert positives needed before a per-type recall is reported
  minAssessableAgreement: 0.85, // AI assessable flag equals the expert's
  minMicroRecall: 0.8,
  minMicroPrecision: 0.7,
  maxDangerousMisses: 0,        // expert-dangerous defect the AI did not report
  maxMissingResults: 0,         // golden cases with no AI result
  minReviewed: 20,              // human decisions required before acceptance rate is reported
  minReviewAcceptRate: 0.7,
  minDepthPairs: 10,
  maxDepthMae: 1.0,             // mm, mean absolute error of predicted vs human/expert depth
  depthToleranceMm: 0.5,
  maxRegression: 0.05,          // allowed absolute drop vs baseline in any rate metric
  maxDepthMaeRegression: 0.25,  // allowed rise in mm vs baseline
  clusterMin: 3,                // disagreement cluster must have at least this many cases
  failOnInsufficient: true,
})

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
const num = (v) => (isNum(v) ? Number(v) : null)
const round = (v, d = 4) => (v === null || v === undefined ? null : Number(v.toFixed(d)))
const str = (v) => (typeof v === 'string' ? v.trim() : '')
/** Ratio that is null (unknown) when the denominator is below the minimum sample. */
const ratio = (n, d, min = 1) => (d >= Math.max(min, 1) && d > 0 ? round(n / d) : null)
const sortedUnique = (arr) => Array.from(new Set(arr)).sort()

function normDefects(list) {
  return (Array.isArray(list) ? list : []).map((d) => {
    const type = typeof d === 'string' ? d : d?.type
    const t = DEFECT_TYPES.includes(str(type)) ? str(type) : 'uncertain'
    return { type: t, severity: typeof d === 'object' && d ? str(d.severity) || 'unknown' : 'unknown' }
  })
}

export function normalizeGolden(rows) {
  return (rows || []).map((g) => ({
    id: str(g?.id),
    position: str(g?.position),
    vehicleType: str(g?.vehicleType),
    expert: {
      assessable: g?.expert?.assessable === true,
      defects: normDefects(g?.expert?.defects),
      depthMm: num(g?.expert?.depthMm),
    },
  }))
}

export function normalizeResults(rows) {
  return (rows || []).map((r) => ({
    caseId: str(r?.caseId),
    assessable: r?.analysis?.assessable === true,
    defects: normDefects(r?.analysis?.defects),
    exactTreadDepthMm: num(r?.analysis?.exactTreadDepthMm),
    predictedDepthMm: num(r?.predictedDepthMm),
  }))
}

export function normalizeReviews(rows) {
  return (rows || []).map((r) => ({
    caseId: str(r?.caseId),
    decision: DECISIONS.includes(str(r?.decision)) ? str(r.decision) : null,
    correctedDefects: normDefects(r?.correctedDefects).map((d) => d.type),
    correctedDepthMm: num(r?.correctedDepthMm),
    note: str(r?.note),
  }))
}

/**
 * Bridge from persisted ai_tyre_inspection_jobs rows (what the worker + reviewers actually produced) to
 * harness inputs, so live human decisions can be adjudicated with the same engine. Only completed jobs
 * become results; only accepted/rejected/corrected jobs become reviews. The job id is the case id.
 * Corrected defect lists are not stored on the job, so a 'corrected' review carries none.
 */
export function fromJobRows(rows) {
  const results = [], reviews = []
  for (const j of rows || []) {
    if (!j || j.status !== 'completed' || !j.id) continue
    results.push({ caseId: j.id, analysis: j.analysis || {} })
    if (DECISIONS.includes(j.review_status)) reviews.push({ caseId: j.id, decision: j.review_status, note: j.reviewer_note || '' })
  }
  return { results, reviews }
}

/** Structural problems in the inputs. Any issue makes the gate fail: bad data must not look like a pass. */
export function validateInputs(golden, results, reviews) {
  const issues = []
  const seen = (rows, key, label) => {
    const ids = rows.map((r) => r[key])
    const dup = sortedUnique(ids.filter((id, i) => ids.indexOf(id) !== i))
    if (dup.length) issues.push({ code: 'duplicate_ids', message: `${label} has duplicate ids: ${dup.slice(0, 5).join(', ')}` })
    if (ids.some((id) => !id)) issues.push({ code: 'missing_id', message: `${label} has a row without an id` })
  }
  seen(golden, 'id', 'Golden set')
  seen(results, 'caseId', 'AI results')
  seen(reviews, 'caseId', 'Reviews')
  const goldenIds = new Set(golden.map((g) => g.id))
  const stray = results.filter((r) => r.caseId && !goldenIds.has(r.caseId))
  // Results for non-golden cases are allowed only if a review exists for them (review-only cases).
  const reviewIds = new Set(reviews.map((r) => r.caseId))
  const orphan = stray.filter((r) => !reviewIds.has(r.caseId)).map((r) => r.caseId)
  if (golden.length && orphan.length) issues.push({ code: 'unknown_case', message: `AI results for unknown cases: ${orphan.slice(0, 5).join(', ')}` })
  if (reviews.some((r) => r.decision === null)) issues.push({ code: 'bad_decision', message: 'A review has an unknown decision value' })
  return issues
}

function isDangerous(defect) {
  return DANGEROUS_TYPES.includes(defect.type) || HIGH_SEVERITY.has(defect.severity)
}

/** Score AI results against the golden set. */
export function scoreAgainstGolden(golden, results) {
  const byResult = new Map(results.map((r) => [r.caseId, r]))
  const perType = new Map(DEFECT_TYPES.filter((t) => t !== 'uncertain').map((t) => [t, { tp: 0, fp: 0, fn: 0, support: 0 }]))
  const cases = []
  let assessableAgree = 0, assessableTotal = 0, missingResults = 0, uncertain = 0, overconfidentUnassessable = 0
  const dangerousMisses = []

  for (const g of golden) {
    const r = byResult.get(g.id)
    if (!r) { missingResults++; cases.push({ id: g.id, status: 'no_result', fp: [], fn: [] }); continue }
    assessableTotal++
    if (r.assessable === g.expert.assessable) assessableAgree++
    const expertTypes = new Set(g.expert.defects.map((d) => d.type).filter((t) => t !== 'uncertain'))
    const aiTypes = new Set(r.assessable ? r.defects.map((d) => d.type).filter((t) => t !== 'uncertain') : [])
    if (r.assessable) uncertain += r.defects.filter((d) => d.type === 'uncertain').length
    if (!g.expert.assessable && r.assessable && aiTypes.size) overconfidentUnassessable++
    const fn = [], fp = []
    // Expert positives only count when the expert could assess the photo.
    const positives = g.expert.assessable ? expertTypes : new Set()
    for (const t of positives) {
      const row = perType.get(t); if (!row) continue
      row.support++
      if (aiTypes.has(t)) row.tp++
      else {
        row.fn++; fn.push(t)
        const dangerousExpert = g.expert.defects.some((d) => d.type === t && isDangerous(d))
        if (dangerousExpert) dangerousMisses.push({ caseId: g.id, type: t, position: g.position, vehicleType: g.vehicleType })
      }
    }
    for (const t of aiTypes) {
      const row = perType.get(t); if (!row) continue
      if (!positives.has(t)) { row.fp++; fp.push(t) }
    }
    cases.push({ id: g.id, status: fn.length || fp.length ? 'disagree' : 'agree', fp: fp.sort(), fn: fn.sort(),
      position: g.position, vehicleType: g.vehicleType })
  }

  const types = {}
  let tp = 0, fp = 0, fn = 0
  for (const [t, c] of perType) {
    tp += c.tp; fp += c.fp; fn += c.fn
    types[t] = {
      support: c.support, tp: c.tp, fp: c.fp, fn: c.fn,
      precision: ratio(c.tp, c.tp + c.fp, 1),          // null when the AI never claimed this type
      recall: ratio(c.tp, c.tp + c.fn, 1),             // null when the expert never saw this type
      reliable: false,                                  // set by buildReport against minSupportPerType
    }
  }
  return {
    goldenCases: golden.length, scored: assessableTotal, missingResults,
    assessableAgreement: ratio(assessableAgree, assessableTotal, 1),
    micro: { tp, fp, fn, precision: ratio(tp, tp + fp, 1), recall: ratio(tp, tp + fn, 1) },
    types, uncertainFlags: uncertain, overconfidentUnassessable,
    dangerousMisses: dangerousMisses.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.type.localeCompare(b.type)),
    cases,
  }
}

/** Human review agreement on AI findings (per defect type the AI claimed, plus overall). */
export function reviewAgreement(results, reviews, minReviewed = DEFAULT_THRESHOLDS.minReviewed) {
  const byResult = new Map(results.map((r) => [r.caseId, r]))
  const types = new Map()
  const bump = (t, d) => {
    if (!types.has(t)) types.set(t, { reviewed: 0, accepted: 0, rejected: 0, corrected: 0 })
    const row = types.get(t); row.reviewed++; row[d]++
  }
  let reviewed = 0, accepted = 0, rejected = 0, corrected = 0, withoutResult = 0
  for (const rv of reviews) {
    if (!rv.decision) continue
    const r = byResult.get(rv.caseId)
    if (!r) { withoutResult++; continue }
    reviewed++
    if (rv.decision === 'accepted') accepted++
    else if (rv.decision === 'rejected') rejected++
    else corrected++
    const claimed = sortedUnique(r.assessable ? r.defects.map((d) => d.type) : [])
    for (const t of claimed.length ? claimed : ['(none)']) bump(t, rv.decision)
  }
  const out = {}
  for (const [t, c] of [...types.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out[t] = { ...c, acceptRate: ratio(c.accepted, c.reviewed, 5), rejectRate: ratio(c.rejected, c.reviewed, 5) }
  }
  return {
    reviewed, accepted, rejected, corrected, withoutResult,
    acceptRate: ratio(accepted, reviewed, minReviewed),
    rejectRate: ratio(rejected, reviewed, minReviewed),
    correctedRate: ratio(corrected, reviewed, minReviewed),
    types: out,
  }
}

function quantile(sorted, q) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)
  return sorted[Math.max(idx, 0)]
}

/**
 * Depth correction magnitude: predicted (engine estimate) vs the human-corrected value, falling back
 * to the golden expert/gauge depth. Visual AI depth is never used here (it must be null).
 */
export function depthCorrection(golden, results, reviews, { minPairs = DEFAULT_THRESHOLDS.minDepthPairs, toleranceMm = DEFAULT_THRESHOLDS.depthToleranceMm } = {}) {
  const rv = new Map(reviews.map((r) => [r.caseId, r]))
  const gd = new Map(golden.map((g) => [g.id, g]))
  const errs = []
  for (const r of results) {
    if (r.predictedDepthMm === null) continue
    const truth = rv.get(r.caseId)?.correctedDepthMm ?? gd.get(r.caseId)?.expert.depthMm ?? null
    if (truth === null) continue
    errs.push(r.predictedDepthMm - truth)
  }
  const n = errs.length
  if (n < Math.max(minPairs, 1)) return { pairs: n, mae: null, bias: null, medianAbs: null, p90Abs: null, maxAbs: null, withinTolerance: null }
  const abs = errs.map(Math.abs).sort((a, b) => a - b)
  return {
    pairs: n,
    mae: round(abs.reduce((a, b) => a + b, 0) / n),
    bias: round(errs.reduce((a, b) => a + b, 0) / n),   // positive = engine over-estimates tread
    medianAbs: round(quantile(abs, 0.5)),
    p90Abs: round(quantile(abs, 0.9)),
    maxAbs: round(abs[n - 1]),
    withinTolerance: round(abs.filter((e) => e <= toleranceMm).length / n),
  }
}

/** Cluster the disagreements so a regression points at a cause, not just a number. */
export function disagreementClusters(golden, goldenScore, results, reviews, { clusterMin = DEFAULT_THRESHOLDS.clusterMin } = {}) {
  const gd = new Map(golden.map((g) => [g.id, g]))
  const res = new Map(results.map((r) => [r.caseId, r]))
  const events = []
  for (const c of goldenScore.cases) {
    for (const t of c.fp) events.push({ kind: 'false_positive', type: t, caseId: c.id, position: c.position || '', vehicleType: c.vehicleType || '' })
    for (const t of c.fn) events.push({ kind: 'missed_defect', type: t, caseId: c.id, position: c.position || '', vehicleType: c.vehicleType || '' })
  }
  for (const rv of reviews) {
    if (rv.decision !== 'rejected' && rv.decision !== 'corrected') continue
    const r = res.get(rv.caseId); if (!r) continue
    const g = gd.get(rv.caseId)
    const types = sortedUnique(r.assessable ? r.defects.map((d) => d.type) : [])
    for (const t of types.length ? types : ['(none)']) {
      events.push({ kind: rv.decision === 'rejected' ? 'reviewer_rejected' : 'reviewer_corrected', type: t, caseId: rv.caseId,
        position: g?.position || '', vehicleType: g?.vehicleType || '' })
    }
  }
  const groups = new Map()
  const add = (dim, e, keyObj) => {
    const key = [dim, e.kind, ...Object.values(keyObj)].join('|')
    if (!groups.has(key)) groups.set(key, { dimension: dim, kind: e.kind, key: keyObj, caseIds: new Set() })
    groups.get(key).caseIds.add(e.caseId)
  }
  for (const e of events) {
    add('type', e, { type: e.type })
    if (e.position) add('type+position', e, { type: e.type, position: e.position })
    if (e.vehicleType) add('type+vehicleType', e, { type: e.type, vehicleType: e.vehicleType })
  }
  return [...groups.entries()]
    .map(([k, g]) => ({ id: k, dimension: g.dimension, kind: g.kind, key: g.key, count: g.caseIds.size, caseIds: [...g.caseIds].sort().slice(0, 10) }))
    .filter((c) => c.count >= Math.max(clusterMin, 1))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

/** Full deterministic report. Pass thresholds only to carry the sample minimums into the metrics. */
export function buildReport({ golden = [], results = [], reviews = [] } = {}, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds }
  const g = normalizeGolden(golden), r = normalizeResults(results), rv = normalizeReviews(reviews)
  const issues = validateInputs(g, r, rv)
  const score = scoreAgainstGolden(g, r)
  for (const [type, row] of Object.entries(score.types)) {
    row.reliable = row.support >= t.minSupportPerType
    if (!row.reliable) { row.recall = null }       // too few expert positives: do not report a rate
  }
  const visualDepthClaims = r.filter((x) => x.exactTreadDepthMm !== null).map((x) => x.caseId).sort()
  const review = reviewAgreement(r, rv, t.minReviewed)
  const depth = depthCorrection(g, r, rv, { minPairs: t.minDepthPairs, toleranceMm: t.depthToleranceMm })
  const clusters = disagreementClusters(g, score, r, rv, { clusterMin: t.clusterMin })
  const enough = score.scored >= t.minCases
  return {
    version: 1,
    counts: { golden: g.length, results: r.length, reviews: rv.length },
    inputIssues: issues,
    golden: {
      ...score,
      // Defect metrics are withheld (null) below the case minimum rather than reported from a tiny sample.
      assessableAgreement: enough ? score.assessableAgreement : null,
      micro: enough ? score.micro : { ...score.micro, precision: null, recall: null },
      sampleSufficient: enough,
    },
    review,
    depth,
    visualDepthClaims,
    clusters,
  }
}

/** The numeric summary a baseline file stores and a later run is compared against. */
export function summarizeForBaseline(report) {
  return {
    assessableAgreement: report.golden.assessableAgreement,
    microPrecision: report.golden.micro.precision,
    microRecall: report.golden.micro.recall,
    acceptRate: report.review.acceptRate,
    depthMae: report.depth.mae,
  }
}

/**
 * Gate a change. status: 'pass' | 'fail' | 'insufficient'. 'insufficient' means a required metric could
 * not be computed (sample too small); with failOnInsufficient (default) it blocks like a failure.
 */
export function evaluateGate(report, thresholds = {}, baseline = null) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds }
  const failures = [], insufficient = [], notes = []
  const fail = (rule, message, actual, limit) => failures.push({ rule, message, actual, limit })
  const need = (rule, message) => insufficient.push({ rule, message })

  for (const issue of report.inputIssues) fail(`input:${issue.code}`, issue.message, null, null)
  if (report.golden.missingResults > t.maxMissingResults) {
    fail('missing_results', `${report.golden.missingResults} golden case(s) have no AI result`, report.golden.missingResults, t.maxMissingResults)
  }
  if (report.visualDepthClaims.length) {
    fail('ai_certified_depth', `AI results carry an exact tread depth for ${report.visualDepthClaims.length} case(s); a photo may never certify millimetres`,
      report.visualDepthClaims.length, 0)
  }
  if (report.golden.dangerousMisses.length > t.maxDangerousMisses) {
    fail('dangerous_misses', `${report.golden.dangerousMisses.length} dangerous defect(s) missed (${report.golden.dangerousMisses.slice(0, 3).map((m) => `${m.caseId}:${m.type}`).join(', ')})`,
      report.golden.dangerousMisses.length, t.maxDangerousMisses)
  }
  const min = (rule, label, actual, limit, why) => {
    if (actual === null || actual === undefined) return need(rule, `${label} not computable: ${why}`)
    if (actual < limit) fail(rule, `${label} ${actual} is below ${limit}`, actual, limit)
  }
  const sampleWhy = `needs at least ${t.minCases} scored golden cases (have ${report.golden.scored})`
  min('assessable_agreement', 'Assessable agreement', report.golden.assessableAgreement, t.minAssessableAgreement, sampleWhy)
  min('micro_recall', 'Overall recall', report.golden.micro.recall, t.minMicroRecall, sampleWhy)
  min('micro_precision', 'Overall precision', report.golden.micro.precision, t.minMicroPrecision, sampleWhy)

  // Review acceptance and depth accuracy only gate when data exists; absent review data is reported, not blamed.
  if (report.review.acceptRate === null) notes.push(`Review acceptance not computed: needs ${t.minReviewed} reviewed findings (have ${report.review.reviewed}).`)
  else if (report.review.acceptRate < t.minReviewAcceptRate) fail('review_accept_rate', `Reviewer acceptance ${report.review.acceptRate} is below ${t.minReviewAcceptRate}`, report.review.acceptRate, t.minReviewAcceptRate)
  if (report.depth.mae === null) notes.push(`Depth accuracy not computed: needs ${t.minDepthPairs} predicted/measured pairs (have ${report.depth.pairs}).`)
  else if (report.depth.mae > t.maxDepthMae) fail('depth_mae', `Depth mean absolute error ${report.depth.mae} mm exceeds ${t.maxDepthMae} mm`, report.depth.mae, t.maxDepthMae)

  if (baseline) {
    const cur = summarizeForBaseline(report)
    for (const [k, label] of [['assessableAgreement', 'Assessable agreement'], ['microPrecision', 'Precision'], ['microRecall', 'Recall'], ['acceptRate', 'Reviewer acceptance']]) {
      if (cur[k] === null || baseline[k] === null || baseline[k] === undefined) continue
      if (baseline[k] - cur[k] > t.maxRegression + 1e-9) {
        fail(`regression:${k}`, `${label} fell from ${baseline[k]} to ${cur[k]} (allowed drop ${t.maxRegression})`, cur[k], baseline[k] - t.maxRegression)
      }
    }
    if (cur.depthMae !== null && baseline.depthMae !== null && baseline.depthMae !== undefined && cur.depthMae - baseline.depthMae > t.maxDepthMaeRegression + 1e-9) {
      fail('regression:depthMae', `Depth error rose from ${baseline.depthMae} to ${cur.depthMae} mm`, cur.depthMae, baseline.depthMae + t.maxDepthMaeRegression)
    }
  }

  const blocked = failures.length > 0 || (t.failOnInsufficient && insufficient.length > 0)
  const status = failures.length ? 'fail' : insufficient.length ? 'insufficient' : 'pass'
  return { status, pass: !blocked, failures, insufficient, notes }
}

/** Plain-text summary for the CLI and PR comments. ASCII only. */
export function formatReport(report, gate) {
  const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`)
  const lines = []
  lines.push(`AI tyre adjudication: ${gate.status.toUpperCase()}`)
  lines.push(`Golden cases ${report.counts.golden} | AI results ${report.counts.results} | reviews ${report.counts.reviews}`)
  lines.push(`Assessable agreement ${pct(report.golden.assessableAgreement)} | precision ${pct(report.golden.micro.precision)} | recall ${pct(report.golden.micro.recall)} | dangerous misses ${report.golden.dangerousMisses.length}`)
  lines.push(`Reviewed ${report.review.reviewed}: accepted ${report.review.accepted}, rejected ${report.review.rejected}, corrected ${report.review.corrected} | acceptance ${pct(report.review.acceptRate)}`)
  lines.push(`Depth pairs ${report.depth.pairs} | MAE ${report.depth.mae === null ? 'n/a' : report.depth.mae + ' mm'} | bias ${report.depth.bias === null ? 'n/a' : report.depth.bias + ' mm'}`)
  const typeRows = Object.entries(report.golden.types).filter(([, v]) => v.support || v.fp)
  if (typeRows.length) {
    lines.push('Per defect type (support, precision, recall):')
    for (const [t, v] of typeRows) lines.push(`  ${t.padEnd(22)} ${String(v.support).padStart(3)}  ${pct(v.precision).padStart(7)}  ${pct(v.recall).padStart(7)}`)
  }
  if (report.clusters.length) {
    lines.push('Disagreement clusters:')
    for (const c of report.clusters.slice(0, 8)) lines.push(`  ${c.count}x ${c.kind} ${Object.values(c.key).join(' / ')} (${c.dimension}) e.g. ${c.caseIds.slice(0, 3).join(', ')}`)
  }
  for (const f of gate.failures) lines.push(`FAIL ${f.rule}: ${f.message}`)
  for (const i of gate.insufficient) lines.push(`INSUFFICIENT ${i.rule}: ${i.message}`)
  for (const n of gate.notes) lines.push(`NOTE ${n}`)
  return lines.join('\n')
}
