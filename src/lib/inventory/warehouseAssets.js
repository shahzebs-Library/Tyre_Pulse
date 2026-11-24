/**
 * Warehouse assets and finance engine (pure, no I/O).
 *
 * Four areas, each built on objects that already exist:
 *
 *  1. Tool custody. The Tool & Equipment Registry (`equipment`) records what a
 *     tool is and its status (available, in_use, maintenance, retired). It does
 *     NOT record who holds it or when it is due back. The custody rules below run
 *     on custody rows (holder, issued_at, due_back_at, returned_at) once the
 *     custody table proposed in docs/warehouse/10_ASSETS_FINANCE_DB_CHANGES.md
 *     exists. Until then a tool "in use" has an unknown holder, never a guessed one.
 *
 *  2. Repairable parts. A part out for repair is stock in a repairable, damaged,
 *     quarantine, warranty or scrap condition, or held in a location of that type
 *     (supplier_custody = at the vendor). Both are existing stock_records /
 *     inventory_locations vocabularies (DB CHECKs), so the status is derived from
 *     the stock balance itself, never from a second register.
 *
 *  3. Warranty and scrap for non-tyre stock. A warranty claim is raised in the
 *     existing warranty_claims table. A claim never carries a credit amount when
 *     it is raised (credit is the supplier's decision, recorded later). Scrap is
 *     validated here but posted only through an approved request; see the DB note.
 *
 *  4. Financial reconciliation per site, month and currency. Stock value (today),
 *     ERP issue cost (parts_consumption via v_inv_erp_reconciliation), in-app
 *     issue value and receipts. Money is summed PER CURRENCY and never across
 *     currencies. Quantity without a known cost is reported as unvalued, never
 *     as zero cost. A value the user may not see (view_value) stays hidden (null).
 */
import { sumByCurrency } from './inventoryMoney'

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const DAY = 24 * 60 * 60 * 1000
const ms = (d) => {
  if (!d) return null
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
  return Number.isFinite(t) ? t : null
}
const up = (v) => String(v ?? '').trim().toUpperCase()

// ── 1. Tool custody ───────────────────────────────────────────────────────────

export const CUSTODY_STATUS = Object.freeze({
  out: 'Out with holder',
  overdue: 'Overdue',
  no_due_date: 'Out, no due date',
  returned: 'Returned',
})

/**
 * Status of one custody row. Returned wins. An open row without a due date is
 * never called overdue: a missing promise is a gap, not a breach.
 * @returns {{ status: string, daysOut: number|null, daysOverdue: number|null }}
 */
export function custodyStatus(row, now = Date.now()) {
  const issued = ms(row?.issued_at)
  const due = ms(row?.due_back_at)
  const returned = ms(row?.returned_at)
  const daysOut = issued === null ? null : Math.max(0, Math.floor(((returned ?? now) - issued) / DAY))
  if (returned !== null) return { status: 'returned', daysOut, daysOverdue: null }
  if (due === null) return { status: 'no_due_date', daysOut, daysOverdue: null }
  if (now > due) return { status: 'overdue', daysOut, daysOverdue: Math.max(1, Math.ceil((now - due) / DAY)) }
  return { status: 'out', daysOut, daysOverdue: null }
}

/** Open custody rows with their status, overdue first then longest out. */
export function openCustody(rows, now = Date.now()) {
  return (rows || [])
    .map((r) => ({ ...r, ...custodyStatus(r, now) }))
    .filter((r) => r.status !== 'returned')
    .sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1) || (b.daysOut ?? -1) - (a.daysOut ?? -1))
}

/**
 * Registry + custody summary. `tools` are equipment rows; `custody` are custody
 * rows (or null when the custody table is not set up). A tool with status
 * in_use and no open custody row has an UNKNOWN holder.
 */
