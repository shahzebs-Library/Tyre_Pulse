/**
 * Holding Company service — the single seam between the group consolidation
 * page (/holding-company) and Supabase. Wraps the org-scoped RPCs
 * (`holding_consolidated_kpis`, `holding_subsidiaries`, `holding_link_subsidiary`,
 * `holding_unlink_subsidiary`) and the `holding_transfers` table.
 *
 * Mirrors odometerLogs.js: explicit column list (least-privilege select),
 * null-safe country scoping, input validation, and a missing-relation guard so
 * a pre-migration org degrades to an empty list instead of erroring. RLS + the
 * SECURITY DEFINER RPCs enforce org isolation and role gating; this layer never
 * trusts client input blindly and maps every server error code to a friendly
 * message.
 */
import { supabase, unwrap, applyCountry, ServiceError } from './_client'
import { toFiniteNumber } from '../holdingCompany'

export const TRANSFER_COLS =
  'id,organisation_id,country,from_org_id,to_org_id,asset_type,asset_ref,' +
  'quantity,status,notes,created_by,created_at,updated_at'

const ASSET_TYPES = ['tyre', 'vehicle', 'part', 'other']
const TRANSFER_STATUSES = ['pending', 'in_transit', 'received', 'cancelled']

/** True when the failure is "table/function does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('could not find the function') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('holding_'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))

/** Empty consolidated shape — rendered when the group is not provisioned. */
function emptyDashboard(parentId = null) {
  return {
    parent_id: parentId,
    subsidiary_count: 0,
    grand_total: {
      vehicles: 0, tyres: 0, alerts: 0, critical_alerts: 0, low_tread: 0, spend_30d: 0,
    },
    subsidiaries: [],
  }
}

/** Coerce the server jsonb into the normalized dashboard shape the UI expects. */
function normalizeDashboard(data) {
  const d = data || {}
  const gt = d.grand_total || {}
  return {
    parent_id: d.parent_id ?? null,
    subsidiary_count: toFiniteNumber(d.subsidiary_count) ?? 0,
    grand_total: {
      vehicles: toFiniteNumber(gt.vehicles) ?? 0,
      tyres: toFiniteNumber(gt.tyres) ?? 0,
      alerts: toFiniteNumber(gt.alerts) ?? 0,
      critical_alerts: toFiniteNumber(gt.critical_alerts) ?? 0,
      low_tread: toFiniteNumber(gt.low_tread) ?? 0,
      spend_30d: toFiniteNumber(gt.spend_30d) ?? 0,
    },
    subsidiaries: Array.isArray(d.subsidiaries) ? d.subsidiaries : [],
  }
}

/**
 * Consolidated group KPIs for the caller's parent org. Returns a normalized
 * dashboard object. A `forbidden` result raises a ServiceError; `no_org` /
 * missing / pre-migration degrade to an empty (not-provisioned) dashboard so
 * the page can render its link-a-subsidiary CTA.
 */
export async function getConsolidatedKpis() {
  let data
  try {
    data = unwrap(await supabase.rpc('holding_consolidated_kpis'))
  } catch (err) {
    if (isMissingRelation(err)) return emptyDashboard()
    throw err
  }
  if (data && data.error) {
    if (data.error === 'forbidden') {
      throw new ServiceError('You do not have permission to view group consolidation.', 'forbidden')
    }
    // no_org or any other non-fatal signal → treat as not provisioned.
    return emptyDashboard()
  }
  return normalizeDashboard(data)
}

