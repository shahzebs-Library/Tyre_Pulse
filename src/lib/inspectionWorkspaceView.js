/**
 * inspectionWorkspaceView - the pure half of the Inspections workspace
 * (list, selected inspection, findings, defect mix, trend).
 *
 * Built ONLY on the rows the register already loaded. No I/O, `now` is
 * injectable. Every tyre reading goes through lib/inspectionView so the
 * workspace, the register, the viewer and the PDF band a condition the same way.
 * A value that was not recorded stays null and is said as such, never 0.
 */
import { normalizeTyreConditions, positionLabelMap, affectedTyreReadings, RISK_LABEL } from './inspectionView'
import { isoDay } from './inspectionsAnalytics'

/** The business day of an inspection (YYYY-MM-DD) or '' when the row carries none. */
export function rowDay(r) {
  const v = r?.inspection_date || r?.scheduled_date || r?.completed_date || r?.created_at || ''
  return String(v).slice(0, 10)
}

// normalizeTyreConditions reads a row WITHOUT a tyre_conditions key as the map
// itself, so a row's own columns would become "positions". Always hand it the key.
const withTc = (r) => (r && !('tyre_conditions' in r) ? { ...r, tyre_conditions: null } : r)
const affected = (r) => affectedTyreReadings(withTc(r))

const isDone = (r) => r?.status === 'Done' || r?.approval_status === 'approved'
const isPending = (r) => !isDone(r) && r?.status !== 'Cancelled' && r?.status !== 'Overdue'

/**
 * One inspection's place in the queue: done, overdue, pending approval, in progress
 * or scheduled. Drives the list pill.
 */
export function inspectionStage(r) {
  if (!r) return { key: 'none', label: 'N/A', tone: 'muted' }
  if (r.approval_status === 'approved') return { key: 'approved', label: 'Approved', tone: 'good' }
  if (r.status === 'Done') return { key: 'done', label: 'Completed', tone: 'good' }
  if (r.status === 'Overdue') return { key: 'overdue', label: 'Overdue', tone: 'bad' }
  if (r.status === 'Cancelled') return { key: 'cancelled', label: 'Cancelled', tone: 'muted' }
  if (r.approval_status === 'pending_approval') return { key: 'approval', label: 'Pending approval', tone: 'warn' }
  if (r.status === 'In Progress') return { key: 'progress', label: 'In progress', tone: 'info' }
  return { key: 'scheduled', label: r.status || 'Scheduled', tone: 'info' }
}

// ── Tyre items and sections ───────────────────────────────────────────────────
const STATUS_OF_RISK = { good: 'ok', warning: 'minor', critical: 'issue' }
export const ITEM_STATUS = {
  ok: { label: 'OK', tone: 'good' },
  minor: { label: 'Minor', tone: 'warn' },
  issue: { label: 'Issue', tone: 'bad' },
  none: { label: 'Not checked', tone: 'muted' },
}

/**
 * Which part of the vehicle a wheel code belongs to. Read from the printed
 * position code (LHF1, RHCI, LHRO, SPARE ...). Anything it cannot place is
 * "Other" rather than guessed into an axle.
 */
export function positionGroup(code) {
  const c = String(code || '').toUpperCase().replace(/\s+/g, '')
  if (!c) return 'other'
  if (/SP(ARE)?/.test(c)) return 'spare'
  const m = c.match(/^(?:LH|RH|L|R)?([FCRDT])/)
  if (!m) return 'other'
  return { F: 'steer', C: 'drive', D: 'drive', R: 'rear', T: 'rear' }[m[1]] || 'other'
}

export const SECTION_LABEL = {
  steer: 'Steer axle', drive: 'Drive axles', rear: 'Rear axles', spare: 'Spare', other: 'Other positions',
}
const SECTION_ORDER = ['steer', 'drive', 'rear', 'spare', 'other']

/** Every wheel on an inspection with what was recorded against it. */
export function inspectionItems(row) {
  const normTc = normalizeTyreConditions(withTc(row))
  const labels = positionLabelMap(withTc(row))
  return Object.entries(normTc).map(([position, d]) => {
    const recorded = !!(d.condition || d.pressure != null || d.tread != null || d.notes)
    const label = d.label || labels[position] || position
    const status = recorded ? (STATUS_OF_RISK[d.risk] || 'none') : 'none'
    const remarks = [
      d.pressure != null ? `${d.pressure} PSI` : null,
      d.tread != null ? `${d.tread} mm tread` : null,
      d.notes || null,
    ].filter(Boolean).join(', ')
    return {
      position, label, group: positionGroup(label), recorded, status,
      condition: d.condition || (recorded ? RISK_LABEL[d.risk] || null : null),
      pressure: d.pressure, tread: d.tread, notes: d.notes || null,
      remarks: remarks || null, photo: d.photo || null,
    }
  })
}

/** Items grouped by axle section, in drive order, with recorded/total and issue counts. */
export function inspectionSections(row) {
  const items = inspectionItems(row)
  const by = new Map()
  for (const it of items) {
    if (!by.has(it.group)) by.set(it.group, [])
    by.get(it.group).push(it)
  }
  return SECTION_ORDER.filter((k) => by.has(k)).map((key) => {
    const list = by.get(key)
    return {
      key, label: SECTION_LABEL[key], items: list,
      total: list.length,
      done: list.filter((i) => i.recorded).length,
      issues: list.filter((i) => i.status === 'issue' || i.status === 'minor').length,
    }
  })
}

