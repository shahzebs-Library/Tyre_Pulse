/**
 * customersAnalytics - the pure engine behind the Customer registry
 * (/customers). Builds on ./customers (statuses, summarizeCustomers,
 * isValidEmail) and adds what the page used to compute inline: register
 * filtering, contact-quality coverage, the type / site breakdowns and the
 * export rows.
 *
 * No I/O, no clock.
 *
 * HONEST NULLS: a coverage percentage of an empty registry is null (N/A).
 */
import { CUSTOMER_STATUSES, isValidEmail, summarizeCustomers } from './customers'

export const STATUS_LABELS = { active: 'Active', inactive: 'Inactive', prospect: 'Prospect' }
export const statusLabel = (s) => STATUS_LABELS[String(s || '').toLowerCase()] || (s ? String(s) : 'Not set')

const clean = (v) => (v == null ? '' : String(v).trim())
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)

/** The text a registry search looks through. */
export function customerSearchText(r) {
  return [r?.name, r?.contact_name, r?.email, r?.phone, r?.site, r?.customer_type, r?.address]
    .map(clean).join(' ').toLowerCase()
}

/** A contact is "reachable" when it has a valid email or any phone. */
export function contactQuality(r) {
  const email = clean(r?.email)
  const hasEmail = email !== ''
  const emailValid = hasEmail && isValidEmail(email)
  const hasPhone = clean(r?.phone) !== ''
  const hasContact = clean(r?.contact_name) !== ''
  if (emailValid || hasPhone) return hasContact ? 'complete' : 'reachable'
  if (hasEmail && !emailValid) return 'invalid_email'
  return 'missing'
}

export const CONTACT_QUALITY = [
  { key: 'complete', label: 'Named contact, reachable' },
  { key: 'reachable', label: 'Reachable, no named contact' },
  { key: 'invalid_email', label: 'Email not valid' },
  { key: 'missing', label: 'No way to reach' },
]
export const contactQualityLabel = (k) => CONTACT_QUALITY.find((c) => c.key === k)?.label || k

/** Narrow the registry by status, type, site, contact quality and free text. */
export function filterCustomers(rows = [], { status = 'all', type = '', site = '', quality = 'all', query = '' } = {}) {
  const q = clean(query).toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (status !== 'all' && clean(r?.status).toLowerCase() !== status) return false
    if (type && clean(r?.customer_type) !== type) return false
    if (site && clean(r?.site) !== site) return false
    if (quality !== 'all' && contactQuality(r) !== quality) return false
    if (q && !customerSearchText(r).includes(q)) return false
    return true
  })
}

/** Distinct non-blank values of a field, sorted. */
export function distinctValues(rows = [], field) {
  return [...new Set((rows || []).map((r) => clean(r?.[field])).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** Headline figures: the base status summary plus contact-quality coverage. */
export function customerKpis(rows = []) {
  const base = summarizeCustomers(rows)
  const quality = { complete: 0, reachable: 0, invalid_email: 0, missing: 0 }
  const sites = new Set()
  for (const r of rows || []) {
    quality[contactQuality(r)] += 1
    const s = clean(r?.site)
    if (s) sites.add(s.toLowerCase())
  }
  const reachable = quality.complete + quality.reachable
  return {
    ...base,
    sites: sites.size,
    quality,
    reachable,
    reachablePct: pct(reachable, base.total),
    activePct: pct(base.active, base.total),
    needsAttention: quality.invalid_email + quality.missing,
  }
}

/** Counts grouped by a field, largest first, with a stable blank bucket. */
export function countBy(rows = [], field, blank = 'Unspecified') {
  const map = new Map()
  for (const r of rows || []) {
    const k = clean(r?.[field]) || blank
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/** Status counts in canonical order (unknown statuses are not attributed). */
export function statusMix(rows = []) {
  const s = summarizeCustomers(rows)
  return CUSTOMER_STATUSES.map((k) => ({ key: k, label: statusLabel(k), count: s[k] || 0 }))
}

export const CUSTOMER_EXPORT_COLUMNS = [
  { key: 'name', header: 'Name' },
  { key: 'customer_type', header: 'Type' },
  { key: 'status', header: 'Status' },
  { key: 'contact_name', header: 'Contact' },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'site', header: 'Site' },
  { key: 'address', header: 'Address' },
  { key: 'contact_quality', header: 'Contact quality' },
]

export function customerExportRows(rows = []) {
  return (rows || []).map((r) => ({
    name: clean(r?.name),
    customer_type: clean(r?.customer_type),
    status: statusLabel(r?.status),
    contact_name: clean(r?.contact_name),
    email: clean(r?.email),
    phone: clean(r?.phone),
    site: clean(r?.site),
    address: clean(r?.address),
    contact_quality: contactQualityLabel(contactQuality(r)),
  }))
}
