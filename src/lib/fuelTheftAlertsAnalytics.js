/**
 * fuelTheftAlertsAnalytics - pure presentation engine for the Fuel Theft
 * Alerts page (/fuel-theft-alerts). Built on ./fuelTheftAlerts.js (per-alert
 * estimated loss); adds filtering, register enrichment, a currency-honest KPI
 * strip, severity / status breakdowns, repeat-asset detection, open-alert
 * ageing and the export shape.
 *
 * Rules:
 *   - Loss in different currencies is never added together: the headline is
 *     null and the per-currency split is returned.
 *   - An alert with no drop litres and no stored loss has an UNKNOWN loss (null),
 *     not a zero loss.
 *   - `now` is injected so ageing is deterministic.
 */
import { toFiniteNumber, estimatedLoss } from './fuelTheftAlerts'

export const SEVERITY_KEYS = ['critical', 'high', 'medium', 'low']
export const STATUS_KEYS = ['open', 'investigating', 'confirmed', 'dismissed', 'resolved']
const CLOSED = new Set(['dismissed', 'resolved'])
const DAY = 24 * 3600 * 1000

const lower = (v) => (v == null ? '' : String(v).trim().toLowerCase())
const str = (v) => (v == null ? '' : String(v))

export const titleCase = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : 'N/A')

export function isOpenAlert(r) {
  return !CLOSED.has(lower(r?.status))
}

/** How the loss figure was obtained, so the UI can say so. */
export function lossBasis(r) {
  const litres = toFiniteNumber(r?.drop_litres)
  const price = toFiniteNumber(r?.fuel_price_per_litre)
  if (litres != null && price != null) return 'derived'
  if (toFiniteNumber(r?.estimated_loss) != null) return 'stored'
  return 'unknown'
}

export function enrichAlerts(rows = [], now = Date.now(), fallbackCurrency = '') {
  const ref = now instanceof Date ? now.getTime() : Number(now)
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const t = r?.detected_at ? Date.parse(r.detected_at) : NaN
    const open = isOpenAlert(r)
    const drop = toFiniteNumber(r?.drop_litres)
    const expected = toFiniteNumber(r?.expected_litres)
    return {
      ...r,
      sev: lower(r?.severity),
      st: lower(r?.status),
      open,
      loss: estimatedLoss(r),
      basis: lossBasis(r),
      dropValue: drop,
      expectedValue: expected,
      // Litres unaccounted for beyond the expected consumption.
      excessLitres: drop != null && expected != null ? Math.max(0, drop - expected) : null,
      detectedTime: Number.isFinite(t) ? t : null,
      ageDays: open && Number.isFinite(t) && Number.isFinite(ref) ? Math.max(0, Math.floor((ref - t) / DAY)) : null,
      cur: str(r?.currency).trim() || fallbackCurrency || '',
    }
  })
}

export function filterAlerts(rows = [], { asset = '', status = '', severity = '', openOnly = false, from = '', to = '', search = '' } = {}) {
  const q = str(search).trim().toLowerCase()
  const fromT = from ? Date.parse(`${from}T00:00:00`) : null
  const toT = to ? Date.parse(`${to}T23:59:59`) : null
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (asset && r?.asset_no !== asset) return false
    if (status && lower(r?.status) !== status) return false
    if (severity && lower(r?.severity) !== severity) return false
    if (openOnly && !isOpenAlert(r)) return false
    if (fromT != null || toT != null) {
      const t = r?.detected_at ? Date.parse(r.detected_at) : NaN
      if (!Number.isFinite(t)) return false
      if (fromT != null && t < fromT) return false
      if (toT != null && t > toT) return false
    }
    if (q) {
      const hay = [r?.alert_no, r?.asset_no, r?.driver_name, r?.location, r?.notes, r?.resolution].map(str).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function lossByCurrency(rows = [], fallbackCurrency = '') {
  const map = new Map()
  let known = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const l = estimatedLoss(r)
    if (l == null) continue
    known += 1
    const cur = str(r?.currency).trim() || fallbackCurrency || 'Unspecified'
    map.set(cur, (map.get(cur) || 0) + l)
  }
  const totals = [...map.entries()].map(([currency, total]) => ({ currency, total })).sort((a, b) => b.total - a.total)
  return { totals, known, mixed: totals.length > 1, total: totals.length === 1 ? totals[0].total : null, currency: totals.length === 1 ? totals[0].currency : null }
}

function tally(list, keys, field) {
  return keys.map((k) => ({ key: k, label: titleCase(k), count: list.filter((r) => lower(r?.[field]) === k).length }))
}

export function severityBreakdown(rows = []) {
  return tally(Array.isArray(rows) ? rows : [], SEVERITY_KEYS, 'severity')
}
export function statusBreakdown(rows = []) {
  return tally(Array.isArray(rows) ? rows : [], STATUS_KEYS, 'status')
}

/** Assets with more than one alert, most alerts first. Loss per currency. */
export function repeatAssets(rows = [], fallbackCurrency = '') {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const a = str(r?.asset_no).trim()
    if (!a) continue
    const prev = map.get(a) || { asset_no: a, alerts: 0, open: 0, rows: [] }
    prev.alerts += 1
    if (isOpenAlert(r)) prev.open += 1
    prev.rows.push(r)
    map.set(a, prev)
  }
  return [...map.values()]
    .filter((x) => x.alerts > 1)
    .map(({ rows: rs, ...rest }) => ({ ...rest, loss: lossByCurrency(rs, fallbackCurrency) }))
    .sort((a, b) => b.alerts - a.alerts || b.open - a.open)
}

