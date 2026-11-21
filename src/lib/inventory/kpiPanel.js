/**
 * Inventory KPI panel adapter (pure, no I/O).
 *
 * Shapes the rows read by src/lib/api/inventoryKpi.js into the inputs of the
 * tested engines in ./kpi.js and ./classification.js, calls them, and decides
 * what a tile may honestly say. It computes NOTHING itself beyond reshaping:
 * every number comes from an engine function.
 *
 * Honesty rules applied here:
 *   - a KPI whose source has no rows says which source is empty (`empty`),
 *     never a fabricated 0 or a bare N/A;
 *   - a source that is not installed or failed to load says so (`status`);
 *   - money is per currency; a headline appears only for exactly one currency;
 *   - money KPIs are hidden (not shown as unvalued) without stock:view_value,
 *     because the views return NULL money for those users.
 */
import {
  KPI_CATALOGUE, KPI_BY_ID, countAccuracy, serialAccuracy, countCompletion, inventoryValue, adjustmentValueKpi,
  turnoverAndDio, exposureKpis, stockoutFrequency, criticalAvailability, supplierDeliveryPerformance, leadTimeVariance,
  outstandingPoQty, consignmentUtilisation, emergencyPurchaseRate, reservedNotIssued, purchaseAvoidance,
} from './kpi'
import { classifyItems, classificationMatrix, DEFAULT_THRESHOLDS } from './classification'
import { buildReconciliationRows } from './auditView'
import { formatMoney, formatQty } from './inventoryMoney'

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const upper = (s) => String(s ?? '').trim().toUpperCase()
const ms = (d) => {
  if (!d) return null
  const t = Date.parse(d)
  return Number.isFinite(t) ? t : null
}

/** KPIs already on the Overview tiles (not repeated in the catalogue screen). */
export const SHOWN_ON_OVERVIEW = Object.freeze(['inv_stock_value', 'inv_discrepancies'])

/** The 23 remaining catalogue KPIs, grouped for the screen. */
export const PANEL_GROUPS = Object.freeze([
  { key: 'availability', ids: ['inv_critical_availability', 'inv_stockout_frequency', 'inv_reserved_not_issued'] },
  { key: 'accuracy', ids: ['inv_accuracy_exact_line', 'inv_accuracy_quantity', 'inv_accuracy_serial', 'inv_gross_shortage', 'inv_gross_excess', 'inv_count_completion'] },
  { key: 'value', ids: ['inv_unvalued_stock', 'inv_adjustment_value', 'inv_turnover', 'inv_dio', 'inv_dead_stock', 'inv_slow_stock', 'inv_excess_stock', 'inv_obsolescence_exposure'] },
  { key: 'supplier', ids: ['inv_supplier_otif', 'inv_lead_time_variance', 'inv_outstanding_po_qty', 'inv_consignment_utilisation', 'inv_emergency_purchase_rate', 'inv_purchase_avoidance'] },
])
export const PANEL_KPI_IDS = Object.freeze(PANEL_GROUPS.flatMap((g) => g.ids))

/** KPIs whose headline is money (or derived from money): hidden without view_value. */
export const MONEY_KPIS = new Set(['inv_adjustment_value', 'inv_turnover', 'inv_dio', 'inv_dead_stock', 'inv_slow_stock', 'inv_excess_stock', 'inv_obsolescence_exposure'])

/**
 * Period kind of each KPI (drives the "period" line on the tile):
 *   asAt   - balance as at now
 *   period - the selected window
 *   year   - the last 12 months, whatever the window
 *   count  - the latest count that reached reconciliation
 */
