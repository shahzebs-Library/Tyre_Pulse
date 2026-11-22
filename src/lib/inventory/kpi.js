/**
 * Inventory KPI engine (pure). Catalogue + formulas: docs/inventory/21_KPI_CATALOGUE.md
 *
 * Every KPI returns { id, value, unit, reason, ...detail }:
 *   - value null + reason when the KPI is not measurable (zero denominator,
 *     mixed units, mixed currency, missing cost, too little history). A
 *     non-measurable KPI is NEVER rendered as 0 or 100%.
 *   - money is per currency (`byCurrency`); a single headline value is only given
 *     when exactly one currency is in scope.
 *   - gross shortage and gross excess are always reported separately; net alone
 *     hides offsetting losses.
 * Inventory value is balance-sheet only. Nothing here reads or feeds
 * parts_consumption, CPK or cost per m3.
 */
import { num, roundMoney, summarizeValuation, adjustmentValue, exposure } from './valuation'

const ratio = (n, d) => (d > 0 ? n / d : null)
const pct = (r) => (r === null ? null : Math.round(r * 10000) / 100)
const upper = (s) => String(s ?? '').trim().toUpperCase()
const ms = (d) => {
  if (!d) return null
  const t = d instanceof Date ? d.getTime() : Date.parse(d)
  return Number.isFinite(t) ? t : null
}
const DAY = 86400000

function kpi(id, value, unit, extra = {}) {
  return { id, value, unit, reason: value === null ? extra.reason ?? 'not_measurable' : null, ...extra }
}

/** Headline from a per-currency map: one currency -> its value; several -> null. */
function headline(byCurrency, field = 'value') {
  const keys = Object.keys(byCurrency).filter((k) => k !== 'N/A')
  if (keys.length === 0) return { value: null, currency: null, reason: 'no_valued_data' }
  if (keys.length > 1) return { value: null, currency: null, reason: 'mixed_currency' }
  return { value: byCurrency[keys[0]][field] ?? null, currency: keys[0], reason: byCurrency[keys[0]][field] == null ? 'value_incomplete' : null }
}

// ---------------------------------------------------------------------------
// Catalogue (the source for metric_registry rows - keep in sync with doc 21)
// ---------------------------------------------------------------------------

