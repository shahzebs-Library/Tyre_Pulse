/**
 * Expert labelling for the AI tyre photo benchmark (pure, deterministic, no network, no clock).
 *
 * Turns completed AI jobs into a stratified labelling queue, records per-defect expert verdicts,
 * builds a consensus across up to two reviewers, measures inter-reviewer agreement, and exports
 * the labelled set in the exact shape scripts/ai-accuracy.mjs and aiTyreAccuracy.js accept.
 *
 * Rules:
 *  - Labels are EVALUATION DATA. Nothing here trains or tunes a model or changes a job review.
 *  - Original photographs are never modified; no tread depth is ever derived from a photo.
 *  - Nothing here says a tyre is "safe" or "roadworthy". A label states what is visible.
 *  - Split (train / validation / holdout) MIRRORS SQL public.ai_tyre_split_for() in
 *    supabase/migrations/20261112104000_ai_tyre_expert_labels.sql. Change BOTH.
 */
import { DEFECT_TYPES, DANGEROUS_TYPES } from './aiTyreAdjudication.js'
import * as accuracy from './aiTyreAccuracy.js'

/** Owner benchmark targets: 500 labelled cases, of which at least 60 carry a dangerous defect. */
export const LABEL_TARGETS = Object.freeze({ cases: 500, dangerous: 60 })

/** The expert picks a real defect or marks the photo unassessable; "uncertain" is the AI's word, not a label. */
export const EXPERT_DEFECT_TYPES = Object.freeze(DEFECT_TYPES.filter((t) => t !== 'uncertain'))
export const VERDICTS = Object.freeze(['correct', 'wrong', 'wrong_type'])
export const SPLITS = Object.freeze(['train', 'validation', 'holdout'])

/**
 * Stratum target shares for the labelling queue. Dangerous suspects are OVERSAMPLED: they are a
 * small fraction of the fleet's photos but the benchmark needs 60 of them before a "0 dangerous
 * misses" result means anything.
 */
export const STRATA = Object.freeze([
  { id: 'dangerous', label: 'Suspected dangerous', weight: 0.35 },
  { id: 'defect', label: 'AI reported a defect', weight: 0.35 },
  { id: 'clear', label: 'AI reported nothing', weight: 0.2 },
  { id: 'unassessable', label: 'AI could not assess', weight: 0.1 },
])

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
const round = (v, d = 4) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)))
const ratio = (n, d) => (d > 0 ? round(n / d) : null)
const uniqSorted = (a) => Array.from(new Set(a)).sort()