export const KPI_PERIOD = Object.freeze({
  inv_critical_availability: 'asAt', inv_stockout_frequency: 'period', inv_reserved_not_issued: 'asAt',
  inv_accuracy_exact_line: 'count', inv_accuracy_quantity: 'count', inv_accuracy_serial: 'count',
  inv_gross_shortage: 'count', inv_gross_excess: 'count', inv_count_completion: 'count',
  inv_unvalued_stock: 'asAt', inv_adjustment_value: 'period', inv_turnover: 'year', inv_dio: 'year',
  inv_dead_stock: 'asAt', inv_slow_stock: 'asAt', inv_excess_stock: 'asAt', inv_obsolescence_exposure: 'asAt',
  inv_supplier_otif: 'period', inv_lead_time_variance: 'period', inv_outstanding_po_qty: 'period',
  inv_consignment_utilisation: 'period', inv_emergency_purchase_rate: 'period', inv_purchase_avoidance: 'period',
})

/** Which sources each KPI reads (their load status decides the tile's state). */
export const KPI_SOURCES = Object.freeze({
  inv_critical_availability: ['valuation', 'items'],
  inv_stockout_frequency: ['movements', 'exceptions'],
  inv_reserved_not_issued: ['reservations', 'valuation'],
  inv_accuracy_exact_line: ['count'], inv_accuracy_quantity: ['count'], inv_accuracy_serial: ['count'],
  inv_gross_shortage: ['count'], inv_gross_excess: ['count'], inv_count_completion: ['count'],
  inv_unvalued_stock: ['valuation'],
  inv_adjustment_value: ['movements'],
  inv_turnover: ['movements', 'valuation'], inv_dio: ['movements', 'valuation'],
  inv_dead_stock: ['valuation', 'items', 'reservations'], inv_slow_stock: ['valuation', 'items', 'reservations'],
  inv_excess_stock: ['valuation', 'items'], inv_obsolescence_exposure: ['valuation', 'items'],
  inv_supplier_otif: ['orders', 'poLines', 'grnLines', 'grns'],
  inv_lead_time_variance: ['orders', 'poLines', 'grnLines', 'grns', 'agreements'],
  inv_outstanding_po_qty: ['orders', 'poLines'],
  inv_consignment_utilisation: ['agreements', 'consumptions', 'valuation'],
  inv_emergency_purchase_rate: ['orders'],
  inv_purchase_avoidance: [],
})

const ISSUE_TYPES = new Set(['issue'])
const ADJ_TYPES = new Set(['adjustment_up', 'adjustment_down'])
const rowsOf = (s) => (s && Array.isArray(s.rows) ? s.rows : [])

/** Engine-shaped balance rows (valuation.js camelCase) from v_inventory_valuation rows. */
export function toValuationRows(valuation = [], items = [], reservations = []) {
  const byItem = new Map(items.map((i) => [i.id, i]))
  const reservedStock = new Set(reservations.filter((r) => String(r.status || 'active') === 'active').map((r) => r.stock_id))
  return valuation.map((r) => {
    const it = byItem.get(r.item_id) || {}
    return {
      stock_id: r.stock_id,
      item_id: r.item_id ?? null,
      location_id: r.location_id ?? null,
      ownership: r.ownership || 'owned',
      owner_supplier_id: r.owner_supplier_id ?? null,
      currency: r.currency,
      valuedQty: num(r.valued_qty) ?? 0,
      unvaluedQty: num(r.unvalued_qty) ?? 0,
      valuedValue: num(r.valued_value),
      lastIssueAt: r.last_issue_at || null,
      itemCreatedAt: it.created_at || null,
      itemStatus: it.status || null,
      maxQty: it.max_qty ?? null,
      hasOpenReservation: reservedStock.has(r.stock_id) || (num(r.qty_reserved) ?? 0) > 0,
    }
  })
}

const inWindow = (d, from, to) => {
  const t = ms(d)
  if (t === null) return false
  if (from && t < ms(`${from}T00:00:00Z`)) return false
  if (to && t > ms(`${to}T23:59:59Z`)) return false
  return true
}

/** Last day of each of the `n` complete months before `now` (UTC), oldest first. */
export function monthEnds(now, n = 12) {
  const d = new Date(now)
  const out = []
  for (let i = n; i >= 1; i -= 1) {
    out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i + 1, 0, 23, 59, 59)))
  }
  return out
}

