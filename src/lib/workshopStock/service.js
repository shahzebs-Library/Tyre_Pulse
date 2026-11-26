/**
 * Workshop <-> warehouse service: the material flow of a job card.
 *
 * WRITES go only through server functions and RLS-checked tables:
 *   reserve          inv_reserve (inventory.reserveStock)
 *   shortage         requisitions insert (own-insert policy, draft/submitted only)
 *   issue            material_issues slip + inv_issue_slip (WP5, idempotent per line);
 *                    falls back to inv_issue against the reservation when the slip
 *                    posting or the slip reservation column is not on this database
 *   install          inv_confirm_installation (migration 20261124131000)
 *   return unused    inv_post_movement issue_return (inventory.returnIssuedStock)
 * Nothing here writes stock_records or stock_movements directly.
 *
 * READS are bounded (explicit limits under the 1,000-row cap, chunked `.in()`).
 * Each loader returns `{ status, ... }`; 'not_provisioned' when an object is missing.
 */
import { supabase, toServiceError, isNotProvisioned, isMissingColumn } from '../api/_client'
import { VIEWS, reserveStock, issueStock, returnIssuedStock } from '../api/inventory'
import { createMaterialIssue, postMaterialIssueSlip, issueSlipPostingAvailable } from '../api/materialIssue'
import { sanitizeSearchTerm, escapeLike } from '../searchFilter'
import { jobCardVariants, handoverReason } from '../inventory/floorWorkflow'
import { buildJobMaterials, summariseJobMaterials, assetMaterialCost } from './jobMaterials'
import { mapWithConcurrency, chunkArray } from '../concurrency'

export const ROW_LIMIT = 500
const ID_CHUNK = 150
const ID_CONCURRENCY = 4
const BAL_COLS = 'id, item_id, item_code, description, site, country, location_id, location_code, condition, qty_on_hand, qty_reserved, avg_unit_cost, currency, uom'
const MOVE_COLS = 'id, movement_type, item_id, item_code, site, country, location_code, qty_change, unit_cost, value_change, unvalued_qty_change, valuation_status, currency, source_doc_type, source_doc_id, reverses_movement_id, reference_no, reason, actor_id, created_by, posted_at, created_at, stock_id'
const INST_COLS = 'id, job_card_no, work_order_id, asset_no, movement_id, stock_id, item_id, qty, installed_by, installed_at, note, photo_path, created_at'
const REQ_COLS = 'id, requisition_no, item, quantity, status, site, country, created_at, needed_by'

const missing = (err) => isNotProvisioned(err) || isMissingColumn(err)

async function readByIds(table, cols, col, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  // Chunks go out ID_CONCURRENCY at a time and are joined in chunk order, so
  // the rows and the first error are the same as the one-at-a-time loop.
  const pages = await mapWithConcurrency(chunkArray(unique, ID_CHUNK), ID_CONCURRENCY, async (chunk) => {
    const { data, error } = await supabase.from(table).select(cols).in(col, chunk)
      .order('id', { ascending: true }).limit(ID_CHUNK * 4)
    if (error) throw error
    return data || []
  })
  return pages.flat()
}

/** Installations of some job cards; `available:false` before migration 20261124131000. */
async function readInstallations(variants) {
  if (!variants.length) return { available: true, rows: [] }
  const { data, error } = await supabase.from('job_material_installations').select(INST_COLS)
    .in('job_card_no', variants).order('installed_at', { ascending: true }).order('id', { ascending: true }).limit(ROW_LIMIT)
  if (error) {
    if (missing(error)) return { available: false, rows: [] }
    throw error
  }
  return { available: true, rows: data || [] }
}

/** Shortage requisitions of one job card; `available:false` before the job_card_no column exists. */
async function readRequisitions(variants) {
  const { data, error } = await supabase.from('requisitions').select(REQ_COLS)
    .in('job_card_no', variants).order('created_at', { ascending: false }).order('id', { ascending: true }).limit(100)
  if (error) {
    if (missing(error)) return { available: false, rows: [] }
    throw error
  }
  return { available: true, rows: data || [] }
}

