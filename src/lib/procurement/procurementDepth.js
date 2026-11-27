/**
 * Pure helpers for the procurement depth panels (RFQ comparison, backorders,
 * supplier performance, three-way match, supplier returns).
 *
 * Rules kept here so the screens and their tests agree:
 *   - money is never added across currencies: every total is per currency;
 *   - a missing price or quantity stays null (shown as "No price"), never 0;
 *   - the "lowest" quote is only ever chosen among quotes in the SAME currency
 *     that price EVERY line, the same rule inv_rfq_award enforces server side.
 */
import { textFn } from '../wmsText'

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * Compare supplier quotes for one RFQ.
 * @param {Array<{id, line_no, qty, item_code?, item_name?, description?}>} rfqLines
 * @param {Array<{id, supplier_id, supplier_name, currency, lead_time_days, status, lines:Array<{rfq_line_id, unit_price, qty_offered}>}>} quotes
 * @returns {{ currencies:string[], mixedCurrency:boolean, quotes:Array, lowestByCurrency:Object, lineBest:Object }}
 */
export function compareQuotes(rfqLines = [], quotes = []) {
  const lines = Array.isArray(rfqLines) ? rfqLines : []
  const lineQty = new Map(lines.map((l) => [l.id, num(l.qty)]))
  const rows = (Array.isArray(quotes) ? quotes : []).map((q) => {
    const byLine = new Map((q.lines || []).map((ql) => [ql.rfq_line_id, ql]))
    let total = 0
    let priced = 0
    const cells = lines.map((l) => {
      const ql = byLine.get(l.id)
      const price = num(ql?.unit_price)
      const qty = num(ql?.qty_offered) ?? lineQty.get(l.id)
      const amount = price === null || qty === null ? null : Math.round(price * qty * 100) / 100
      if (amount !== null) { total += amount; priced += 1 }
      return { rfq_line_id: l.id, unit_price: price, qty, amount, lead_time_days: num(ql?.lead_time_days) }
    })
    const complete = lines.length > 0 && priced === lines.length
    return {
      ...q,
      currency: q.currency ? String(q.currency).toUpperCase() : null,
      cells,
      priced,
      complete,
      total: priced > 0 ? Math.round(total * 100) / 100 : null,
      lead_time_days: num(q.lead_time_days),
    }
  })
  const currencies = [...new Set(rows.map((r) => r.currency).filter(Boolean))].sort()
  const lowestByCurrency = {}
  for (const cur of currencies) {
    const full = rows.filter((r) => r.currency === cur && r.complete && r.status !== 'withdrawn')
    if (!full.length) continue
    const best = full.reduce((a, b) => (b.total < a.total ? b : a))
    lowestByCurrency[cur] = best.id
  }
  // cheapest price per line, per currency (never across currencies)
  const lineBest = {}
  for (const l of lines) {
    lineBest[l.id] = {}
    for (const cur of currencies) {
      const priced = rows.filter((r) => r.currency === cur)
        .map((r) => ({ id: r.id, price: r.cells.find((c) => c.rfq_line_id === l.id)?.unit_price }))
        .filter((x) => x.price !== null && x.price !== undefined)
      if (priced.length) lineBest[l.id][cur] = priced.reduce((a, b) => (b.price < a.price ? b : a)).id
    }
  }
  return {
    currencies,
    mixedCurrency: currencies.length > 1,
    quotes: rows.map((r) => ({ ...r, isLowest: lowestByCurrency[r.currency] === r.id })),
    lowestByCurrency,
    lineBest,
  }
}

/** True when awarding this quote needs a written reason (mirrors inv_rfq_award). */
export function awardNeedsReason(comparison, quoteId) {
  if (!comparison || !quoteId) return true
  if (comparison.mixedCurrency) return true
  const q = comparison.quotes.find((x) => x.id === quoteId)
  return !q || !q.isLowest
}

/** Summary of open backorder lines. Values per currency; unknown price stays unvalued. */
export function summariseBackorders(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const open = list.filter((r) => num(r.qty_outstanding) > 0)
  const overdue = open.filter((r) => r.is_overdue)
  const valueByCurrency = {}
  let unvaluedLines = 0
  for (const r of open) {
    const price = num(r.unit_price)
    const cur = r.currency ? String(r.currency).toUpperCase() : null
    if (price === null || !cur) { unvaluedLines += 1; continue }
    valueByCurrency[cur] = Math.round(((valueByCurrency[cur] || 0) + price * num(r.qty_outstanding)) * 100) / 100
  }
  return {
    openLines: open.length,
    overdueLines: overdue.length,
    openPos: new Set(open.map((r) => r.po_id)).size,
    maxDaysOverdue: overdue.reduce((m, r) => Math.max(m, num(r.days_overdue) || 0), 0) || null,
    valueByCurrency,
    unvaluedLines,
  }
}

/** Plain rating of a supplier from the measured delivery and reject figures. */
export function rateSupplier(row = {}) {
  const onTime = num(row.on_time_pct)
  const reject = num(row.reject_pct)
  const measured = (num(row.on_time) || 0) + (num(row.late) || 0)
  if (onTime === null && reject === null) return { band: 'not_measured', label: 'Not measured yet', tone: 'muted' }
  if ((onTime !== null && onTime < 70) || (reject !== null && reject > 5) || (num(row.open_overdue) || 0) > 2) {
    return { band: 'watch', label: 'Needs attention', tone: 'bad' }
  }
  if ((onTime !== null && onTime < 90) || (reject !== null && reject > 2)) return { band: 'fair', label: 'Fair', tone: 'warn' }
  if (measured < 3) return { band: 'early', label: 'Good so far (few orders)', tone: 'info' }
  return { band: 'good', label: 'Good', tone: 'good' }
}

/** How much of a goods receipt line can still go back to the supplier. */
export function returnableQty(grnLine = {}, returned = []) {
  const done = (src) => (Array.isArray(returned) ? returned : [])
    .filter((r) => r.grn_line_id === grnLine.id && r.source === src)
    .reduce((s, r) => s + (num(r.qty) || 0), 0)
  return {
    rejected: Math.max(0, (num(grnLine.qty_rejected) || 0) - done('rejected')),
    accepted: Math.max(0, (num(grnLine.qty_accepted) || 0) - done('accepted')),
  }
}

export const MATCH_STATUS = Object.freeze({
  pending: { label: 'Not checked', tone: 'muted' },
  matched: { label: 'Matched', tone: 'good' },
  qty_mismatch: { label: 'Quantity variance', tone: 'warn' },
  price_mismatch: { label: 'Price variance', tone: 'warn' },
  qty_and_price_mismatch: { label: 'Quantity and price variance', tone: 'bad' },
  unmatched: { label: 'Not on a PO line', tone: 'bad' },
})

export const REJECTION_CODES = Object.freeze([
  { value: 'damaged', label: 'Damaged' },
  { value: 'wrong_part', label: 'Wrong part' },
  { value: 'quality', label: 'Quality failure' },
  { value: 'expired', label: 'Expired' },
  { value: 'other', label: 'Other' },
])

/** Build the rejection_reason text the receipt engine reads ("damaged: crushed box"). */
export function rejectionReasonText(code, note) {
  const c = REJECTION_CODES.find((x) => x.value === code)
  const n = String(note || '').trim()
  if (!c) return n || null
  return n ? `${c.value}: ${n}` : c.value
}

/** Money in its own currency; "No price" (translated when `t` is given) when unknown. */
export function formatMoneyIn(amount, currency, t) {
  const v = num(amount)
  if (v === null) return textFn(t)('wmsmsgprocure.common.noPrice')
  return `${currency || ''} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()
}