/**
 * Month-end owned stock value per currency, reconstructed from the ledger:
 * value now minus the value that moved after each month end. A month end
 * before the ledger began (or with unknown current value) is incomplete.
 */
export function monthEndSnapshots(valuationRows = [], movements = [], { now, ledgerStartAt } = {}) {
  const owned = valuationRows.filter((r) => (r.ownership || 'owned') === 'owned')
  const current = {}
  const unknown = new Set()
  for (const r of owned) {
    const cur = upper(r.currency)
    if (!cur) continue
    if (r.valuedValue === null) unknown.add(cur)
    current[cur] = (current[cur] || 0) + (r.valuedValue ?? 0)
  }
  const ledgerMs = ms(ledgerStartAt)
  const ownedMoves = movements.filter((m) => (m.ownership || 'owned') === 'owned')
  const snaps = []
  for (const end of monthEnds(now)) {
    const endMs = end.getTime()
    for (const cur of Object.keys(current)) {
      let after = 0
      let unvaluedAfter = false
      for (const m of ownedMoves) {
        if (upper(m.currency) !== cur) continue
        const t = ms(m.posted_at)
        if (t === null || t <= endMs) continue
        const v = num(m.value_change)
        if (v === null) unvaluedAfter = true
        else after += v
      }
      const complete = ledgerMs !== null && ledgerMs <= endMs && !unknown.has(cur) && !unvaluedAfter
      snaps.push({ date: end.toISOString(), currency: cur, value: Math.round((current[cur] - after) * 100) / 100, complete })
    }
  }
  return snaps
}

function earliest(dates) {
  const t = dates.map(ms).filter((x) => x !== null)
  return t.length ? new Date(Math.min(...t)).toISOString() : null
}
function latest(dates) {
  const t = dates.map(ms).filter((x) => x !== null)
  return t.length ? new Date(Math.max(...t)).toISOString() : null
}

/**
 * Everything the 23 KPIs need, computed by the engines.
 * Returns { [kpiId]: { result, empty, status, sourceError } } where
 *   status: 'ok' | 'not_provisioned' | 'error' (worst of the KPI's sources)
 *   empty:  translation key suffix of the empty-source sentence, or null.
 */
