/**
 * Action Center service — the single seam between the Action Center page
 * (/action-center) and Supabase (table `action_items`, V186). Keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, enum
 * whitelisting, and input validation. RLS enforces org isolation; this layer
 * never trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `action_items` relation (org has not run
 * the migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../actionCenter'

export const COLS =
  'id,organisation_id,country,title,category,source,asset_no,severity,' +
  'priority_score,assigned_to,due_date,status,impact,recommended_action,' +
  'resolution,notes,created_by,created_at,updated_at,assigned_user_id,site,' +
  'shift_id,blocked_reason,escalated_reason,escalated_at,escalated_by,' +
  'sla_due_at,sla_breached_at,approval_status,approval_requested_at,' +
  'approval_requested_by,approved_at,approved_by,approval_note,completed_at'

const LEGACY_COLS =
  'id,organisation_id,country,title,category,source,asset_no,severity,' +
  'priority_score,assigned_to,due_date,status,impact,recommended_action,' +
  'resolution,notes,created_by,created_at,updated_at'

// Enum whitelists — mirror the CHECK constraints in MIGRATIONS_V186. Any value
// outside these sets is coerced to null so a bad client payload can never write
// an invalid enum (and never trips the DB constraint at insert time).
const CATEGORIES = new Set([
  'safety', 'compliance', 'maintenance', 'cost', 'tyre', 'inspection', 'data_quality', 'other',
])
const SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical'])
const STATUSES = new Set(['open', 'acknowledged', 'in_progress', 'blocked', 'escalated', 'pending_approval', 'resolved', 'dismissed'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('action_items'))
  )
}

function isMissingAdvancedSchema(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return code === '42703' || code === 'PGRST204' || msg.includes('column') || msg.includes('schema cache')
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const asEnum = (v, allowed) => {
  const t = v == null ? '' : String(v).trim().toLowerCase()
  return allowed.has(t) ? t : null
}
const asLong = (v, max = 8000) => (v == null || v === '' ? null : String(v).slice(0, max))

/** Validate priority_score: must be numeric and non-negative when provided. */
function normPriority(v) {
  if (v == null || v === '') return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error('Priority score must be a number.')
  if (n < 0) throw new Error('Priority score cannot be negative.')
  return n
}

/**
 * List action items (newest first by created_at). Optional `country` filter.
 * Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listActionItems({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('action_items').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q.order('created_at', { ascending: false }).limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    if (isMissingAdvancedSchema(err)) {
      let q = supabase.from('action_items').select(LEGACY_COLS)
      q = applyCountry(q, country)
      return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
    }
    throw err
  }
}
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export async function getActionItem(id) {
  try {
    return unwrap(await supabase.from('action_items').select(COLS).eq('id', id).maybeSingle())
  } catch (err) {
    if (!isMissingAdvancedSchema(err)) throw err
    return unwrap(await supabase.from('action_items').select(LEGACY_COLS).eq('id', id).maybeSingle())
  }
}

/**
 * Raise an action item. Requires a title (what needs doing). Category, severity,
 * and status default sensibly and are whitelisted to the allowed enums. Priority
 * score, when supplied, must be a non-negative number.
 */
export async function createActionItem(values = {}) {
  const title = asText(values.title, 300)
  if (!title) throw new Error('A title is required.')

  const payload = {
    title,
    category: asEnum(values.category, CATEGORIES) || 'other',
    source: asText(values.source, 200),
    asset_no: asText(values.asset_no, 120),
    severity: asEnum(values.severity, SEVERITIES) || 'medium',
    priority_score: normPriority(values.priority_score),
    assigned_to: asText(values.assigned_to, 200),
    assigned_user_id: values.assigned_user_id || null,
    site: asText(values.site, 200),
    shift_id: values.shift_id || null,
    due_date: asDate(values.due_date),
    sla_due_at: asTimestamp(values.sla_due_at),
    status: asEnum(values.status, STATUSES) || 'open',
    impact: asLong(values.impact, 4000),
    recommended_action: asLong(values.recommended_action, 4000),
    resolution: asLong(values.resolution, 4000),
    notes: asLong(values.notes, 8000),
    country: values.country ?? null,
  }
  try {
    return unwrap(await supabase.from('action_items').insert(payload).select(COLS).single())
  } catch (err) {
    if (!isMissingAdvancedSchema(err)) throw err
    const legacy = Object.fromEntries(Object.entries(payload).filter(([key]) => LEGACY_COLS.split(',').includes(key)))
    return unwrap(await supabase.from('action_items').insert(legacy).select(LEGACY_COLS).single())
  }
}

/**
 * Patch an action item. Strips immutable/ownership fields (id, organisation_id,
 * created_by, created_at, updated_at) and coerces each supplied field so the
 * stored value never drifts from the validated shape.
 */
