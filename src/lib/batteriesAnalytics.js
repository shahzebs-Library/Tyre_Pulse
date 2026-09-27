/**
 * batteriesAnalytics - pure presentation engine for the Battery Lifecycle page
 * (/batteries). Warranty expiry, the attention rule and the fleet roll-up live
 * in `./batteries.js` and are REUSED here, never re-derived. This module only
 * shapes that output for the page: enrichment, filters, the KPI strip, the
 * warranty window, health bands, the attention list and the export rows.
 *
 * No I/O and no clock read: `nowMs` is injected so the warranty window is
 * deterministic and testable.
 *
 * HONEST NULLS. A battery with no recorded health is "Not measured", never 0%;
 * a battery with no install date or warranty term has an unknown expiry, never
 * "expired". An average over nothing is null (N/A).
 */
import {
  warrantyExpiry, batteryNeedsAttention, summarizeBatteries,
  BATTERY_STATUSES, BATTERY_STATUS_META,
} from './batteries'

export { BATTERY_STATUSES, BATTERY_STATUS_META }

const DAY_MS = 86_400_000
/** A warranty ending within this many days is "expiring soon". */
export const WARRANTY_SOON_DAYS = 90

const toNum = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export const statusLabel = (s) => BATTERY_STATUS_META[s]?.label || (s ? String(s) : 'N/A')

/** Health band used for the bar colour AND spelled out in text. */
export function healthBand(pct) {
  if (pct == null) return { key: 'unknown', label: 'Not measured' }
  if (pct >= 70) return { key: 'good', label: 'Good' }
  if (pct >= 50) return { key: 'fair', label: 'Fair' }
  return { key: 'poor', label: 'Poor' }
}

/**
 * Warranty state against `nowMs`: 'unknown' (no install date or term),
 * 'expired', 'soon' (within WARRANTY_SOON_DAYS) or 'active'. `daysLeft` is null
 * when unknown, negative when expired.
 */
export function warrantyState(row, nowMs) {
  const expiry = row?._expiry !== undefined ? row._expiry : warrantyExpiry(row)
  if (!expiry) return { key: 'unknown', label: 'Not recorded', daysLeft: null }
  const daysLeft = Math.floor((expiry.getTime() - Number(nowMs)) / DAY_MS)
  if (daysLeft < 0) return { key: 'expired', label: 'Expired', daysLeft }
  if (daysLeft <= WARRANTY_SOON_DAYS) return { key: 'soon', label: `${daysLeft} days left`, daysLeft }
  return { key: 'active', label: 'In warranty', daysLeft }
}

/** Attach derived fields once so every consumer reads the same values. */
export function enrichBatteries(rows = [], nowMs) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const expiry = warrantyExpiry(r)
    const health = toNum(r?.health_pct)
    const base = { ...r, _expiry: expiry, _health: health }
    const w = warrantyState(base, nowMs)
    return {
      ...base,
      _needsAttention: batteryNeedsAttention(r),
      _band: healthBand(health),
      _warranty: w,
      _statusLabel: statusLabel(r?.status),
    }
  })
}

export const EMPTY_BATTERY_FILTERS = Object.freeze({
  search: '', status: 'all', asset: '', warranty: 'all', attentionOnly: false,
})

export function activeBatteryFilterCount(f = {}) {
  let n = 0
  if (String(f.search || '').trim()) n += 1
  if (f.status && f.status !== 'all') n += 1
  if (f.asset) n += 1
  if (f.warranty && f.warranty !== 'all') n += 1
  if (f.attentionOnly) n += 1
  return n
}

/** Filter enriched rows. Search matches serial, asset, brand, site and notes. */
export function filterBatteries(rows = [], f = {}) {
  const q = String(f.search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (f.status && f.status !== 'all' && r.status !== f.status) return false
    if (f.asset && r.asset_no !== f.asset) return false
    if (f.warranty && f.warranty !== 'all' && r._warranty?.key !== f.warranty) return false
    if (f.attentionOnly && !r._needsAttention) return false
    if (q) {
      const hay = [r.serial_no, r.asset_no, r.brand, r.site, r.notes].map((x) => (x == null ? '' : String(x))).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * KPI strip over the enriched set. Reuses summarizeBatteries for counts and
 * average health; adds warranty exposure and measurement coverage.
 */
export function batteryKpis(enriched = []) {
  const list = Array.isArray(enriched) ? enriched : []
  const s = summarizeBatteries(list)
  const inService = list.filter((r) => r.status !== 'retired')
  const expiringSoon = inService.filter((r) => r._warranty?.key === 'soon').length
  const outOfWarranty = inService.filter((r) => r._warranty?.key === 'expired').length
  const measured = list.filter((r) => r._health != null).length
  return {
    ...s,
    inService: inService.length,
    expiringSoon,
    outOfWarranty,
    measured,
    measuredPct: list.length ? Math.round((measured / list.length) * 100) : null,
  }
}

/** Attention list, worst first: lowest health, then replace before weak. */
export function attentionList(enriched = [], limit = 30) {
  const order = { replace: 0, weak: 1, healthy: 2, retired: 3 }
  return (Array.isArray(enriched) ? enriched : [])
    .filter((r) => r._needsAttention)
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)
      || (a._health ?? 101) - (b._health ?? 101))
    .slice(0, limit)
}

/** Unique sorted asset numbers that own at least one battery. */
export function assetOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.asset_no).filter(Boolean))].sort()
}

const isoDay = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '')

export const BATTERY_EXPORT_COLUMNS = Object.freeze([
  ['serial_no', 'Serial'], ['asset_no', 'Asset'], ['brand', 'Brand'], ['site', 'Site'],
  ['status', 'Status'], ['health_pct', 'Health %'], ['health_band', 'Health band'],
  ['voltage', 'Voltage'], ['install_date', 'Installed'], ['warranty_months', 'Warranty (mo)'],
  ['expiry', 'Warranty expiry'], ['warranty_state', 'Warranty state'], ['attention', 'Needs attention'],
])

export function batteryExportRows(enriched = []) {
  return (Array.isArray(enriched) ? enriched : []).map((r) => ({
    serial_no: r.serial_no || '',
    asset_no: r.asset_no || '',
    brand: r.brand || '',
    site: r.site || '',
    status: statusLabel(r.status),
    health_pct: r._health ?? '',
    health_band: r._band?.label || '',
    voltage: r.voltage ?? '',
    install_date: r.install_date || '',
    warranty_months: r.warranty_months ?? '',
    expiry: isoDay(r._expiry),
    warranty_state: r._warranty?.key === 'soon' ? 'Expiring soon' : (r._warranty?.label || ''),
    attention: r._needsAttention ? 'Yes' : 'No',
  }))
}
