/**
 * insuranceEmailAnalysis.js - read an insurer's email / letter (PDF text) and
 * determine, GROUNDED in the fleet's own stored policy conditions, why a claim
 * was rejected or delayed and under which clause it should be approved.
 *
 * The pure helpers (buildAnalysisPrompt / parseAnalysisResponse / groundAnalysis)
 * are unit-testable without a browser or network. `analyzeInsurerEmail` runs the
 * secure chat-ai edge function (same client as aiCopilot) and returns the
 * grounded result.
 *
 * GROUNDING RULE: the model may only reference the numbered conditions we pass
 * it. groundAnalysis discards any clause the model invents, and every cited
 * clause is rendered from OUR stored clause_text, not the model's paraphrase, so
 * the citation is always the real policy wording.
 *
 * ASCII only; honest about uncertainty (outcome 'unclear', empty clause lists,
 * confidence 'low') and never fabricates a policy clause.
 */
import { invokeChatAI } from './api/uploads'

export const ANALYSIS_MODEL = 'claude-haiku-4-5-20251001'
export const ANALYSIS_MAX_TOKENS = 700
const TIMEOUT_MS = 45_000
const TEXT_CAP = 6000

export const OUTCOME_META = {
  rejected: { label: 'Rejected', tone: 'reject' },
  delayed: { label: 'Delayed / pending', tone: 'delay' },
  information_requested: { label: 'Information requested', tone: 'delay' },
  approved: { label: 'Approved', tone: 'ok' },
  unclear: { label: 'Unclear', tone: 'info' },
}
export function outcomeMeta(outcome) {
  return OUTCOME_META[outcome] || OUTCOME_META.unclear
}

const clip = (v, max = 240) => {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)} ...` : s
}

/**
 * Build the {system,user} prompt. Conditions are passed as a compact numbered
 * list (seq, category, clause). The model is told to answer only from them and
 * to return STRICT JSON.
 */
export function buildAnalysisPrompt({ policy = {}, conditions = [], emailText = '' } = {}) {
  const conds = (Array.isArray(conditions) ? conditions : [])
    .filter((c) => c && c.seq != null)
    .map((c) => `${c.seq}. [${c.category || 'other'}${c.causes_rejection ? ', rejection' : ''}${c.causes_delay ? ', delay' : ''}] ${clip(c.clause_text, 300)}`)
    .join('\n')

  const system = [
    'You are a motor-fleet insurance claims analyst. You are given the text of a',
    "message from an insurer about a claim, plus the policy's numbered conditions.",
    'Decide the outcome and explain it ONLY from the message and the numbered',
    'conditions provided. Never invent a clause or a condition number that is not',
    'in the list. If the message is ambiguous, use outcome "unclear" and confidence',
    '"low". Return STRICT JSON ONLY (no prose, no code fences) with exactly these',
    'keys: outcome (one of rejected, delayed, information_requested, approved,',
    'unclear), reason_summary (one sentence), quoted_text (the short phrase from the',
    'message that shows the outcome, or ""), matched_condition_seqs (array of the',
    'condition numbers the message relies on), approval_condition_seqs (array of the',
    'condition numbers that must be satisfied for the claim to be approved),',
    'confidence (high, medium or low). Use only numbers that appear in the list.',
  ].join(' ')

  const user = [
    `POLICY: ${policy.policy_no || 'N/A'} (${policy.insurer || 'insurer N/A'})`,
    conds ? `POLICY CONDITIONS (numbered):\n${conds}` : 'POLICY CONDITIONS: none recorded',
    `INSURER MESSAGE:\n${clip(emailText, TEXT_CAP)}`,
  ].join('\n\n')

  return { system, user }
}

/**
 * Parse the model's JSON reply robustly (tolerates code fences / surrounding
 * prose). Returns a normalized object or null when it cannot be parsed.
 */
export function parseAnalysisResponse(text) {
  if (!text || typeof text !== 'string') return null
  let raw = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  // grab the first {...} block if there is surrounding prose
  if (raw[0] !== '{') {
    const a = raw.indexOf('{')
    const b = raw.lastIndexOf('}')
    if (a === -1 || b === -1 || b <= a) return null
    raw = raw.slice(a, b + 1)
  }
  let obj
  try { obj = JSON.parse(raw) } catch { return null }
  if (!obj || typeof obj !== 'object') return null

  const outcome = OUTCOME_META[obj.outcome] ? obj.outcome : 'unclear'
  const toSeqs = (v) => (Array.isArray(v) ? v : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
  const conf = ['high', 'medium', 'low'].includes(obj.confidence) ? obj.confidence : 'low'

  return {
    outcome,
    reason_summary: clip(obj.reason_summary, 300),
    quoted_text: clip(obj.quoted_text, 300),
    matched_condition_seqs: toSeqs(obj.matched_condition_seqs),
    approval_condition_seqs: toSeqs(obj.approval_condition_seqs),
    confidence: conf,
  }
}

/**
 * Attach OUR stored clause text to the model's cited condition numbers, dropping
 * any number that is not a real condition (grounding). Returns the display-ready
 * analysis, or null when parsed is null.
 */
export function groundAnalysis(parsed, conditions = []) {
  if (!parsed) return null
  const bySeq = new Map()
  for (const c of Array.isArray(conditions) ? conditions : []) {
    if (c && c.seq != null) bySeq.set(Number(c.seq), c)
  }
  const pick = (seqs) => [...new Set(seqs)]
    .map((seq) => bySeq.get(Number(seq)))
    .filter(Boolean)
    .map((c) => ({
      seq: c.seq,
      category: c.category || 'other',
      clause_text: c.clause_text || '',
      policy_no: c.policy_no || null,
      causes_rejection: !!c.causes_rejection,
      causes_delay: !!c.causes_delay,
    }))

  const meta = outcomeMeta(parsed.outcome)
  return {
    outcome: parsed.outcome,
    outcomeLabel: meta.label,
    tone: meta.tone,
    reasonSummary: parsed.reason_summary || '',
    quotedText: parsed.quoted_text || '',
    confidence: parsed.confidence || 'low',
    matched: pick(parsed.matched_condition_seqs),
    approval: pick(parsed.approval_condition_seqs),
  }
}

/**
 * Full runner: prompt the secure chat-ai edge function and return the grounded
 * analysis. Throws a user-friendly Error on failure (caller shows it and offers
 * retry). Honest: if the model cannot parse an outcome it returns 'unclear'.
 */
export async function analyzeInsurerEmail({ policy = {}, conditions = [], emailText = '' } = {}) {
  const text = String(emailText || '').trim()
  if (!text) throw new Error('No readable text was found in the document. Try a text-based PDF (not a scan).')

  const { system, user } = buildAnalysisPrompt({ policy, conditions, emailText: text })

  let timer
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('The analysis timed out. Please try again.')), TIMEOUT_MS)
    })
    const res = await Promise.race([
      invokeChatAI({ system, user, model: ANALYSIS_MODEL, max_tokens: ANALYSIS_MAX_TOKENS }),
      timeout,
    ])
    if (res?.error) {
      let detail = res.error.message
      try { const body = await res.error.context?.json?.(); if (body?.error) detail = body.error } catch { /* keep */ }
      throw new Error(`AI is unavailable: ${detail || 'edge function error'}`)
    }
    if (res?.data?.error) throw new Error(`AI is unavailable: ${res.data.error}`)
    const content = res?.data?.content
    const parsed = parseAnalysisResponse(content)
    if (!parsed) throw new Error('The analysis could not be read. Please try again.')
    return groundAnalysis(parsed, conditions)
  } finally {
    clearTimeout(timer)
  }
}