export function computeKpiPanel(sources = {}, { now = new Date(), from = null, to = null } = {}) {
  const items = rowsOf(sources.items)
  const reservations = rowsOf(sources.reservations)
  const valuation = toValuationRows(rowsOf(sources.valuation), items, reservations)
  const movements = rowsOf(sources.movements)
  const stockById = new Map(rowsOf(sources.valuation).map((r) => [r.stock_id, r]))
  const itemById = new Map(items.map((i) => [i.id, i]))
  const nowIso = new Date(now).toISOString()
  const out = {}
  const put = (id, result, empty = null) => { out[id] = { result, empty } }

  // ── Availability ──────────────────────────────────────────────────────────
  const perItem = new Map()
  for (const r of rowsOf(sources.valuation)) {
    if ((r.ownership || 'owned') !== 'owned' || !r.item_id) continue
    const it = itemById.get(r.item_id) || {}
    const p = perItem.get(r.item_id) || { item_id: r.item_id, criticality: it.criticality ?? null, safety_stock: it.safety_stock ?? null, on_hand: 0, reserved: 0 }
    p.on_hand += num(r.qty_on_hand) ?? 0
    p.reserved += num(r.qty_reserved) ?? 0
    perItem.set(r.item_id, p)
  }
  put('inv_critical_availability', criticalAvailability([...perItem.values()]), perItem.size ? null : 'noStock')

  const issuesInPeriod = movements.filter((m) => ISSUE_TYPES.has(m.movement_type) && inWindow(m.posted_at, from, to))
  const requests = [
    ...issuesInPeriod.map(() => ({ fulfilled_from_stock: true })),
    ...rowsOf(sources.exceptions).map(() => ({ fulfilled_from_stock: false })),
  ]
  put('inv_stockout_frequency', stockoutFrequency(requests), requests.length ? null : 'noRequests')

  const resRows = reservations.map((r) => {
    const s = stockById.get(r.stock_id) || {}
    const cost = num(s.avg_unit_cost) ?? (num(s.valued_qty) > 0 && num(s.valued_value) !== null ? num(s.valued_value) / num(s.valued_qty) : null)
    return {
      qty_reserved: num(r.qty), qty_issued: (num(r.qty_consumed) ?? 0) + (num(r.qty_released) ?? 0),
      reserved_at: r.created_at, status: r.status || 'active', unit_cost: cost, currency: s.currency || null,
    }
  })
  put('inv_reserved_not_issued', reservedNotIssued(resRows, { now: nowIso }), resRows.length ? null : 'noReservations')

  // ── Counting accuracy (latest count that reached reconciliation) ─────────
  const count = sources.count || {}
  const recon = buildReconciliationRows(count.snapshot || [], count.counts || [])
  const lines = recon.map((r) => ({
    expected_qty: r.expected_qty, counted_qty: r.counted_qty, confirmed_zero: false, uom: null,
    serial_tracked: !!r.serial_no, unit_cost: r.unit_cost, currency: r.currency,
  }))
  const acc = countAccuracy(lines)
  const noCount = recon.length ? null : 'noCount'
  put('inv_accuracy_exact_line', acc.exactLine, noCount)
  put('inv_accuracy_quantity', acc.quantity, noCount)
  put('inv_gross_shortage', acc.grossShortage, noCount)
  put('inv_gross_excess', acc.grossExcess, noCount)
  put('inv_count_completion', countCompletion(lines), noCount)
  const expectedSerials = recon.filter((r) => r.serial_no && r.expected_qty > 0).map((r) => r.serial_no)
  const foundSerials = recon.filter((r) => r.serial_no && (r.counted_qty ?? 0) > 0).map((r) => r.serial_no)
  put('inv_accuracy_serial', serialAccuracy(expectedSerials, foundSerials),
    noCount || (expectedSerials.length || foundSerials.length ? null : 'noSerialCount'))

  // ── Value and movement ───────────────────────────────────────────────────
  const noStock = valuation.length ? null : 'noStock'
  put('inv_unvalued_stock', inventoryValue(valuation).unvalued, noStock)
  const adj = movements.filter((m) => ADJ_TYPES.has(m.movement_type) && inWindow(m.posted_at, from, to))
    .map((m) => ({ type: m.movement_type, qtyChange: num(m.qty_change), valueChange: num(m.value_change), currency: m.currency }))
  put('inv_adjustment_value', adjustmentValueKpi(adj), adj.length ? null : 'noAdjustments')

  const yearStart = new Date(now)
  yearStart.setUTCFullYear(yearStart.getUTCFullYear() - 1)
  const yearIssues = movements.filter((m) => ISSUE_TYPES.has(m.movement_type) && (m.ownership || 'owned') === 'owned' && (ms(m.posted_at) ?? 0) >= yearStart.getTime())
  const issueQty = yearIssues.reduce((a, m) => a + Math.abs(num(m.qty_change) ?? 0), 0)
  const valuedIssueQty = yearIssues.filter((m) => num(m.value_change) !== null).reduce((a, m) => a + Math.abs(num(m.qty_change) ?? 0), 0)
  const turn = turnoverAndDio({
    issues: yearIssues.map((m) => ({ value: num(m.value_change), currency: m.currency })),
    snapshots: monthEndSnapshots(valuation, movements, { now, ledgerStartAt: sources.ledgerStartAt }),
    periodDays: 365,
    issueCoverage: issueQty > 0 ? valuedIssueQty / issueQty : null,
  })
  const noMoves = movements.length ? null : 'noMovements'
  put('inv_turnover', turn.turnover, noMoves)
  put('inv_dio', turn.dio, noMoves)

  const exp = exposureKpis(valuation, { now: nowIso, ledgerStartAt: sources.ledgerStartAt })
  put('inv_dead_stock', exp.dead, noStock)
  put('inv_slow_stock', exp.slow, noStock)
  put('inv_excess_stock', exp.excess, noStock)
  put('inv_obsolescence_exposure', exp.obsolescence, noStock)

  // ── Suppliers and procurement ────────────────────────────────────────────
  const orders = rowsOf(sources.orders)
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const grnById = new Map(rowsOf(sources.grns).map((g) => [g.id, g]))
  const receiptsByLine = new Map()
  for (const gl of rowsOf(sources.grnLines)) {
    const g = grnById.get(gl.grn_id)
    const d = g?.received_date || g?.created_at || null
    if (!gl.po_line_id || !d) continue
    const list = receiptsByLine.get(gl.po_line_id) || []
    list.push(d)
    receiptsByLine.set(gl.po_line_id, list)
  }
  const agreements = rowsOf(sources.agreements)
  const leadBySupplier = new Map()
  for (const a of agreements) {
    if (a.status && a.status !== 'active') continue
    const lt = num(a.lead_time_days)
    if (lt !== null && !leadBySupplier.has(a.supplier_id)) leadBySupplier.set(a.supplier_id, lt)
  }
  const poLines = rowsOf(sources.poLines).map((l) => {
    const o = orderById.get(l.po_id) || {}
    const rec = receiptsByLine.get(l.id) || []
    return {
      supplier_id: o.supplier_id || o.supplier_name || o.vendor_name || 'unknown',
      item_id: l.item_id, ordered_qty: num(l.qty_ordered), received_qty: num(l.qty_received), accepted_qty: num(l.qty_accepted),
      unit_price: num(l.unit_price), currency: l.currency || o.currency || null, uom: null, status: l.status,
      promised_at: o.expected_delivery || null, ordered_at: o.order_date || null,
      received_at: latest(rec), first_received_at: earliest(rec),
      agreed_lead_days: leadBySupplier.get(o.supplier_id) ?? null,
    }
  })
  const noOrders = orders.length ? null : 'noOrders'
  const noLines = noOrders || (poLines.length ? null : 'noPoLines')
  put('inv_supplier_otif', supplierDeliveryPerformance(poLines, { now: nowIso }), noLines)
  put('inv_lead_time_variance', leadTimeVariance(poLines.map((l) => ({ ...l, received_at: l.first_received_at }))), noLines)
  put('inv_outstanding_po_qty', outstandingPoQty(poLines), noLines)
  put('inv_emergency_purchase_rate', emergencyPurchaseRate(orders.map((o) => ({
    is_emergency: /emerg|urgent/i.test(String(o.priority || '')), total: num(o.total_amount), currency: o.currency, status: o.status,
  }))), noOrders)

  const consign = agreements.filter((a) => a.agreement_type === 'consignment' && (!a.status || a.status === 'active'))
  const consumed = rowsOf(sources.consumptions)
  const heldBySupplier = new Map()
  for (const r of rowsOf(sources.valuation)) {
    if (r.ownership !== 'consignment' || !r.owner_supplier_id) continue
    heldBySupplier.set(r.owner_supplier_id, (heldBySupplier.get(r.owner_supplier_id) || 0) + (num(r.qty_on_hand) ?? 0))
  }
  put('inv_consignment_utilisation', consignmentUtilisation(consign.map((a) => ({
    supplier_id: a.supplier_id,
    issued_qty: consumed.filter((c) => c.supplier_id === a.supplier_id).reduce((s, c) => s + (num(c.qty) ?? 0), 0),
    avg_on_hand_qty: heldBySupplier.has(a.supplier_id) ? heldBySupplier.get(a.supplier_id) : null,
    agreed_max_qty: num(a.max_qty),
  }))), consign.length ? null : 'noConsignment')

  // No table records whether a request was met from stock or by buying.
  put('inv_purchase_avoidance', purchaseAvoidance([]), 'fulfilmentNotRecorded')

  for (const id of PANEL_KPI_IDS) {
    const deps = KPI_SOURCES[id].map((k) => sources[k]).filter(Boolean)
    const failed = deps.find((s) => s.status === 'error')
    const missing = deps.find((s) => s.status === 'not_provisioned')
    out[id].status = failed ? 'error' : missing ? 'not_provisioned' : 'ok'
    out[id].sourceError = failed?.error || null
  }
  return out
}

