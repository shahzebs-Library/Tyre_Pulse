/**
 * holdingCompanyAnalytics - pure presentation engine for /holding-company.
 *
 * The roll-up primitives (league table, spend breakdown, permission matrix,
 * summary) live in src/lib/holdingCompany.js and are reused. This module adds
 * what the page must say HONESTLY on top of them:
 *
 *   - MONEY IS NEVER BLENDED ACROSS CURRENCIES. holding_consolidated_kpis sums
 *     purchase_orders.total_amount, which carries no currency, over every
 *     country the viewer may see. The figure is therefore only a quantity of
 *     one currency when the viewer is scoped to exactly ONE country; for an
 *     org-wide or multi-country viewer it is SAR + AED + EGP added together
 *     and the page must not print it under any currency label. `spendCurrency`
 *     decides this; `consolidateSpend` groups spend per currency and puts an
 *     undeterminable amount in its own bucket rather than a total.
 *   - Zero subsidiaries is a normal state (the group holds only its own
 *     organisation), not an error. The group health average is null with no
 *     scored organisation, never 0.
 *
 * No I/O, no React.
 */
import { toFiniteNumber } from './holdingCompany'

export const COUNTRY_CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })
export const TRANSFER_STATUSES = Object.freeze(['pending', 'in_transit', 'received', 'cancelled'])
export const ASSET_TYPES = Object.freeze(['tyre', 'vehicle', 'part', 'other'])

const ORG_WIDE = new Set(['ALL', '*'])

/**
 * The viewer's country scope as a clean list, or null when org-wide.
 * @param {{ role?:string, isSuperAdmin?:boolean, country?:string|string[] }} profile
 */
export function viewerCountries(profile) {
  const p = profile || {}
  if (p.isSuperAdmin || p.is_super_admin || String(p.role || '') === 'Admin') return null
  const raw = Array.isArray(p.country) ? p.country : p.country ? [p.country] : []
  const clean = raw.map((c) => String(c || '').trim()).filter(Boolean)
  if (clean.some((c) => ORG_WIDE.has(c.toUpperCase()))) return null
  return clean
}

/**
 * The single currency a consolidated spend figure is denominated in, or null
 * when it cannot be known (org-wide viewer, several countries, or an unknown
 * country). Null means "do not print this as money in any currency".
 */
export function spendCurrency(countries) {
  if (!Array.isArray(countries) || countries.length !== 1) return null
  return COUNTRY_CURRENCY[countries[0]] || null
}

/**
 * Per-currency consolidation of subsidiary spend.
 * Returns `{ byCurrency:[{currency,total,orgs}], undetermined:{total,orgs}|null,
 * single: currency|null, total: number|null }` where `total` is set ONLY when
 * every amount shares one known currency.
 */
export function consolidateSpend(subsidiaries, currency) {
  const list = Array.isArray(subsidiaries) ? subsidiaries : []
  const buckets = new Map()
  let undTotal = 0
  let undOrgs = 0
  let any = false
  for (const s of list) {
    const v = toFiniteNumber(s?.spend_30d)
    if (v == null) continue
    any = true
    if (currency) {
      const b = buckets.get(currency) || { currency, total: 0, orgs: 0 }
      b.total += v; b.orgs += 1
      buckets.set(currency, b)
    } else {
      undTotal += v; undOrgs += 1
    }
  }
  const byCurrency = [...buckets.values()]
  const undetermined = undOrgs > 0 ? { total: undTotal, orgs: undOrgs } : null
  const single = byCurrency.length === 1 && !undetermined ? byCurrency[0].currency : null
  return {
    any,
    byCurrency,
    undetermined,
    single,
    total: single ? byCurrency[0].total : null,
  }
}

/** Money label that refuses to print a blended amount. */
export function fmtSpend(value, currency) {
  const n = toFiniteNumber(value)
  if (n == null) return 'N/A'
  if (!currency) return 'Mixed currencies'
  return `${currency} ${Math.round(n).toLocaleString()}`
}

/** Integer label, or 'N/A'. */
export function fmtInt(v) {
  const n = toFiniteNumber(v)
  return n == null ? 'N/A' : Math.round(n).toLocaleString()
}