export function summarizeTools(tools, custody, now = Date.now()) {
  const list = tools || []
  const byStatus = {}
  for (const t of list) {
    const s = String(t?.status || 'unspecified')
    byStatus[s] = (byStatus[s] || 0) + 1
  }
  const open = custody ? openCustody(custody, now) : []
  const heldIds = new Set(open.map((r) => r.equipment_id).filter(Boolean))
  const inUseUnknownHolder = list.filter((t) => t?.status === 'in_use' && !heldIds.has(t.id)).length
  const holders = new Set(open.map((r) => String(r.holder_name || r.holder_user_id || '').trim()).filter(Boolean))
  return {
    tools: list.length,
    byStatus,
    custodyTracked: custody !== null && custody !== undefined,
    open: open.length,
    overdue: open.filter((r) => r.status === 'overdue').length,
    noDueDate: open.filter((r) => r.status === 'no_due_date').length,
    holders: holders.size,
    inUseUnknownHolder,
  }
}

/**
 * Items issued to a person through a material issue (MIS) and not yet returned
 * (MRT), by item code and holder. The issue ledger has no due date, so these
 * are "held", never "overdue".
 */
export function heldByPerson(issues) {
  const map = new Map()
  for (const h of issues || []) {
    const who = String(h?.issued_to || '').trim()
    if (!who) continue
    const sign = up(h?.doc_type) === 'MRT' ? -1 : 1
    for (const l of h?.lines || []) {
      const code = up(l?.item_code)
      const q = num(l?.qty)
      if (!code || q === null) continue
      const key = `${who.toUpperCase()}|${code}`
      const cur = map.get(key) || { holder: who, item_code: code, description: l?.item_description || null, qty: 0, lastIssued: null }
      cur.qty += sign * q
      if (sign > 0 && (!cur.lastIssued || ms(h.issued_at) > ms(cur.lastIssued))) cur.lastIssued = h.issued_at
      map.set(key, cur)
    }
  }
  return [...map.values()].filter((r) => r.qty > 0.0001).sort((a, b) => a.holder.localeCompare(b.holder) || a.item_code.localeCompare(b.item_code))
}

// ── 2. Repairable parts ───────────────────────────────────────────────────────

export const REPAIR_STATES = Object.freeze({
  at_vendor: 'At vendor (out for repair or exchange)',
  awaiting_repair: 'Awaiting repair',
  under_warranty: 'Held for warranty',
  quarantine: 'Quarantine (inspect before use)',
  damaged: 'Damaged',
  scrap_pending: 'Marked scrap, not yet written off',
})

const LOCATION_STATE = { supplier_custody: 'at_vendor', repairable: 'awaiting_repair', warranty: 'under_warranty', quarantine: 'quarantine', damaged: 'damaged', scrap: 'scrap_pending' }
const CONDITION_STATE = { repairable: 'awaiting_repair', damaged: 'damaged', quarantine: 'quarantine', scrap: 'scrap_pending' }

/**
 * Repair state of one stock balance, or null when it is ordinary usable stock.
 * The location wins over the condition: a damaged part sitting at the vendor
 * is "at vendor".
 */
export function repairState(balance, location) {
  const lt = String(location?.location_type || '').toLowerCase()
  if (LOCATION_STATE[lt]) return LOCATION_STATE[lt]
  const c = String(balance?.condition || '').toLowerCase()
  return CONDITION_STATE[c] || null
}

/**
 * Repairable stock with its state. `valuation` rows are v_inv_valuation rows;
 * `locations` are inventory_locations rows. Zero on-hand rows are skipped.
 */
export function repairableRows(valuation, locations) {
  const locById = new Map((locations || []).map((l) => [l.id, l]))
  const out = []
  for (const b of valuation || []) {
    const q = num(b?.qty_on_hand)
    if (q === null || q <= 0) continue
    const loc = locById.get(b.location_id) || null
    const state = repairState(b, loc)
    if (!state) continue
    out.push({ ...b, state, location_code: loc?.code || null, location_type: loc?.location_type || null })
  }
  return out.sort((a, b) => a.state.localeCompare(b.state) || String(a.item_code || '').localeCompare(String(b.item_code || '')))
}