const fmtNum = (v, digits = 2) => (num(v) === null ? null : Number(v).toLocaleString('en-US', { maximumFractionDigits: digits }))

/**
 * The display of one engine result: { primary, perCurrency: [{currency, text}] }.
 * `primary` is null when the KPI is not measurable (the screen then shows the
 * reason). Money is never summed across currencies.
 */
export function kpiDisplay(id, result, { canValue = true } = {}) {
  if (!result) return { primary: null, perCurrency: [] }
  const unit = KPI_BY_ID[id]?.unit
  const by = result.byCurrency || {}
  const perCurrency = []
  if (canValue) {
    for (const [cur, v] of Object.entries(by)) {
      if (cur === 'N/A') continue
      if (id === 'inv_turnover' || id === 'inv_dio') {
        const val = id === 'inv_turnover' ? v.turnover : v.dio
        perCurrency.push({ currency: cur, text: val === null || val === undefined ? `${cur} N/A` : `${cur} ${fmtNum(val)}${id === 'inv_turnover' ? 'x' : ' d'}` })
      } else if (id === 'inv_emergency_purchase_rate') {
        perCurrency.push({ currency: cur, text: v.valueSharePct === null ? `${cur} N/A` : `${cur} ${fmtNum(v.valueSharePct)}%` })
      } else if (id === 'inv_purchase_avoidance') {
        perCurrency.push({ currency: cur, text: v.unvaluedLines ? `${cur} N/A` : formatMoney(v.bookValue, cur) })
      } else if (id === 'inv_adjustment_value') {
        perCurrency.push({ currency: cur, text: v.complete ? `${formatMoney(v.net, cur)} (+${fmtNum(v.gain)} / -${fmtNum(v.loss)})` : `${cur} N/A` })
      } else {
        const val = v.complete === false ? null : v.value
        perCurrency.push({ currency: cur, text: val === null || val === undefined ? `${cur} N/A` : formatMoney(val, cur) })
      }
    }
  }
  const v = result.value
  let primary = null
  if (v !== null && v !== undefined) {
    if (unit === '%') primary = `${fmtNum(v)}%`
    else if (unit === 'times') primary = `${fmtNum(v)}x`
    else if (unit === 'days') primary = `${fmtNum(v, 1)} d`
    else if (unit === 'currency') primary = canValue ? formatMoney(v, result.currency) : null
    else primary = formatQty(v)
  }
  // One currency whose figure IS the headline adds nothing; show it otherwise.
  const redundant = perCurrency.length === 1 && primary !== null && ['currency', 'times', 'days'].includes(unit)
  return { primary, perCurrency: redundant ? [] : perCurrency }
}

