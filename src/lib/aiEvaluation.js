/**
 * aiEvaluation.js - OFFLINE evaluation of AI Command Center answers, built
 * from expert-verified feedback (ai_feedback, migration 20261112101000).
 *
 * Pure: no I/O, no clock, no paid model calls. scripts/ai-eval.mjs runs it on
 * exported JSON.
 *
 * Controlled learning only. This module never changes a prompt or a model.
 * It answers one question: does a CANDIDATE prompt version answer the
 * verified questions better than the CURRENT one on data it was not tuned on?
 *
 * PROMOTION POLICY (all four must hold; nothing is automatic):
 *   1. The candidate is scored on the HOLDOUT split, which nobody looked at
 *      while editing the prompt. Train/validation are for iteration only.
 *   2. Holdout pass rate beats the current version by at least MIN_DELTA and
 *      the holdout has at least MIN_HOLDOUT items.
 *   3. No regression on any item the expert flagged `unsafe`, and no
 *      critical-check failure (invented numbers) the current version passed.
 *   4. A named human approves, and the previous PROMPT_VERSION stays
 *      deployable so a rollback is one redeploy.
 * `comparePromotion` reports (1)-(3) and always returns
 * `requiresHumanApproval: true`.
 */

export const DATASET_SCHEMA = 'tyrepulse-ai-eval/1'
export const SPLITS = ['train', 'validation', 'holdout']
export const DEFAULT_RATIOS = { train: 0.6, validation: 0.2, holdout: 0.2 }
export const MIN_DELTA = 0.02
export const MIN_HOLDOUT = 30