/** FNV-1a 32-bit over UTF-8 bytes. Mirrors SQL public.ai_tyre_fnv1a(). */
export function fnv1a(text) {
  const bytes = new TextEncoder().encode(String(text))
  let h = 2166136261
  for (const b of bytes) {
    h ^= b
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** Group that must never cross splits: the tyre serial, else the inspection. Mirrors the SQL trigger. */
export function groupKeyFor({ tyreSerial, inspectionId } = {}) {
  const serial = str(tyreSerial).toUpperCase()
  if (serial) return serial
  const insp = str(inspectionId)
  return insp ? 'insp:' + insp : ''
}

/** Deterministic split for a group key. Mirrors SQL public.ai_tyre_split_for(). */
export function splitForGroup(groupKey) {
  if (!str(groupKey)) return null
  const b = fnv1a(groupKey) % 100
  return b < 60 ? 'train' : b < 80 ? 'validation' : 'holdout'
}

/** What the inspector recorded for this position (shown beside the AI). Never a depth. */
export function inspectorFinding(tyreConditions, position) {
  let raw = tyreConditions
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { raw = {} } }
  const c = raw && typeof raw === 'object' ? raw[position] : null
  if (!c || typeof c !== 'object') return { recorded: false, condition: '', notes: '', serial: '' }
  return {
    recorded: true,
    condition: str(c.condition),
    notes: str(c.notes),
    serial: str(c.serial_number ?? c.serial_no ?? c.serial ?? c.tyre_serial),
  }
}

const DANGER_TEXT = /(\bcords?\b|steel|\bwires?\b|\bbelts?\b|\bply\b|bulg|blister|bubble|separat|delaminat|expos|inner layer|chunk(ing)? missing|blow ?out|\bburst)/i
const DANGER_CONDITION = /(damage|flat|puncture|burst|blast|bulge|cut|separat)/i

/** Why a job looks like it may show a dangerous defect. The AI mostly answers "uncertain", so text and the inspector matter. */
export function dangerSignals(job, inspector = {}) {
  const reasons = []
  const a = job?.analysis || {}
  const defects = Array.isArray(a.defects) ? a.defects : []
  const aiDanger = uniqSorted(defects.map((d) => str(d?.type)).filter((t) => DANGEROUS_TYPES.includes(t)))
  if (aiDanger.length) reasons.push('AI type: ' + aiDanger.join(', '))
  const text = [a.reason, ...defects.flatMap((d) => [d?.description, d?.visibleEvidence])].map(str).join(' ')
  const m = text.match(DANGER_TEXT)
  if (m) reasons.push('AI wording: ' + m[0].toLowerCase())
  if (DANGER_CONDITION.test(str(inspector.condition))) reasons.push('Inspector: ' + str(inspector.condition))
  const n = str(inspector.notes).match(DANGER_TEXT)
  if (n) reasons.push('Inspector note: ' + n[0].toLowerCase())
  return { suspected: reasons.length > 0, reasons }
}

export function stratumFor(job, inspector = {}) {
  if (dangerSignals(job, inspector).suspected) return 'dangerous'
  const a = job?.analysis || {}
  if (a.assessable === false) return 'unassessable'
  return (Array.isArray(a.defects) ? a.defects : []).length ? 'defect' : 'clear'
}

/**
 * Expected defect list from the expert's verdicts on each AI defect plus defects the AI missed.
 * correct -> the AI type counts (an AI "uncertain" marked correct is ignored: not a real label);
 * wrong_type -> the corrected type counts; wrong -> nothing.
 */
export function expectedFromVerdicts(aiDefects, verdicts, missed, assessable = true) {
  if (!assessable) return []
  const out = []
  const list = Array.isArray(aiDefects) ? aiDefects : []
  for (const v of Array.isArray(verdicts) ? verdicts : []) {
    const d = list[v?.index]
    if (v?.verdict === 'correct' && d && EXPERT_DEFECT_TYPES.includes(str(d.type))) out.push(str(d.type))
    if (v?.verdict === 'wrong_type' && EXPERT_DEFECT_TYPES.includes(str(v.corrected_type))) out.push(str(v.corrected_type))
  }
  for (const t of Array.isArray(missed) ? missed : []) if (EXPERT_DEFECT_TYPES.includes(str(t))) out.push(str(t))
  return uniqSorted(out)
}

/** Every AI defect has a verdict, and wrong_type carries a corrected type. */
export function verdictProblems(aiDefects, verdicts, assessable) {
  if (!assessable) return []
  const problems = []
  const byIdx = new Map((verdicts || []).map((v) => [v.index, v]))
  ;(aiDefects || []).forEach((d, i) => {
    const v = byIdx.get(i)
    if (!v || !VERDICTS.includes(v.verdict)) problems.push(`AI finding ${i + 1} has no verdict`)
    else if (v.verdict === 'wrong_type' && !EXPERT_DEFECT_TYPES.includes(str(v.corrected_type))) problems.push(`AI finding ${i + 1} needs the correct type`)
  })
  return problems
}

/** Payload for the ai_tyre_expert_labels upsert. Provenance columns are re-stamped by the database. */
export function buildLabelPayload({ job, reviewerId, assessable, verdicts, missed, tyreSerial, inspectorCondition, note }) {
  const aiDefects = job?.analysis?.defects || []
  const clean = (verdicts || []).filter((v) => VERDICTS.includes(v?.verdict)).map((v) => ({
    index: v.index, type: str(aiDefects[v.index]?.type) || 'uncertain', verdict: v.verdict,
    corrected_type: v.verdict === 'wrong_type' ? str(v.corrected_type) || null : null,
  }))
  const missedClean = uniqSorted((missed || []).filter((t) => EXPERT_DEFECT_TYPES.includes(t)))
  return {
    job_id: job.id,
    inspection_id: job.inspection_id,
    tyre_position: job.tyre_position,
    photo_ref: job.photo_ref,
    reviewer_id: reviewerId,
    assessable: !!assessable,
    ai_defect_verdicts: assessable ? clean : [],
    missed_defects: assessable ? missedClean : [],
    expected_defects: expectedFromVerdicts(aiDefects, clean, missedClean, !!assessable),
    inspector_condition: str(inspectorCondition) || null,
    tyre_serial: str(tyreSerial) || null,
    group_key: groupKeyFor({ tyreSerial, inspectionId: job.inspection_id }),
    split: splitForGroup(groupKeyFor({ tyreSerial, inspectionId: job.inspection_id })),
    note: str(note) || null,
  }
}

const labelsByJob = (labels) => {
  const m = new Map()
  for (const l of labels || []) { if (!l?.job_id) continue; const a = m.get(l.job_id) || []; a.push(l); m.set(l.job_id, a) }
  return m
}
const sameLabel = (a, b) => !!a.assessable === !!b.assessable
  && uniqSorted(a.expected_defects || []).join('|') === uniqSorted(b.expected_defects || []).join('|')

/**
 * Stratified queue. mode 'first' = photos nobody has labelled; 'second' = photos labelled once by
 * someone else (second opinion for agreement). Within a stratum, photos from a tyre/inspection not
 * yet labelled come first, then a stable hash order (reproducible, no randomness).
 * candidates: [{ job, inspection }]
 */
export function buildLabellingQueue(candidates, labels, { reviewerId = '', mode = 'first', limit = 50 } = {}) {
  const byJob = labelsByJob(labels)
  const usedGroups = new Set((labels || []).map((l) => l.group_key).filter(Boolean))
  const pools = new Map(STRATA.map((s) => [s.id, []]))
  for (const c of candidates || []) {
    const job = c?.job
    if (!job?.id || !job.photo_ref || job.status !== 'completed') continue
    const mine = byJob.get(job.id) || []
    if (mine.some((l) => l.reviewer_id === reviewerId)) continue
    if (mode === 'first' ? mine.length !== 0 : mine.length !== 1) continue
    const inspector = inspectorFinding(c.inspection?.tyre_conditions, job.tyre_position)
    const stratum = stratumFor(job, inspector)
    const group = groupKeyFor({ tyreSerial: inspector.serial, inspectionId: job.inspection_id })
    pools.get(stratum).push({
      job, inspection: c.inspection || null, inspector, stratum, group,
      reasons: dangerSignals(job, inspector).reasons, fresh: !usedGroups.has(group), rank: fnv1a(job.id),
    })
  }
  for (const p of pools.values()) p.sort((a, b) => (b.fresh - a.fresh) || (a.rank - b.rank) || String(a.job.id).localeCompare(String(b.job.id)))
  const picked = Object.fromEntries(STRATA.map((s) => [s.id, 0]))
  const out = []
  while (out.length < limit) {
    let best = null, bestDeficit = -Infinity
    for (const s of STRATA) {
      if (picked[s.id] >= pools.get(s.id).length) continue
      const deficit = s.weight * (out.length + 1) - picked[s.id]
      if (deficit > bestDeficit) { bestDeficit = deficit; best = s.id }
    }
    if (!best) break
    out.push(pools.get(best)[picked[best]++])
  }
  return { items: out, available: Object.fromEntries([...pools].map(([k, v]) => [k, v.length])) }
}

/** One consensus row per labelled job: single reviewer, agreed (2+ identical), or disagreement. */
export function consensusLabels(labels) {
  const rows = []
  for (const [jobId, ls] of labelsByJob(labels)) {
    const sorted = [...ls].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.reviewer_id).localeCompare(String(b.reviewer_id)))
    const first = sorted[0]
    const agree = sorted.every((l) => sameLabel(l, first))
    rows.push({
      jobId,
      status: sorted.length === 1 ? 'single' : agree ? 'agreed' : 'disagreement',
      labels: sorted,
      assessable: !!first.assessable,
      expected: uniqSorted(first.expected_defects || []),
      reviewerIds: uniqSorted(sorted.map((l) => l.reviewer_id)),
      split: first.split || splitForGroup(first.group_key),
      groupKey: first.group_key || '',
      tyreSerial: first.tyre_serial || '',
    })
  }
  return rows.sort((a, b) => String(a.jobId).localeCompare(String(b.jobId)))
}