// ── Classification ─────────────────────────────────────────────────────────

/**
 * Items for ABC / FSN / VED: every owned stocked item in scope plus any item
 * issued in the window. Consumption value = valued issue value in the last
 * 12 months in the item's currency; an unvalued issue or two currencies make
 * it unknown (the engine then marks the item unclassified, never C).
 */
export function buildClassificationItems({ valuation = [], items = [], movements = [] } = {}, { now = new Date() } = {}) {
  const itemById = new Map(items.map((i) => [i.id, i]))
  const yearStart = new Date(now)
  yearStart.setUTCMonth(yearStart.getUTCMonth() - DEFAULT_THRESHOLDS.fsn.windowMonths)
  const acc = new Map()
  const touch = (id) => {
    if (!acc.has(id)) acc.set(id, { item_id: id, currencies: new Set(), value: 0, unvalued: false, issueDates: [], onHand: 0, stockCurrencies: new Set(), sites: new Set() })
    return acc.get(id)
  }
  for (const r of valuation) {
    if ((r.ownership || 'owned') !== 'owned' || !r.item_id) continue
    const a = touch(r.item_id)
    a.onHand += num(r.qty_on_hand) ?? 0
    if (r.currency) a.stockCurrencies.add(upper(r.currency))
    if (r.site) a.sites.add(r.site)
  }
  for (const m of movements) {
    if (!ISSUE_TYPES.has(m.movement_type) || !m.item_id || (m.ownership || 'owned') !== 'owned') continue
    const t = ms(m.posted_at)
    if (t === null || t < yearStart.getTime()) continue
    const a = touch(m.item_id)
    a.issueDates.push(m.posted_at)
    if (m.currency) a.currencies.add(upper(m.currency))
    const v = num(m.value_change)
    if (v === null) a.unvalued = true
    else a.value += Math.abs(v)
  }
  return [...acc.values()].map((a) => {
    const it = itemById.get(a.item_id) || {}
    const curs = a.currencies.size ? a.currencies : a.stockCurrencies
    const currency = curs.size === 1 ? [...curs][0] : null
    const consumptionValue = a.unvalued || a.currencies.size > 1 ? null : Math.round(a.value * 100) / 100
    return {
      item_id: a.item_id,
      organisation_id: it.organisation_id ?? null,
      item_code: it.item_code || null,
      item_name: it.item_name || null,
      category: it.category ?? null,
      criticality: it.criticality ?? null,
      createdAt: it.created_at || null,
      currency,
      consumptionValue: curs.size > 1 ? null : consumptionValue,
      issueDates: a.issueDates,
      issues: a.issueDates.length,
      onHand: a.onHand,
      sites: [...a.sites].sort().join(', '),
    }
  })
}