/** Counts, quantity and value per state; value per currency, unvalued counted apart. */
export function summarizeRepairables(rows) {
  const byState = {}
  for (const k of Object.keys(REPAIR_STATES)) byState[k] = { rows: 0, qty: 0, unvaluedQty: 0 }
  for (const r of rows || []) {
    const s = byState[r.state]
    if (!s) continue
    s.rows += 1
    s.qty += num(r.qty_on_hand) || 0
    s.unvaluedQty += num(r.unvalued_qty) || 0
  }
  const money = sumByCurrency(rows, (r) => r.valued_amount, (r) => r.currency)
  const unvaluedQty = (rows || []).reduce((a, r) => a + (num(r.unvalued_qty) || 0), 0)
  return { byState, totals: money.totals, unvaluedQty, hiddenValue: (rows || []).some((r) => r.valued_amount === null && (num(r.valued_qty) || 0) > 0) }
}

/** Repair-type locations that exist for a site; empty means the flow cannot be used yet. */
export function repairLocationCoverage(locations) {
  const have = new Set((locations || []).filter((l) => l?.active !== false).map((l) => String(l.location_type || '').toLowerCase()))
  return Object.keys(LOCATION_STATE).map((type) => ({ type, present: have.has(type) }))
}

// ── 3. Warranty and scrap for non-tyre stock ─────────────────────────────────

export const STOCK_WARRANTY_SOURCE = 'inventory'
export const STOCK_FAILURE_TYPES = Object.freeze([
  'Manufacturing defect', 'Failed in service before expected life', 'Wrong part supplied', 'Damaged on arrival', 'Other',
])

/**
 * Validate and build the warranty_claims insert for one stock balance. The
 * claim starts as Submitted with NO credit amount (never 0): the credit is the
 * supplier's decision, recorded on the Warranty page. Returns { payload } or
 * { error }.
 */
export function stockWarrantyDraft(stock, form = {}) {
  if (!stock?.stock_id && !stock?.id) return { error: 'Choose the stock line the claim is for.' }
  const failure = String(form.failure_type || '').trim()
  if (!failure) return { error: 'Choose what went wrong.' }
  const qty = num(form.qty)
  const onHand = num(stock.qty_on_hand)
  if (qty === null || qty <= 0) return { error: 'Enter how many units the claim covers.' }
  if (onHand !== null && qty > onHand) return { error: `The claim cannot cover more than the ${onHand} on hand.` }
  const notes = String(form.notes || '').trim()
  if (failure === 'Other' && !notes) return { error: 'Describe the failure.' }
  const supplier = String(form.supplier || '').trim() || null
  return {
    payload: {
      claim_status: 'Submitted',
      serial_number: String(form.serial || '').trim() || null,
      brand: String(form.brand || '').trim() || null,
      site: stock.site || null,
      country: stock.country || null,
      failure_type: failure.slice(0, 200),
      supplier,
      notes: [notes, `Stock item ${stock.item_code || 'with no code'}: ${stock.description || ''}`.trim()].filter(Boolean).join('\n').slice(0, 5000),
      custom_data: {
        source: STOCK_WARRANTY_SOURCE,
        stock_id: stock.stock_id || stock.id,
        item_id: stock.item_id || null,
        item_code: stock.item_code || null,
        location_id: stock.location_id || null,
        qty,
      },
    },
  }
}

/** Claims raised from stock, keyed by stock id (newest first per stock line). */
export function claimsByStock(claims) {
  const map = new Map()
  for (const c of claims || []) {
    const id = c?.custom_data?.stock_id
    if (!id) continue
    const arr = map.get(id) || []
    arr.push(c)
    map.set(id, arr)
  }
  for (const arr of map.values()) arr.sort((a, b) => (ms(b.created_at) || 0) - (ms(a.created_at) || 0))
  return map
}

/**
 * Validate a scrap proposal. It is only ever sent as a request for approval;
 * nothing is posted from the client. Returns { proposal } or { error }.
 */
