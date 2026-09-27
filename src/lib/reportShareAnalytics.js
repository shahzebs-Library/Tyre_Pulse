/**
 * reportShareAnalytics - pure row shapers for the anonymous public / TV board
 * (src/pages/ReportShare.jsx, route /report/:token).
 *
 * The board renders ONLY the aggregate snapshot returned by the token-gated
 * get_report_snapshot RPC. These helpers turn the three list channels in that
 * snapshot into table rows - they add no data and never reach for more:
 *
 *   jobCardRows / summarizeJobCards   ops.open_job_cards  (Open job cards page)
 *   pmDueRows / summarizePmDue        ops.pm_due_list     (Maintenance due page)
 *   countryCostRows                   cost.by_country     (Cost per unit page)
 *
 * The lists are already PII free (asset, site, status, priority, plan name);
 * nothing here adds a person, a name or a cost that was not in the snapshot.
 * `now` is injected so "overdue by N days" is deterministic under test.
 * Blank values stay null (rendered N/A), never 0 or an empty string.
 */

const arr = (v) => (Array.isArray(v) ? v : [])
const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
const text = (v) => (blank(v) ? null : String(v))

const DAY_MS = 86400000

/** Whole calendar days from `now` to `iso` (negative = overdue); null when unreadable. */
export function daysUntil(iso, now = new Date()) {
  if (blank(iso)) return null
  const d = new Date(iso)
  const n = now instanceof Date ? new Date(now.getTime()) : new Date(now)
  if (Number.isNaN(d.getTime()) || Number.isNaN(n.getTime())) return null
  d.setHours(0, 0, 0, 0)
  n.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - n.getTime()) / DAY_MS)
}

/** "Overdue 3d" / "Due today" / "In 5d" / "N/A". */
export function dueLabel(days) {
  if (days == null) return 'N/A'
  if (days < 0) return `Overdue ${Math.abs(days).toLocaleString('en-US')}d`
  if (days === 0) return 'Due today'
  return `In ${days.toLocaleString('en-US')}d`
}

export function jobCardRows(list) {
  return arr(list).map((r, i) => ({
    key: `${r?.wo_no || 'wo'}-${i}`,
    wo_no: text(r?.wo_no),
    asset_no: text(r?.asset_no),
    work_type: text(r?.work_type),
    status: text(r?.status),
    site: text(r?.site),
    priority: text(r?.priority),
  }))
}

function tally(rows, field) {
  const out = {}
  for (const r of rows) {
    const k = r[field] ?? 'Not recorded'
    out[k] = (out[k] || 0) + 1
  }
  return out
}

/** Counts shown on the board are for the LISTED rows, which may be a top-N. */
export function summarizeJobCards(rows) {
  const list = arr(rows)
  return {
    listed: list.length,
    byStatus: tally(list, 'status'),
    byPriority: tally(list, 'priority'),
    highPriority: list.filter((r) => /crit|high/i.test(r.priority || '')).length,
  }
}

export function pmDueRows(list, now = new Date()) {
  return arr(list).map((r, i) => {
    const days = daysUntil(r?.next_due, now)
    return {
      key: `${r?.asset_no || 'pm'}-${i}`,
      asset_no: text(r?.asset_no),
      name: text(r?.name),
      next_due: text(r?.next_due),
      days,
      overdue: days != null && days < 0,
      due_label: dueLabel(days),
      priority: text(r?.priority),
    }
  })
}

export function summarizePmDue(rows) {
  const list = arr(rows)
  const overdue = list.filter((r) => r.overdue)
  const measurable = list.filter((r) => r.days != null)
  return {
    listed: list.length,
    overdue: overdue.length,
    dueToday: list.filter((r) => r.days === 0).length,
    undated: list.length - measurable.length,
    worstOverdueDays: overdue.length ? Math.max(...overdue.map((r) => Math.abs(r.days))) : null,
  }
}

/** Per-country cost rows; each keeps its own currency and is never summed. */
export function countryCostRows(byCountry) {
  const num = (v) => (blank(v) || !Number.isFinite(Number(v)) ? null : Number(v))
  return arr(byCountry).map((r) => ({
    key: String(r?.country ?? ''),
    country: text(r?.country),
    currency: text(r?.currency),
    total: num(r?.total),
    tyre: num(r?.tyre),
    maintenance: num(r?.maintenance),
    sco: num(r?.sco),
    sany: num(r?.sany),
  }))
}

/** "SAR 1,234" / "N/A". Grouping only; the currency comes from the row. */
export function formatMoney(v, currency) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  return `${currency ? `${currency} ` : ''}${Math.round(Number(v)).toLocaleString('en-US')}`
}
