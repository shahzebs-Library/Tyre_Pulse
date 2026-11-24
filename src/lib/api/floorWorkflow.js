/**
 * Warehouse floor workflow service: put-away, picking, workshop handover.
 *
 * WRITES go only through the existing inventory RPC wrappers in
 * ./inventory.js (inv_transfer_dispatch, inv_transfer_receive, inv_issue).
 * Nothing here writes stock_records or stock_movements directly.
 *
 * READS are bounded (explicit .limit under the 1,000-row cap, or chunked
 * `.in()` reads) and ordered on `id` where they page. Each returns
 * `{ status, ... }`; `status: 'not_provisioned'` when an object is missing.
 */
import { supabase, toServiceError, isNotProvisioned, isMissingColumn, applyCountry } from './_client'
import {
  VIEWS, listLocations, listAssignablePeople, dispatchTransfer, receiveTransfer, issueStock,
} from './inventory'
import { sanitizeSearchTerm, escapeLike } from '../searchFilter'
import {
  putawaySourceIds, putawayReceiveLines, buildPickList, jobCardVariants, summariseHandover,
} from '../inventory/floorWorkflow'

const notProvisioned = (err) => isNotProvisioned(err) || isMissingColumn(err)
const BALANCE_COLS = 'id, item_id, item_code, description, site, country, location_id, location_code, condition, ownership, qty_on_hand, qty_reserved, uom, updated_at'
const MAX_PAGE = 200
const ID_CHUNK = 150
/** Upper bound of reservation / movement rows read for one job card. */
export const JOB_CARD_ROW_LIMIT = 500

function fail(err) {
  if (notProvisioned(err)) return { status: 'not_provisioned' }
  throw toServiceError(err)
}

/** Read rows of `table` whose `col` is in `ids`, in chunks. Bounded by ids.length. */
async function readByIds(table, cols, col, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  const out = []
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const chunk = unique.slice(i, i + ID_CHUNK)
    const { data, error } = await supabase.from(table).select(cols).in(col, chunk).order('id', { ascending: true }).limit(ID_CHUNK * 4)
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

// ── Put-away ────────────────────────────────────────────────────────────────

/**
 * Stock sitting in a receiving area (warehouse / zone / rack location) with
 * quantity on hand, server paged. Also returns the scope's locations so the
 * screen can offer bins without a second read.
 */
export async function listPutawayCandidates({ country, site, search, page = 0, pageSize = 25 } = {}) {
  try {
    const locs = await listLocations({ country, site })
    if (locs.status !== 'ok') return { status: locs.status, rows: [], total: 0, locations: [] }
    const ids = putawaySourceIds(locs.rows)
    if (!ids.length) return { status: 'ok', rows: [], total: 0, locations: locs.rows, locationsTruncated: locs.truncated }
    const size = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(pageSize) || 25)))
    const from = Math.max(0, Math.floor(Number(page) || 0)) * size
    let q = supabase.from(VIEWS.balances).select(BALANCE_COLS, { count: 'exact' })
      .in('location_id', ids.slice(0, 500)).gt('qty_on_hand', 0)
    q = applyCountry(q, country)
    if (site && site !== 'all') q = q.eq('site', site)
    const s = sanitizeSearchTerm(search)
    if (s) {
      const like = `%${escapeLike(s)}%`
      q = q.or(`item_code.ilike.${like},description.ilike.${like},location_code.ilike.${like}`)
    }
    const { data, error, count } = await q.order('item_code', { ascending: true }).order('id', { ascending: true }).range(from, from + size - 1)
    if (error) return { ...fail(error), rows: [], total: 0, locations: [] }
    return { status: 'ok', rows: data || [], total: count ?? (data || []).length, locations: locs.rows, locationsTruncated: locs.truncated }
  } catch (err) {
    return { ...fail(err), rows: [], total: 0, locations: [] }
  }
}

/** Lines of one transfer (for the receive half of a put-away). */
export async function listTransferLines(transferId) {
  if (!transferId) return []
  const { data, error } = await supabase.from('stock_transfer_lines')
    .select('id, transfer_id, line_no, item_id, qty_dispatched, qty_received, qty_returned')
    .eq('transfer_id', transferId).order('line_no', { ascending: true }).limit(200)
  if (error) throw toServiceError(error)
  return data || []
}

/**
 * Step 1 of a put-away: dispatch the quantity from the receiving area to the
 * bin (same site). The stock sits in the site's in-transit location until
 * step 2 receives it. `{ transferId, ref, status }`.
 */
