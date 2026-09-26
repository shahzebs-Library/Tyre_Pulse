/**
 * storeMaterialIssueAnalytics - the presentation-level derivations of the
 * Store Material Issue page (src/pages/StoreMaterialIssue.jsx) that used to be
 * computed inline in its components.
 *
 * The domain maths (slips, summaries, trend, buckets) stay in the existing
 * `materialIssue` engine; this module only turns those results into what the
 * page shows. Pure: no I/O, and the one date read takes an injectable `now`.
 *
 * MONEY IS NEVER BLENDED. Anything that sums money is scoped to ONE currency;
 * when a scope spans several, the caller names the currency to show and the
 * other countries' slips are left out rather than added in.
 */
import { bucketTotals, docTypeLabel, issueStatusLabel } from './materialIssue'
import { currencyForCountry, MIXED_CURRENCY } from './governedCost'

const finite = (v) => v != null && v !== '' && Number.isFinite(Number(v))

/**
 * The single currency a summary can be shown in, or null when it spans several.
 * With no slips at all, the country scope decides (so an empty KSA view still
 * says SAR); an all-countries scope with nothing loaded has no currency.
 */
export function singleCurrencyOf(summary, activeCountry) {
  if (!summary || summary.mixedCurrency) return null
  const keys = Object.keys(summary.byCurrency || {})
  if (keys.length === 1) return keys[0]
  if (keys.length > 1) return null
  const c = currencyForCountry(activeCountry)
  return c && c !== MIXED_CURRENCY ? c : null
}

/** One money figure from a summary in one currency, or null (never 0 for "unknown"). */
export function headlineValue(summary, currency, field = 'bookedValue') {
  if (!currency || currency === MIXED_CURRENCY) return null
  const v = summary?.byCurrency?.[currency]?.[field]
  return finite(v) ? Number(v) : null
}

/**
 * Tyre / spare / oil split of the slips' lines. When `currency` is given only
 * slips in that currency are counted, so a mixed scope never adds SAR to AED.
 */
export function categoryShare(slips, { currency = null } = {}) {
  const scoped = (slips || []).filter((s) => !currency || s.currency === currency)
  const b = bucketTotals(scoped.flatMap((s) => s.lines || []))
  const data = [
    { name: 'Tyres', value: b.tyre },
    { name: 'Spares', value: b.spare },
    { name: 'Oil and lubricants', value: b.oil },
  ].filter((d) => d.value > 0)
  return { data, unavailable: b.tyre + b.spare + b.oil === 0, slips: scoped.length }
}

/** Issues vs returns vs unreadable numbers, zero slices dropped. */
export function docTypeShare(split) {
  const s = split || {}
  return [
    { name: 'Issues (MIS)', value: s.MIS || 0 },
    { name: 'Returns (MRT)', value: s.MRT || 0 },
    { name: 'Unreadable number', value: s.unknown || 0 },
  ].filter((d) => d.value > 0)
}

/** How a return slip is flagged in the return register. */
export function returnFlag(slip) {
  return slip?.returnSignAnomaly
    ? { label: 'Booked as a charge', anomaly: true }
    : { label: 'Credited already', anomaly: false }
}

/** Display rows for the slips raised in the app. */
export function recentSlipRows(recent) {
  return (recent || []).map((r) => {
    const day = String(r?.issued_at || '').slice(0, 10)
    return {
      id: r.id,
      issueNumber: r.issue_number || null,
      docType: docTypeLabel(r.doc_type),
      workOrderNo: r.work_order_no || null,
      assetNo: r.asset_no || null,
      issuedDay: day || null,
      status: issueStatusLabel(r.status),
    }
  })
}

/** Slips raised in the app in the last `days` days, relative to `now`. */
export function recentSlipCount(recent, { now = new Date(), days = 30 } = {}) {
  const cutoff = (now instanceof Date ? now : new Date(now)).getTime() - days * 86400000
  return (recent || []).filter((r) => {
    const t = new Date(r?.issued_at || '').getTime()
    return Number.isFinite(t) && t >= cutoff
  }).length
}

/** Top items with a stable row key. */
export function topItemRows(items) {
  return (items || []).map((it, i) => ({ ...it, rowKey: `${it.key ?? 'item'}-${i}` }))
}

/** Slip lines with a stable row key and the slip currency as fallback. */
export function slipLineRows(lines, slipCurrency) {
  return (lines || []).map((l, i) => ({
    ...l,
    rowKey: l.id ? String(l.id) : `line-${i}`,
    currency: l.currency || slipCurrency || null,
  }))
}
