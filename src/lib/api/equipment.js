/**
 * Equipment service — the single seam between the Tool & Equipment Registry
 * page (/equipment) and Supabase (table `equipment`, V150). Keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, and input
 * validation. RLS enforces org isolation and the read/write role split; this
 * layer never trusts client input blindly.
 *
 * Mirrors telematicsDevices.js / support.js. A missing `equipment` relation
 * (org has not run the migration) degrades listing to an empty array so the
 * page can render its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'
import { EQUIPMENT_STATUSES } from '../equipment'

export const COLS =
  'id,organisation_id,country,name,equipment_type,serial_no,site,condition,' +
  'calibration_due,status,notes,created_by,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('equipment'))
  )
}

/** Normalise a form value to a trimmed string (or null) with a max length. */
function str(v, max) {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  return max ? s.slice(0, max) : s
}

/**
 * List equipment (newest first). Optional `status` and `country` filters.
 * Returns [] when the table has not been provisioned yet.
 */
export async function listEquipment({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('equipment').select(COLS)
    if (status && EQUIPMENT_STATUSES.includes(status)) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * List EVERY equipment row (transparently paging past the PostgREST 1000-row
 * cap) so registry analytics reflect the full set, not just the first page.
 * Country-scoped like listEquipment. Returns [] when the table is not
 * provisioned yet. `max` guards against runaway pulls.
 */
export async function listAllEquipment({ country, max = 20000 } = {}) {
  try {
    const { data, error } = await fetchAllPages(
      (from, to) => applyCountry(supabase.from('equipment').select(COLS), country)
        .order('created_at', { ascending: false })
        .range(from, to),
      { max },
    )
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getEquipment(id) {
  return unwrap(await supabase.from('equipment').select(COLS).eq('id', id).maybeSingle())
}

/** Build a clean, typed insert payload from raw form values. */
function toPayload(values = {}) {
  const status = EQUIPMENT_STATUSES.includes(values.status) ? values.status : 'available'
  return {
    name: str(values.name, 200),
    equipment_type: str(values.equipment_type, 120),
    serial_no: str(values.serial_no, 120),
    site: str(values.site, 200),
    condition: str(values.condition, 120),
    calibration_due: values.calibration_due ? String(values.calibration_due).slice(0, 10) : null,
    status,
    notes: str(values.notes, 4000),
    country: values.country ?? null,
  }
}

/** Register a piece of equipment. Requires a non-empty name. */
export async function createEquipment(values = {}) {
  const name = str(values.name, 200)
  if (!name) throw new Error('An equipment name is required.')
  const payload = toPayload({ ...values, name })
  return unwrap(await supabase.from('equipment').insert(payload).select(COLS).single())
}

/** Patch an item. Re-validates name when supplied; strips immutable fields. */
export async function updateEquipment(id, patch = {}) {
  const clean = {}
  if (patch.name !== undefined) {
    const name = str(patch.name, 200)
    if (!name) throw new Error('An equipment name is required.')
    clean.name = name
  }
  if (patch.equipment_type !== undefined) clean.equipment_type = str(patch.equipment_type, 120)
  if (patch.serial_no !== undefined) clean.serial_no = str(patch.serial_no, 120)
  if (patch.site !== undefined) clean.site = str(patch.site, 200)
  if (patch.condition !== undefined) clean.condition = str(patch.condition, 120)
  if (patch.calibration_due !== undefined) clean.calibration_due = patch.calibration_due ? String(patch.calibration_due).slice(0, 10) : null
  if (patch.status !== undefined) clean.status = EQUIPMENT_STATUSES.includes(patch.status) ? patch.status : 'available'
  if (patch.notes !== undefined) clean.notes = str(patch.notes, 4000)
  if (patch.country !== undefined) clean.country = patch.country ?? null
  return unwrap(await supabase.from('equipment').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteEquipment(id) {
  return unwrap(await supabase.from('equipment').delete().eq('id', id))
}