export async function updateActionItem(id, patch = {}) {
  const clean = {}
  if (patch.title !== undefined) {
    const title = asText(patch.title, 300)
    if (!title) throw new Error('A title is required.')
    clean.title = title
  }
  if (patch.category !== undefined) clean.category = asEnum(patch.category, CATEGORIES) || 'other'
  if (patch.source !== undefined) clean.source = asText(patch.source, 200)
  if (patch.asset_no !== undefined) clean.asset_no = asText(patch.asset_no, 120)
  if (patch.severity !== undefined) clean.severity = asEnum(patch.severity, SEVERITIES) || 'medium'
  if (patch.priority_score !== undefined) clean.priority_score = normPriority(patch.priority_score)
  if (patch.assigned_to !== undefined) clean.assigned_to = asText(patch.assigned_to, 200)
  if (patch.assigned_user_id !== undefined) clean.assigned_user_id = patch.assigned_user_id || null
  if (patch.site !== undefined) clean.site = asText(patch.site, 200)
  if (patch.shift_id !== undefined) clean.shift_id = patch.shift_id || null
  if (patch.sla_due_at !== undefined) clean.sla_due_at = asTimestamp(patch.sla_due_at)
  if (patch.due_date !== undefined) clean.due_date = asDate(patch.due_date)
  if (patch.status !== undefined) clean.status = asEnum(patch.status, STATUSES) || 'open'
  if (patch.impact !== undefined) clean.impact = asLong(patch.impact, 4000)
  if (patch.recommended_action !== undefined) clean.recommended_action = asLong(patch.recommended_action, 4000)
  if (patch.resolution !== undefined) clean.resolution = asLong(patch.resolution, 4000)
  if (patch.notes !== undefined) clean.notes = asLong(patch.notes, 8000)
  if (patch.country !== undefined) clean.country = patch.country ?? null

  try {
    return unwrap(await supabase.from('action_items').update(clean).eq('id', id).select(COLS).single())
  } catch (err) {
    if (!isMissingAdvancedSchema(err)) throw err
    const legacy = Object.fromEntries(Object.entries(clean).filter(([key]) => LEGACY_COLS.split(',').includes(key)))
    return unwrap(await supabase.from('action_items').update(legacy).eq('id', id).select(LEGACY_COLS).single())
  }
}

/**
 * Create once for a stable cross-module source key. The preflight makes normal
 * retries idempotent; production should additionally enforce a tenant-scoped
 * UNIQUE (organisation_id, source) constraint for concurrent producers.
 */
export async function ensureActionItem(values = {}) {
  const source = asText(values.source, 200)
  if (!source) throw new Error('A source key is required.')
  const existing = unwrap(await supabase.from('action_items').select(COLS).eq('source', source).maybeSingle())
  if (existing) return { item: existing, created: false }
  try {
    return { item: await createActionItem({ ...values, source }), created: true }
  } catch (error) {
    if (error?.code !== '23505' && error?.cause?.code !== '23505') throw error
    const item = unwrap(await supabase.from('action_items').select(COLS).eq('source', source).maybeSingle())
    return { item, created: false }
  }
}

/** Lifecycle changes are authorised, validated and audited by the database RPC. */
export async function transitionActionItem(id, status, { reason = null, resolution = null, approvalNote = null } = {}) {
  const next = asEnum(status, STATUSES)
  if (!next) throw new Error('Invalid action status.')
  const result = await supabase.rpc('transition_action_item', {
    p_action_item_id: id,
    p_to_status: next,
    p_reason: asLong(reason, 4000),
    p_resolution: asLong(resolution, 4000),
    p_approval_note: asLong(approvalNote, 4000),
  })
  if (!result.error) return Array.isArray(result.data) ? result.data[0] : result.data
  const msg = String(result.error.message || '').toLowerCase()
  // During a rolling deployment only, retain the original safe transitions.
  if ((result.error.code === 'PGRST202' || msg.includes('function')) && ['acknowledged', 'in_progress', 'resolved'].includes(next)) {
    return updateActionItem(id, { status: next, resolution })
  }
  throw result.error
}

export async function listActionItemHistory(actionItemId) {
  try {
    return unwrap(await supabase.from('action_item_history')
      .select('id,action_item_id,actor_id,event_type,from_status,to_status,reason,metadata,created_at')
      .eq('action_item_id', actionItemId).order('created_at', { ascending: false }).limit(200)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export function subscribeToActionItems(onChange, onStatus) {
  const channel = supabase.channel(`daily-ops-actions-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'action_items' }, onChange)
    .subscribe((status, err) => onStatus?.(status, err))
  return () => { supabase.removeChannel(channel) }
}

export async function deleteActionItem(id) {
  return unwrap(await supabase.from('action_items').delete().eq('id', id))
}
