/**
 * Brand / part-type review queue (service layer).
 *
 * Reads only. Every proposal is computed in the browser by the pure engine
 * src/lib/inventory/variantClassify.js from data already in the database.
 * Accepting a proposal goes through the EXISTING two-person writers, never a
 * direct table write:
 *   - brand on an item              -> inv_correction_request (canonical, field_update brand)
 *   - part type on an open variant  -> inv_correction_request (variant, field_update part_classification)
 *   - part type, item has no variant -> inv_material_variant_propose (with the evidence)
 * A second person then approves it in Corrections / variant approvals, so the
 * person who accepts here can never be the one who makes it final.
 *
 * Reads are bounded and paged with an `id` tiebreak (rowCapGuard).
 */
import { supabase, toServiceError, isNotProvisioned, isMissingColumn, fetchAllPages } from './_client'
import { requestCorrection, proposeVariant } from './physicalInventory'
import { buildBrandCatalogue, buildProposals, writePlan } from '../inventory/variantClassify'

const MAX_ITEMS = 10000
const MAX_VARIANTS = 10000
const MAX_PENDING = 5000
const notProvisioned = (err) => isNotProvisioned(err) || isMissingColumn(err)

async function pagedRead(table, cols, build, max) {
  const { data, error, truncated } = await fetchAllPages(
    (from, to) => build(supabase.from(table).select(cols)).order('id', { ascending: true }).range(from, to),
    { max },
  )
  if (error) {
    if (notProvisioned(error)) return { status: 'not_provisioned', rows: [], truncated: false }
    throw toServiceError(error)
  }
  return { status: 'ok', rows: data || [], truncated: !!truncated }
}

async function readAliases() {
  // brand_aliases is a small reference table (tens of rows); 500 is a real bound below the cap.
  const { data, error } = await supabase.from('brand_aliases').select('id, alias, canonical').order('id', { ascending: true }).limit(500)
  if (error) {
    if (notProvisioned(error)) return []
    throw toServiceError(error)
  }
  return data || []
}

/**
 * Load the queue. Returns { status, rows, counts, truncated, alreadyProposed }.
 * alreadyProposed = variants that already carry a stated type and still wait for a
 * second person (so the reader knows why an ORIGINAL item is not in the queue).
 */
export async function loadVariantReview() {
  const [items, variants, pending, aliases] = await Promise.all([
    pagedRead('material_canonical', 'id, company_sku, description, brand, manufacturer, specs, status',
      (q) => q.eq('status', 'active'), MAX_ITEMS),
    pagedRead('material_variants', 'id, canonical_id, brand, part_classification, status',
      (q) => q.in('status', ['proposed', 'active']), MAX_VARIANTS),
    pagedRead('material_correction_requests', 'id, target_id, topic, status',
      (q) => q.eq('status', 'submitted').in('topic', ['brand', 'classification', 'country_of_manufacture']), MAX_PENDING),
    readAliases(),
  ])
  if (items.status === 'not_provisioned') return { status: 'not_provisioned', rows: [], counts: null, truncated: false, alreadyProposed: 0 }
  const catalogue = buildBrandCatalogue({ aliases, recordedBrands: items.rows.map((r) => r.brand).filter(Boolean) })
  const pendingIds = new Set(pending.rows.map((r) => r.target_id).filter(Boolean))
  const { rows, counts } = buildProposals(items.rows, { variants: variants.rows, catalogue, pending: pendingIds })
  const alreadyProposed = variants.rows.filter((v) => v.status === 'proposed' && v.part_classification && v.part_classification !== 'unknown').length
  return {
    status: 'ok',
    rows,
    counts,
    totals: { items: items.rows.length, withoutBrand: items.rows.filter((r) => !String(r.brand || '').trim()).length, variants: variants.rows.length },
    pendingRequests: pendingIds.size,
    alreadyProposed,
    truncated: items.truncated || variants.truncated || pending.truncated,
  }
}

/**
 * Send one accepted proposal to the existing approval flow.
 * field: 'brand' | 'partType'. Throws when the proposal cannot be written.
 */
export async function acceptProposal(row, field) {
  const plan = writePlan(row, field)
  if (!plan) throw new Error('This proposal cannot be sent for approval.')
  if (plan.writer === 'correction') return requestCorrection(plan.payload)
  return proposeVariant(plan.payload)
}

/**
 * Accept many proposals one after another. Each item still passes the server rules;
 * failures are reported per item, never hidden.
 * Returns { sent, failed: [{ canonicalId, sku, message }] }.
 */
export async function acceptProposalsBulk(rows, field, { onProgress } = {}) {
  let sent = 0
  const failed = []
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    try {
      await acceptProposal(r, field)
      sent += 1
    } catch (err) {
      failed.push({ canonicalId: r.canonicalId, sku: r.sku, message: err?.message || 'Failed' })
    }
    if (onProgress) onProgress(i + 1, rows.length)
  }
  return { sent, failed }
}

// "Reject" a proposal = hide it on this device. A proposal exists only in the browser,
// so there is nothing on the server to reject; the decision is kept locally.
const HIDDEN_KEY = 'inv.variantReview.hidden.v1'
export function loadHiddenProposals() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(HIDDEN_KEY) : null
    const list = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(list) ? list : [])
  } catch {
    return new Set()
  }
}
export function saveHiddenProposals(set) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set].slice(-5000)))
  } catch {
    // storage full or blocked: the hide still applies for this session
  }
}
