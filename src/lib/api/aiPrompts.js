/**
 * AI Prompts service — the seam between the AI Administration page
 * (/ai-administration, Prompts tab) and Supabase (table `ai_prompts`, V205).
 *
 * Versioned agent system-prompts. Configuration/audit only: the edge functions
 * and client agents keep their own hardcoded SYSTEM_PROMPT as the authoritative
 * runtime value, so an empty catalogue never changes AI behaviour.
 *
 * Mirrors odometerLogs.js: explicit columns, missing-relation → [], locale
 * whitelisted, version coerced to a positive integer.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../aiAdmin'

export const COLS =
  'id,organisation_id,agent,name,system_prompt,locale,version,active,notes,' +
  'created_by,created_at,updated_at'

export const LOCALES = ['en', 'ar']

function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' || code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('ai_prompts'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))

function asLocale(v) {
  if (v == null || v === '') return 'en'
  const l = String(v).trim().toLowerCase()
  if (!LOCALES.includes(l)) throw new Error(`Locale must be one of: ${LOCALES.join(', ')}.`)
  return l
}

function asVersion(v) {
  if (v === '' || v == null) return 1
  const n = toFiniteNumber(v)
  if (n == null || n < 1) throw new Error('Version must be a positive integer.')
  return Math.round(n)
}

export async function listAiPrompts({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('ai_prompts').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('agent', { ascending: true, nullsFirst: false })
        .order('version', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getAiPrompt(id) {
  return unwrap(await supabase.from('ai_prompts').select(COLS).eq('id', id).maybeSingle())
}

export async function createAiPrompt(values = {}) {
  const agent = asText(values.agent, 120)
  if (!agent) throw new Error('An agent identifier is required.')
  const system_prompt = values.system_prompt == null ? '' : String(values.system_prompt).trim()
  if (!system_prompt) throw new Error('A system prompt is required.')

  const payload = {
    agent,
    name: asText(values.name, 200),
    system_prompt: system_prompt.slice(0, 20000),
    locale: asLocale(values.locale),
    version: asVersion(values.version),
    active: values.active !== false,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
  }
  return unwrap(await supabase.from('ai_prompts').insert(payload).select(COLS).single())
}

export async function updateAiPrompt(id, patch = {}) {
  const clean = {}
  if (patch.agent !== undefined) {
    const agent = asText(patch.agent, 120)
    if (!agent) throw new Error('An agent identifier is required.')
    clean.agent = agent
  }
  if (patch.name !== undefined) clean.name = asText(patch.name, 200)
  if (patch.system_prompt !== undefined) {
    const sp = patch.system_prompt == null ? '' : String(patch.system_prompt).trim()
    if (!sp) throw new Error('A system prompt is required.')
    clean.system_prompt = sp.slice(0, 20000)
  }
  if (patch.locale !== undefined) clean.locale = asLocale(patch.locale)
  if (patch.version !== undefined) clean.version = asVersion(patch.version)
  if (patch.active !== undefined) clean.active = patch.active !== false
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null

  return unwrap(await supabase.from('ai_prompts').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteAiPrompt(id) {
  return unwrap(await supabase.from('ai_prompts').delete().eq('id', id))
}
