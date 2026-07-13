/**
 * AI Models service — the single seam between the AI Administration page
 * (/ai-administration, Models tab) and Supabase (table `ai_models`, V205).
 *
 * Admin-managed model catalogue + pricing (USD per 1M tokens). This is
 * configuration/audit data only: the edge functions keep their own hardcoded
 * model + pricing as the authoritative runtime fallback, so an empty or
 * unprovisioned catalogue never changes AI behaviour.
 *
 * Mirrors odometerLogs.js: explicit least-privilege columns, missing-relation
 * degrades listing to [] (page shows its "apply the migration" state), and
 * every write is validated (non-negative numerics) before it reaches the DB.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../aiAdmin'

export const COLS =
  'id,organisation_id,key,provider,model_id,input_price,output_price,max_tokens,' +
  'active,is_default,notes,created_by,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' || code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('ai_models'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))

/** Validate a price/token value: null when blank, else a non-negative number. */
function asNonNegative(v, label) {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/** List models (defaults first, then newest). Returns [] pre-migration. */
export async function listAiModels({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('ai_models').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getAiModel(id) {
  return unwrap(await supabase.from('ai_models').select(COLS).eq('id', id).maybeSingle())
}

export async function createAiModel(values = {}) {
  const key = asText(values.key, 120)
  if (!key) throw new Error('A model key is required.')

  const payload = {
    key,
    provider: asText(values.provider, 120),
    model_id: asText(values.model_id, 200),
    input_price: asNonNegative(values.input_price, 'Input price'),
    output_price: asNonNegative(values.output_price, 'Output price'),
    max_tokens: values.max_tokens === '' || values.max_tokens == null
      ? null
      : (() => {
          const n = asNonNegative(values.max_tokens, 'Max tokens')
          return n == null ? null : Math.round(n)
        })(),
    active: values.active !== false,
    is_default: values.is_default === true,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
  }
  return unwrap(await supabase.from('ai_models').insert(payload).select(COLS).single())
}

export async function updateAiModel(id, patch = {}) {
  const clean = {}
  if (patch.key !== undefined) {
    const key = asText(patch.key, 120)
    if (!key) throw new Error('A model key is required.')
    clean.key = key
  }
  if (patch.provider !== undefined) clean.provider = asText(patch.provider, 120)
  if (patch.model_id !== undefined) clean.model_id = asText(patch.model_id, 200)
  if (patch.input_price !== undefined) clean.input_price = asNonNegative(patch.input_price, 'Input price')
  if (patch.output_price !== undefined) clean.output_price = asNonNegative(patch.output_price, 'Output price')
  if (patch.max_tokens !== undefined) {
    const n = asNonNegative(patch.max_tokens, 'Max tokens')
    clean.max_tokens = n == null ? null : Math.round(n)
  }
  if (patch.active !== undefined) clean.active = patch.active !== false
  if (patch.is_default !== undefined) clean.is_default = patch.is_default === true
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null

  return unwrap(await supabase.from('ai_models').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteAiModel(id) {
  return unwrap(await supabase.from('ai_models').delete().eq('id', id))
}