export const KPI_CATALOGUE = Object.freeze([
  { id: 'inv_accuracy_exact_line', label: 'Inventory accuracy (exact line)', unit: '%', scope: 'audit / location / item set', period: 'per approved count', source: 'inventory_count_lines vs inventory_audit_snapshot_lines', formula: 'lines with |counted - expected| <= tolerance / lines counted', nullRule: 'no counted lines' },
  { id: 'inv_accuracy_quantity', label: 'Inventory accuracy (quantity)', unit: '%', scope: 'audit', period: 'per approved count', source: 'count lines', formula: '1 - sum|counted - expected| / sum expected', nullRule: 'expected total 0, or more than one unit of measure' },
  { id: 'inv_accuracy_serial', label: 'Serial accuracy', unit: '%', scope: 'tyre serial audit', period: 'per count', source: 'serial count lines vs expected serials', formula: 'matched serials / (expected serials union found serials)', nullRule: 'nothing expected and nothing found' },
  { id: 'inv_gross_shortage', label: 'Gross shortage', unit: 'qty and currency', scope: 'audit', period: 'per approved count', source: 'count lines x WAC', formula: 'sum max(expected - counted, 0) (x unit cost)', nullRule: 'qty null if mixed units; value null if any short line unvalued' },
  { id: 'inv_gross_excess', label: 'Gross excess', unit: 'qty and currency', scope: 'audit', period: 'per approved count', source: 'count lines x WAC', formula: 'sum max(counted - expected, 0) (x unit cost)', nullRule: 'as gross shortage' },
  { id: 'inv_count_completion', label: 'Count completion', unit: '%', scope: 'audit', period: 'audit lifetime', source: 'snapshot lines vs count lines', formula: 'lines counted or confirmed zero / lines in scope', nullRule: 'no lines in scope' },
  { id: 'inv_stock_value', label: 'Inventory value (owned)', unit: 'currency', scope: 'company / country / site / location', period: 'as at', source: 'stock_records valued qty x WAC', formula: 'sum valued value of owned stock', nullRule: 'any owned line unvalued (valued part and priced % still shown); mixed currency headline' },
  { id: 'inv_unvalued_stock', label: 'Unvalued stock', unit: 'lines / qty', scope: 'as inventory value', period: 'as at', source: 'stock_records unvalued qty', formula: 'count and qty of owned stock with no known cost', nullRule: 'never null (0 is a real answer)' },
  { id: 'inv_adjustment_value', label: 'Adjustment value', unit: 'currency', scope: 'company / site', period: 'period', source: 'stock_movements adjustment_up/down', formula: 'gross gain, gross loss, net, absolute', nullRule: 'value incomplete when any adjustment unvalued' },
  { id: 'inv_turnover', label: 'Inventory turnover', unit: 'times', scope: 'company / country', period: '12 months', source: 'issue value / average month-end stock value', formula: 'issue value / average stock value', nullRule: 'fewer than 3 complete month-end values, average 0, issue coverage < 80%, mixed currency' },
  { id: 'inv_dio', label: 'Days inventory outstanding', unit: 'days', scope: 'as turnover', period: 'as turnover', source: 'turnover', formula: 'period days / turnover', nullRule: 'turnover null or 0' },
  { id: 'inv_dead_stock', label: 'Dead stock', unit: 'currency / qty', scope: 'owned stock', period: 'as at', source: 'balances + last issue', formula: 'value of owned stock with no issue in 365 days, no open reservation', nullRule: 'item too new or ledger too short -> line unknown, not dead' },
  { id: 'inv_slow_stock', label: 'Slow-moving stock', unit: 'currency / qty', scope: 'owned stock', period: 'as at', source: 'balances + last issue', formula: 'no issue in 180-364 days', nullRule: 'as dead stock' },
  { id: 'inv_excess_stock', label: 'Excess stock', unit: 'currency / qty', scope: 'owned stock', period: 'as at', source: 'balances + max qty', formula: 'qty above max_qty x WAC', nullRule: 'line without max_qty counted as unknown' },
  { id: 'inv_obsolescence_exposure', label: 'Obsolescence exposure', unit: 'currency', scope: 'owned stock', period: 'as at', source: 'balances + material status obsolete', formula: 'value of owned stock whose item is obsolete', nullRule: 'value incomplete when unvalued qty present' },
  { id: 'inv_stockout_frequency', label: 'Stock-out frequency', unit: '%', scope: 'site / item', period: 'period', source: 'issue requests / reservations', formula: 'requests not fulfilled from stock at request time / requests with a known outcome', nullRule: 'no requests with a known outcome' },
  { id: 'inv_critical_availability', label: 'Critical item availability', unit: '%', scope: 'site', period: 'as at', source: 'balances + VED / criticality + safety stock', formula: 'vital items with available qty >= safety stock (>0 when unset) / vital items', nullRule: 'no vital items' },
  { id: 'inv_supplier_otif', label: 'Supplier delivery performance (OTIF)', unit: '%', scope: 'supplier', period: 'period', source: 'purchase_order_lines + goods_receipt_lines', formula: 'lines on time AND in full / lines due', nullRule: 'no lines due' },
  { id: 'inv_lead_time_variance', label: 'Lead-time variance', unit: 'days', scope: 'supplier', period: 'period', source: 'PO ordered_at, receipt received_at, agreement lead time', formula: 'mean(actual lead days - agreed lead days), plus std dev', nullRule: 'no received line with an agreed lead time' },
  { id: 'inv_discrepancies', label: 'Discrepancies', unit: 'count / currency', scope: 'audit / site', period: 'period', source: 'inventory_discrepancies', formula: 'open, by category, by status; shortage and excess value separate', nullRule: 'value null if any impact unvalued' },
  { id: 'inv_outstanding_po_qty', label: 'Outstanding PO quantity', unit: 'qty / currency', scope: 'item / supplier', period: 'as at', source: 'purchase_order_lines', formula: 'sum max(ordered - received, 0) on open lines', nullRule: 'qty headline null across mixed units' },
  { id: 'inv_consignment_utilisation', label: 'Consignment utilisation', unit: 'times / %', scope: 'supplier agreement', period: 'period', source: 'consignment movements + agreement', formula: 'consigned qty issued / average consigned qty held; held / agreed max', nullRule: 'no consigned stock held' },
  { id: 'inv_emergency_purchase_rate', label: 'Emergency purchase rate', unit: '%', scope: 'company / site', period: 'period', source: 'purchase orders flagged emergency', formula: 'emergency POs / POs; value share per currency', nullRule: 'no POs' },
  { id: 'inv_reserved_not_issued', label: 'Reserved but not issued', unit: 'qty / currency', scope: 'site / work order', period: 'as at', source: 'reservations', formula: 'open reserved qty not issued, older than N days', nullRule: 'value null when any line unvalued' },
  { id: 'inv_purchase_avoidance', label: 'Purchase avoidance (stock used instead of buying)', unit: '% / currency (book value)', scope: 'company / site', period: 'period', source: 'requests and how they were fulfilled', formula: 'requests fulfilled from stock or reusable stock / resolved requests; book value of stock used', nullRule: 'no resolved requests; value is book value, not a saving' },
])

