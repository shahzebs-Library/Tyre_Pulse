/**
 * AI Feedback service - the seam between the AI answer surfaces (Command
 * Center thumbs up/down, AI Administration > Feedback) and the `ai_feedback`
 * table (V205, extended by migration 20261112101000_ai_feedback_loop.sql).
 *
 * Supervised learning, controlled: feedback is STORED and reviewed. Nothing
 * here retrains a model or changes a prompt. An expert marks useful rows as
 * verified, and only verified rows feed the offline evaluation set
 * (src/lib/aiEvaluation.js).
 *
 * Before the migration is applied the extended columns do not exist. Reads
 * then fall back to the V205 columns (`legacy: true`) and answer feedback is
 * written in the V205 shape, carrying the answer id inside the note, so a
 * thumbs press is never lost.
 */
import { supabase, unwrap, isMissingColumn } from './_client'
import { toFiniteNumber } from '../aiAdmin'

export const BASE_COLS =
  'id,organisation_id,conversation_id,message_id,user_id,rating,correct,note,' +
  'created_at,updated_at'

export const COLS =
  BASE_COLS + ',assistant_message_id,agent,category,question,answer,expected_answer,' +
  'grounded,coverage,prompt_version,expert_verified,verified_by,verified_at,review_note'

export const RATING_MIN = 1
export const RATING_MAX = 5

/** Why an answer was wrong. Mirrors the CHECK in the migration. */
export const FEEDBACK_CATEGORIES = [
  { value: 'wrong_figure', label: 'Wrong figure' },
  { value: 'wrong_cause', label: 'Wrong root cause' },
  { value: 'missing_data', label: 'Missing data' },
  { value: 'unsafe', label: 'Unsafe advice' },
  { value: 'other', label: 'Other' },
]
const CATEGORY_SET = new Set(FEEDBACK_CATEGORIES.map((c) => c.value))

export function categoryLabel(v) {
  return FEEDBACK_CATEGORIES.find((c) => c.value === v)?.label ?? (v || '')
}

function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.cause?.message || err?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    (msg.includes('relation') && msg.includes('ai_feedback') && msg.includes('does not exist'))
  )
}

const asUuid = (v) => {
  if (v == null || v === '') return null
  const s = String(v).trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null
}

