/**
 * Warehouse assets and finance service (read-mostly).
 *
 * Reuses the existing objects; nothing here is a second register:
 *   - tools: `equipment` via the Tool & Equipment Registry service;
 *   - tool custody: `equipment_custody` (PROPOSED, docs/warehouse/
 *     10_ASSETS_FINANCE_DB_CHANGES.md). Until it exists every read answers
 *     { status: 'not_provisioned' } and the screen says so;
 *   - items held by a person: `material_issues` + `material_issue_lines`;
 *   - repairables: `v_inv_valuation` + `inventory_locations` (inventory.js);
 *   - warranty: `warranty_claims` (warranty.js writes; this file only reads the
 *     claims that were raised from stock);
 *   - scrap history: `stock_movements` (scrap) read only. A scrap is never posted
 *     from here: there is no approval-gated scrap request yet (see the DB note);
 *   - finance: `v_inv_erp_reconciliation`, `stock_movements` (receipts) and
 *     `v_inv_valuation`.
 *
 * Every multi-row read is bounded: fetchAllPages, a total order ending on a
 * unique key, and a `max` ceiling whose hit is reported as `truncated`.
 */
import { supabase, fetchAllPages, applyCountry, toServiceError, isNotProvisioned, isMissingColumn, ServiceError } from './_client'
import { listAllEquipment } from './equipment'
import { createWarrantyClaim } from './warranty'
import { loadValuation, listLocations, inventoryRefusalText, NOT_SET_UP_MESSAGE, NOT_SET_UP_CODE, loadErpReconciliationRpcRows } from './inventory'
import { STOCK_WARRANTY_SOURCE, stockWarrantyDraft } from '../inventory/warehouseAssets'

export const CUSTODY_TABLE = 'equipment_custody'
export const ISSUE_MAX = 5000
export const RECON_MAX = 20000
export const MOVEMENT_MAX = 5000
export const CLAIM_MAX = 2000

const applySite = (q, site) => (site && site !== 'all' ? q.eq('site', site) : q)

/** Run a bounded paged read; a missing relation answers not_provisioned. */
async function bounded(pageFn, max, concurrency) {
  try {
    const { data, error, truncated } = await fetchAllPages(pageFn, concurrency ? { max, concurrency } : { max })
    if (error) {
      if (isNotProvisioned(error)) return { status: 'not_provisioned', rows: [], truncated: false }
      throw toServiceError(error)
    }
    return { status: 'ok', rows: data || [], truncated: !!truncated }
  } catch (err) {
    if (isNotProvisioned(err)) return { status: 'not_provisioned', rows: [], truncated: false }
    throw toServiceError(err)
  }
}

// ── Tool custody ─────────────────────────────────────────────────────────────

/** Tools in the registry (country-scoped). */
export async function listTools({ country } = {}) {
  const rows = await listAllEquipment({ country: country || 'All', max: 20000 })
  return { status: 'ok', rows: rows || [] }
}

const CUSTODY_COLS = 'id, equipment_id, holder_user_id, holder_name, issued_at, due_back_at, returned_at, condition_out, condition_in, site, country, notes'