/** Agreement between reviewers over photos labelled at least twice (first two labels compared). */
export function agreementStats(labels) {
  let pairs = 0, exact = 0, assess = 0, jaccardSum = 0, dangerousDisagree = 0
  for (const ls of labelsByJob(labels).values()) {
    if (ls.length < 2) continue
    const [a, b] = [...ls].sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')))
    pairs++
    if (sameLabel(a, b)) exact++
    if (!!a.assessable === !!b.assessable) assess++
    const A = new Set(a.assessable ? a.expected_defects || [] : []), B = new Set(b.assessable ? b.expected_defects || [] : [])
    const union = new Set([...A, ...B])
    jaccardSum += union.size ? [...A].filter((t) => B.has(t)).length / union.size : 1
    const dA = [...A].some((t) => DANGEROUS_TYPES.includes(t)), dB = [...B].some((t) => DANGEROUS_TYPES.includes(t))
    if (dA !== dB) dangerousDisagree++
  }
  return {
    pairs,
    exactAgreement: ratio(exact, pairs),
    assessableAgreement: ratio(assess, pairs),
    meanJaccard: ratio(jaccardSum, pairs),
    dangerousDisagreements: dangerousDisagree,
  }
}

/** Progress toward the benchmark targets. Disagreements do not count until adjudicated. */
export function labellingProgress(consensus, targets = LABEL_TARGETS) {
  const usable = (consensus || []).filter((r) => r.status !== 'disagreement')
  const dangerous = usable.filter((r) => r.assessable && r.expected.some((t) => DANGEROUS_TYPES.includes(t))).length
  const splits = Object.fromEntries(SPLITS.map((s) => [s, usable.filter((r) => r.split === s).length]))
  const reviewers = uniqSorted((consensus || []).flatMap((r) => r.reviewerIds))
  return {
    cases: usable.length,
    casesTarget: targets.cases,
    casesPct: Math.min(100, Math.round((usable.length / targets.cases) * 100)),
    dangerous,
    dangerousTarget: targets.dangerous,
    dangerousPct: Math.min(100, Math.round((dangerous / targets.dangerous) * 100)),
    assessable: usable.filter((r) => r.assessable).length,
    doubleReviewed: (consensus || []).filter((r) => r.labels.length >= 2).length,
    agreed: (consensus || []).filter((r) => r.status === 'agreed').length,
    disagreements: (consensus || []).filter((r) => r.status === 'disagreement').length,
    reviewers: reviewers.length,
    splits,
  }
}