// ── deterministic hashing (FNV-1a 32-bit) ────────────────────────────────────
export function fnv1a(str) {
  let h = 0x811c9dc5
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// murmur3 finaliser: FNV-1a alone avalanches poorly on short sequential keys
// (conv-1, conv-2 ...), which skews the split ratios.
export function mix32(h) {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

const clean = (v) => (v == null ? '' : String(v).trim())

/**
 * Turn feedback rows into a versioned eval dataset. Only expert-verified rows
 * with a question become items: an unverified thumbs press is a signal, not a
 * label.
 */
export function buildEvalDataset(rows = [], { version = 'v1', generatedAt = null } = {}) {
  const items = []
  const skipped = { unverified: 0, noQuestion: 0, duplicate: 0 }
  const seen = new Set()
  // Deterministic duplicate resolution: the most recently edited review wins,
  // ties broken by id, so input order never changes the dataset.
  const stamp = (r) => String(r?.updated_at || r?.verified_at || r?.created_at || '')
  const ordered = (Array.isArray(rows) ? [...rows] : []).sort((x, y) =>
    stamp(y).localeCompare(stamp(x)) || String(x?.id ?? '').localeCompare(String(y?.id ?? '')))
  for (const r of ordered) {
    if (r?.expert_verified !== true) { skipped.unverified++; continue }
    const question = clean(r.question)
    if (!question) { skipped.noQuestion++; continue }
    const key = r.assistant_message_id != null ? `m:${r.assistant_message_id}` : `f:${r.id}`
    if (seen.has(key)) { skipped.duplicate++; continue }
    seen.add(key)
    const agents = clean(r.agent).split('+').map((a) => a.trim()).filter(Boolean)
    items.push({
      id: `eval-${fnv1a(key).toString(16)}`,
      feedback_id: r.id ?? null,
      conversation_id: r.conversation_id ?? null,
      agents,
      question,
      verdict: r.correct === true ? 'correct' : r.correct === false ? 'wrong' : 'unjudged',
      category: r.category ?? null,
      expected: clean(r.expected_answer) || clean(r.note),
      reference_answer: clean(r.answer),
      grounded: typeof r.grounded === 'boolean' ? r.grounded : null,
      coverage: Array.isArray(r.coverage) ? r.coverage : null,
      prompt_version: r.prompt_version ?? null,
    })
  }
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return {
    schema: DATASET_SCHEMA,
    version,
    generated_at: generatedAt,
    count: items.length,
    fingerprint: fnv1a(items.map((i) => `${i.id}|${i.question}|${i.expected}`).join('\n')).toString(16),
    skipped,
    items,
  }
}

/**
 * Deterministic split BY CONVERSATION, so follow-up questions from one
 * thread never land on both sides (no leakage). Items with no conversation
 * are grouped by their own id.
 */
export function splitOf(groupKey, { seed = 'tyrepulse', ratios = DEFAULT_RATIOS } = {}) {
  const total = (ratios.train ?? 0) + (ratios.validation ?? 0) + (ratios.holdout ?? 0)
  if (!(total > 0)) throw new Error('Split ratios must be positive')
  const u = mix32(fnv1a(`${seed}:${groupKey}`)) / 0x100000000
  const t = (ratios.train ?? 0) / total
  const v = t + (ratios.validation ?? 0) / total
  return u < t ? 'train' : u < v ? 'validation' : 'holdout'
}

export function splitDataset(dataset, opts = {}) {
  const out = { train: [], validation: [], holdout: [] }
  for (const item of dataset?.items ?? []) {
    out[splitOf(item.conversation_id || item.id, opts)].push(item)
  }
  return out
}

/** Conversations that appear in more than one split (must be empty). */
export function checkSplitLeakage(splits) {
  const where = new Map()
  for (const s of SPLITS) {
    for (const item of splits?.[s] ?? []) {
      const g = item.conversation_id || item.id
      if (!where.has(g)) where.set(g, new Set())
      where.get(g).add(s)
    }
  }
  return [...where.entries()].filter(([, s]) => s.size > 1).map(([g, s]) => ({ group: g, splits: [...s] }))
}

// ── answer checks ────────────────────────────────────────────────────────────
const SOURCE_RE = /\[source-\d+\]/i
const MISSING_EVIDENCE_RE = /\b(no ([a-z-]+ ){0,2}(data|evidence|records?|readings?|measurements?)|not (available|recorded|enough)|insufficient|missing|cannot (be )?(confirm(ed)?|verif(y|ied)|determin(e|ed))|could not (find|retrieve|confirm)|unverified)\b/i
const STOP = new Set(('the and for with that this from have were been into than then them they your about which there their would could should when what where will also more most only over such very each tyre tyres fleet answer').split(' '))

/** Numbers that would be facts: 2+ digits, decimals, percentages, currency. */
export function figuresIn(textIn) {
  const t = String(textIn ?? '')
    .replace(/\[source-\d+\]/gi, ' ')
    .replace(/\b(19|20)\d{2}-\d{2}(-\d{2})?\b/g, ' ') // ISO dates
    .replace(/\b(19|20)\d{2}\b/g, ' ') // bare years
    .replace(/^\s*\d+[.)]\s/gm, ' ') // list numbering
  const m = t.match(/\d[\d,]*(\.\d+)?\s*(%|sar|aed|egp|km|hrs?|psi|mm)?/gi) ?? []
  return m.map((s) => s.trim()).filter((s) => /\d{2,}|\d\.\d|%|sar|aed|egp/i.test(s))
}

function keyTerms(textIn) {
  return [...new Set(String(textIn ?? '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [])]
    .filter((w) => !STOP.has(w))
}

const normNum = (s) => String(s).toLowerCase().replace(/[,\s]/g, '').replace(/(sar|aed|egp|km|hrs?|psi|mm)$/, '')

/**
 * Score one candidate answer against one verified item.
 * @param {object} item     dataset item
 * @param {object} cand     { answer: string, coverage?: Array<{ok:boolean}> }
 * @returns {{ checks: Array<{key,pass,critical}>, applicable:number, passed:number, score:number|null, pass:boolean }}
 */
export function scoreAnswer(item, cand = {}) {
  const answer = String(cand?.answer ?? '')
  const coverage = Array.isArray(cand?.coverage) ? cand.coverage : (item?.coverage ?? [])
  const grounded = coverage.some((c) => c?.ok === true)
  const agents = item?.agents ?? []
  const checks = []

  if (!answer.trim()) {
    return { checks: [{ key: 'non_empty', pass: false, critical: true }], applicable: 1, passed: 0, score: 0, pass: false }
  }

  if (grounded) {
    checks.push({ key: 'cites_sources', pass: SOURCE_RE.test(answer), critical: false })
  } else {
    // Nothing retrieved: any figure is invented.
    checks.push({ key: 'no_invented_numbers', pass: figuresIn(answer).length === 0, critical: true })
  }

  if (agents.includes('tyre_engineer') && !grounded) {
    checks.push({ key: 'states_missing_evidence', pass: MISSING_EVIDENCE_RE.test(answer), critical: false })
  }

  const expected = String(item?.expected ?? '')
  if (expected.trim()) {
    const nums = [...new Set(figuresIn(expected).map(normNum))]
    if (nums.length) {
      const got = new Set(figuresIn(answer).map(normNum))
      checks.push({ key: 'expected_figures', pass: nums.every((n) => got.has(n)), critical: false })
    }
    const terms = keyTerms(expected)
    if (terms.length) {
      const a = answer.toLowerCase()
      const hit = terms.filter((t) => a.includes(t)).length
      checks.push({ key: 'expected_terms', pass: hit / terms.length >= 0.5, critical: false })
    }
  }

  const passed = checks.filter((c) => c.pass).length
  const critical = checks.some((c) => c.critical && !c.pass)
  return {
    checks,
    applicable: checks.length,
    passed,
    score: checks.length ? passed / checks.length : null,
    pass: !critical && passed === checks.length,
  }
}

/**
 * Score a whole answer set on a list of items.
 * @param {Array<object>} items
 * @param {Record<string, {answer:string, coverage?:Array}>} answers keyed by item id
 */
export function evaluateAnswers(items = [], answers = {}) {
  const perItem = []
  const byCheck = {}
  const byAgent = {}
  let passCount = 0
  let missing = 0
  for (const item of items) {
    const cand = answers?.[item.id]
    if (!cand) { missing++; perItem.push({ id: item.id, missing: true, pass: false, score: 0, checks: [] }); continue }
    const r = scoreAnswer(item, cand)
    perItem.push({ id: item.id, category: item.category, ...r })
    if (r.pass) passCount++
    for (const c of r.checks) {
      byCheck[c.key] ??= { passed: 0, total: 0 }
      byCheck[c.key].total++
      if (c.pass) byCheck[c.key].passed++
    }
    for (const a of item.agents?.length ? item.agents : ['unknown']) {
      byAgent[a] ??= { passed: 0, total: 0 }
      byAgent[a].total++
      if (r.pass) byAgent[a].passed++
    }
  }
  return {
    total: items.length,
    missing,
    passed: passCount,
    passRate: items.length ? passCount / items.length : null,
    byCheck,
    byAgent,
    perItem,
  }
}

/**
 * Gate (1)-(3) of the promotion policy. Never promotes; a passing result only
 * means "eligible to go to a human for approval".
 */
export function comparePromotion(current, candidate, { minDelta = MIN_DELTA, minHoldout = MIN_HOLDOUT } = {}) {
  const reasons = []
  if (!current || !candidate) {
    return { eligible: false, requiresHumanApproval: true, delta: null, reasons: ['Both results are required.'] }
  }
  if (candidate.total < minHoldout) reasons.push(`Holdout has ${candidate.total} items; at least ${minHoldout} are needed.`)
  if (candidate.missing > 0) reasons.push(`Candidate is missing answers for ${candidate.missing} items.`)
  const delta = candidate.passRate != null && current.passRate != null ? candidate.passRate - current.passRate : null
  if (delta == null) reasons.push('Pass rate could not be computed.')
  else if (delta < minDelta) reasons.push(`Candidate improves the holdout by ${(delta * 100).toFixed(1)} points; at least ${(minDelta * 100).toFixed(1)} needed.`)

  const cur = new Map((current.perItem ?? []).map((p) => [p.id, p]))
  const regressions = []
  for (const p of candidate.perItem ?? []) {
    const c = cur.get(p.id)
    if (!c || !c.pass || p.pass) continue
    const criticalNow = (p.checks ?? []).some((x) => x.critical && !x.pass)
    if (p.category === 'unsafe' || criticalNow) regressions.push(p.id)
  }
  if (regressions.length) reasons.push(`Candidate regresses ${regressions.length} unsafe or critical item(s): ${regressions.slice(0, 5).join(', ')}.`)

  return { eligible: reasons.length === 0, requiresHumanApproval: true, delta, regressions, reasons }
}

export function formatEvalReport({ split, current, candidate, decision }) {
  const pct = (v) => (v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`)
  const lines = [
    `Split: ${split}`,
    `Current   : ${current.passed}/${current.total} pass (${pct(current.passRate)})`,
    `Candidate : ${candidate.passed}/${candidate.total} pass (${pct(candidate.passRate)})`,
    `Delta     : ${decision.delta == null ? 'N/A' : `${(decision.delta * 100).toFixed(1)} points`}`,
    `Checks (candidate):`,
    ...Object.entries(candidate.byCheck).map(([k, v]) => `  ${k}: ${v.passed}/${v.total}`),
    decision.eligible
      ? 'Result: ELIGIBLE for human review. Not promoted. A named approver must sign off; keep the previous prompt version for rollback.'
      : `Result: NOT ELIGIBLE.\n  - ${decision.reasons.join('\n  - ')}`,
  ]
  return lines.join('\n')
}
