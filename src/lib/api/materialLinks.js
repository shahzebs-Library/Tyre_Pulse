/**
 * Material Master reconciliation + OEM part detail (service layer).
 * Pure logic: src/lib/oem/materialLinks.js.
 *
 * Reads:
 *  - inv_material_link_candidates / inv_material_link_health (SECURITY INVOKER,
 *    so row security decides what a caller sees) and material_link_proposals;
 *  - for the OEM part detail: oem_part_references, material_master,
 *    material_canonical(_items), material_aliases, v_inv_balances,
 *    purchase_order_lines / purchase_orders, the last parts_consumption cost and
 *    the manual + fleet register for fitment. Every list read is paged with an
 *    `id` tiebreak and a ceiling (readAll), or chunked by id lists.
 *
 * Writes go ONLY through governed RPCs as the signed-in user:
 *  - inv_material_link_propose (stores a proposal; nothing is linked);
 *  - inv_material_link_decide (a SECOND person approves; the database refuses the
 *    proposer, stamps decided_by from auth.uid() and re-checks country / site);
 *  - requisitions are created through the existing requisitions service as
 *    drafts, one per selected part, with item_id set.
 *
 * Migration 20261124132000 installs the RPCs and the proposals table. Until it
 * is applied, every call here reports "not set up" instead of failing.
 */
import { supabase, ServiceError, toServiceError, isNotProvisioned } from './_client'
import { NOT_SET_UP_CODE, NOT_SET_UP_MESSAGE, inventoryRefusalText, newIdempotencyKey } from './inventory'
import { readAll } from './oemCrossRef'
import { createRequisition } from './requisitions'
import { buildManualFitment } from '../inventory/oemFitment'
import { buildOemPartDetail, buildErpLinkPayload, buildStockLinkPayload, buildRequisitionDrafts } from '../oem/materialLinks'

const CHUNK = 200
export const CANDIDATE_PAGE = 500

const notSetUp = (error) => new ServiceError(NOT_SET_UP_MESSAGE, NOT_SET_UP_CODE, error)

function readFailure(error, label) {
  if (isNotProvisioned(error)) return notSetUp(error)
  return toServiceError(error, `Could not read ${label}.`)
}

async function readByIds(table, cols, column, ids, label) {
  const list = [...new Set((ids || []).filter(Boolean))]
  const rows = []
  let truncated = false
  for (let i = 0; i < list.length; i += CHUNK) {
    const res = await readAll(table, cols, (q) => q.in(column, list.slice(i, i + CHUNK)), label)
    rows.push(...res.rows)
    truncated = truncated || res.truncated
  }
  return { rows, truncated }
}

/** One page of proposed matches for ERP items with no catalogue link. */
export async function loadLinkCandidates({ country, page = 0, pageSize = CANDIDATE_PAGE } = {}) {
  const { data, error } = await supabase.rpc('inv_material_link_candidates', {
    p_country: country && country !== 'All' ? country : null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  })
  if (error) {
    if (isNotProvisioned(error)) return { status: 'not_provisioned', rows: [], total: 0 }
    throw readFailure(error, 'the link review queue')
  }
  const rows = data || []
  return { status: 'ok', rows, total: rows.length ? Number(rows[0].total_count) : 0 }
}

/** Duplicate / cross-country checks and the unlinked counts. */
export async function loadLinkHealth() {
  const { data, error } = await supabase.rpc('inv_material_link_health')
  if (error) {
    if (isNotProvisioned(error)) return { status: 'not_provisioned', health: {} }
    throw readFailure(error, 'the link health check')
  }
  return { status: 'ok', health: data || {} }
}

const PROPOSAL_COLS = 'id,country,kind,item_id,canonical_id,stock_id,basis,evidence,note,status,proposed_by,proposed_at,decided_by,decided_at,decision_note'

/** Stored proposals for stock lines (open and decided), newest first per line. */
export async function loadStockLinkProposals(stockIds) {
  if (!stockIds?.length) return []
  try {
    const res = await readByIds('material_link_proposals', PROPOSAL_COLS, 'stock_id', stockIds, 'stock link proposals')
    return res.rows.sort((a, b) => String(b.proposed_at || '').localeCompare(String(a.proposed_at || '')))
  } catch (err) {
    if (err?.code === NOT_SET_UP_CODE) return null
    throw err
  }
}

