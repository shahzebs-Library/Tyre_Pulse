/**
 * Onboarding Wizard service — the single seam between the Onboarding Wizard page
 * (/onboarding) and Supabase (table `onboarding_tasks`, V199). Keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, and input
 * validation. RLS enforces org isolation; this layer never trusts client input
 * blindly.
 *
 * Mirrors odometerLogs.js. A missing `onboarding_tasks` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../onboarding'

export const COLS =
  'id,organisation_id,country,phase,title,description,sort_order,required,status,' +
  'owner,due_date,completed_at,help_url,notes,created_by,created_at,updated_at'

const PHASES = ['setup', 'data_import', 'configuration', 'team', 'integration', 'go_live']
const STATUSES = ['not_started', 'in_progress', 'completed', 'skipped', 'blocked']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('onboarding_tasks'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
/** Coerce a variety of truthy/falsy inputs to a strict boolean. */
const asBool = (v) => {
  if (typeof v === 'boolean') return v
  if (v == null || v === '') return true // default-required
  const s = String(v).trim().toLowerCase()
  return !(s === 'false' || s === '0' || s === 'no' || s === 'off')
}
const asPhase = (v) => {
  const s = asText(v, 40)
  return s && PHASES.includes(s) ? s : null
}
const asStatus = (v) => {
  const s = asText(v, 40)
  return s && STATUSES.includes(s) ? s : null
}

/**
 * List onboarding tasks (checklist order: sort_order asc, then created_at asc).
 * Optional `country` filter. Returns [] when the table has not been
 * provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listOnboardingTasks({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('onboarding_tasks').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('sort_order', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getOnboardingTask(id) {
  return unwrap(await supabase.from('onboarding_tasks').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a task. Requires a title. Phase and status are whitelisted; sort_order
 * (when supplied) must be a non-negative number; `required` is coerced to a
 * strict boolean. `completed_at` is stamped when the task is created already
 * completed.
 */
export async function createOnboardingTask(values = {}) {
  const title = asText(values.title, 300)
  if (!title) throw new Error('A task title is required.')

  let sort_order = 0
  if (values.sort_order !== undefined && values.sort_order !== null && values.sort_order !== '') {
    const n = toFiniteNumber(values.sort_order)
    if (n == null) throw new Error('Sort order must be a number.')
    if (n < 0) throw new Error('Sort order cannot be negative.')
    sort_order = Math.round(n)
  }

  const status = asStatus(values.status) || 'not_started'

  const payload = {
    title,
    phase: asPhase(values.phase) || 'setup',
    description: values.description ? String(values.description).slice(0, 8000) : null,
    sort_order,
    required: asBool(values.required),
    status,
    owner: asText(values.owner, 200),
    due_date: asDate(values.due_date),
    completed_at: status === 'completed'
      ? (values.completed_at ? new Date(values.completed_at).toISOString() : new Date().toISOString())
      : null,
    help_url: asText(values.help_url, 1000),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('onboarding_tasks').insert(payload).select(COLS).single())
}

/**
 * Patch a task. Strips immutable/ownership fields; coerces each field present so
 * the stored value never drifts from the validated shape. Transitioning status
 * to/from 'completed' maintains completed_at automatically unless the caller
 * supplies it explicitly.
 */
export async function updateOnboardingTask(id, patch = {}) {
  const clean = {}

  if (patch.title !== undefined) {
    const title = asText(patch.title, 300)
    if (!title) throw new Error('A task title is required.')
    clean.title = title
  }
  if (patch.phase !== undefined) {
    const phase = asPhase(patch.phase)
    if (!phase) throw new Error('Invalid phase.')
    clean.phase = phase
  }
  if (patch.description !== undefined) {
    clean.description = patch.description ? String(patch.description).slice(0, 8000) : null
  }
  if (patch.sort_order !== undefined) {
    if (patch.sort_order === null || patch.sort_order === '') {
      clean.sort_order = 0
    } else {
      const n = toFiniteNumber(patch.sort_order)
      if (n == null) throw new Error('Sort order must be a number.')
      if (n < 0) throw new Error('Sort order cannot be negative.')
      clean.sort_order = Math.round(n)
    }
  }
  if (patch.required !== undefined) clean.required = asBool(patch.required)
  if (patch.status !== undefined) {
    const status = asStatus(patch.status)
    if (!status) throw new Error('Invalid status.')
    clean.status = status
    if (patch.completed_at === undefined) {
      clean.completed_at = status === 'completed' ? new Date().toISOString() : null
    }
  }
  if (patch.completed_at !== undefined) {
    clean.completed_at = patch.completed_at ? new Date(patch.completed_at).toISOString() : null
  }
  if (patch.owner !== undefined) clean.owner = asText(patch.owner, 200)
  if (patch.due_date !== undefined) clean.due_date = asDate(patch.due_date)
  if (patch.help_url !== undefined) clean.help_url = asText(patch.help_url, 1000)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('onboarding_tasks').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteOnboardingTask(id) {
  return unwrap(await supabase.from('onboarding_tasks').delete().eq('id', id))
}