/** Recorded / total positions across the whole inspection. Null when there are none. */
export function inspectionProgress(row) {
  const items = inspectionItems(row)
  if (!items.length) return { done: null, total: null, pct: null }
  const done = items.filter((i) => i.recorded).length
  return { done, total: items.length, pct: Math.round((done / items.length) * 100) }
}

// ── Workspace KPIs, list tabs, search ─────────────────────────────────────────
const hasCritical = (r) => r?.severity === 'Critical' || r?.severity === 'High'
  || affected(r).some((t) => t.risk === 'critical')

/** Headline over a scoped set. Rates are null when there is nothing to divide by. */
export function workspaceKpis(rows) {
  const list = (rows || []).filter((r) => r?.status !== 'Cancelled')
  const total = list.length
  const completed = list.filter(isDone).length
  const overdue = list.filter((r) => r.status === 'Overdue').length
  const pending = list.filter(isPending).length
  const critical = list.filter(hasCritical).length
  const pct = (n) => (total ? Math.round((n / total) * 100) : null)
  return {
    total, completed, pending, overdue, critical,
    completedPct: pct(completed), pendingPct: pct(pending), overduePct: pct(overdue),
    vehicles: new Set(list.map((r) => r.asset_no).filter(Boolean)).size,
  }
}

export const LIST_TABS = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'pending', label: 'Pending' },
  { key: 'overdue', label: 'Overdue' },
]

export function matchesListTab(r, tab, now = new Date()) {
  if (tab === 'today') return rowDay(r) === isoDay(now)
  if (tab === 'pending') return isPending(r)
  if (tab === 'overdue') return r?.status === 'Overdue'
  return true
}

export function listTabCounts(rows, now = new Date()) {
  const out = {}
  for (const t of LIST_TABS) out[t.key] = (rows || []).filter((r) => matchesListTab(r, t.key, now)).length
  return out
}

export function searchInspections(rows, q) {
  const s = String(q || '').trim().toLowerCase()
  if (!s) return rows || []
  return (rows || []).filter((r) => [r.asset_no, r.vehicle_type, r.site, r.inspector, r.title, r.inspection_type]
    .some((v) => String(v || '').toLowerCase().includes(s)))
}

/** Newest first, ties broken by created_at then id so the order is stable. */
export function sortNewest(rows) {
  return [...(rows || [])].sort((a, b) => (rowDay(b).localeCompare(rowDay(a)))
    || String(b.created_at || '').localeCompare(String(a.created_at || ''))
    || String(b.id || '').localeCompare(String(a.id || '')))
}

/** Other inspections of the same asset, newest first. */
export function assetHistory(rows, row) {
  if (!row?.asset_no) return []
  return sortNewest((rows || []).filter((r) => r.asset_no === row.asset_no && r.id !== row.id))
}

// ── Findings, defect mix, trend ───────────────────────────────────────────────
/** Every non-Good tyre reading across the set, newest inspection first. */
export function recentFindings(rows, limit = 6) {
  const out = []
  for (const r of sortNewest(rows)) {
    for (const t of affected(r)) {
      out.push({
        key: `${r.id}:${t.position}`, inspectionId: r.id, row: r,
        asset_no: r.asset_no || null, site: r.site || null, inspector: r.inspector || null,
        day: rowDay(r) || null, position: t.label || t.position,
        condition: t.condition || RISK_LABEL[t.risk] || 'Flagged',
        tone: t.risk === 'critical' ? 'bad' : 'warn',
        severity: t.risk === 'critical' ? 'Critical' : 'Minor',
      })
      if (out.length >= limit) return out
    }
  }
  return out
}

const titleCase = (s) => String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
export const DEFECT_COLORS = ['#ef4444', '#f59e0b', '#f97316', '#3b82f6', '#a855f7', '#94a3b8']

/** Non-Good tyre conditions by recorded word, top five plus Others. */
export function defectCategories(rows, top = 5) {
  const counts = new Map()
  let total = 0
  for (const r of rows || []) {
    for (const t of affected(r)) {
      const k = titleCase(t.condition || RISK_LABEL[t.risk] || 'Flagged')
      counts.set(k, (counts.get(k) || 0) + 1)
      total += 1
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const head = sorted.slice(0, top).map(([label, count], i) => ({ label, count, color: DEFECT_COLORS[i] }))
  const rest = sorted.slice(top).reduce((s, [, c]) => s + c, 0)
  if (rest > 0) head.push({ label: 'Others', count: rest, color: DEFECT_COLORS[5] })
  return { total, segments: head }
}

/**
 * Daily completed / pending / overdue counts by inspection day over the last
 * `days` days ending today. Days with no inspections are zero (a real count).
 */
export function inspectionTrend(rows, now = new Date(), days = 30) {
  const end = new Date(now instanceof Date ? now : new Date(now))
  const labels = []
  const idx = new Map()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i)
    const k = isoDay(d)
    idx.set(k, labels.length)
    labels.push(k)
  }
  const completed = labels.map(() => 0)
  const pending = labels.map(() => 0)
  const overdue = labels.map(() => 0)
  for (const r of rows || []) {
    const i = idx.get(rowDay(r))
    if (i == null || r.status === 'Cancelled') continue
    if (isDone(r)) completed[i] += 1
    else if (r.status === 'Overdue') overdue[i] += 1
    else pending[i] += 1
  }
  const any = completed.some(Boolean) || pending.some(Boolean) || overdue.some(Boolean)
  return { labels, completed, pending, overdue, any }
}