// ---------------------------------------------------------------------------
// Counting accuracy
// ---------------------------------------------------------------------------

const isCounted = (l) => l.confirmed_zero === true || num(l.counted_qty) !== null

/**
 * Accuracy and gross variance from count lines.
 * line = { expected_qty, counted_qty, confirmed_zero, uom, serial_tracked, tolerance, unit_cost, currency }
 * Uncounted lines are excluded from accuracy (completion covers them).
 */
export function countAccuracy(lines = [], { tolerance = 0 } = {}) {
  const counted = lines.filter(isCounted)
  const uoms = new Set(counted.map((l) => upper(l.uom) || 'EA'))
  const mixed = uoms.size > 1
  let exact = 0
  let expTotal = 0
  let absVar = 0
  let shortQty = 0
  let excessQty = 0
  const money = {}
  for (const l of counted) {
    const exp = num(l.expected_qty) ?? 0
    const cnt = l.confirmed_zero === true ? 0 : num(l.counted_qty)
    const diff = cnt - exp
    const tol = l.serial_tracked ? 0 : Math.max(0, num(l.tolerance) ?? tolerance)
    if (Math.abs(diff) <= tol + 1e-9) exact += 1
    expTotal += exp
    absVar += Math.abs(diff)
    if (diff < 0) shortQty += -diff
    if (diff > 0) excessQty += diff
    if (diff !== 0) {
      const cur = upper(l.currency) || 'N/A'
      const m = (money[cur] ||= { shortage: 0, excess: 0, unvaluedShortLines: 0, unvaluedExcessLines: 0 })
      const c = num(l.unit_cost)
      if (diff < 0) {
        if (c === null) m.unvaluedShortLines += 1
        else m.shortage = roundMoney(m.shortage + -diff * c)
      } else if (c === null) m.unvaluedExcessLines += 1
      else m.excess = roundMoney(m.excess + diff * c)
    }
  }
  for (const m of Object.values(money)) {
    m.shortageValue = m.unvaluedShortLines ? null : m.shortage
    m.excessValue = m.unvaluedExcessLines ? null : m.excess
    m.netValue = m.shortageValue === null || m.excessValue === null ? null : roundMoney(m.excess - m.shortage)
  }
  const qtyReason = mixed ? 'mixed_units' : null
  return {
    exactLine: kpi('inv_accuracy_exact_line', pct(ratio(exact, counted.length)), '%', { reason: counted.length ? null : 'no_counted_lines', numerator: exact, denominator: counted.length }),
    quantity: kpi('inv_accuracy_quantity', mixed || expTotal <= 0 ? null : pct(Math.max(0, 1 - absVar / expTotal)), '%', { reason: mixed ? 'mixed_units' : expTotal <= 0 ? 'expected_total_zero' : null }),
    grossShortage: kpi('inv_gross_shortage', mixed ? null : shortQty, 'qty', { reason: qtyReason, byCurrency: Object.fromEntries(Object.entries(money).map(([k, v]) => [k, { value: v.shortageValue, unvaluedLines: v.unvaluedShortLines }])) }),
    grossExcess: kpi('inv_gross_excess', mixed ? null : excessQty, 'qty', { reason: qtyReason, byCurrency: Object.fromEntries(Object.entries(money).map(([k, v]) => [k, { value: v.excessValue, unvaluedLines: v.unvaluedExcessLines }])) }),
    netVarianceQty: mixed ? null : excessQty - shortQty,
    absoluteVarianceQty: mixed ? null : absVar,
    valueByCurrency: money,
    countedLines: counted.length,
  }
}