async function readReversals(ids) {
  if (!ids.length) return []
  return readByIds(VIEWS.movements, 'id, reverses_movement_id', 'reverses_movement_id', ids)
}

/**
 * Everything the job card materials panel needs, in one call.
 * `{ status, jobCard, workOrder, rows, summary, requisitions, installationsAvailable, requisitionLinkAvailable, truncated }`
 */
export async function loadJobCardMaterials(jobCard) {
  const variants = jobCardVariants(jobCard)
  if (!variants.length) return { status: 'ok', jobCard: '', workOrder: null, rows: [], summary: summariseJobMaterials([]), requisitions: [] }
  try {
    const [wo, res, mov] = await Promise.all([
      supabase.from('work_orders').select('id, work_order_no, asset_no, site, country, status, work_type, opened_at').in('work_order_no', variants).limit(1),
      supabase.from('stock_reservations').select('id, stock_id, qty, qty_released, qty_consumed, status, site, country, source_doc_id, created_at')
        .eq('source_doc_type', 'job_card').in('source_doc_id', variants)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(ROW_LIMIT),
      supabase.from(VIEWS.movements).select(MOVE_COLS)
        .eq('source_doc_type', 'job_card').in('source_doc_id', variants).in('movement_type', ['issue', 'issue_return', 'return'])
        .order('posted_at', { ascending: true }).order('id', { ascending: true }).limit(ROW_LIMIT),
    ])
    for (const r of [res, mov]) {
      if (r.error) {
        if (missing(r.error)) return { status: 'not_provisioned', rows: [] }
        throw r.error
      }
    }
    const reservations = res.data || []
    const movements = mov.data || []
    const [reversals, inst, reqs] = await Promise.all([
      readReversals(movements.map((m) => m.id)),
      readInstallations(variants),
      readRequisitions(variants),
    ])
    const stockIds = [...reservations.map((r) => r.stock_id), ...movements.map((m) => m.stock_id), ...inst.rows.map((i) => i.stock_id)]
    const balances = await readByIds(VIEWS.balances, BAL_COLS, 'id', stockIds)
    const rows = buildJobMaterials({ reservations, movements, reversals, installations: inst.rows, balances })
    const workOrder = (!wo.error && wo.data && wo.data[0]) || null
    return {
      status: 'ok',
      // Show the job card as Work Orders records it, not as it was typed.
      jobCard: workOrder?.work_order_no || variants[0],
      workOrder,
      rows,
      summary: summariseJobMaterials(rows, reqs.rows),
      requisitions: reqs.rows,
      installationsAvailable: inst.available,
      requisitionLinkAvailable: reqs.available,
      truncated: reservations.length >= ROW_LIMIT || movements.length >= ROW_LIMIT || inst.rows.length >= ROW_LIMIT,
    }
  } catch (err) {
    if (missing(err)) return { status: 'not_provisioned', rows: [] }
    throw toServiceError(err)
  }
}

/** Stock lines that can serve a request: item code or description match, the job's country and site. */
export async function findStockForRequest({ search, country, site } = {}) {
  const s = sanitizeSearchTerm(search)
  if (!s) return []
  const like = `%${escapeLike(s)}%`
  let q = supabase.from(VIEWS.balances).select(BAL_COLS)
    .or(`item_code.ilike.${like},description.ilike.${like}`)
    .order('item_code', { ascending: true }).order('id', { ascending: true }).limit(60)
  if (country && country !== 'All') q = q.eq('country', country)
  if (site) q = q.eq('site', String(site).trim().toUpperCase())
  const { data, error } = await q
  if (error) {
    if (missing(error)) return []
    throw toServiceError(error, 'Could not read the stock for this item.')
  }
  return data || []
}

/** Reserve one allocation for the job card (inv_reserve). */
export function reserveForJob({ stockId, qty, jobCard }, key) {
  return reserveStock({ stockId, qty, sourceDocType: 'job_card', sourceDocId: jobCard }, key)
}

/**
 * Raise a requisition for what the store cannot cover. Status 'submitted' so
 * procurement sees it; the job card goes into job_card_no (migration
 * 20261124131000) and, before that column exists, into the notes.
 */