export async function startPutaway({ stock, targetId, qty, note }, key) {
  const res = await dispatchTransfer({
    fromLocationId: stock?.location_id, toLocationId: targetId,
    lines: [{ stock_id: stock?.id, qty }],
    remarks: ['Put-away', note && String(note).trim()].filter(Boolean).join(': ').slice(0, 300),
  }, key)
  if (res?.status === 'refused_shortage') return { refused: true }
  return { transferId: res?.transfer_id || null, ref: res?.ref || null, status: res?.status || null, replayed: !!res?.replayed }
}

/** Step 2: receive everything still in transit on that transfer into the bin. */
export async function finishPutaway(transferId, key) {
  const lines = putawayReceiveLines(await listTransferLines(transferId))
  if (!lines.length) return { alreadyReceived: true }
  return receiveTransfer({ transferId, lines }, key)
}

// ── Picking ─────────────────────────────────────────────────────────────────

/**
 * Pick list for a job card: its open stock reservations (pickable) plus any
 * work-order reservation lines (shown, not pickable), each placed at its
 * location / bin. `{ status, jobCard, workOrder, lines, truncated }`.
 */
export async function loadPickList(jobCard, { country } = {}) {
  const variants = jobCardVariants(jobCard)
  if (!variants.length) return { status: 'ok', jobCard: '', workOrder: null, lines: [], truncated: false }
  try {
    const { data: res, error: rErr } = await supabase.from('stock_reservations')
      .select('id, stock_id, qty, qty_released, qty_consumed, status, site, country, source_doc_type, source_doc_id, created_at')
      .eq('source_doc_type', 'job_card').in('source_doc_id', variants).eq('status', 'active')
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(JOB_CARD_ROW_LIMIT)
    if (rErr) return { ...fail(rErr), lines: [] }

    // The job card itself (for the header), and any work-order reservation holds.
    let workOrder = null
    let holds = []
    const { data: wo, error: woErr } = await supabase.from('work_orders')
      .select('id, work_order_no, asset_no, site, country, status').in('work_order_no', variants).limit(1)
    if (!woErr && wo && wo[0]) {
      workOrder = wo[0]
      const { data: heads, error: hErr } = await supabase.from('work_order_stock_reservations')
        .select('id, status').eq('work_order_id', workOrder.id).eq('status', 'reserved').limit(50)
      if (!hErr && heads?.length) {
        holds = await readByIds('work_order_stock_reservation_lines', 'reservation_id, stock_id, quantity', 'reservation_id', heads.map((h) => h.id))
          .catch(() => [])
      }
    }

    const reservations = res || []
    const stockIds = [...reservations.map((r) => r.stock_id), ...holds.map((h) => h.stock_id)]
    const balances = await readByIds(VIEWS.balances, BALANCE_COLS, 'id', stockIds)
    const locs = await listLocations({ country })
    const lines = buildPickList({ reservations, holds, balances, locations: locs.rows || [] })
    return {
      status: 'ok', jobCard: variants[0], workOrder, lines,
      truncated: reservations.length >= JOB_CARD_ROW_LIMIT || !!locs.truncated,
    }
  } catch (err) {
    return { ...fail(err), lines: [] }
  }
}

/** Confirm one pick: issue against the reservation (inv_issue). `args` from pickIssueArgs. */
export function confirmPick(args, key) {
  return issueStock(args, key)
}

// ── Handover ────────────────────────────────────────────────────────────────

const MOVE_COLS = 'id, movement_type, item_id, item_code, site, country, location_id, location_code, qty_change, source_doc_type, source_doc_id, reason, reference_no, actor_id, created_by, posted_at, created_at, stock_id'

/** Issue / return movements recorded against a job card, with the handover read back. */
export async function loadHandover(jobCard) {
  const variants = jobCardVariants(jobCard)
  if (!variants.length) return { status: 'ok', jobCard: '', rows: [], items: [], issuedCount: 0, missingReceiver: 0, truncated: false }
  try {
    const { data, error } = await supabase.from(VIEWS.movements).select(MOVE_COLS)
      .eq('source_doc_type', 'job_card').in('source_doc_id', variants).in('movement_type', ['issue', 'issue_return'])
      .order('posted_at', { ascending: true }).order('id', { ascending: true }).limit(JOB_CARD_ROW_LIMIT)
    if (error) return { ...fail(error), rows: [], items: [] }
    const people = await listAssignablePeople().catch(() => [])
    const summary = summariseHandover(data || [], people)
    return { status: 'ok', jobCard: variants[0], ...summary, truncated: (data || []).length >= JOB_CARD_ROW_LIMIT }
  } catch (err) {
    return { ...fail(err), rows: [], items: [] }
  }
}