const normSerial = (s) => upper(s).replace(/\s+/g, '')

/** Serial accuracy: zero tolerance; missing and unexpected listed separately. */
export function serialAccuracy(expected = [], found = []) {
  const e = new Set(expected.map(normSerial).filter(Boolean))
  const f = new Set(found.map(normSerial).filter(Boolean))
  const matched = [...e].filter((s) => f.has(s))
  const missing = [...e].filter((s) => !f.has(s))
  const unexpected = [...f].filter((s) => !e.has(s))
  const union = e.size + unexpected.length
  return kpi('inv_accuracy_serial', pct(ratio(matched.length, union)), '%', {
    reason: union ? null : 'nothing_expected_or_found',
    matched: matched.length,
    missing,
    unexpected,
  })
}

/** Lines counted (or confirmed zero) out of lines in scope. */
export function countCompletion(lines = []) {
  const done = lines.filter(isCounted).length
  return kpi('inv_count_completion', pct(ratio(done, lines.length)), '%', { reason: lines.length ? null : 'no_lines_in_scope', numerator: done, denominator: lines.length })
}

// ---------------------------------------------------------------------------
// Value
// ---------------------------------------------------------------------------

/** Owned inventory value + unvalued stock from balance rows. */
export function inventoryValue(rows = []) {
  const s = summarizeValuation(rows)
  const byCurrency = Object.fromEntries(Object.entries(s.byCurrency).map(([k, v]) => [k, {
    value: v.owned.value,
    valuedValue: v.owned.valuedValue,
    pricedPct: v.owned.pricedPct,
    reason: v.owned.valueReason,
    consignmentAgreedValue: v.consignment.agreedValue,
    supplierCustodyQty: v.supplier.qty,
  }]))
  const h = headline(byCurrency)
  let unvaluedLines = 0
  let unvaluedQty = 0
  for (const v of Object.values(s.byCurrency)) {
    unvaluedLines += v.owned.unvaluedLines + v.owned.partiallyValuedLines
    unvaluedQty += v.owned.unvaluedQty
  }
  return {
    value: kpi('inv_stock_value', h.value, 'currency', { currency: h.currency, reason: h.reason, byCurrency }),
    unvalued: kpi('inv_unvalued_stock', unvaluedLines, 'lines', { reason: null, qty: unvaluedQty, noCurrencyLines: s.noCurrency.lines }),
  }
}

export function adjustmentValueKpi(movements = []) {
  const by = adjustmentValue(movements)
  const byCurrency = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { ...v, value: v.complete ? v.net : null }]))
  const h = headline(byCurrency)
  return kpi('inv_adjustment_value', h.value, 'currency', { currency: h.currency, reason: Object.keys(by).length ? h.reason : 'no_adjustments', byCurrency })
}

/**
 * Turnover and DIO per currency.
 * input = { issues: [{ value, currency }], snapshots: [{ date, value, currency, complete }],
 *           periodDays = 365, issueCoverage (0..1, share of issue qty that was valued) }
 */
