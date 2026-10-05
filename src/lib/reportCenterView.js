/**
 * reportCenterView - pure shaping for the rebuilt Report Center page: the
 * report catalogue (every report the app can generate today), category counts,
 * catalogue filters, delivery mode / last delivery per report and the KPI
 * strip. No I/O; `now` is injectable.
 *
 * The catalogue is built from what really exists:
 *   - four on-demand exports the page renders itself (executive deck, daily
 *     executive PDF, tyre records Excel / PDF);
 *   - every standard scheduled report type (REPORT_TYPES), generated on demand
 *     from the same dataset the scheduler emails;
 *   - every saved Report Builder layout (accident_report_templates).
 * A report counts as "Scheduled" only when an ACTIVE schedule uses it.
 */

const DAY = 86400000

export const CATEGORIES = [
  'Fleet and Assets', 'Tyre Management', 'Workshop', 'Compliance', 'Safety and Claims',
  'Finance', 'Inventory and Procurement', 'Executive', 'Custom reports',
]

/** Category of a standard report type. */
export const TYPE_CATEGORY = {
  executive: 'Executive',
  kpi: 'Tyre Management',
  fleet: 'Fleet and Assets',
  cost: 'Finance',
  inspection: 'Compliance',
  accidents: 'Safety and Claims',
  claims: 'Safety and Claims',
  stock: 'Inventory and Procurement',
  vendor: 'Inventory and Procurement',
  pm: 'Workshop',
  workshop: 'Workshop',
}

/** The four page-rendered exports (ids are the existing generate() keys). */
export const ON_DEMAND = [
  { id: 'pptx', name: 'Executive PowerPoint', category: 'Executive', formats: ['PPTX'], desc: '12-slide management deck: KPIs, risk, cost, recommendations.' },
  { id: 'daily', name: 'Daily Executive PDF', category: 'Executive', formats: ['PDF'], desc: 'One page per section landscape operations brief.' },
  { id: 'excel', name: 'Tyre Records (Excel)', category: 'Tyre Management', formats: ['Excel'], desc: 'Workbook of tyre records with cost columns.' },
  { id: 'pdf', name: 'Tyre Records (PDF)', category: 'Tyre Management', formats: ['PDF'], desc: 'Print-ready landscape table (top 200 records).' },
]

/**
 * Full catalogue. `reportTypes` = [{value,label}], `layouts` = schedulable
 * builder layouts [{value,label,updated_at}].
 */
export function buildCatalog(reportTypes = [], layouts = []) {
  return [
    ...ON_DEMAND.map((r) => ({ ...r, kind: 'page', reportType: null, updatedAt: null })),
    ...reportTypes.map((t) => ({
      id: `type:${t.value}`, kind: 'type', reportType: t.value, name: t.label,
      category: TYPE_CATEGORY[t.value] || 'Executive', formats: ['PDF', 'Excel'],
      desc: 'Same dataset the scheduler emails, over the selected date range.', updatedAt: null,
    })),
    ...layouts.map((l) => ({
      id: `layout:${l.value}`, kind: 'layout', reportType: l.value, name: l.label || 'Untitled layout',
      category: 'Custom reports', formats: ['PDF', 'Excel'], desc: 'Saved Report Builder layout.', updatedAt: l.updated_at || null,
    })),
  ]
}

export function categoryCounts(catalog = []) {
  const m = new Map(CATEGORIES.map((c) => [c, 0]))
  for (const r of catalog) m.set(r.category, (m.get(r.category) || 0) + 1)
  return [...m.entries()].map(([category, count]) => ({ category, count }))
}

/** 'Scheduled' when an active schedule uses the report type, else 'On demand'. */
export function modeFor(entry, schedules = []) {
  if (!entry?.reportType) return 'On demand'
  return schedules.some((s) => s.active && s.report_type === entry.reportType) ? 'Scheduled' : 'On demand'
}

/** Newest delivery (sent or failed) for a report type, or null. */
export function lastDelivery(entry, runs = []) {
  if (!entry?.reportType) return null
  let best = null
  for (const r of runs) {
    if (r?.report_type !== entry.reportType || !r.sent_at) continue
    if (!best || String(r.sent_at) > String(best.sent_at)) best = r
  }
  return best
}

export function filterCatalog(catalog = [], { search = '', category = '', format = '', mode = '' } = {}, schedules = []) {
  const q = String(search).trim().toLowerCase()
  return catalog.filter((r) => {
    if (category && r.category !== category) return false
    if (format && !r.formats.includes(format)) return false
    if (mode && modeFor(r, schedules) !== mode) return false
    if (q && ![r.name, r.category, r.desc].some((v) => String(v || '').toLowerCase().includes(q))) return false
    return true
  })
}

/** Delivery success over the last `days` days; null when nothing was decided. */
export function deliverySuccess(runs = [], now, days = 30) {
  const from = Number(now) - days * DAY
  let sent = 0; let failed = 0
  for (const r of runs) {
    const t = new Date(r?.sent_at).getTime()
    if (!Number.isFinite(t) || t < from || t > Number(now)) continue
    const s = String(r.status || '').toLowerCase()
    if (s === 'sent') sent += 1
    else if (s === 'failed' || s === 'error') failed += 1
  }
  const decided = sent + failed
  return { sent, failed, pct: decided ? Math.round((sent / decided) * 1000) / 10 : null }
}

/** Next run label input: the active schedules sorted by next_run_at. */
export function upcomingSchedules(schedules = [], limit = 5) {
  return [...schedules]
    .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active))
      || String(a.next_run_at || '9999').localeCompare(String(b.next_run_at || '9999')))
    .slice(0, limit)
}