/** ai_messages.id is a bigint identity. Accept positive safe integers only. */
export function asMessageId(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function asRating(v) {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error('Rating must be a number.')
  const r = Math.round(n)
  if (r < RATING_MIN || r > RATING_MAX) {
    throw new Error(`Rating must be between ${RATING_MIN} and ${RATING_MAX}.`)
  }
  return r
}

function asCategory(v) {
  if (v == null || v === '') return null
  if (!CATEGORY_SET.has(v)) throw new Error('Choose a valid feedback category.')
  return v
}

const text = (v, max) => {
  const s = v == null ? '' : String(v).trim()
  return s ? s.slice(0, max) : null
}

/**
 * Feedback rows, newest first. Feedback is org-scoped (RLS), not
 * country-scoped: ai_feedback has no country column. Filtering is applied
 * client-side on the returned rows.
 * @returns {Promise<Array<object>>} rows; the array carries `.legacy = true`
 *   when the extended columns are not provisioned yet.
 */
export async function listAiFeedback({ limit = 1000 } = {}) {
  const run = (cols) => supabase.from('ai_feedback').select(cols)
    .order('created_at', { ascending: false }).limit(limit)
  try {
    return unwrap(await run(COLS)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    if (!isMissingColumn(err)) throw err
    const rows = unwrap(await run(BASE_COLS)) || []
    rows.legacy = true
    return rows
  }
}

export async function getAiFeedback(id) {
  return unwrap(await supabase.from('ai_feedback').select(BASE_COLS).eq('id', id).maybeSingle())
}

/** Build the row a thumbs up/down press writes. Pure, exported for tests. */
export function buildAnswerFeedback(input = {}) {
  const assistantMessageId = asMessageId(input.assistantMessageId)
  if (!assistantMessageId) throw new Error('This answer was not saved, so it cannot be rated.')
  if (input.verdict !== 'up' && input.verdict !== 'down') throw new Error('Choose helpful or not helpful.')
  const up = input.verdict === 'up'
  const category = up ? null : asCategory(input.category)
  const coverage = Array.isArray(input.coverage)
    ? input.coverage.slice(0, 30).map((c) => ({
      tool: String(c?.tool ?? '').slice(0, 80),
      ok: c?.ok === true,
      rows: Number.isFinite(c?.rows) ? c.rows : null,
      truncated: c?.truncated === true,
    }))
    : null
  return {
    assistant_message_id: assistantMessageId,
    conversation_id: asUuid(input.conversationId),
    rating: up ? 5 : 1,
    correct: up,
    category,
    expected_answer: up ? null : text(input.expectedAnswer, 8000),
    note: text(input.note, 8000),
    agent: Array.isArray(input.agents) && input.agents.length
      ? input.agents.map(String).join('+').slice(0, 200)
      : text(input.agent, 200),
    grounded: typeof input.grounded === 'boolean' ? input.grounded : null,
    coverage,
    prompt_version: text(input.promptVersion, 80),
  }
}

/** V205-shaped fallback: the answer id and details travel in the note. */
export function legacyAnswerFeedback(row) {
  const parts = [`[answer #${row.assistant_message_id}]`]
  if (row.agent) parts.push(`[agent ${row.agent}]`)
  if (row.category) parts.push(`[${row.category}]`)
  if (row.expected_answer) parts.push(`Correct answer: ${row.expected_answer}`)
  if (row.note) parts.push(row.note)
  return {
    conversation_id: row.conversation_id,
    rating: row.rating,
    correct: row.correct,
    note: parts.join(' ').slice(0, 8000),
  }
}

/**
 * Record a thumbs up/down (with optional correction) on one assistant answer.
 * A second press by the same person updates their earlier rating.
 */
export async function submitAnswerFeedback(input) {
  const row = buildAnswerFeedback(input)
  const { data, error } = await supabase.from('ai_feedback')
    .upsert(row, { onConflict: 'user_id,assistant_message_id' })
    .select('id')
    .single()
  if (!error) return { id: data?.id ?? null, legacy: false }
  if (!isMissingColumn(error)) return unwrap({ data, error })
  const legacy = unwrap(await supabase.from('ai_feedback')
    .insert(legacyAnswerFeedback(row)).select('id').single())
  return { id: legacy?.id ?? null, legacy: true }
}

export async function createAiFeedback(values = {}) {
  const rating = asRating(values.rating)
  const correct = values.correct == null || values.correct === '' ? null : values.correct === true
  const note = text(values.note, 8000)
  if (rating == null && correct == null && !note) {
    throw new Error('Provide a rating, a correctness flag, or a note.')
  }
  const payload = { conversation_id: asUuid(values.conversation_id), rating, correct, note }
  return unwrap(await supabase.from('ai_feedback').insert(payload).select(BASE_COLS).single())
}

/**
 * Edit a feedback row. Reviewer-only fields (expert_verified, review_note) are
 * enforced by the database trigger; the client only shapes the patch.
 */
export async function updateAiFeedback(id, patch = {}) {
  const clean = {}
  if (patch.rating !== undefined) clean.rating = asRating(patch.rating)
  if (patch.correct !== undefined) {
    clean.correct = patch.correct == null || patch.correct === '' ? null : patch.correct === true
  }
  if (patch.note !== undefined) clean.note = text(patch.note, 8000)
  if (patch.category !== undefined) clean.category = asCategory(patch.category)
  if (patch.expected_answer !== undefined) clean.expected_answer = text(patch.expected_answer, 8000)
  if (patch.review_note !== undefined) clean.review_note = text(patch.review_note, 4000)
  if (patch.expert_verified !== undefined) clean.expert_verified = patch.expert_verified === true
  return unwrap(await supabase.from('ai_feedback').update(clean).eq('id', id).select('id').single())
}

export async function deleteAiFeedback(id) {
  return unwrap(await supabase.from('ai_feedback').delete().eq('id', id))
}