export function turnoverAndDio({ issues = [], snapshots = [], periodDays = 365, issueCoverage = null } = {}) {
  const byCurrency = {}
  const curs = new Set([...issues.map((i) => upper(i.currency)), ...snapshots.map((s) => upper(s.currency))].filter(Boolean))
  for (const cur of curs) {
    const snaps = snapshots.filter((s) => upper(s.currency) === cur)
    const iss = issues.filter((i) => upper(i.currency) === cur)
    const complete = snaps.filter((s) => s.complete !== false && num(s.value) !== null)
    let reason = null
    if (complete.length < 3) reason = 'fewer_than_3_complete_snapshots'
    const avg = complete.length ? complete.reduce((a, s) => a + num(s.value), 0) / complete.length : null
    if (!reason && !(avg > 0)) reason = 'average_stock_value_zero'
    const unvaluedIssue = iss.some((i) => num(i.value) === null)
    if (!reason && unvaluedIssue) reason = 'issue_value_incomplete'
    const cov = num(issueCoverage)
    if (!reason && cov !== null && cov < 0.8) reason = 'issue_coverage_below_80pct'
    const issueValue = unvaluedIssue ? null : roundMoney(iss.reduce((a, i) => a + Math.abs(num(i.value)), 0))
    const t = reason ? null : Math.round((issueValue / avg) * 100) / 100
    byCurrency[cur] = {
      turnover: t,
      dio: t && t > 0 ? Math.round((periodDays / t) * 10) / 10 : null,
      averageStockValue: avg === null ? null : roundMoney(avg),
      issueValue,
      snapshots: complete.length,
      reason,
    }
  }
  const keys = Object.keys(byCurrency)
  const one = keys.length === 1 ? byCurrency[keys[0]] : null
  const multiReason = keys.length > 1 ? 'mixed_currency' : 'no_data'
  return {
    turnover: kpi('inv_turnover', one ? one.turnover : null, 'times', { reason: one ? one.reason : multiReason, byCurrency }),
    dio: kpi('inv_dio', one ? one.dio : null, 'days', { reason: one ? (one.dio === null ? one.reason || 'turnover_zero' : null) : multiReason, byCurrency }),
  }
}

/** Dead / slow / excess / obsolescence exposure (wraps valuation.exposure). */
export function exposureKpis(rows = [], opts = {}) {
  const e = exposure(rows, opts)
  if (!e.ok) {
    const bad = (id) => kpi(id, null, 'currency', { reason: e.reason })
    return { dead: bad('inv_dead_stock'), slow: bad('inv_slow_stock'), excess: bad('inv_excess_stock'), obsolescence: bad('inv_obsolescence_exposure') }
  }
  const pick = (bucket) => Object.fromEntries(Object.entries(e.byCurrency).map(([k, v]) => [k, {
    value: v[bucket].unvaluedQty > 0 ? null : v[bucket].valuedValue,
    valuedValue: v[bucket].valuedValue,
    qty: v[bucket].qty,
    lines: v[bucket].lines,
    unvaluedQty: v[bucket].unvaluedQty,
  }]))
  const make = (id, bucket) => {
    const byCurrency = pick(bucket)
    const h = headline(byCurrency)
    return kpi(id, h.value, 'currency', { currency: h.currency, reason: Object.keys(byCurrency).length ? h.reason : 'no_owned_stock', byCurrency })
  }
  const unknownLines = Object.values(e.byCurrency).reduce((a, v) => a + v.unknown.lines, 0)
  const tooNewLines = Object.values(e.byCurrency).reduce((a, v) => a + v.tooNew.lines, 0)
  return {
    dead: { ...make('inv_dead_stock', 'dead'), unknownLines, tooNewLines },
    slow: make('inv_slow_stock', 'slow'),
    excess: { ...make('inv_excess_stock', 'excess'), unknownMaxLines: Object.values(e.byCurrency).reduce((a, v) => a + v.excess.unknownMaxLines, 0) },
    obsolescence: make('inv_obsolescence_exposure', 'obsolete'),
  }
}

// ---------------------------------------------------------------------------
// Service level
// ---------------------------------------------------------------------------

/** requests = [{ fulfilled_from_stock: true | false | null }] (null = outcome unknown, excluded). */
export function stockoutFrequency(requests = []) {
  const known = requests.filter((r) => r.fulfilled_from_stock === true || r.fulfilled_from_stock === false)
  const out = known.filter((r) => r.fulfilled_from_stock === false).length
  return kpi('inv_stockout_frequency', pct(ratio(out, known.length)), '%', {
    reason: known.length ? null : 'no_requests_with_known_outcome',
    stockouts: out,
    requests: known.length,
    unknownOutcome: requests.length - known.length,
  })
}