/** Leakage check: one group key in more than one split. */
export function splitLeaks(consensus) {
  const seen = new Map()
  for (const r of consensus || []) {
    if (!r.groupKey || !r.split) continue
    const s = seen.get(r.groupKey) || new Set(); s.add(r.split); seen.set(r.groupKey, s)
  }
  return [...seen].filter(([, s]) => s.size > 1).map(([group, s]) => ({ group, splits: [...s].sort() }))
}

/** Header order of the labelled CSV, accepted by scripts/ai-accuracy.mjs. */
export const LABELLED_COLUMNS = Object.freeze(['photo_ref', 'expected', 'assessable', 'reviewer', 'position', 'vehicle_type', 'tyre_serial', 'split', 'inspection_id', 'model_version', 'prompt_version', 'reviewers', 'consensus'])

/**
 * Labelled set + predictions for the accuracy engine.
 * jobsById: Map(jobId -> job), inspectionsById: Map(id -> inspection), names: Map(reviewerId -> display name).
 * One row per photo_ref (the most recently labelled job wins; the rest are counted, never silently merged).
 */
export function buildBenchmarkExport({ consensus, jobsById, inspectionsById, names, requireAgreement = false }) {
  const name = (id) => str(names?.get?.(id)) || str(id)
  const byRef = new Map()
  let excludedDisagreement = 0, excludedSingle = 0, missingJob = 0, duplicatePhoto = 0
  for (const r of consensus || []) {
    if (r.status === 'disagreement') { excludedDisagreement++; continue }
    if (requireAgreement && r.status !== 'agreed') { excludedSingle++; continue }
    const job = jobsById?.get?.(r.jobId)
    if (!job?.photo_ref) { missingJob++; continue }
    const latest = r.labels.map((l) => str(l.updated_at || l.created_at)).sort().pop() || ''
    const prev = byRef.get(job.photo_ref)
    if (prev) { duplicatePhoto++; if (prev.latest >= latest) continue }
    byRef.set(job.photo_ref, { r, job, latest })
  }
  const labelled = [], predictions = []
  for (const [ref, { r, job }] of [...byRef].sort((a, b) => a[0].localeCompare(b[0]))) {
    const insp = inspectionsById?.get?.(job.inspection_id) || {}
    labelled.push({
      photo_ref: ref,
      expected: r.assessable ? r.expected : [],
      assessable: r.assessable,
      reviewer: name(r.labels[0].reviewer_id),
      position: str(job.tyre_position),
      vehicle_type: str(insp.vehicle_type),
      tyre_serial: r.tyreSerial || '',
      split: r.split || '',
      inspection_id: str(job.inspection_id),
      model_version: str(job.model_version),
      prompt_version: str(job.prompt_version),
      reviewers: r.reviewerIds.map(name).join('; '),
      consensus: r.status,
    })
    const a = job.analysis || {}
    predictions.push({
      photo_ref: ref,
      assessable: a.assessable !== false,
      defects: (Array.isArray(a.defects) ? a.defects : []).map((d) => {
        const c = Number(d?.confidence)
        return { type: str(d?.type) || 'uncertain', confidence: Number.isFinite(c) && c >= 0 && c <= 1 ? c : null }
      }),
      model_version: str(job.model_version),
      prompt_version: str(job.prompt_version),
    })
  }
  return { labelled, predictions, excludedDisagreement, excludedSingle, missingJob, duplicatePhoto }
}