/** Custody rows (open and recently returned). not_provisioned until the table exists. */
export function listToolCustody({ country, site } = {}) {
  return bounded((from, to) => {
    let q = supabase.from(CUSTODY_TABLE).select(CUSTODY_COLS)
    q = applySite(applyCountry(q, country), site)
    return q.order('issued_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
  }, 5000)
}

/**
 * Material issues made to a named person, with their lines (MIS out, MRT back).
 * Bounded; the newest issues first.
 */
export function listIssuesToPeople({ country, site } = {}) {
  return bounded((from, to) => {
    let q = supabase.from('material_issues')
      .select('id, issue_number, doc_type, issued_to, issued_at, status, site, country, lines:material_issue_lines(item_code, item_description, qty)')
      .not('issued_to', 'is', null)
      .eq('status', 'issued')
    q = applySite(applyCountry(q, country), site)
    return q.order('issued_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
  }, ISSUE_MAX)
}

// ── Repairables ──────────────────────────────────────────────────────────────

/** Valuation balances + locations, the two inputs of the repairable view. */
export async function loadStockWithLocations({ country, site } = {}) {
  const [val, loc] = await Promise.all([loadValuation({ country, site }), listLocations({ country, site })])
  if (val.status === 'not_provisioned') return { status: 'not_provisioned', valuation: [], locations: [], truncated: false }
  return { status: 'ok', valuation: val.rows, locations: loc.rows || [], truncated: !!(val.truncated || loc.truncated) }
}

// ── Warranty and scrap ───────────────────────────────────────────────────────

const CLAIM_COLS = 'id, claim_no, claim_status, failure_type, supplier, site, country, credit_amount, credit_date, created_at, custom_data'

/** Warranty claims raised from stock (custom_data.source = inventory). */
export function listStockWarrantyClaims({ country } = {}) {
  return bounded((from, to) => {
    let q = supabase.from('warranty_claims').select(CLAIM_COLS).eq('custom_data->>source', STOCK_WARRANTY_SOURCE)
    q = applyCountry(q, country)
    return q.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
  }, CLAIM_MAX)
}

/**
 * Raise a warranty claim for a stock line through the existing warranty
 * service (the same table and server rules as the Warranty page). Validated
 * first; never sends a credit amount.
 */
export async function raiseStockWarrantyClaim(stock, form) {
  const { payload, error } = stockWarrantyDraft(stock, form)
  if (error) {
    const e = new Error(error)
    e.code = 'INV_BAD_CLAIM'
    throw e
  }
  return createWarrantyClaim(payload)
}

/** Scrap movements already posted (read only). */
export function listScrapMovements({ country, site } = {}) {
  return bounded((from, to) => {
    let q = supabase.from('stock_movements')
      .select('id, stock_id, item_id, site, country, description, qty_change, value_change, unvalued_qty_change, currency, reason, reference_no, approval_ref, actor_id, created_at')
      .in('movement_type', ['scrap', 'Scrap'])
    q = applySite(applyCountry(q, country), site)
    return q.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
  }, MOVEMENT_MAX)
}

// ── Financial reconciliation ─────────────────────────────────────────────────

const ERP_COLS = 'country, site, month, item_code, currency, inventory_qty, inventory_value, inventory_unvalued_qty, inventory_movements, erp_qty, erp_value, erp_lines'

/**
 * v_inv_erp_reconciliation rows from `fromMonth` (YYYY-MM-01). Read through the
 * one-pass server function when it is installed (sequential pages); the view
 * read below is the fallback. The view has no id.
 */
export async function loadErpIssueRows({ country, site, fromMonth } = {}) {
  try {
    const viaRpc = await loadErpReconciliationRpcRows({ country, site, monthFrom: fromMonth }, RECON_MAX)
    if (viaRpc) return viaRpc
  } catch (err) {
    if (!isNotProvisioned(err)) throw toServiceError(err)
  }
  return bounded((from, to) => {
    let q = supabase.from('v_inv_erp_reconciliation').select(ERP_COLS)
    q = applySite(applyCountry(q, country), site)
    if (fromMonth) q = q.gte('month', fromMonth)
    return q.order('month', { ascending: false })
      .order('country', { ascending: true }).order('site', { ascending: true })
      .order('item_code', { ascending: true }).order('currency', { ascending: true })
      .range(from, to)
  }, RECON_MAX, 1)
}

/** Receipt movements from `fromMonth`. */
export function loadReceiptMovements({ country, site, fromMonth } = {}) {
  return bounded((from, to) => {
    let q = supabase.from('stock_movements')
      .select('id, site, country, currency, qty_change, value_change, unvalued_qty_change, effective_at, posted_at, created_at')
      .in('movement_type', ['receipt', 'consignment_receipt'])
    q = applySite(applyCountry(q, country), site)
    if (fromMonth) q = q.gte('effective_at', fromMonth)
    return q.order('id', { ascending: true }).range(from, to)
  }, MOVEMENT_MAX)
}

/**
 * Everything the finance reconciliation needs. The two heavy reads (ERP
 * aggregation and valuation) run one after the other: started together with the
 * valuation's own pages they were the burst that hit the 8 s timeout.
 */
export async function loadFinanceRecon({ country, site, fromMonth } = {}) {
  const [erp, receipts] = await Promise.all([
    loadErpIssueRows({ country, site, fromMonth }),
    loadReceiptMovements({ country, site, fromMonth }),
  ])
  const valuation = await loadValuation({ country, site })
  if (erp.status === 'not_provisioned' && valuation.status === 'not_provisioned') {
    return { status: 'not_provisioned', erpRows: [], receipts: [], valuation: [], truncated: {} }
  }
  return {
    status: 'ok',
    erpRows: erp.rows,
    receipts: receipts.rows,
    valuation: valuation.rows,
    truncated: { erp: erp.truncated, receipts: receipts.truncated, valuation: !!valuation.truncated },
  }
}


// ── Special classes (migration 20261124133000, NOT APPLIED) ──────────────────
// Every write below goes through a SECURITY DEFINER RPC that re-checks the
// organisation, country / site scope and the stock capability. Before the
// migration is applied each call answers "not set up yet".

async function classRpc(fn, payload, idempotencyKey) {
  const body = idempotencyKey ? { ...payload, idempotency_key: idempotencyKey } : payload
  const { data, error } = await supabase.rpc(fn, { p_payload: body })
  if (error) {
    if (isNotProvisioned(error)) throw new ServiceError(NOT_SET_UP_MESSAGE, NOT_SET_UP_CODE, error)
    const refusal = inventoryRefusalText(error)
    if (refusal) throw new ServiceError(refusal, 'INV_REFUSED', error)
    throw toServiceError(error)
  }
  return data
}

/** A read that answers not_provisioned for a missing view/column (migration not applied). */
async function classRead(pageFn, max) {
  try {
    const { data, error, truncated } = await fetchAllPages(pageFn, { max })
    if (error) {
      if (isNotProvisioned(error) || isMissingColumn(error)) return { status: 'not_provisioned', rows: [], truncated: false }
      throw toServiceError(error)
    }
    return { status: 'ok', rows: data || [], truncated: !!truncated }
  } catch (err) {
    if (isNotProvisioned(err) || isMissingColumn(err)) return { status: 'not_provisioned', rows: [], truncated: false }
    throw toServiceError(err)
  }
}

// Locations

/** Save a location with its capacity, restriction, owner and van (inv_location_upsert). */
export function saveLocationWithRules(draft, idempotencyKey) {
  const cap = draft.capacity_qty === '' || draft.capacity_qty === null || draft.capacity_qty === undefined ? null : Number(draft.capacity_qty)
  return classRpc('inv_location_upsert', {
    id: draft.id || null, site: draft.site, country: draft.country || null, parent_id: draft.parent_id || null,
    location_type: draft.location_type, code: String(draft.code || '').trim(), name: String(draft.name || '').trim(),
    responsible_user_id: draft.responsible_user_id || null, active: draft.active !== false,
    capacity_qty: cap, capacity_uom: String(draft.capacity_uom || '').trim() || null,
    restriction: draft.restriction || null, restriction_note: String(draft.restriction_note || '').trim() || null,
    van_asset_no: draft.location_type === 'service_van' ? (String(draft.van_asset_no || '').trim() || null) : null,
  }, idempotencyKey)
}

const UTIL_COLS = 'location_id, country, site, code, name, location_type, capacity_qty, capacity_uom, restriction, restriction_note, responsible_user_id, van_asset_no, qty_on_hand, stock_lines, pct_used, restriction_breaches, mixing_breach'

/** v_inv_location_utilisation: on hand vs capacity and rule breaches per location. */
export function listLocationUtilisation({ country, site } = {}) {
  return classRead((from, to) => {
    let q = supabase.from('v_inv_location_utilisation').select(UTIL_COLS)
    q = applySite(applyCountry(q, country), site)
    return q.order('location_id', { ascending: true }).range(from, to)
  }, 5000)
}

// Tools

export const issueTool = (payload, key) => classRpc('equipment_issue', payload, key)
export const returnTool = (payload) => classRpc('equipment_return', payload)
export const recordCalibration = (payload, key) => classRpc('equipment_record_calibration', payload, key)

/** Calibration history (newest first). */
export function listCalibrations({ country, site } = {}) {
  return classRead((from, to) => {
    let q = supabase.from('equipment_calibrations')
      .select('id, equipment_id, calibrated_on, next_due, result, certificate_ref, provider, notes, recorded_by, recorded_at, site, country')
    q = applySite(applyCountry(q, country), site)
    return q.order('calibrated_on', { ascending: false }).order('id', { ascending: true }).range(from, to)
  }, 5000)
}

// Lubricants

/** Lubricant items (material_master.is_lubricant) and their stock lines in scope. */
export async function loadLubricantStock({ country, site } = {}) {
  const items = await classRead((from, to) => {
    let q = supabase.from('material_master').select('id, item_code, item_name, uom, base_uom, lubricant_grade, country').eq('is_lubricant', true)
    q = applyCountry(q, country)
    return q.order('item_code', { ascending: true }).order('id', { ascending: true }).range(from, to)
  }, 2000)
  if (items.status === 'not_provisioned') return { status: 'not_provisioned', items: [], stock: [] }
  const ids = items.rows.map((r) => r.id)
  const stock = []
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    const res = await bounded((from, to) => {
      let q = supabase.from('stock_records')
        .select('id, item_id, site, country, location_id, uom, qty_on_hand, qty_reserved, condition')
        .in('item_id', chunk).gt('qty_on_hand', 0)
      q = applySite(applyCountry(q, country), site)
      return q.order('id', { ascending: true }).range(from, to)
    }, 5000)
    stock.push(...res.rows)
  }
  return { status: 'ok', items: items.rows, stock }
}

export const dispenseLubricant = (payload, key) => classRpc('inv_lubricant_dispense', payload, key)
export const setLubricantGrade = (payload) => classRpc('inv_lubricant_set_grade', payload)

/** v_inv_lubricant_consumption rows from `fromMonth` (YYYY-MM-01), optional source filter. */
export function listLubricantConsumption({ country, site, fromMonth, source } = {}) {
  return classRead((from, to) => {
    let q = supabase.from('v_inv_lubricant_consumption')
      .select('source, country, site, asset_no, month, item_code, item_name, lubricant_grade, currency, uom, qty, value, unvalued_qty, lines')
    q = applySite(applyCountry(q, country), site)
    if (fromMonth) q = q.gte('month', fromMonth)
    if (source) q = q.eq('source', source)
    return q.order('month', { ascending: false }).order('asset_no', { ascending: true }).order('item_code', { ascending: true })
      .order('source', { ascending: true }).order('currency', { ascending: true }).range(from, to)
  }, 20000)
}

/** Recent in-app dispenses (who, what, which asset and job card). */
export function listDispenses({ country, site } = {}) {
  return classRead((from, to) => {
    let q = supabase.from('inventory_lubricant_dispenses')
      .select('id, stock_id, item_id, asset_no, job_card_no, qty, uom, meter_reading, meter_type, note, dispensed_by, dispensed_at, site, country')
    q = applySite(applyCountry(q, country), site)
    return q.order('dispensed_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
  }, 2000)
}

// Serialised units (repairables)

export const recordUnitEvent = (payload, key) => classRpc('inv_unit_event_record', payload, key)

/** Current state per serial (v_inv_unit_latest). */
export function listUnitLatest({ country, site } = {}) {
  return classRead((from, to) => {
    let q = supabase.from('v_inv_unit_latest')
      .select('item_id, item_code, item_name, serial, last_event, unit_state, asset_no, supplier_id, rma_ref, expected_back, overdue_from_vendor, condition, event_at, site, country')
    q = applySite(applyCountry(q, country), site)
    return q.order('event_at', { ascending: false }).order('serial', { ascending: true }).range(from, to)
  }, 5000)
}

/** Full history of one serial, oldest first. */
export function listUnitHistory({ itemId, serial }) {
  return classRead((from, to) => supabase.from('inventory_unit_events')
    .select('id, seq, event_type, asset_no, job_card_no, supplier_id, rma_ref, expected_back, condition, note, actor_id, event_at')
    .eq('item_id', itemId).eq('serial', String(serial || '').toUpperCase().replace(/\s+/g, ''))
    .order('seq', { ascending: true }).range(from, to), 500)
}

/** Suppliers in scope for the repair-vendor picker. */
export function listRepairVendors() {
  return classRead((from, to) => supabase.from('suppliers').select('id, supplier_name, status')
    .order('supplier_name', { ascending: true }).order('id', { ascending: true }).range(from, to), 2000)
}

/** Material items matching a code or name (for the unit event form). */
export async function searchItems({ country, term }) {
  const s = String(term || '').trim().replace(/[%,()]/g, ' ')
  if (s.length < 2) return []
  let q = supabase.from('material_master').select('id, item_code, item_name, country, serial_tracked')
    .or(`item_code.ilike.%${s}%,item_name.ilike.%${s}%`)
  q = applyCountry(q, country)
  const { data, error } = await q.order('item_code', { ascending: true }).limit(25)
  if (error) throw toServiceError(error)
  return data || []
}

// Scrap requests

const SCRAP_COLS = 'id, country, site, stock_id, item_id, qty, reason, status, proposed_by, proposed_at, evaluated_by, evaluated_at, evaluation_result, evaluation_note, decided_by, decided_at, decision_note, movement_id, posted_by, posted_at, disposal_method, disposal_ref, disposed_at, recovery_value, recovery_currency'

export function listScrapRequests({ country, site } = {}) {
  return classRead((from, to) => {
    let q = supabase.from('inventory_scrap_requests').select(SCRAP_COLS)
    q = applySite(applyCountry(q, country), site)
    return q.order('proposed_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
  }, 2000)
}

export const requestScrap = (payload, key) => classRpc('inv_scrap_request', payload, key)
export const cancelScrap = (payload) => classRpc('inv_scrap_cancel', payload)
export const evaluateScrap = (payload) => classRpc('inv_scrap_evaluate', payload)
export const decideScrap = (payload) => classRpc('inv_scrap_decide', payload)
export const postScrap = (payload) => classRpc('inv_scrap_post', payload)
export const disposeScrap = (payload) => classRpc('inv_scrap_dispose', payload)