/**
 * items = [{ ved | criticality, on_hand, reserved, safety_stock }]
 * Vital = ved 'V' or criticality vital/critical. Available = on_hand - reserved.
 */
export function criticalAvailability(items = []) {
  const vital = items.filter((i) => upper(i.ved) === 'V' || ['VITAL', 'CRITICAL', 'SAFETY_CRITICAL'].includes(upper(i.criticality).replace(/[\s-]+/g, '_')))
  let ok = 0
  let noSafety = 0
  for (const i of vital) {
    const avail = (num(i.on_hand) ?? 0) - (num(i.reserved) ?? 0)
    const ss = num(i.safety_stock)
    if (ss === null) noSafety += 1
    if (ss === null ? avail > 0 : avail >= ss && avail > 0) ok += 1
  }
  return kpi('inv_critical_availability', pct(ratio(ok, vital.length)), '%', {
    reason: vital.length ? null : 'no_vital_items',
    available: ok,
    vitalItems: vital.length,
    safetyStockUnset: noSafety,
  })
}

// ---------------------------------------------------------------------------
// Suppliers and procurement
// ---------------------------------------------------------------------------

/**
 * OTIF per supplier.
 * lines = [{ supplier_id, ordered_qty, accepted_qty, promised_at, received_at, status }]
 * A line is DUE when received, or when its promised date has passed (then it is
 * late and not in full). Cancelled lines and lines not yet due are excluded.
 */
export function supplierDeliveryPerformance(lines = [], { now } = {}) {
  const nowMs = ms(now)
  const per = {}
  const add = (sid, onTime, inFull) => {
    const s = (per[sid] ||= { due: 0, onTime: 0, inFull: 0, otif: 0 })
    s.due += 1
    if (onTime) s.onTime += 1
    if (inFull) s.inFull += 1
    if (onTime && inFull) s.otif += 1
  }
  let missingPromise = 0
  for (const l of lines) {
    if (String(l.status ?? '').toLowerCase() === 'cancelled') continue
    const sid = l.supplier_id ?? 'unknown'
    const promised = ms(l.promised_at)
    const received = ms(l.received_at)
    if (promised === null) {
      missingPromise += 1
      continue
    }
    if (received === null) {
      if (nowMs !== null && nowMs > promised) add(sid, false, false)
      continue
    }
    const inFull = (num(l.accepted_qty) ?? 0) >= (num(l.ordered_qty) ?? Infinity)
    add(sid, received <= promised + DAY - 1, inFull)
  }
  let due = 0
  let otif = 0
  for (const s of Object.values(per)) {
    due += s.due
    otif += s.otif
    s.otifPct = pct(ratio(s.otif, s.due))
    s.onTimePct = pct(ratio(s.onTime, s.due))
    s.inFullPct = pct(ratio(s.inFull, s.due))
  }
  return kpi('inv_supplier_otif', pct(ratio(otif, due)), '%', { reason: due ? null : 'no_lines_due', bySupplier: per, linesWithoutPromisedDate: missingPromise })
}

/** lines = [{ supplier_id, ordered_at, received_at, agreed_lead_days }] */
export function leadTimeVariance(lines = []) {
  const per = {}
  let excluded = 0
  const all = []
  for (const l of lines) {
    const o = ms(l.ordered_at)
    const r = ms(l.received_at)
    const agreed = num(l.agreed_lead_days)
    if (o === null || r === null || agreed === null) {
      excluded += 1
      continue
    }
    const actual = (r - o) / DAY
    const v = actual - agreed
    all.push(v)
    ;(per[l.supplier_id ?? 'unknown'] ||= []).push({ actual, v })
  }
  const stats = (vals) => {
    const n = vals.length
    const mean = vals.reduce((a, b) => a + b, 0) / n
    const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null
    return { lines: n, meanVarianceDays: Math.round(mean * 10) / 10, stdDevDays: sd === null ? null : Math.round(sd * 10) / 10 }
  }
  const bySupplier = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { ...stats(v.map((x) => x.v)), meanActualDays: Math.round((v.reduce((a, x) => a + x.actual, 0) / v.length) * 10) / 10 }]))
  const overall = all.length ? stats(all) : null
  return kpi('inv_lead_time_variance', overall ? overall.meanVarianceDays : null, 'days', {
    reason: overall ? null : 'no_received_line_with_agreed_lead_time',
    stdDevDays: overall?.stdDevDays ?? null,
    bySupplier,
    excludedLines: excluded,
  })
}