export async function raiseShortageRequisition({ jobCard, itemId, itemCode, description, qty, site, country, requester }) {
  const n = Number(qty)
  if (!jobCard || !Number.isFinite(n) || n <= 0) throw new Error('A job card and a quantity above zero are required.')
  const item = [itemCode, description].filter(Boolean).join(' ').slice(0, 300) || 'Part for job card'
  const base = {
    item, quantity: n, status: 'submitted', category: 'Spare parts',
    site: site || null, country: country || null, requester: requester ? String(requester).slice(0, 200) : null,
    notes: `Shortage for job card ${jobCard}. Raised from the job card materials screen.`,
  }
  const attempt = async (payload) => supabase.from('requisitions').insert(payload).select(REQ_COLS).single()
  let payload = { ...base, job_card_no: jobCard, ...(itemId ? { item_id: itemId } : {}) }
  let { data, error } = await attempt(payload)
  // Before WP4 (item_id) or 20261124131000 (job_card_no) a column may be missing.
  for (let i = 0; i < 2 && error && isMissingColumn(error); i += 1) {
    const raw = String(error.message || '').toLowerCase()
    const drop = raw.includes('item_id') && payload.item_id ? 'item_id' : 'job_card_no'
    payload = { ...payload }
    delete payload[drop]
    const next = await attempt(payload)
    data = next.data
    error = next.error
  }
  if (error) throw toServiceError(error, 'Could not raise the requisition.')
  return data
}

let slipReservationCache = null
/** Can a slip line carry its reservation (migration 20261124131000)? */
export async function slipReservationAvailable() {
  if (slipReservationCache !== null) return slipReservationCache
  const { error } = await supabase.from('material_issue_lines').select('reservation_id').limit(1)
  slipReservationCache = !error
  return slipReservationCache
}
export function _resetWorkshopStockProbe() { slipReservationCache = null }

/**
 * Issue the reserved parts to the job card.
 *
 * Preferred path: ONE material issue slip (MIS) naming the job card, asset,
 * receiver and every line's stock line + reservation, posted by inv_issue_slip.
 * Posting is idempotent per line on the server, so `retrySlipId` re-posts the
 * same slip without moving stock twice. Fallback (slip posting or the slip
 * reservation column not on this database): inv_issue per line with the
 * caller's idempotency keys.
 *
 * @returns {{ ok:boolean, mode:'slip'|'direct', slipId?:string, issueNumber?:string, posted?:number, already?:number, message?:string }}
 */
export async function issueReservedToJob({ jobCard, workOrder, site, country, lines, issuedTo, note, retrySlipId }, keys = {}) {
  const clean = (lines || []).filter((l) => l?.stockId && Number(l.qty) > 0)
  if (!clean.length) return { ok: false, message: 'Choose at least one reserved line to issue.' }
  if (!String(issuedTo || '').trim()) return { ok: false, message: 'Name the person receiving the parts.' }
  const slipPath = (await issueSlipPostingAvailable()) && (await slipReservationAvailable())
  if (slipPath) {
    let slipId = retrySlipId || null
    let issueNumber = null
    if (!slipId) {
      const created = await createMaterialIssue({
        doc_type: 'MIS', work_order_no: jobCard, asset_no: workOrder?.asset_no, site, country,
        issued_to: String(issuedTo).trim().slice(0, 200), status: 'issued',
        notes: handoverReason({ jobCard, receivedBy: issuedTo, note }),
      }, clean.map((l) => ({
        item_code: l.itemCode, item_description: l.description, qty: l.qty, uom: l.uom,
        stock_id: l.stockId, reservation_id: l.reservationId,
      })))
      if (!created.ok) return { ok: false, message: 'Material issue slips are not set up on this database.' }
      slipId = created.id
      issueNumber = created.issue_number
    }
    const posted = await postMaterialIssueSlip(slipId)
    if (!posted.ok) return { ok: false, mode: 'slip', slipId, issueNumber, message: posted.message || 'The slip is saved but stock did not move. Try posting it again.' }
    return { ok: true, mode: 'slip', slipId, issueNumber: posted.issueNumber || issueNumber, posted: posted.posted, already: posted.already }
  }
  let posted = 0
  for (const l of clean) {
    const key = keys[l.key]
    if (!key) return { ok: false, mode: 'direct', message: 'A request reference is missing. Please try again.' }
    const res = await issueStock({
      stockId: l.stockId, qty: l.qty, reservationId: l.reservationId,
      reason: handoverReason({ jobCard, receivedBy: issuedTo, note }),
      referenceNo: jobCard, sourceDocType: 'job_card', sourceDocId: jobCard,
    }, key)
    if (res?.status === 'refused_shortage') return { ok: false, mode: 'direct', posted, message: `Not enough stock on ${l.itemCode || 'a line'}. Nothing more was posted.` }
    posted += 1
  }
  return { ok: true, mode: 'direct', posted }
}

