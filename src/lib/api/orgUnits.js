/**
 * Organization Units service — the single seam between the Organization
 * Hierarchy page (/org-hierarchy) and Supabase (tables `org_units` and
 * `user_org_assignments`, V206). Keeps explicit column lists (least-privilege
 * selects) and input validation. RLS enforces org isolation and elevated-role
 * writes; this layer never trusts client input blindly and guards re-parenting
 * cycles before they reach the database.
 *
 * Mirrors fleetGroups.js / odometerLogs.js. A missing relation (org has not run
 * the migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap } from './_client'
import { buildTree, descendantsOf } from '../orgUnits'

export const COLS =
  'id,organisation_id,parent_id,unit_type,name,code,country,site_ref,' +
  'active,sort_order,notes,created_by,created_at,updated_at'

export const ASSIGNMENT_COLS =
  'id,organisation_id,user_id,org_unit_id,role,is_primary,starts_at,ends_at,' +
  'created_by,created_at,updated_at'

/** Allowed unit_type values — mirrors the CHECK constraint in V206. */
export const UNIT_TYPES = [
  'company', 'country', 'region', 'branch', 'project',
  'site', 'workshop', 'department', 'team',
]

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && (msg.includes('org_units') || msg.includes('user_org_assignments')))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asType = (v) => {
  const t = asText(v, 40)
  return t && UNIT_TYPES.includes(t) ? t : null
}
const asInt = (v, field) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number.`)
  return Math.round(n)
}
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// ── Units ──────────────────────────────────────────────────────────────────

/**
 * List units (sort_order asc, then name asc, then created_at desc). Returns []
 * when the table has not been provisioned yet.
 * @param {{ limit?:number }} [opts]
 */
export async function listUnits({ limit = 1000 } = {}) {
  try {
    return unwrap(
      await supabase
        .from('org_units')
        .select(COLS)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getUnit(id) {
  return unwrap(await supabase.from('org_units').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a unit. Requires a name and a valid unit_type. A unit cannot be its
 * own parent (guarded here and by the DB CHECK).
 */
export async function createUnit(values = {}) {
  const name = asText(values.name, 200)
  if (!name) throw new Error('A unit name is required.')
  const unit_type = asType(values.unit_type)
  if (!unit_type) throw new Error('A valid unit type is required.')

  const parent_id = asText(values.parent_id, 100)
  // A brand-new row has no id yet, so self-parenting is only possible if the
  // caller passed an explicit id equal to parent_id.
  if (parent_id && values.id && String(values.id) === parent_id) {
    throw new Error('A unit cannot be its own parent.')
  }

  const payload = {
    name,
    unit_type,
    parent_id: parent_id || null,
    code: asText(values.code, 60),
    country: asText(values.country, 120),
    site_ref: asText(values.site_ref, 200),
    active: values.active === undefined || values.active === null ? true : Boolean(values.active),
    sort_order: asInt(values.sort_order, 'Sort order'),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
  }
  return unwrap(await supabase.from('org_units').insert(payload).select(COLS).single())
}

/**
 * Patch a unit. Strips immutable/ownership fields; coerces each field present.
 * Re-parenting is cycle-guarded: the new parent may not be the unit itself nor
 * any of its current descendants (which would orphan a subtree into a loop).
 * Pass `allRows` (the current unit set) so the guard can resolve descendants;
 * without it, only the self-parent check is enforced.
 */
export async function updateUnit(id, patch = {}, allRows) {
  const clean = {}
  if (patch.name !== undefined) {
    const name = asText(patch.name, 200)
    if (!name) throw new Error('A unit name is required.')
    clean.name = name
  }
  if (patch.unit_type !== undefined) {
    const unit_type = asType(patch.unit_type)
    if (!unit_type) throw new Error('A valid unit type is required.')
    clean.unit_type = unit_type
  }
  if (patch.parent_id !== undefined) {
    const parent_id = asText(patch.parent_id, 100)
    if (parent_id) {
      if (parent_id === String(id)) throw new Error('A unit cannot be its own parent.')
      if (Array.isArray(allRows)) {
        const banned = new Set(descendantsOf(allRows, id))
        if (banned.has(parent_id)) {
          throw new Error('A unit cannot be re-parented under one of its own descendants.')
        }
      }
    }
    clean.parent_id = parent_id || null
  }
  if (patch.code !== undefined) clean.code = asText(patch.code, 60)
  if (patch.country !== undefined) clean.country = asText(patch.country, 120)
  if (patch.site_ref !== undefined) clean.site_ref = asText(patch.site_ref, 200)
  if (patch.active !== undefined) clean.active = Boolean(patch.active)
  if (patch.sort_order !== undefined) clean.sort_order = asInt(patch.sort_order, 'Sort order')
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null

  return unwrap(await supabase.from('org_units').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteUnit(id) {
  return unwrap(await supabase.from('org_units').delete().eq('id', id))
}

// ── Assignments ────────────────────────────────────────────────────────────

/**
 * List user→unit assignments, optionally scoped to a single unit. Returns []
 * when the table has not been provisioned yet.
 * @param {{ unitId?:string, limit?:number }} [opts]
 */
export async function listAssignments({ unitId, limit = 1000 } = {}) {
  try {
    let q = supabase.from('user_org_assignments').select(ASSIGNMENT_COLS)
    if (unitId) q = q.eq('org_unit_id', unitId)
    return unwrap(
      await q
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Assign a user to a unit. Requires both user_id and org_unit_id. Effective
 * date bounds are optional (open-ended when omitted).
 */
export async function createAssignment(values = {}) {
  const user_id = asText(values.user_id, 100)
  if (!user_id) throw new Error('A user is required.')
  const org_unit_id = asText(values.org_unit_id, 100)
  if (!org_unit_id) throw new Error('A unit is required.')

  const payload = {
    user_id,
    org_unit_id,
    role: asText(values.role, 80),
    is_primary: Boolean(values.is_primary),
    starts_at: asDate(values.starts_at),
    ends_at: asDate(values.ends_at),
  }
  return unwrap(
    await supabase.from('user_org_assignments').insert(payload).select(ASSIGNMENT_COLS).single(),
  )
}

/** Patch an assignment. Strips immutable/ownership fields; coerces present fields. */
export async function updateAssignment(id, patch = {}) {
  const clean = {}
  if (patch.user_id !== undefined) {
    const user_id = asText(patch.user_id, 100)
    if (!user_id) throw new Error('A user is required.')
    clean.user_id = user_id
  }
  if (patch.org_unit_id !== undefined) {
    const org_unit_id = asText(patch.org_unit_id, 100)
    if (!org_unit_id) throw new Error('A unit is required.')
    clean.org_unit_id = org_unit_id
  }
  if (patch.role !== undefined) clean.role = asText(patch.role, 80)
  if (patch.is_primary !== undefined) clean.is_primary = Boolean(patch.is_primary)
  if (patch.starts_at !== undefined) clean.starts_at = asDate(patch.starts_at)
  if (patch.ends_at !== undefined) clean.ends_at = asDate(patch.ends_at)

  return unwrap(
    await supabase.from('user_org_assignments').update(clean).eq('id', id).select(ASSIGNMENT_COLS).single(),
  )
}

export async function deleteAssignment(id) {
  return unwrap(await supabase.from('user_org_assignments').delete().eq('id', id))
}

// Re-export tree helpers used by the page from the pure module for convenience.
export { buildTree, descendantsOf }