/** Group health average over scored organisations; null when none scored. */
export function groupHealth(subsidiaries) {
  const vals = (Array.isArray(subsidiaries) ? subsidiaries : [])
    .map((s) => toFiniteNumber(s?.fleet_health_score))
    .filter((v) => v != null)
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
}

/** Health band with a text label (colour is never the only signal). */
export function healthBand(score) {
  const s = toFiniteNumber(score)
  if (s == null) return { key: 'none', label: 'Not measured' }
  if (s >= 80) return { key: 'good', label: 'Healthy' }
  if (s >= 60) return { key: 'watch', label: 'Watch' }
  return { key: 'risk', label: 'At risk' }
}

/**
 * Org options for the transfer form: every organisation in the dashboard plus
 * any linked subsidiary not yet in it. De-duplicated by id.
 */
export function orgOptions(dashboardSubs, linkedSubs) {
  const out = []
  const seen = new Set()
  for (const s of Array.isArray(dashboardSubs) ? dashboardSubs : []) {
    const id = s?.tenant_id
    if (id == null || seen.has(String(id))) continue
    seen.add(String(id)); out.push({ id: String(id), name: s.name || String(id) })
  }
  for (const s of Array.isArray(linkedSubs) ? linkedSubs : []) {
    const id = s?.id
    if (id == null || seen.has(String(id))) continue
    seen.add(String(id)); out.push({ id: String(id), name: s.name || String(id) })
  }
  return out
}

/** Filter transfers by status and a query over org names, asset and notes. */
export function filterTransfers(transfers, { status = '', search = '', nameOf = (id) => id } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(transfers) ? transfers : []).filter((t) => {
    if (status && t.status !== status) return false
    if (q) {
      const hay = `${nameOf(t.from_org_id)} ${nameOf(t.to_org_id)} ${t.asset_type || ''} ${t.asset_ref || ''} ${t.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Transfer roll-up: counts by status, open movements and units moved. */
export function transferSummary(transfers) {
  const list = Array.isArray(transfers) ? transfers : []
  const byStatus = Object.fromEntries(TRANSFER_STATUSES.map((s) => [s, 0]))
  let units = 0
  for (const t of list) {
    const st = TRANSFER_STATUSES.includes(t?.status) ? t.status : 'pending'
    byStatus[st] += 1
    const q = toFiniteNumber(t?.quantity)
    if (q != null && st !== 'cancelled') units += q
  }
  return {
    total: list.length,
    byStatus,
    open: byStatus.pending + byStatus.in_transit,
    received: byStatus.received,
    units,
  }
}

/** Subsidiary register rows with honest nulls (missing counts stay null). */
export function subsidiaryRows(subsidiaries) {
  return (Array.isArray(subsidiaries) ? subsidiaries : []).map((s) => ({
    tenant_id: s?.tenant_id,
    name: s?.name || 'Unknown',
    is_hq: !!s?.is_hq,
    logo_url: s?.logo_url || null,
    vehicles: toFiniteNumber(s?.vehicles),
    tyres: toFiniteNumber(s?.tyres),
    open_alerts: toFiniteNumber(s?.open_alerts),
    critical_alerts: toFiniteNumber(s?.critical_alerts),
    low_tread: toFiniteNumber(s?.low_tread),
    spend_30d: toFiniteNumber(s?.spend_30d),
    fleet_health_score: toFiniteNumber(s?.fleet_health_score),
  }))
}

/** Export rows for the subsidiary register; spend is labelled with its currency or marked mixed. */
export function subsidiaryExportRows(rows, currency) {
  return (Array.isArray(rows) ? rows : []).map((s) => ({
    name: s.name,
    is_hq: s.is_hq ? 'Yes' : 'No',
    vehicles: s.vehicles ?? '',
    tyres: s.tyres ?? '',
    open_alerts: s.open_alerts ?? '',
    critical_alerts: s.critical_alerts ?? '',
    low_tread: s.low_tread ?? '',
    spend_30d: s.spend_30d == null ? '' : currency ? s.spend_30d : 'Mixed currencies',
    spend_currency: currency || 'Mixed',
    fleet_health_score: s.fleet_health_score ?? '',
  }))
}