/** Classified rows for the screen (engine output joined back to item details). */
export function classifyForScreen(sources = {}, { now = new Date() } = {}) {
  const items = buildClassificationItems({
    valuation: rowsOf(sources.valuation), items: rowsOf(sources.items), movements: rowsOf(sources.movements),
  }, { now })
  const classified = classifyItems(items, { now: new Date(now).toISOString(), ledgerStartAt: sources.ledgerStartAt || null })
  const byId = new Map(items.map((i) => [i.item_id, i]))
  const rows = classified.map((c) => ({ ...byId.get(c.item_id), ...c }))
  return { rows, ...classificationMatrix(rows) }
}

export const ABC_CLASSES = Object.freeze(['A', 'B', 'C', 'unclassified'])
export const FSN_CLASSES = Object.freeze(['F', 'S', 'N', 'unclassified'])
export const VED_CLASSES = Object.freeze(['V', 'E', 'D', 'unassessed'])

/** Engine reasons the screen has a sentence for (anything else reads 'not measurable'). */
export const KPI_REASONS = Object.freeze([
  'not_measurable', 'mixed_currency', 'no_valued_data', 'value_incomplete', 'now_required', 'mixed_units',
  'fewer_than_3_complete_snapshots', 'average_stock_value_zero', 'issue_value_incomplete', 'issue_coverage_below_80pct',
  'turnover_zero', 'no_data', 'expected_total_zero', 'no_adjustments', 'no_consigned_stock_held', 'no_counted_lines',
  'no_lines_due', 'no_lines_in_scope', 'no_owned_stock', 'no_purchase_orders', 'no_received_line_with_agreed_lead_time',
  'no_requests_with_known_outcome', 'no_resolved_requests', 'no_vital_items', 'nothing_expected_or_found',
])

/** Empty-source sentences (translation keys under inventory.kpis.empty). */
export const KPI_EMPTY_KEYS = Object.freeze([
  'noStock', 'noRequests', 'noReservations', 'noCount', 'noSerialCount', 'noAdjustments', 'noMovements',
  'noOrders', 'noPoLines', 'noConsignment', 'fulfilmentNotRecorded',
])

export const CATALOGUE_IDS = Object.freeze(KPI_CATALOGUE.map((k) => k.id))
