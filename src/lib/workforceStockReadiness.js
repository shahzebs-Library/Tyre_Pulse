/**
 * Stock readiness for a tyre task: does the site the work is planned at hold the tyre size the asset
 * runs on? Pure, no I/O. It INFORMS the manager choosing who and when; it never blocks an assignment
 * (stock can arrive, be transferred or be miscounted, and a person is accountable for the decision).
 *
 * Stock rows carry the size inconsistently: sometimes in tyre_size, usually only inside the free-text
 * description ("TIRE 385-65R22.5", "23.5.R.25 Doublecoin", "TIRE 7.00 R16 10PR"). sizeKeyFromText reads
 * either into one canonical key so the two sides can be compared.
 */

const METRIC = /(\d{3})\s*[/-]\s*(\d{2})\s*[RZD]?\s*-?\s*(\d{2}(?:\.\d)?)(?!\d)/i
const RADIAL = /(?<![\d./])(\d{1,4}(?:\.\d{1,2})?)\s*\.?\s*R\s*\.?\s*(\d{2}(?:\.\d)?)(?!\d)/i
const BIAS = /(?<![\d./])(\d{1,2}(?:\.\d{1,2})?)\s*-\s*(\d{2}(?:\.\d)?)(?![\d.])/

// Bias-ply widths are written both ways: "7.00R16" and "700 R 16" are the same tyre.
const biasWidth = w => (/^\d{3,4}$/.test(w) && w.endsWith('00') && Number(w) >= 600 && Number(w) <= 1400)
  ? (Number(w) / 100).toFixed(2) : w

/** Canonical size key from a size field or free text, or null when none can be read. */
export function sizeKeyFromText (text) {
  const s = String(text ?? '').trim()
  if (!s) return null
  let m = METRIC.exec(s)
  if (m) return `${m[1]}/${m[2]}R${m[3]}`
  m = RADIAL.exec(s)
  if (m) return `${biasWidth(m[1])}R${m[2]}`
  m = BIAS.exec(s)
  if (m) return `${m[1]}-${m[2]}`
  return null
}

const siteKey = v => String(v ?? '').trim().toUpperCase()
const ACTIVE_EXCLUDED = /removed|scrap|disposed|returned|written/i

/** Distinct size keys the asset currently runs on; falls back to its whole history when none are active. */
export function assetSizeKeys (tyreRows = []) {
  const keys = rows => [...new Set(rows.map(r => sizeKeyFromText(r?.size)).filter(Boolean))]
  const active = (tyreRows || []).filter(r => !r?.removal_date && !ACTIVE_EXCLUDED.test(String(r?.status ?? '')))
  const fromActive = keys(active)
  return fromActive.length ? fromActive : keys(tyreRows || [])
}

/**
 * For each size the asset needs: quantity on hand at the planned site, its status, and the other sites
 * that hold it. Quantities are summed per site (the same size often has several rows by brand).
 * state: in_stock | low | out | no_record | unknown_size | no_site
 */
export function stockReadiness ({ sizes = [], site, stockRows = [] }) {
  if (!sizes.length) return { state: 'unknown_size', lines: [] }
  const here = siteKey(site)
  const bySize = new Map()
  for (const r of stockRows || []) {
    const k = sizeKeyFromText(r?.tyre_size) || sizeKeyFromText(r?.description)
    if (!k) continue
    if (!bySize.has(k)) bySize.set(k, [])
    bySize.get(k).push(r)
  }
  const lines = sizes.map(size => {
    const rows = bySize.get(size) || []
    const atSite = rows.filter(r => here && siteKey(r.site) === here)
    const qty = atSite.reduce((n, r) => n + (Number.isFinite(Number(r.stock_qty)) ? Number(r.stock_qty) : 0), 0)
    const flaggedLow = atSite.some(r => /critical|low/i.test(String(r.stock_status ?? '')))
    const others = new Map()
    for (const r of rows) {
      const s = siteKey(r.site)
      if (!s || s === here) continue
      const q = Number(r.stock_qty)
      if (Number.isFinite(q) && q > 0) others.set(s, (others.get(s) || 0) + q)
    }
    const elsewhere = [...others.entries()].map(([s, q]) => ({ site: s, qty: q })).sort((a, b) => b.qty - a.qty)
    let state
    if (!here) state = 'no_site'
    else if (!atSite.length) state = 'no_record'
    else if (qty <= 0) state = 'out'
    else if (flaggedLow) state = 'low'
    else state = 'in_stock'
    const counted = atSite.map(r => r.last_counted_at || r.updated_at).filter(Boolean).sort().pop() || null
    return { size, state, qty: atSite.length ? qty : null, elsewhere, lastCounted: counted }
  })
  const order = ['out', 'no_record', 'low', 'no_site', 'in_stock']
  const state = lines.map(l => l.state).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]
  return { state, lines }
}

export const READINESS_TEXT = Object.freeze({
  in_stock: 'In stock at this site',
  low: 'Low stock at this site',
  out: 'Out of stock at this site',
  no_record: 'No stock record for this size at this site',
  unknown_size: 'Tyre size for this asset is not recorded',
  no_site: 'Pick a site to check stock',
})
