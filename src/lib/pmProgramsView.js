/**
 * pmProgramsView.js - page shaping for the Preventive Maintenance page
 * (/pm-programs) on the Command Center kit.
 *
 * The maths stays where it already lives (pmSchedule, pmAnalytics,
 * pmProgramsAnalytics, costSources). This module only turns those results into
 * what the kit renders: pill classes, due text, KPI values, donut segments and
 * bar rows. Pure and deterministic, so it is unit tested.
 *
 * Honest values: anything that cannot be measured is null (rendered N/A), and
 * money is withheld when the scope spans more than one country, because each
 * country reports in its own currency and a sum across them is not a quantity.
 */

export const COUNTRY_CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })

/** Shared engine tones (green/amber/red/slate/sky) to kit pill classes. */
const TONE_TO_PILL = Object.freeze({ green: 'good', amber: 'warn', red: 'bad', slate: 'muted', sky: 'info' })

export function pillClass(tone) {
  return TONE_TO_PILL[tone] || 'muted'
}

/** True when the page is scoped to exactly one country. */
export function isSingleCountry(country) {
  const c = String(country || '').trim()
  return c !== '' && c.toLowerCase() !== 'all'
}

/**
 * The currency every money figure on the page is labelled with, or null when
 * the scope spans several countries (then money is shown per row only, or N/A).
 */
export function pageCurrency(country, fallback = null) {
  if (!isSingleCountry(country)) return null
  return COUNTRY_CURRENCY[country] || fallback || null
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** "in 5 days", "due today", "3 days overdue", or null when there is no date. */
export function dueDateText(daysToDue) {
  const d = num(daysToDue)
  if (d === null) return null
  if (d === 0) return 'due today'
  if (d < 0) return `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`
  return `in ${d} day${d === 1 ? '' : 's'}`
}

/** "1,200 km left", "300 h over", or null when the plan has no meter axis. */
export function dueMeterText(meterRemaining, unit) {
  const m = num(meterRemaining)
  if (m === null || !unit) return null
  const v = Math.abs(m).toLocaleString('en-US')
  return m < 0 ? `${v} ${unit} over` : `${v} ${unit} left`
}

/** Headline stat for the hero, from the compliance summary. */
export function heroStat(summary, loaded) {
  if (!loaded || !summary || summary.compliantPct == null) return undefined
  return { value: `${summary.compliantPct}%`, lines: ['Active plans', 'on schedule'] }
}

/**
 * KPI strip values. serviceCost12m is withheld (null) when the scope spans
 * several countries; `costReason` says why so the tile can explain itself.
 */
export function kpiValues({ summary, monthlyServiceTotal, singleCountry, loaded }) {
  if (!loaded || !summary) {
    return { active: null, overdue: null, dueSoon: null, compliance: null, serviceCost12m: null, costReason: null }
  }
  const cost = num(monthlyServiceTotal)
  return {
    active: summary.active ?? null,
    overdue: summary.overdue ?? null,
    dueSoon: summary.dueSoon ?? null,
    compliance: summary.compliantPct ?? null,
    serviceCost12m: singleCountry ? cost : null,
    costReason: singleCountry ? null : 'Choose one country. Service costs from several countries are in different currencies.',
  }
}

/** Upcoming-service window rows (30 / 60 / 90 days) with a bar share of active plans. */
export function bucketRows(buckets = {}, active = 0) {
  const total = num(active) || 0
  return [
    { key: 'd30', label: 'Next 30 days', count: buckets.d30 ?? 0 },
    { key: 'd60', label: 'Next 60 days', count: buckets.d60 ?? 0 },
    { key: 'd90', label: 'Next 90 days', count: buckets.d90 ?? 0 },
  ].map((r) => ({ ...r, pct: total > 0 ? Math.round((r.count / total) * 100) : 0 }))
}

/** Donut segments from [{key, count}] with a label map and a colour list. */
export function segments(items = [], { keyOf, labelOf, colors = [] } = {}) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => (num(it?.count) || 0) > 0)
    .map((it, i) => ({
      key: keyOf ? keyOf(it) : it.key,
      label: labelOf ? labelOf(it) : String(keyOf ? keyOf(it) : it.key),
      count: num(it.count) || 0,
      color: colors[i % Math.max(colors.length, 1)] || '#64748b',
    }))
}

/**
 * Horizontal bar rows: each item's share of the largest value. Items with a
 * zero or missing value are dropped (a 0 bar says nothing).
 */
export function barRows(items = [], { valueOf, limit = Infinity } = {}) {
  const rows = (Array.isArray(items) ? items : [])
    .map((it) => ({ item: it, value: num(valueOf ? valueOf(it) : it?.value) }))
    .filter((r) => r.value !== null && r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
  const max = rows.length ? rows[0].value : 0
  return rows.map((r) => ({ ...r.item, value: r.value, pct: max > 0 ? Math.max(2, Math.round((r.value / max) * 100)) : 0 }))
}

/** The due queue on the dashboard: overdue first (already sorted upstream). */
export function dueQueue(dueList = [], limit = 8) {
  const list = Array.isArray(dueList) ? dueList : []
  return { rows: list.slice(0, limit), more: Math.max(0, list.length - limit), total: list.length }
}

/** Short money text, with the currency when one is known. */
export function money(value, currency) {
  const n = num(value)
  if (n === null) return 'N/A'
  const abs = Math.abs(n)
  let s
  if (abs >= 1_000_000) s = `${(n / 1_000_000).toFixed(2)}M`
  else if (abs >= 10_000) s = `${(n / 1_000).toFixed(1)}K`
  else s = Math.round(n).toLocaleString('en-US')
  return currency ? `${currency} ${s}` : s
}
