/**
 * AI Budgets service — the seam between the AI Administration page
 * (/ai-administration, Budgets tab) and Supabase (table `ai_budgets`, V205).
 *
 * Admin-managed token / cost budget caps per period. Configuration only: the
 * edge functions keep their own hardcoded rate limits as the authoritative
 * runtime guard, so these caps do not (yet) change AI behaviour — they surface
 * intended limits and utilisation against real usage in the admin UI.
 *
 * Mirrors odometerLogs.js: explicit columns, missing-relation → [], period
 * whitelisted, non-negative caps.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../aiAdmin'

export const COLS =
  'id,organisation_id,period,token_cap,cost_cap_usd,hard_stop,scope,active,notes,' +
  'created_by,created_at,updated_at'

export const PERIODS = ['daily', 'weekly', 'monthly']

function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' || code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('ai_budgets'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))

function asPeriod(v) {
  if (v == null || v === '') return 'monthly'
  const p = String(v).trim().toLowerCase()
  if (!PERIODS.includes(p)) throw new Error(`Period must be one of: ${PERIODS.join(', ')}.`)
  return p
}

function asNonNegative(v, label, integer = false) {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return integer ? Math.round(n) : n
}

export async function listAiBudgets({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('ai_budgets').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('active', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getAiBudget(id) {
  return unwrap(await supabase.from('ai_budgets').select(COLS).eq('id', id).maybeSingle())
}

export async function createAiBudget(values = {}) {
  const payload = {
    period: asPeriod(values.period),
    token_cap: asNonNegative(values.token_cap, 'Token cap', true),
    cost_cap_usd: asNonNegative(values.cost_cap_usd, 'Cost cap'),
    hard_stop: values.hard_stop === true,
    scope: asText(values.scope, 200),
    active: values.active !== false,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
  }
  return unwrap(await supabase.from('ai_budgets').insert(payload).select(COLS).single())
}

export async function updateAiBudget(id, patch = {}) {
  const clean = {}
  if (patch.period !== undefined) clean.period = asPeriod(patch.period)
  if (patch.token_cap !== undefined) clean.token_cap = asNonNegative(patch.token_cap, 'Token cap', true)
  if (patch.cost_cap_usd !== undefined) clean.cost_cap_usd = asNonNegative(patch.cost_cap_usd, 'Cost cap')
  if (patch.hard_stop !== undefined) clean.hard_stop = patch.hard_stop === true
  if (patch.scope !== undefined) clean.scope = asText(patch.scope, 200)
  if (patch.active !== undefined) clean.active = patch.active !== false
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null

  return unwrap(await supabase.from('ai_budgets').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteAiBudget(id) {
  return unwrap(await supabase.from('ai_budgets').delete().eq('id', id))
}