async function rpcWrite(fn, payload, idempotencyKey) {
  const key = idempotencyKey || newIdempotencyKey()
  const { data, error } = await supabase.rpc(fn, { p_payload: { ...payload, idempotency_key: key } })
  if (error) {
    if (isNotProvisioned(error)) throw notSetUp(error)
    const refusal = inventoryRefusalText(error)
    if (refusal) throw new ServiceError(refusal, 'INV_REFUSED', error)
    throw toServiceError(error)
  }
  return data
}

function safeBuild(fn) {
  try { return fn() } catch (err) { throw new ServiceError(err.message, 'INV_INVALID') }
}

/** Propose "this ERP item is this catalogue item". A second person approves. */
export function proposeErpLink(row, idempotencyKey) {
  return rpcWrite('inv_material_link_propose', safeBuild(() => buildErpLinkPayload(row)), idempotencyKey)
}

/** Propose "this stock line is this ERP item". A second person approves. */
export function proposeStockLink(line, candidate, note, idempotencyKey) {
  return rpcWrite('inv_material_link_propose', safeBuild(() => buildStockLinkPayload(line, candidate, note)), idempotencyKey)
}

/** Approve, reject (with a reason) or withdraw (proposer only) a stored proposal. */
export function decideLink({ id, decision, note }, idempotencyKey) {
  if (!id) return Promise.reject(new ServiceError('Choose a proposal first.', 'INV_INVALID'))
  if (!['approve', 'reject', 'withdraw'].includes(decision)) {
    return Promise.reject(new ServiceError('Decision must be approve, reject or withdraw.', 'INV_INVALID'))
  }
  const text = String(note || '').trim()
  if (decision === 'reject' && !text) return Promise.reject(new ServiceError('Give a reason for rejecting this link.', 'INV_INVALID'))
  return rpcWrite('inv_material_link_decide', { id, decision, note: text || null }, idempotencyKey)
}

// ── OEM part detail ─────────────────────────────────────────────────────────

const REF_COLS = 'id,country,oem_part_no,manufacturer,item_id,oem_entry_id,status,source,proposed_by,proposed_at,approved_by,approved_at,decision_note'
const ITEM_COLS = 'id,item_code,item_name,country,category'
const CANON_COLS = 'id,company_sku,description,brand,manufacturer,category,base_uom,status'
const LINK_COLS = 'id,country,canonical_id,item_id'
const ALIAS_COLS = 'id,canonical_id,alias_type,value,source,verified,ref_status'
const BALANCE_COLS = 'id,item_id,item_code,site,country,location_code,qty_on_hand,qty_reserved,uom'
const POL_COLS = 'id,po_id,item_id,qty_ordered,qty_received,unit_price,currency,status'
const PO_COLS = 'id,po_number,supplier_name,vendor_name,order_date,expected_delivery,actual_delivery,status'
const ENTRY_COLS = 'id,manual_id'
const MANUAL_COLS = 'id,country,manufacturer,model,model_code,equipment_no,revision,source_file_name'
const FLEET_COLS = 'id,country,asset_no,make,model,vehicle_type,site'

/** Approved OEM links, for the parts list (optionally one country). */
export async function listApprovedOemParts({ country } = {}) {
  const res = await readAll('oem_part_references', REF_COLS, (q) => {
    let qq = q.eq('status', 'approved')
    if (country && country !== 'All') qq = qq.eq('country', country)
    return qq
  }, 'approved OEM links')
  const items = await readByIds('material_master', ITEM_COLS, 'id', res.rows.map((r) => r.item_id), 'ERP items')
  const byId = new Map(items.rows.map((i) => [i.id, i]))
  return {
    status: 'ok',
    truncated: res.truncated || items.truncated,
    rows: res.rows.map((r) => ({
      ...r,
      item_code: byId.get(r.item_id)?.item_code || null,
      item_name: byId.get(r.item_id)?.item_name || null,
      item_country: byId.get(r.item_id)?.country || null,
    })),
  }
}

