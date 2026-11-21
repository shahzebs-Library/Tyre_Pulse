/**
 * Money presentation for the Inventory Control Center (pure).
 *
 * RULE: each country reports in its own currency (SAR, AED, EGP). Amounts are
 * summed PER CURRENCY and never added across currencies. A row whose value
 * cannot be computed (no unit cost) is counted as "unvalued", never as 0.
 *
 * This is presentation only. Valuation (weighted average cost, tyre specific
 * price) is computed server-side and by the valuation engine lane; this file
 * just adds up figures that already carry a currency.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * @param rows        any rows
 * @param valueOf     row -> number|null (null = cannot be valued)
 * @param currencyOf  row -> currency code|null
 * @returns {{ totals: {currency:string, amount:number, rows:number}[], unvalued:number, noCurrency:number, mixed:boolean }}
 */
export function sumByCurrency(rows, valueOf, currencyOf) {
  const map = new Map()
  let unvalued = 0
  let noCurrency = 0
  for (const r of rows || []) {
    const v = num(valueOf(r))
    if (v === null) { unvalued += 1; continue }
    const c = String(currencyOf(r) || '').trim().toUpperCase()
    if (!c) { noCurrency += 1; continue }
    const cur = map.get(c) || { currency: c, amount: 0, rows: 0 }
    cur.amount += v
    cur.rows += 1
    map.set(c, cur)
  }
  const totals = [...map.values()]
    .map((t) => ({ ...t, amount: Math.round(t.amount * 100) / 100 }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
  return { totals, unvalued, noCurrency, mixed: totals.length > 1 }
}

/** Value of one balance row: on-hand x average unit cost, or null. */
export function balanceValue(row) {
  const q = num(row?.qty_on_hand ?? row?.stock_qty)
  const c = num(row?.avg_unit_cost ?? row?.unit_cost)
  if (q === null || c === null) return null
  return q * c
}

/** Owned stock only: consignment and supplier-owned stock is never owned value. */
export function isOwned(row) {
  const o = String(row?.ownership || 'owned').toLowerCase()
  return o === 'owned'
}

export function formatMoney(amount, currency) {
  const n = num(amount)
  if (n === null) return 'N/A'
  const code = String(currency || '').trim().toUpperCase()
  const body = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return code ? `${code} ${body}` : body
}

/** A list of per-currency totals as one readable line ("SAR 1.00 | AED 2.00"). */
export function formatTotals(totals) {
  if (!totals?.length) return 'N/A'
  return totals.map((t) => formatMoney(t.amount, t.currency)).join(' | ')
}

export function formatQty(v) {
  const n = num(v)
  if (n === null) return 'N/A'
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 })
}