/** Translate the installation RPC refusals into plain sentences. */
const INSTALL_SENTENCE = /^(Only \d|The person who issued|Confirming an installation|This issue is outside|Choose an issue|That issue was reversed|Enter an installed|The signature|The photo|Not authorised|This idempotency_key)/

/** Confirm parts as installed (inv_confirm_installation). */
export async function confirmInstallation({ movementId, qty, note, signatureImage, photoPath }, key) {
  if (!key) return { ok: false, message: 'A request reference is missing. Please try again.' }
  const { data, error } = await supabase.rpc('inv_confirm_installation', {
    p_payload: {
      idempotency_key: key, movement_id: movementId, qty: Number(qty),
      note: note ? String(note).slice(0, 400) : null,
      signature_image: signatureImage || null, photo_path: photoPath || null,
    },
  })
  if (error) {
    if (isNotProvisioned(error)) return { ok: false, reason: 'not_available', message: 'Installation confirmation is not set up on this database yet.' }
    const raw = String(error.message || '')
    return { ok: false, message: INSTALL_SENTENCE.test(raw) && raw.length < 300 ? raw : toServiceError(error, 'Could not confirm the installation.').message }
  }
  return { ok: true, ...data }
}

/** Return unused parts to the stock line they came from, against the job card. */
export function returnUnused({ stockId, qty, jobCard, reason }, key) {
  return returnIssuedStock({ stockId, qty, reason, sourceDocType: 'job_card', sourceDocId: jobCard, referenceNo: jobCard }, key)
}

/**
 * Material cost of one asset: its job cards (newest 100) and their issue /
 * return movements, per currency. `{ status, assetNo, ...assetMaterialCost, truncated }`.
 */
export async function loadAssetMaterialCost(assetNo, { country } = {}) {
  const a = String(assetNo || '').trim()
  if (!a) return { status: 'ok', assetNo: '', cards: [], cost: [], unvaluedQty: 0, unreconciled: 0 }
  try {
    let q = supabase.from('work_orders').select('id, work_order_no, status, opened_at')
      .eq('asset_no', a.toUpperCase()).order('opened_at', { ascending: false }).order('id', { ascending: false }).limit(100)
    if (country && country !== 'All') q = q.eq('country', country)
    const { data: cards, error } = await q
    if (error) throw error
    const nos = (cards || []).map((c) => c.work_order_no).filter(Boolean)
    const movements = []
    for (let i = 0; i < nos.length; i += 50) {
      const { data, error: mErr } = await supabase.from(VIEWS.movements).select(MOVE_COLS)
        .eq('source_doc_type', 'job_card').in('source_doc_id', nos.slice(i, i + 50))
        .in('movement_type', ['issue', 'issue_return', 'return'])
        .order('posted_at', { ascending: true }).order('id', { ascending: true }).limit(ROW_LIMIT)
      if (mErr) throw mErr
      movements.push(...(data || []))
    }
    const reversals = await readReversals(movements.map((m) => m.id))
    const inst = await readInstallations(nos)
    return {
      status: 'ok', assetNo: a.toUpperCase(),
      ...assetMaterialCost({ jobCards: cards || [], movements, reversals, installations: inst.rows }),
      installationsAvailable: inst.available,
      truncated: (cards || []).length >= 100 || movements.length >= ROW_LIMIT,
    }
  } catch (err) {
    if (missing(err)) return { status: 'not_provisioned', cards: [], cost: [] }
    throw toServiceError(err)
  }
}
