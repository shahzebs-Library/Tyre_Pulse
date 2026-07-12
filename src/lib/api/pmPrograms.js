/**
 * PM Programs service (V163) — preventive-maintenance programs defined against
 * an asset or asset-type with a recurring service interval and next-due date.
 * RLS enforces org isolation (read for any member; write for Admin/Manager/
 * Director). This layer keeps an explicit column list (least-privilege select)
 * and null-safe country scoping, mirroring certifications.js / support.js.
 *
 * When the table has not been migrated yet, the lister degrades to [] so the
 * page can surface an "apply MIGRATIONS_V163_PM_PROGRAMS.sql" hint instead of
 * throwing.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,name,asset_no,asset_type,interval_type,interval_value,' +
  'last_done,next_due,site,status,notes,created_by,created_at,updated_at'

export const PM_STATUS_VALUES = ['active', 'paused', 'completed']
export const PM_INTERVAL_VALUES = ['km', 'hours', 'days', 'months']

/** True when a Supabase error means the table/relation is not deployed yet. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

/**
 * List PM programs (soonest next_due first). Optional country / status filters.
 * Returns [] when the table is missing so the UI can prompt for the migration
 * rather than error.
 */
export async function listPmPrograms({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('pm_programs').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('next_due', { ascending: true, nullsFirst: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getPmProgram(id) {
  return unwrap(await supabase.from('pm_programs').select(COLS).eq('id', id).maybeSingle())
}

/** Create a PM program. `name` is required. */
export async function createPmProgram(values = {}) {
  const name = String(values.name || '').trim()
  if (!name) throw new Error('A program name is required.')
  const intervalType = PM_INTERVAL_VALUES.includes(values.interval_type) ? values.interval_type : 'months'
  const status = PM_STATUS_VALUES.includes(values.status) ? values.status : 'active'
  const intervalValue = values.interval_value === '' || values.interval_value == null
    ? null
    : Number(values.interval_value)
  const payload = {
    name: name.slice(0, 200),
    asset_no: values.asset_no ? String(values.asset_no).slice(0, 120) : null,
    asset_type: values.asset_type ? String(values.asset_type).slice(0, 120) : null,
    interval_type: intervalType,
    interval_value: Number.isFinite(intervalValue) ? intervalValue : null,
    last_done: values.last_done || null,
    next_due: values.next_due || null,
    site: values.site ? String(values.site).slice(0, 120) : null,
    status,
    notes: values.notes ? String(values.notes).slice(0, 4000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('pm_programs').insert(payload).select(COLS).single())
}

/** Patch a PM program. Immutable columns are stripped before update. */
export async function updatePmProgram(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.created_by
  delete clean.organisation_id
  if (clean.interval_type != null && !PM_INTERVAL_VALUES.includes(clean.interval_type)) delete clean.interval_type
  if (clean.status != null && !PM_STATUS_VALUES.includes(clean.status)) delete clean.status
  if (clean.name != null) {
    const name = String(clean.name).trim()
    if (!name) throw new Error('A program name is required.')
    clean.name = name.slice(0, 200)
  }
  if ('interval_value' in clean) {
    if (clean.interval_value === '' || clean.interval_value == null) clean.interval_value = null
    else {
      const n = Number(clean.interval_value)
      clean.interval_value = Number.isFinite(n) ? n : null
    }
  }
  if ('last_done' in clean && !clean.last_done) clean.last_done = null
  if ('next_due' in clean && !clean.next_due) clean.next_due = null
  return unwrap(await supabase.from('pm_programs').update(clean).eq('id', id).select(COLS).single())
}

export async function deletePmProgram(id) {
  return unwrap(await supabase.from('pm_programs').delete().eq('id', id))
}
