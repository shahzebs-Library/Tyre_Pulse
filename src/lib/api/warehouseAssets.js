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
import { supabase, fetchAllPages, applyCountry, toServiceError, isNotProvisioned } from './_client'
import { listAllEquipment } from './equipment'
import { createWarrantyClaim } from './warranty'
import { loadValuation, listLocations } from './inventory'
import { STOCK_WARRANTY_SOURCE, stockWarrantyDraft } from '../inventory/warehouseAssets'

export const CUSTODY_TABLE = 'equipment_custody'
export const ISSUE_MAX = 5000
export const RECON_MAX = 20000
export const MOVEMENT_MAX = 5000
export const CLAIM_MAX = 2000

const applySite = (q, site) => (site && site !== 'all' ? q.eq('site', site) : q)

/** Run a bounded paged read; a missing relation answers not_provisioned. */
async function bounded(pageFn, max) {
  try {
    const { data, error, truncated } = await fetchAllPages(pageFn, { max })
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

/** v_inv_erp_reconciliation rows from `fromMonth` (YYYY-MM-01). The view has no id. */
export function loadErpIssueRows({ country, site, fromMonth } = {}) {
  return bounded((from, to) => {
    let q = supabase.from('v_inv_erp_reconciliation').select(ERP_COLS)
    q = applySite(applyCountry(q, country), site)
    if (fromMonth) q = q.gte('month', fromMonth)
    return q.order('month', { ascending: false })
      .order('country', { ascending: true }).order('site', { ascending: true })
      .order('item_code', { ascending: true }).order('currency', { ascending: true })
      .range(from, to)
  }, RECON_MAX)
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

/** Everything the finance reconciliation needs, read in parallel. */
export async function loadFinanceRecon({ country, site, fromMonth } = {}) {
  const [erp, receipts, valuation] = await Promise.all([
    loadErpIssueRows({ country, site, fromMonth }),
    loadReceiptMovements({ country, site, fromMonth }),
    loadValuation({ country, site }),
  ])
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