export function buildAlertKpis(rows = [], now = Date.now(), fallbackCurrency = '') {
  const list = enrichAlerts(rows, now, fallbackCurrency)
  const open = list.filter((r) => r.open)
  const ages = open.map((r) => r.ageDays).filter((v) => v != null)
  let litres = 0
  let litresKnown = 0
  for (const r of list) {
    if (r.dropValue != null) { litres += r.dropValue; litresKnown += 1 }
  }
  return {
    total: list.length,
    open: open.length,
    criticalOpen: open.filter((r) => r.sev === 'critical').length,
    confirmed: list.filter((r) => r.st === 'confirmed').length,
    litresLost: litresKnown ? litres : null,
    oldestOpenDays: ages.length ? Math.max(...ages) : null,
    staleOpen: ages.filter((d) => d > 7).length,
    loss: lossByCurrency(list, fallbackCurrency),
    unknownLoss: list.filter((r) => r.loss == null).length,
  }
}

export function buildAlertInsights(rows = [], now = Date.now(), fallbackCurrency = '') {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return []
  const k = buildAlertKpis(list, now, fallbackCurrency)
  const out = []
  if (k.criticalOpen) out.push(`${k.criticalOpen} critical alert(s) are still open.`)
  if (k.staleOpen) out.push(`${k.staleOpen} open alert(s) are older than 7 days without being resolved or dismissed.`)
  const repeat = repeatAssets(list, fallbackCurrency)
  if (repeat.length) out.push(`${repeat.length} asset(s) have more than one alert, led by ${repeat[0].asset_no} with ${repeat[0].alerts}. Repeat events point to a pattern, not a one-off.`)
  if (k.unknownLoss) out.push(`${k.unknownLoss} alert(s) have no drop litres or loss recorded, so the loss total understates the exposure.`)
  if (k.loss.mixed) out.push(`Losses are recorded in ${k.loss.totals.length} currencies, so no single total is shown.`)
  return out
}

export const ALERT_EXPORT_COLUMNS = [
  { key: 'alert_no', header: 'Alert #' },
  { key: 'asset_no', header: 'Asset' },
  { key: 'driver_name', header: 'Driver' },
  { key: 'location', header: 'Location' },
  { key: 'detected_at', header: 'Detected' },
  { key: 'drop_litres', header: 'Drop (L)' },
  { key: 'expected_litres', header: 'Expected (L)' },
  { key: 'fuel_price_per_litre', header: 'Price/L' },
  { key: 'estimated_loss', header: 'Est. loss' },
  { key: 'loss_basis', header: 'Loss basis' },
  { key: 'currency', header: 'Currency' },
  { key: 'severity', header: 'Severity' },
  { key: 'status', header: 'Status' },
  { key: 'age_days', header: 'Open for (days)' },
]

const BASIS_LABEL = { derived: 'Drop x price', stored: 'Recorded', unknown: 'Not recorded' }

export function alertExportRows(rows = [], now = Date.now(), fallbackCurrency = '') {
  return enrichAlerts(rows, now, fallbackCurrency).map((r) => ({
    alert_no: r.alert_no || '',
    asset_no: r.asset_no || '',
    driver_name: r.driver_name || '',
    location: r.location || '',
    detected_at: r.detected_at || '',
    drop_litres: r.dropValue ?? '',
    expected_litres: r.expectedValue ?? '',
    fuel_price_per_litre: toFiniteNumber(r.fuel_price_per_litre) ?? '',
    estimated_loss: r.loss == null ? '' : Math.round(r.loss * 100) / 100,
    loss_basis: BASIS_LABEL[r.basis],
    currency: r.loss == null ? '' : r.cur,
    severity: r.sev ? titleCase(r.sev) : '',
    status: r.st ? titleCase(r.st) : '',
    age_days: r.ageDays ?? '',
  }))
}