/** All organisations linked as subsidiaries of the caller's parent org. */
export async function listSubsidiaries() {
  try {
    return unwrap(await supabase.rpc('holding_subsidiaries')) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Friendly messages for every documented link/unlink error code. */
const LINK_ERRORS = {
  forbidden: 'You do not have permission to manage subsidiaries.',
  not_found: 'No organisation was found for that slug.',
  already_linked: 'That organisation is already a subsidiary.',
  consent_required: 'That organisation has not opted in to being linked.',
  would_create_cycle: 'Linking that organisation would create a circular ownership loop.',
  cannot_link_self: 'An organisation cannot be linked to itself.',
}
const UNLINK_ERRORS = {
  forbidden: 'You do not have permission to manage subsidiaries.',
  not_a_subsidiary: 'That organisation is not a subsidiary of your group.',
}

/**
 * Link an organisation (by its slug) as a subsidiary of the caller's group.
 * Resolves to `{ ok, linked, name }`; throws a friendly Error on any server
 * error code.
 */
export async function linkSubsidiary(slug) {
  const p_slug = asText(slug, 200)
  if (!p_slug) throw new Error('A subsidiary organisation slug is required.')
  const data = unwrap(await supabase.rpc('holding_link_subsidiary', { p_slug }))
  if (data && data.error) {
    throw new Error(LINK_ERRORS[data.error] || 'Could not link that organisation.')
  }
  return data
}

/** Unlink a subsidiary from the group. Resolves to `{ ok, unlinked }`. */
export async function unlinkSubsidiary(childId) {
  const p_child = asText(childId, 200)
  if (!p_child) throw new Error('A subsidiary organisation id is required.')
  const data = unwrap(await supabase.rpc('holding_unlink_subsidiary', { p_child }))
  if (data && data.error) {
    throw new Error(UNLINK_ERRORS[data.error] || 'Could not unlink that organisation.')
  }
  return data
}

// ── Inter-company asset transfers (holding_transfers) ────────────────────────

/**
 * List transfers (newest first). Optional `country` filter. Returns [] when
 * the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listTransfers({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('holding_transfers').select(TRANSFER_COLS)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getTransfer(id) {
  return unwrap(await supabase.from('holding_transfers').select(TRANSFER_COLS).eq('id', id).maybeSingle())
}

/**
 * Record an inter-company asset transfer. Requires distinct from/to orgs, a
 * whitelisted asset type/status, and a non-negative quantity.
 */
export async function createTransfer(values = {}) {
  const from_org_id = asText(values.from_org_id, 200)
  const to_org_id = asText(values.to_org_id, 200)
  if (!from_org_id || !to_org_id) throw new Error('Both a source and destination organisation are required.')
  if (from_org_id === to_org_id) throw new Error('Source and destination organisations must differ.')

  const asset_type = ASSET_TYPES.includes(values.asset_type) ? values.asset_type : 'other'
  const status = TRANSFER_STATUSES.includes(values.status) ? values.status : 'pending'

  const quantity = values.quantity === '' || values.quantity == null ? 1 : toFiniteNumber(values.quantity)
  if (quantity == null) throw new Error('Quantity must be a number.')
  if (quantity < 0) throw new Error('Quantity cannot be negative.')

  const payload = {
    from_org_id,
    to_org_id,
    asset_type,
    asset_ref: asText(values.asset_ref, 200),
    quantity,
    status,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('holding_transfers').insert(payload).select(TRANSFER_COLS).single())
}

/**
 * Patch a transfer. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape.
 */
export async function updateTransfer(id, patch = {}) {
  const clean = {}
  if (patch.from_org_id !== undefined) {
    const v = asText(patch.from_org_id, 200)
    if (!v) throw new Error('A source organisation is required.')
    clean.from_org_id = v
  }
  if (patch.to_org_id !== undefined) {
    const v = asText(patch.to_org_id, 200)
    if (!v) throw new Error('A destination organisation is required.')
    clean.to_org_id = v
  }
  if (clean.from_org_id && clean.to_org_id && clean.from_org_id === clean.to_org_id) {
    throw new Error('Source and destination organisations must differ.')
  }
  if (patch.asset_type !== undefined) {
    if (!ASSET_TYPES.includes(patch.asset_type)) throw new Error('Invalid asset type.')
    clean.asset_type = patch.asset_type
  }
  if (patch.status !== undefined) {
    if (!TRANSFER_STATUSES.includes(patch.status)) throw new Error('Invalid transfer status.')
    clean.status = patch.status
  }
  if (patch.asset_ref !== undefined) clean.asset_ref = asText(patch.asset_ref, 200)
  if (patch.quantity !== undefined) {
    const q = toFiniteNumber(patch.quantity)
    if (q == null) throw new Error('Quantity must be a number.')
    if (q < 0) throw new Error('Quantity cannot be negative.')
    clean.quantity = q
  }
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('holding_transfers').update(clean).eq('id', id).select(TRANSFER_COLS).single())
}

export async function deleteTransfer(id) {
  return unwrap(await supabase.from('holding_transfers').delete().eq('id', id))
}
