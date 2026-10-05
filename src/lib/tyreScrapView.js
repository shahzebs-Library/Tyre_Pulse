/**
 * Pure shaping for the Tyre Scrap Management page (owner mockup, 2026-10-05).
 * Sits on top of tyreScrapManagementAnalytics.js: that engine owns what counts
 * as scrap and how cost, life and rate are measured; this file only arranges
 * those numbers for the KPI row, the three analytics cards and the selected
 * tyre card. No I/O, no clock unless passed in.
 */
import { isScrap, refDate, scrapKpis } from './tyreScrapManagementAnalytics'

export const COUNTRY_CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })

/** Days ahead that count as "vendor collection due". */
export const COLLECTION_DUE_DAYS = 14

/**
 * Money can be shown only when every row is in one currency. Under "All
 * countries" the rows may mix SAR, AED and EGP, and adding them gives a number
 * that is not an amount of anything.
 */
export function moneyScope(rows = [], activeCountry, activeCurrency) {
  if (activeCountry && activeCountry !== 'All') return { ok: true, currency: activeCurrency }
  const countries = [...new Set(rows.map((r) => r?.country).filter(Boolean))]
  if (countries.length <= 1) {
    return { ok: true, currency: COUNTRY_CURRENCY[countries[0]] || activeCurrency }
  }
  return { ok: false, currency: null, countries }
}

/** Percent change, rounded. Null whenever the previous value cannot anchor a change. */
export function pctChange(current, previous) {
  if (current == null || previous == null) return null
  const c = Number(current); const p = Number(previous)
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null
  return Math.round(((c - p) / Math.abs(p)) * 100)
}

/**
 * The window immediately before the selected one, same length. `rows` must
 * already carry the site / brand / reason filters but NOT the date cutoff.
 * Returns null for an open-ended period ("All time"), where no previous window
 * exists, so no trend is drawn.
 */
export function previousWindowKpis(rows = [], days, anchor) {
  if (!days || !anchor) return null
  const end = new Date(anchor)
  end.setDate(end.getDate() - days)
  const start = new Date(end)
  start.setDate(start.getDate() - days)
  const prior = rows.filter((t) => {
    const ref = refDate(t)
    if (!ref) return false
    const d = new Date(ref)
    return d >= start && d < end
  })
  if (!prior.length) return null
  return scrapKpis(prior, prior.filter(isScrap))
}

/** KPI trends vs the previous window. Each is null when it cannot be measured. */
export function scrapTrends(current, previous) {
  if (!current || !previous) return { count: null, cost: null, life: null, rate: null, retread: null }
  return {
    count: pctChange(current.scrapCount, previous.scrapCount),
    cost: pctChange(current.totalCost, previous.totalCost),
    life: pctChange(current.avgKmLife, previous.avgKmLife),
    rate: pctChange(current.scrapRate, previous.scrapRate),
    retread: pctChange(current.retreadCandidates, previous.retreadCandidates),
  }
}

/** The last `n` months of the 12-month trend, with a 0..100 bar height. */
export function trendBars(monthly = [], n = 9) {
  const slice = monthly.slice(-n)
  const max = Math.max(0, ...slice.map((m) => m.count || 0))
  return slice.map((m) => ({ ...m, pct: max > 0 ? Math.round(((m.count || 0) / max) * 100) : 0 }))
}

/** Reason breakdown folded to the top `top` reasons plus "Other reasons". */
export function reasonSegments(reasons = [], colors = [], top = 5) {
  const sorted = [...reasons].sort((a, b) => b.count - a.count)
  const head = sorted.slice(0, top)
  const rest = sorted.slice(top).reduce((s, r) => s + r.count, 0)
  const out = head.map((r, i) => ({ label: r.label, count: r.count, color: colors[i % (colors.length || 1)] }))
  if (rest > 0) out.push({ label: 'Other reasons', count: rest, color: '#94a3b8' })
  return out
}

const toDay = (v) => {
  if (!v) return null
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Disposal governance for the scrapped register.
 *
 * `disposals` are tyre_disposals rows (status, collection_due). `register` is the
 * register total plus how many of its tyres have a disposal row. Recycled,
 * destroyed and collection due only exist once the governance migration is
 * applied; before that they read null so the card shows N/A, not 0.
 */
export function governanceRows(disposals = [], { registerTotal = null, withDisposal = null, ready = false, now = new Date() } = {}) {
  const count = (s) => disposals.filter((d) => d?.status === s).length
  const today = toDay(now.toISOString())
  const horizon = new Date(today); horizon.setUTCDate(horizon.getUTCDate() + COLLECTION_DUE_DAYS)
  const due = ready
    ? disposals.filter((d) => {
      const c = toDay(d?.collection_due)
      return c && c <= horizon && !['Disposed', 'Recycled', 'Destroyed'].includes(d.status)
    }).length
    : null
  const notStarted = registerTotal != null && withDisposal != null ? Math.max(0, registerTotal - withDisposal) : null
  return [
    { key: 'not_started', label: 'Disposal not started', count: notStarted, tone: 'muted', hint: 'Scrapped tyres in the register with no disposal decision yet' },
    { key: 'pending', label: 'Pending decision', count: count('Pending'), tone: 'warn' },
    { key: 'retread', label: 'Sent for retread', count: count('Retreaded'), tone: 'info' },
    { key: 'disposed', label: 'Disposed', count: count('Disposed'), tone: 'good' },
    { key: 'recycled', label: 'Recycled', count: ready ? count('Recycled') : null, tone: 'good' },
    { key: 'destroyed', label: 'Destroyed', count: ready ? count('Destroyed') : null, tone: 'bad' },
    { key: 'due', label: `Vendor collection due (${COLLECTION_DUE_DAYS} days)`, count: due, tone: 'orange' },
  ]
}

/** Disposal statuses a user may pick, depending on whether the migration is applied. */
export function disposalStatusOptions(ready) {
  return ready
    ? ['Pending', 'Retreaded', 'Disposed', 'Recycled', 'Destroyed']
    : ['Pending', 'Retreaded', 'Disposed']
}

export function disposalTone(status) {
  return {
    Pending: 'warn', Retreaded: 'info', Disposed: 'good', Recycled: 'good', Destroyed: 'bad',
  }[status] || 'muted'
}

/** One line of facts for the selected tyre, each part only when it is known. */
export function selectedTyreFacts(row) {
  if (!row) return []
  const facts = []
  if (row.asset_no) facts.push(`Vehicle: ${[row.asset_no, row.vehicle_type, row.make].filter(Boolean).join(' ')}`)
  if (row.tyre_position) facts.push(`Position: ${row.tyre_position}`)
  if (row.tread_depth != null) facts.push(`Tread: ${row.tread_depth} mm`)
  if (row.km_run != null) facts.push(`Life: ${Number(row.km_run).toLocaleString('en-US')} km`)
  if (row.cost_per_tyre != null && row.km_run > 0) {
    facts.push(`CPK: ${(Number(row.cost_per_tyre) / Number(row.km_run)).toFixed(3)} per km`)
  }
  if (row.reason) facts.push(`Reason: ${row.reason}`)
  if (row.job_card) facts.push(`Job card: ${row.job_card}`)
  return facts
}