/** Everything the detail of one approved OEM link shows. */
export async function loadOemPartDetail(reference) {
  if (!reference?.item_id) throw new ServiceError('Choose an approved OEM link first.', 'INV_INVALID')
  const itemId = reference.item_id
  const [itemRes, refsRes, linkRes] = await Promise.all([
    readByIds('material_master', ITEM_COLS, 'id', [itemId], 'the ERP item'),
    readAll('oem_part_references', REF_COLS, (q) => q.eq('item_id', itemId).in('status', ['approved', 'proposed']), 'OEM links for the item'),
    readByIds('material_canonical_items', LINK_COLS, 'item_id', [itemId], 'the catalogue link'),
  ])
  const item = itemRes.rows[0] || null
  const canonicalId = linkRes.rows[0]?.canonical_id || null
  const [canonRes, allLinks, aliasRes] = await Promise.all([
    canonicalId ? readByIds('material_canonical', CANON_COLS, 'id', [canonicalId], 'the catalogue item') : { rows: [] },
    canonicalId ? readByIds('material_canonical_items', LINK_COLS, 'canonical_id', [canonicalId], 'ERP codes per country') : { rows: [] },
    canonicalId ? readByIds('material_aliases', ALIAS_COLS, 'canonical_id', [canonicalId], 'alternatives') : { rows: [] },
  ])
  const itemIds = [...new Set([itemId, ...allLinks.rows.map((l) => l.item_id)])]
  const [erpRes, balRes, polRes] = await Promise.all([
    readByIds('material_master', ITEM_COLS, 'id', itemIds, 'ERP codes'),
    readByIds('v_inv_balances', BALANCE_COLS, 'item_id', itemIds, 'stock balances'),
    readByIds('purchase_order_lines', POL_COLS, 'item_id', itemIds, 'purchase order lines').catch(() => ({ rows: [], failed: true })),
  ])
  const poRes = polRes.rows.length
    ? await readByIds('purchase_orders', PO_COLS, 'id', polRes.rows.map((l) => l.po_id), 'purchase orders')
    : { rows: [] }

  // Last ERP issue cost for this item code in this country (cost source).
  let lastIssue = null
  if (item?.item_code && item?.country) {
    const { data } = await supabase.from('parts_consumption')
      .select('unit_cost,currency,event_date')
      .eq('country', item.country).eq('item_code', item.item_code).not('unit_cost', 'is', null)
      .order('event_date', { ascending: false }).order('id', { ascending: false }).limit(1)
    lastIssue = data?.[0] || null
  }

  // Fitment: the manual the OEM row came from, and the fleet register.
  let fitment = null
  const entryIds = refsRes.rows.map((r) => r.oem_entry_id).filter(Boolean)
  if (entryIds.length) {
    const entries = await readByIds('oem_parts_entries', ENTRY_COLS, 'id', entryIds, 'OEM manual rows')
    const manuals = await readByIds('oem_parts_manuals', MANUAL_COLS, 'id', entries.rows.map((e) => e.manual_id), 'OEM manuals')
    if (manuals.rows.length) {
      const countries = [...new Set(manuals.rows.map((m) => m.country).filter(Boolean))]
      const fleet = await readAll('vehicle_fleet', FLEET_COLS, (q) => (countries.length ? q.in('country', countries) : q), 'the fleet register')
      fitment = { manuals: buildManualFitment({ manuals: manuals.rows, fleet: fleet.rows }), truncated: fleet.truncated }
    } else {
      fitment = { manuals: [], truncated: false }
    }
  }

  return buildOemPartDetail({
    references: refsRes.rows,
    item,
    canonical: canonRes.rows[0] || null,
    links: allLinks.rows,
    erpItems: erpRes.rows,
    aliases: aliasRes.rows,
    balances: balRes.rows,
    poLines: polRes.rows,
    purchaseOrders: poRes.rows,
    lastIssue,
    fitment,
  })
}

/**
 * Create one DRAFT requisition per selected part (item_id set). Nothing is
 * created as a new material. Returns created and failed lines separately so a
 * partial result is reported honestly.
 */
export async function createRequisitionsForParts(selection, options) {
  const drafts = safeBuild(() => buildRequisitionDrafts(selection, options))
  const created = []
  const failed = []
  for (const d of drafts) {
    try {
      created.push(await createRequisition(d))
    } catch (err) {
      failed.push({ item: d.item, error: err })
    }
  }
  return { created, failed }
}
