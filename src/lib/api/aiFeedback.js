/**
 * AI Feedback service — the seam between the AI Administration page
 * (/ai-administration, Feedback tab) and Supabase (table `ai_feedback`, V205).
 *
 * Captures user ratings / corrections on AI answers so the org can measure
 * answer quality over time. Read-only reporting surface for admins plus a thin
 * create path any authenticated member can use (RLS enforces the signed-in
 * requirement; edits/deletes are elevated-only).
 *
 * Mirrors odometerLogs.js: explicit columns, missing-relation → [], rating
 * clamped to a sensible 1–5 range.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../aiAdmin'

export const COLS =
  'id,organisation_id,conversation_id,message_id,user_id,rating,correct,note,' +
  'created_at,updated_at'

export const RATING_MIN = 1
export const RATING_MAX = 5

function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' || code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('ai_feedback'))
  )
}

const asUuid = (v) => {
  if (v == null || v === '') return null
  const s = String(v).trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null
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

export async function listAiFeedback({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('ai_feedback').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q.order('created_at', { ascending: false }).limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getAiFeedback(id) {
  return unwrap(await supabase.from('ai_feedback').select(COLS).eq('id', id).maybeSingle())
}

export async function createAiFeedback(values = {}) {
  const rating = asRating(values.rating)
  const correct = values.correct == null || values.correct === '' ? null : values.correct === true
  const note = values.note ? String(values.note).slice(0, 8000) : null
  if (rating == null && correct == null && !note) {
    throw new Error('Provide a rating, a correctness flag, or a note.')
  }

  const payload = {
    conversation_id: asUuid(values.conversation_id),
    message_id: asUuid(values.message_id),
    rating,
    correct,
    note,
  }
  return unwrap(await supabase.from('ai_feedback').insert(payload).select(COLS).single())
}

export async function updateAiFeedback(id, patch = {}) {
  const clean = {}
  if (patch.rating !== undefined) clean.rating = asRating(patch.rating)
  if (patch.correct !== undefined) {
    clean.correct = patch.correct == null || patch.correct === '' ? null : patch.correct === true
  }
  if (patch.note !== undefined) clean.note = patch.note ? String(patch.note).slice(0, 8000) : null
  if (patch.conversation_id !== undefined) clean.conversation_id = asUuid(patch.conversation_id)
  if (patch.message_id !== undefined) clean.message_id = asUuid(patch.message_id)

  return unwrap(await supabase.from('ai_feedback').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteAiFeedback(id) {
  return unwrap(await supabase.from('ai_feedback').delete().eq('id', id))
}