export function scrapProposal(stock, form = {}) {
  if (!stock?.stock_id) return { error: 'Choose the stock line to scrap.' }
  const qty = num(form.qty)
  const onHand = num(stock.qty_on_hand)
  if (qty === null || qty <= 0) return { error: 'Enter how many units to scrap.' }
  if (onHand !== null && qty > onHand) return { error: `You cannot scrap more than the ${onHand} on hand.` }
  const reason = String(form.reason || '').trim()
  if (reason.length < 5) return { error: 'Give the reason for scrapping (at least a few words).' }
  return { proposal: { stock_id: stock.stock_id, qty, reason: reason.slice(0, 1000) } }
}

// ── 4. Financial reconciliation ──────────────────────────────────────────────

const monthKey = (d) => {
  const t = ms(d)
  if (t === null) return null
  const x = new Date(t)
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`
}
const addNullable = (a, b) => (b === null ? a : (a ?? 0) + b)

/**
 * One row per site + month + currency:
 *  - erpQty / erpValue / erpLines: ERP issues (parts_consumption, plus in-app
 *    issues the ERP has not seen), from v_inv_erp_reconciliation;
 *  - invIssueQty / invIssueValue / invIssueUnvaluedQty: in-app issue movements;
 *    invIssueValue is null when the value is hidden from this user;
 *  - receiptQty / receiptValue / receiptUnvaluedQty: receipts (stock_movements).
 * A value with nothing behind it stays null, never 0.
 */
export function buildFinanceRecon({ erpRows = [], receipts = [] } = {}) {
  const map = new Map()
  const get = (site, month, currency, country) => {
    const k = `${up(site) || '(NO SITE)'}|${month}|${up(currency) || '?'}`
    let r = map.get(k)
    if (!r) {
      r = {
        key: k, site: up(site) || null, month, currency: up(currency) || null, country: country || null,
        erpQty: null, erpValue: null, erpLines: 0,
        invIssueQty: null, invIssueValue: null, invIssueUnvaluedQty: null, invIssueValueHidden: false,
        receiptQty: null, receiptValue: null, receiptUnvaluedQty: null, receiptMovements: 0,
      }
      map.set(k, r)
    }
    return r
  }
  for (const e of erpRows || []) {
    const month = monthKey(e?.month)
    if (!month) continue
    const r = get(e.site, month, e.currency, e.country)
    const lines = num(e.erp_lines) || 0
    if (lines > 0) {
      r.erpLines += lines
      r.erpQty = addNullable(r.erpQty, num(e.erp_qty))
      r.erpValue = addNullable(r.erpValue, num(e.erp_value))
    }
    const moves = num(e.inventory_movements) || 0
    if (moves > 0) {
      r.invIssueQty = addNullable(r.invIssueQty, num(e.inventory_qty))
      r.invIssueUnvaluedQty = addNullable(r.invIssueUnvaluedQty, num(e.inventory_unvalued_qty))
      if (e.inventory_value === null || e.inventory_value === undefined) r.invIssueValueHidden = true
      else r.invIssueValue = addNullable(r.invIssueValue, num(e.inventory_value))
    }
  }
  for (const m of receipts || []) {
    const month = monthKey(m?.effective_at || m?.posted_at || m?.created_at)
    if (!month) continue
    const r = get(m.site, month, m.currency, m.country)
    r.receiptMovements += 1
    r.receiptQty = addNullable(r.receiptQty, num(m.qty_change))
    r.receiptUnvaluedQty = addNullable(r.receiptUnvaluedQty, num(m.unvalued_qty_change) ?? 0)
    if (m.value_change !== null && m.value_change !== undefined) r.receiptValue = addNullable(r.receiptValue, num(m.value_change))
  }
  return [...map.values()].sort((a, b) => b.month.localeCompare(a.month) || String(a.site).localeCompare(String(b.site)) || String(a.currency).localeCompare(String(b.currency)))
}

/** Stock value today per site + currency (valued amount, valued qty, unvalued qty). */
export function stockValueBySite(valuation) {
  const map = new Map()
  for (const b of valuation || []) {
    const k = `${up(b?.site) || '(NO SITE)'}|${up(b?.currency) || '?'}`
    const r = map.get(k) || { key: k, site: up(b?.site) || null, currency: up(b?.currency) || null, country: b?.country || null, qtyOnHand: 0, valuedQty: 0, unvaluedQty: 0, valuedAmount: null, valueHidden: false, lines: 0 }
    r.lines += 1
    r.qtyOnHand += num(b?.qty_on_hand) || 0
    r.valuedQty += num(b?.valued_qty) || 0
    r.unvaluedQty += num(b?.unvalued_qty) || 0
    if (b?.valued_amount === null || b?.valued_amount === undefined) {
      if ((num(b?.valued_qty) || 0) > 0) r.valueHidden = true
    } else r.valuedAmount = addNullable(r.valuedAmount, num(b.valued_amount))
    map.set(k, r)
  }
  return [...map.values()].sort((a, b) => String(a.site).localeCompare(String(b.site)) || String(a.currency).localeCompare(String(b.currency)))
}

/**
 * Totals per currency over recon rows. Never adds two currencies together.
 * A row with no currency is counted apart (noCurrency).
 */
export function financeTotals(rows) {
  const map = new Map()
  let noCurrency = 0
  for (const r of rows || []) {
    if (!r.currency || r.currency === '?') { noCurrency += 1; continue }
    const t = map.get(r.currency) || { currency: r.currency, erpValue: null, erpLines: 0, invIssueValue: null, invIssueUnvaluedQty: null, receiptValue: null, receiptUnvaluedQty: null, invIssueValueHidden: false }
    t.erpValue = addNullable(t.erpValue, r.erpValue)
    t.erpLines += r.erpLines || 0
    t.invIssueValue = addNullable(t.invIssueValue, r.invIssueValue)
    t.invIssueUnvaluedQty = addNullable(t.invIssueUnvaluedQty, r.invIssueUnvaluedQty)
    t.receiptValue = addNullable(t.receiptValue, r.receiptValue)
    t.receiptUnvaluedQty = addNullable(t.receiptUnvaluedQty, r.receiptUnvaluedQty)
    t.invIssueValueHidden = t.invIssueValueHidden || !!r.invIssueValueHidden
    map.set(r.currency, t)
  }
  const round = (v) => (v === null ? null : Math.round(v * 100) / 100)
  const totals = [...map.values()].map((t) => ({
    ...t, erpValue: round(t.erpValue), invIssueValue: round(t.invIssueValue), receiptValue: round(t.receiptValue),
  })).sort((a, b) => a.currency.localeCompare(b.currency))
  return { totals, noCurrency }
}

/**
 * Plain-English finding for one recon row: what the ERP issued that the store
 * never recorded, or the reverse.
 */
export function reconFinding(r) {
  if (!r) return null
  const erp = (r.erpLines || 0) > 0
  const inv = r.invIssueQty !== null
  if (erp && !inv) return 'Issued in the ERP, not recorded as an issue in the store.'
  if (inv && !erp) return 'Issued in the store, not in the ERP.'
  if (inv && (r.invIssueUnvaluedQty || 0) > 0) return 'Store issues include unvalued quantity; the cost is unknown, not zero.'
  if (inv && erp && Math.abs((r.invIssueQty || 0) - (r.erpQty || 0)) > 0.0001) return 'Quantities differ between the store and the ERP.'
  if (inv && erp) return 'Quantities agree.'
  if ((r.receiptMovements || 0) > 0) return 'Receipts only this month.'
  return null
}

/** First day of the month `n` months before `now`, as YYYY-MM-DD. */
export function monthsAgoStart(n, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - Math.max(0, n | 0), 1))
  return d.toISOString().slice(0, 10)
}