/** discrepancies = [{ category, status, value_impact (signed), currency }] */
export function discrepancyKpis(rows = []) {
  const OPEN_DONE = new Set(['closed', 'adjustment_posted', 'rejected', 'cancelled', 'resolved'])
  const byCategory = {}
  const byStatus = {}
  const money = {}
  let open = 0
  for (const d of rows) {
    const cat = d.category ?? 'uncategorised'
    const st = String(d.status ?? 'open').toLowerCase()
    byCategory[cat] = (byCategory[cat] || 0) + 1
    byStatus[st] = (byStatus[st] || 0) + 1
    if (!OPEN_DONE.has(st)) open += 1
    const cur = upper(d.currency) || 'N/A'
    const m = (money[cur] ||= { shortage: 0, excess: 0, unvalued: 0 })
    const v = num(d.value_impact)
    if (v === null) m.unvalued += 1
    else if (v < 0) m.shortage = roundMoney(m.shortage - v)
    else m.excess = roundMoney(m.excess + v)
  }
  for (const m of Object.values(money)) {
    m.shortageValue = m.unvalued ? null : m.shortage
    m.excessValue = m.unvalued ? null : m.excess
  }
  return kpi('inv_discrepancies', rows.length, 'count', { reason: null, open, byCategory, byStatus, byCurrency: money })
}

/** lines = [{ item_id, ordered_qty, received_qty, unit_price, currency, uom, status }] */
export function outstandingPoQty(lines = []) {
  const CLOSED = new Set(['cancelled', 'closed', 'completed'])
  const byItem = {}
  const money = {}
  const uoms = new Set()
  let qty = 0
  for (const l of lines) {
    if (CLOSED.has(String(l.status ?? '').toLowerCase())) continue
    const out = Math.max(0, (num(l.ordered_qty) ?? 0) - (num(l.received_qty) ?? 0))
    if (out <= 0) continue
    uoms.add(upper(l.uom) || 'EA')
    qty += out
    byItem[l.item_id ?? 'unknown'] = (byItem[l.item_id ?? 'unknown'] || 0) + out
    const cur = upper(l.currency) || 'N/A'
    const m = (money[cur] ||= { value: 0, unpricedLines: 0 })
    const p = num(l.unit_price)
    if (p === null) m.unpricedLines += 1
    else m.value = roundMoney(m.value + out * p)
  }
  for (const m of Object.values(money)) m.complete = m.unpricedLines === 0
  const mixed = uoms.size > 1
  return kpi('inv_outstanding_po_qty', mixed ? null : qty, 'qty', { reason: mixed ? 'mixed_units' : null, byItem, byCurrency: money })
}

/** agreements = [{ supplier_id, issued_qty, avg_on_hand_qty, agreed_max_qty }] */
export function consignmentUtilisation(agreements = []) {
  const bySupplier = {}
  let issued = 0
  let held = 0
  for (const a of agreements) {
    const i = num(a.issued_qty) ?? 0
    const h = num(a.avg_on_hand_qty)
    const max = num(a.agreed_max_qty)
    bySupplier[a.supplier_id ?? 'unknown'] = {
      utilisation: h && h > 0 ? Math.round((i / h) * 100) / 100 : null,
      holdingVsMaxPct: h !== null && max ? pct(h / max) : null,
      reason: h && h > 0 ? null : 'no_consigned_stock_held',
    }
    issued += i
    held += h ?? 0
  }
  return kpi('inv_consignment_utilisation', held > 0 ? Math.round((issued / held) * 100) / 100 : null, 'times', { reason: held > 0 ? null : 'no_consigned_stock_held', bySupplier })
}

