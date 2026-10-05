/**
 * Pure shaping for the TV Display Mode page (/display). No I/O and no clock
 * reads: every function that needs "now" takes it as an argument, so the page
 * and the tests decide what time it is.
 *
 * Nothing here invents a number. A value with no source renders "N/A" with a
 * reason, a trend is never drawn (the board has no measured previous period),
 * and money is kept per currency: SAR, AED and EGP are never added together.
 */

export const COUNTRY_CURRENCY = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** "12 min ago", "3 h ago", "2 days ago". Null-safe: '' when unknown. */
export function agoText(when, now) {
  if (!when || !now) return ''
  const t = new Date(when).getTime()
  const n = (now instanceof Date ? now : new Date(now)).getTime()
  if (!Number.isFinite(t) || !Number.isFinite(n)) return ''
  const mins = Math.max(0, Math.round((n - t) / 60000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.round(hrs / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

/**
 * The five headline tiles. Inputs are the already-computed board summaries.
 * `ready` maps each source to whether it loaded, so an unloaded source reads
 * "..." / "N/A" instead of 0.
 */
export function tvKpis({ availability, alertSummary, woBoard, todayInsp, ready = {} }) {
  const fleetOk = !!ready.fleet
  const total = availability?.total ?? 0
  return [
    {
      key: 'vehicles', label: 'Vehicles Active', tone: 'green',
      value: fleetOk ? (availability?.available ?? 0) : null,
      sub: fleetOk ? (total ? `Of ${total.toLocaleString('en-US')} registered` : 'No vehicles registered') : 'Fleet register not loaded',
      to: '/fleet-master',
    },
    {
      key: 'alerts', label: 'Critical Alerts', tone: 'red',
      value: ready.alerts ? (alertSummary?.bySeverity?.Critical ?? 0) : null,
      sub: ready.alerts ? 'Active, need immediate action' : 'Alerts not loaded',
      to: '/alerts', danger: ready.alerts && (alertSummary?.bySeverity?.Critical ?? 0) > 0,
    },
    {
      key: 'workshop', label: 'Workshop Jobs', tone: 'blue',
      value: ready.workOrders ? (woBoard?.total ?? 0) : null,
      sub: ready.workOrders ? `${woBoard?.inProgress ?? 0} in progress` : 'Job cards not loaded',
      to: '/workshop-live',
    },
    {
      key: 'inspections', label: 'Inspections', tone: 'purple',
      value: ready.inspections ? (todayInsp?.total ?? 0) : null,
      sub: ready.inspections ? 'Scheduled today' : 'Inspections not loaded',
      to: '/inspections',
    },
    {
      key: 'health', label: 'Fleet Health', tone: 'amber',
      // Availability is the one measured operational status this board has.
      display: fleetOk ? (total ? `${availability.pct}%` : 'N/A') : null,
      sub: fleetOk ? (total ? 'Share of fleet in service' : 'No fleet to measure') : 'Fleet register not loaded',
      to: '/fleet-master',
    },
  ]
}

/**
 * Tyre spend this month from priced tyre records, one line per currency.
 * Rows carry country + cost_per_tyre + qty + issue_date. A row with no country
 * cannot be given a currency, so it is counted apart rather than guessed.
 * @returns {{ lines:Array<{country,currency,amount,tyres}>, unknownCountry:number, priced:number }}
 */
export function monthSpendByCurrency(rows = [], now) {
  const d = now instanceof Date ? now : new Date(now)
  const y = d.getFullYear()
  const m = d.getMonth()
  const by = {}
  let unknownCountry = 0
  let priced = 0
  for (const r of rows) {
    if (!r?.issue_date) continue
    const t = new Date(r.issue_date)
    if (Number.isNaN(t.getTime()) || t.getFullYear() !== y || t.getMonth() !== m) continue
    const cost = num(r.cost_per_tyre)
    if (cost == null || cost <= 0) continue
    const qty = num(r.qty) && num(r.qty) > 0 ? num(r.qty) : 1
    priced += 1
    const currency = COUNTRY_CURRENCY[r.country]
    if (!currency) { unknownCountry += 1; continue }
    const b = (by[r.country] ||= { country: r.country, currency, amount: 0, tyres: 0 })
    b.amount += cost * qty
    b.tyres += qty
  }
  const lines = Object.values(by)
    .map((b) => ({ ...b, amount: Math.round(b.amount) }))
    .sort((a, b) => a.country.localeCompare(b.country))
  return { lines, unknownCountry, priced }
}

/** "SAR 319,000" style money; 'N/A' when not a number. */
export function money(amount, currency) {
  const n = num(amount)
  if (n == null) return 'N/A'
  return `${currency || ''} ${Math.round(n).toLocaleString('en-US')}`.trim()
}

const SEV_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 }
const SEV_TONE = { Critical: 'bad', High: 'orange', Medium: 'warn', Low: 'info', Info: 'muted' }

/** Normalised alert rows for the Live Alerts card, worst and newest first. */
export function liveAlertRows(alerts = [], now, limit = 6) {
  return alerts
    .map((a, i) => {
      const sev = SEV_ORDER[a?.severity] != null ? a.severity : 'Info'
      return {
        id: a?.id ?? `alert-${i}`,
        severity: sev,
        tone: SEV_TONE[sev],
        message: (a?.message && String(a.message).trim()) || 'Alert',
        asset: a?.asset_no || '',
        site: (a?.site && String(a.site).trim()) || '',
        ago: agoText(a?.created_at, now),
        at: a?.created_at ? new Date(a.created_at).getTime() : 0,
      }
    })
    .sort((x, y) => (SEV_ORDER[x.severity] - SEV_ORDER[y.severity]) || (y.at - x.at))
    .slice(0, limit)
}

/** Status tone for a work-order status chip. */
export function jobStatusTone(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('progress')) return 'info'
  if (s.includes('part') || s.includes('wait') || s.includes('hold')) return 'warn'
  if (s.includes('overdue') || s.includes('delay')) return 'bad'
  if (s === 'open' || s === 'new') return 'good'
  return 'muted'
}

/**
 * Live job activity rows from the open work-order list. A job is "Delayed"
 * only when it has a target completion date that has passed.
 */
export function jobActivityRows(list = [], now, limit = 8) {
  const n = (now instanceof Date ? now : new Date(now)).getTime()
  return list.slice(0, limit).map((o, i) => {
    const target = o?.target_completion ? new Date(o.target_completion).getTime() : null
    const delayed = target != null && Number.isFinite(target) && target < n
    return {
      id: o?.id ?? `wo-${i}`,
      asset: o?.asset_no || 'Unassigned asset',
      ref: o?.work_order_no || '',
      type: o?.work_type || 'Job',
      site: o?.site || '',
      status: delayed ? 'Delayed' : (o?.status || 'Open'),
      tone: delayed ? 'bad' : jobStatusTone(o?.status),
      opened: agoText(o?.opened_at, now),
    }
  })
}

/**
 * Rotation table rows: every board with its duration, scope, on/off state and
 * whether it is on screen now.
 */
export function rotationRows(boards = [], enabled = {}, { rotateSecs = 30, activeKey, autoRotate = true } = {}) {
  return boards.map((b) => {
    const on = enabled[b.key] !== false
    return {
      key: b.key,
      label: b.label,
      duration: `${rotateSecs} sec`,
      scope: 'All sites',
      on,
      live: b.key === activeKey,
      state: !on ? 'Off' : b.key === activeKey ? (autoRotate ? 'On screen' : 'Paused on screen') : 'Queued',
    }
  })
}

/**
 * TV screens = the org's active shared report links (report_shares). Each one is
 * a real screen somewhere that opens a rotating board.
 */
export function screenRows(shares = [], now) {
  const n = (now instanceof Date ? now : new Date(now)).getTime()
  return shares.map((s) => {
    const exp = s?.expires_at ? new Date(s.expires_at).getTime() : null
    const expired = exp != null && Number.isFinite(exp) && exp < n
    const boards = Array.isArray(s?.layout?.boards) && s.layout.boards.length
      ? s.layout.boards.length
      : (Array.isArray(s?.pages) ? s.pages.length : 0)
    return {
      id: s?.id,
      name: s?.name || 'Unnamed screen',
      token: s?.token || '',
      status: expired ? 'Expired' : s?.active === false ? 'Revoked' : 'Live link',
      tone: expired || s?.active === false ? 'muted' : 'good',
      boards,
      views: num(s?.view_count) ?? 0,
      lastViewed: s?.last_viewed_at ? agoText(s.last_viewed_at, now) : 'Never opened',
    }
  })
}

// Dark ink used by src/lib/displayCharts.js, mapped to readable light-theme ink.
const LIGHT_SWAP = {
  '#f1f5f9': '#101828',
  '#f8fafc': '#101828',
  '#cbd5e1': '#344054',
  '#94a3b8': '#667085',
  '#0d1420': '#ffffff',
  'rgba(148,163,184,0.28)': 'rgba(16,24,40,0.18)',
  'rgba(148,163,184,0.12)': 'rgba(16,24,40,0.08)',
  'rgba(148,163,184,0.3)': 'rgba(16,24,40,0.15)',
  'rgba(148,163,184,0.16)': 'rgba(16,24,40,0.08)',
}

/**
 * Re-ink a dark ECharts option for the light theme. Returns a deep copy with
 * the dark text/axis/border colours swapped; functions (formatters) are kept.
 * In dark mode the option is returned unchanged.
 */
export function themeChartOption(option, light) {
  if (!light) return option
  const walk = (v) => {
    if (typeof v === 'string') {
      const k = v.trim().toLowerCase().replace(/\s+/g, '')
      return LIGHT_SWAP[k] ?? v
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out = {}
      for (const [k, val] of Object.entries(v)) out[k] = walk(val)
      return out
    }
    return v
  }
  return walk(option)
}

/** Header date line: "05 Oct 2026" and "Mon 14:32". */
export function clockParts(now) {
  const d = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const time = `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  return { date, time }
}

/* ── Operations summary period + map board (fix round, mockup parity) ───── */

export const OPS_PERIODS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: 'mtd', label: 'Month to date' },
]

const dayKey = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Local-calendar window for an Operations Summary period. `from`/`to` are
 * YYYY-MM-DD (inclusive) built from local getters, never toISOString.
 */
export function opsPeriodRange(key, now) {
  const d = now instanceof Date ? now : new Date(now)
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  let start = end
  if (key === '7d') start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6)
  else if (key === 'mtd') start = new Date(end.getFullYear(), end.getMonth(), 1)
  const days = Math.round((end - start) / 86400000) + 1
  const label = OPS_PERIODS.find((p) => p.key === key)?.label || 'Today'
  return { from: dayKey(start), to: dayKey(end), days, label }
}

/** Earliest date any period can ask for: the sooner of month start and 7 days ago. */
export function opsLoadStart(now) {
  const a = opsPeriodRange('mtd', now).from
  const b = opsPeriodRange('7d', now).from
  return a < b ? a : b
}

const inRange = (v, from, to) => {
  if (!v) return false
  const k = String(v).slice(0, 10)
  return k >= from && k <= to
}

/** Tyre spend per currency inside an explicit window (same rules as monthSpendByCurrency). */
export function spendByCurrency(rows = [], { from, to }) {
  const by = {}
  let unknownCountry = 0
  let priced = 0
  for (const r of rows) {
    if (!inRange(r?.issue_date, from, to)) continue
    const cost = num(r.cost_per_tyre)
    if (cost == null || cost <= 0) continue
    const qty = num(r.qty) && num(r.qty) > 0 ? num(r.qty) : 1
    priced += 1
    const currency = COUNTRY_CURRENCY[r.country]
    if (!currency) { unknownCountry += 1; continue }
    const b = (by[r.country] ||= { country: r.country, currency, amount: 0, tyres: 0 })
    b.amount += cost * qty
    b.tyres += qty
  }
  const lines = Object.values(by)
    .map((b) => ({ ...b, amount: Math.round(b.amount) }))
    .sort((a, b) => a.country.localeCompare(b.country))
  return { lines, unknownCountry, priced }
}

/**
 * One value per day across the window (zero-filled), for the mini bar charts.
 * `valueOf(row)` returns the number to add, or null to skip the row.
 */
export function dailySeries(rows = [], { from, to }, dateKey, valueOf = () => 1) {
  const out = []
  const idx = {}
  const [y, m, d] = from.split('-').map(Number)
  for (let t = new Date(y, m - 1, d); dayKey(t) <= to; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
    idx[dayKey(t)] = out.length
    out.push(0)
    if (out.length > 62) break
  }
  for (const r of rows) {
    const k = r?.[dateKey] ? String(r[dateKey]).slice(0, 10) : null
    if (k == null || idx[k] == null) continue
    const v = valueOf(r)
    if (v == null || !Number.isFinite(v)) continue
    out[idx[k]] += v
  }
  return out
}

/**
 * Production in the window from production_logs. Approved m3 is the counted
 * quantity; a load with no approved figure is NOT counted (V523 rule).
 * @returns {{ m3:number|null, loads:number, series:number[] }}
 */
export function productionSummary(rows = [], range) {
  const kept = rows.filter((r) => inRange(r?.period_date, range.from, range.to))
  const approved = kept.filter((r) => num(r.approved_m3) != null)
  const m3 = approved.length ? Math.round(approved.reduce((t, r) => t + num(r.approved_m3), 0)) : null
  return {
    m3,
    loads: approved.length,
    series: dailySeries(approved, range, 'period_date', (r) => num(r.approved_m3)),
  }
}

/**
 * Site board for the "Live Fleet Map" card. There is no GPS feed, so every
 * site is a pin with its registered vehicles and today's activity.
 * Tone: alert > workshop > inspection > active > inactive.
 */
export function siteBoard({ fleet = [], jobs = [], inspectionsToday = [], alerts = [] } = {}) {
  const norm = (v) => (v && String(v).trim()) || 'Unassigned'
  const by = {}
  const get = (site) => (by[site] ||= { site, vehicles: 0, active: 0, inactive: 0, workshop: 0, inspection: 0, alerts: 0 })
  for (const v of fleet) {
    const b = get(norm(v?.site))
    b.vehicles += 1
    if (!v?.status || v.status === 'Active') b.active += 1
    else b.inactive += 1
  }
  for (const j of jobs) get(norm(j?.site)).workshop += 1
  for (const i of inspectionsToday) get(norm(i?.site)).inspection += 1
  for (const a of alerts) if (a?.severity === 'Critical' && a?.site) get(norm(a.site)).alerts += 1
  const rows = Object.values(by).map((b) => ({
    ...b,
    tone: b.alerts ? 'alert' : b.workshop ? 'workshop' : b.inspection ? 'inspection' : b.active ? 'active' : 'inactive',
  })).sort((a, b) => b.vehicles - a.vehicles || a.site.localeCompare(b.site))
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0)
  const criticalAll = alerts.filter((a) => a?.severity === 'Critical').length
  return {
    sites: rows,
    legend: [
      { key: 'active', label: 'Active', count: sum('active') },
      { key: 'alert', label: 'Alert', count: criticalAll },
      { key: 'workshop', label: 'Workshop', count: sum('workshop') },
      { key: 'inspection', label: 'Inspection', count: sum('inspection') },
      { key: 'inactive', label: 'Inactive', count: sum('inactive') },
    ],
  }
}