const csvCell = (v) => {
  let s = Array.isArray(v) ? v.join(';') : v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // spreadsheet formula guard
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
export function labelledToCsv(rows) {
  return [LABELLED_COLUMNS.join(','), ...(rows || []).map((r) => LABELLED_COLUMNS.map((k) => csvCell(r[k])).join(','))].join('\n')
}

/**
 * RELEASE thresholds: the owner's targets in aiTyreAccuracy.RELEASE_THRESHOLDS. Fallback (same
 * targets for cases/reviewers/dangerous support) is used only while that export has not landed.
 */
export function releaseThresholds() {
  if (accuracy.RELEASE_THRESHOLDS) return { profile: 'release', thresholds: accuracy.RELEASE_THRESHOLDS }
  return {
    profile: 'release (fallback)',
    thresholds: { ...accuracy.ACCURACY_THRESHOLDS, minCases: 500, minSupportPerCondition: 20, minMicroPrecision: 0.9, minMicroRecall: 0.95, minConditionRecall: 0.85, minAssessableAgreement: 0.95, minReviewers: 2, maxEce: 0.1, minDangerousSupport: 60 },
  }
}

/** Release gate result over the export. Honest: "insufficient" until the data exists. */
export function runReleaseGate({ labelled, predictions }) {
  const { profile, thresholds } = releaseThresholds()
  const report = accuracy.buildAccuracyReport({ labelled, predictions }, thresholds)
  const gate = accuracy.evaluateAccuracyGate(report, thresholds)
  // Older engine without the dangerous-support check: add it here so 0 misses on 3 cases is never a pass.
  if (!gate.checks.some((c) => c.id === 'dangerous_support')) {
    const ds = (labelled || []).filter((l) => l.assessable && (Array.isArray(l.expected) ? l.expected : []).some((t) => DANGEROUS_TYPES.includes(t))).length
    const ok = ds >= LABEL_TARGETS.dangerous
    gate.checks.push({ id: 'dangerous_support', label: `At least ${LABEL_TARGETS.dangerous} expert-labelled dangerous defects`, value: ds, status: ok ? 'pass' : 'insufficient' })
    if (!ok && gate.status === 'pass') gate.status = 'insufficient'
  }
  return { profile, report, gate }
}