/** pos = [{ is_emergency, total, currency, status }] (cancelled excluded) */
export function emergencyPurchaseRate(pos = []) {
  const live = pos.filter((p) => String(p.status ?? '').toLowerCase() !== 'cancelled')
  const em = live.filter((p) => p.is_emergency === true)
  const money = {}
  for (const p of live) {
    const cur = upper(p.currency) || 'N/A'
    const m = (money[cur] ||= { total: 0, emergency: 0, unpriced: 0 })
    const v = num(p.total)
    if (v === null) {
      m.unpriced += 1
      continue
    }
    m.total = roundMoney(m.total + v)
    if (p.is_emergency === true) m.emergency = roundMoney(m.emergency + v)
  }
  for (const m of Object.values(money)) m.valueSharePct = m.unpriced || !(m.total > 0) ? null : pct(m.emergency / m.total)
  return kpi('inv_emergency_purchase_rate', pct(ratio(em.length, live.length)), '%', { reason: live.length ? null : 'no_purchase_orders', emergency: em.length, total: live.length, byCurrency: money })
}

/** reservations = [{ qty_reserved, qty_issued, reserved_at, status, unit_cost, currency }] */
export function reservedNotIssued(reservations = [], { now, olderThanDays = 14 } = {}) {
  const nowMs = ms(now)
  if (nowMs === null) return kpi('inv_reserved_not_issued', null, 'qty', { reason: 'now_required' })
  const OPEN = new Set(['open', 'reserved', 'partially_issued', 'active'])
  const money = {}
  let qty = 0
  let lines = 0
  for (const r of reservations) {
    if (!OPEN.has(String(r.status ?? 'open').toLowerCase())) continue
    const at = ms(r.reserved_at)
    if (at === null || (nowMs - at) / DAY < olderThanDays) continue
    const left = Math.max(0, (num(r.qty_reserved) ?? 0) - (num(r.qty_issued) ?? 0))
    if (left <= 0) continue
    lines += 1
    qty += left
    const cur = upper(r.currency) || 'N/A'
    const m = (money[cur] ||= { value: 0, unvaluedLines: 0 })
    const c = num(r.unit_cost)
    if (c === null) m.unvaluedLines += 1
    else m.value = roundMoney(m.value + left * c)
  }
  for (const m of Object.values(money)) m.complete = m.unvaluedLines === 0
  return kpi('inv_reserved_not_issued', qty, 'qty', { reason: null, lines, olderThanDays, byCurrency: money })
}

/**
 * requests = [{ fulfilled_from: 'stock' | 'reusable_stock' | 'purchase' | null, qty, book_unit_cost, currency }]
 * The value is the BOOK value of stock used instead of buying. It is not a cash
 * saving (the stock was already paid for) and must never be shown as one.
 */
export function purchaseAvoidance(requests = []) {
  const resolved = requests.filter((r) => ['stock', 'reusable_stock', 'purchase'].includes(r.fulfilled_from))
  const fromStock = resolved.filter((r) => r.fulfilled_from !== 'purchase')
  const money = {}
  for (const r of fromStock) {
    const cur = upper(r.currency) || 'N/A'
    const m = (money[cur] ||= { bookValue: 0, unvaluedLines: 0, reusableLines: 0 })
    if (r.fulfilled_from === 'reusable_stock') m.reusableLines += 1
    const c = num(r.book_unit_cost)
    const q = num(r.qty) ?? 0
    if (c === null) m.unvaluedLines += 1
    else m.bookValue = roundMoney(m.bookValue + q * c)
  }
  return kpi('inv_purchase_avoidance', pct(ratio(fromStock.length, resolved.length)), '%', {
    reason: resolved.length ? null : 'no_resolved_requests',
    fromStock: fromStock.length,
    resolved: resolved.length,
    byCurrency: money,
    valueLabel: 'Book value of stock used instead of buying (not a saving)',
  })
}

/** Lookup map so a surface can render any catalogued KPI by id. */
export const KPI_BY_ID = Object.freeze(Object.fromEntries(KPI_CATALOGUE.map((k) => [k.id, k])))
