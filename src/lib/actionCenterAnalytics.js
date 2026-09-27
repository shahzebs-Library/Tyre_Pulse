/**
 * actionCenterAnalytics - pure presentation engine for the Action Center page
 * (/action-center). The prioritisation maths (rankScore, prioritise, isOverdue,
 * summariseActions, byCategory, bySeverity) lives in `./actionCenter.js` and is
 * REUSED here, never re-derived. This module only shapes that output for the
 * page: filtering, the KPI strip, the category bars, the severity share, the
 * table rows and the export rows.
 *
 * No I/O and no clock read: `nowMs` is always injected so a render ranks and
 * summarises against one consistent instant and every test is deterministic.
 *
 * HONEST NULLS. A resolution rate over zero items is not 0% (which reads as
 * "nothing was ever resolved"); it is unmeasurable and returns null, which the
 * page renders as N/A.
 */
import {
  prioritise, summariseActions, isOverdue, isOpen, daysOverdue, rankScore,
} from './actionCenter'

export const ACTION_CATEGORIES = Object.freeze([
  { v: 'safety', label: 'Safety' },
  { v: 'compliance', label: 'Compliance' },
  { v: 'maintenance', label: 'Maintenance' },
  { v: 'cost', label: 'Cost' },
  { v: 'tyre', label: 'Tyre' },
  { v: 'inspection', label: 'Inspection' },
  { v: 'data_quality', label: 'Data Quality' },
  { v: 'other', label: 'Other' },
])

export const ACTION_SEVERITIES = Object.freeze([
  { v: 'critical', label: 'Critical' },
  { v: 'high', label: 'High' },
  { v: 'medium', label: 'Medium' },
  { v: 'low', label: 'Low' },
  { v: 'info', label: 'Info' },
])

export const ACTION_STATUSES = Object.freeze([
  { v: 'open', label: 'Open' },
  { v: 'acknowledged', label: 'Acknowledged' },
  { v: 'in_progress', label: 'In progress' },
  { v: 'resolved', label: 'Resolved' },
  { v: 'dismissed', label: 'Dismissed' },
])

const CATEGORY_LABEL = Object.fromEntries(ACTION_CATEGORIES.map((c) => [c.v, c.label]))
const SEVERITY_LABEL = Object.fromEntries(ACTION_SEVERITIES.map((c) => [c.v, c.label]))
const STATUS_LABEL = Object.fromEntries(ACTION_STATUSES.map((c) => [c.v, c.label]))

export const categoryLabel = (v) => CATEGORY_LABEL[v] || (v ? String(v) : 'Other')
export const severityLabel = (v) => SEVERITY_LABEL[v] || (v ? String(v) : 'Info')
export const statusLabel = (v) => STATUS_LABEL[v] || (v ? String(v) : 'Open')

export const EMPTY_ACTION_FILTERS = Object.freeze({
  search: '', status: '', severity: '', category: '', openOnly: false,
})

/** How many filters (search included) are currently narrowing the queue. */
export function activeActionFilterCount(f = {}) {
  return ['search', 'status', 'severity', 'category'].filter((k) => String(f[k] || '').trim()).length
    + (f.openOnly ? 1 : 0)
}

/**
 * Filter then prioritise (worst / most urgent first). Search is a
 * case-insensitive contains over every free-text field an operator would type.
 */
export function filterActions(rows = [], f = {}, nowMs) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(f.search || '').trim().toLowerCase()
  const out = list.filter((r) => {
    if (!r) return false
    if (f.status && r.status !== f.status) return false
    if (f.severity && r.severity !== f.severity) return false
    if (f.category && r.category !== f.category) return false
    if (f.openOnly && !isOpen(r)) return false
    if (q) {
      const hay = [r.title, r.asset_no, r.source, r.assigned_to, r.impact, r.recommended_action, r.notes]
        .map((x) => (x == null ? '' : String(x))).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  return prioritise(out, nowMs)
}

/**
 * KPI strip. Counts are always numbers; the resolution rate is null when there
 * is nothing to resolve (N/A), and the share of open items that are overdue is
 * null when nothing is open.
 */
export function actionKpis(rows = [], nowMs) {
  const s = summariseActions(rows, nowMs)
  const resolutionRate = s.totalItems > 0 ? Math.round((s.resolvedCount / s.totalItems) * 100) : null
  const overdueShare = s.openCount > 0 ? Math.round((s.overdueCount / s.openCount) * 100) : null
  const unassignedOpen = (Array.isArray(rows) ? rows : [])
    .filter((r) => isOpen(r) && !String(r?.assigned_to || '').trim()).length
  return { ...s, resolutionRate, overdueShare, unassignedOpen }
}

/**
 * Category bars scaled against the busiest category's OPEN count. A category
 * with no open items still gets a thin sliver (3%) so it reads as present
 * rather than missing, and one with open items at least 6%.
 */
export function categoryBars(breakdown = []) {
  const list = Array.isArray(breakdown) ? breakdown : []
  const max = Math.max(1, ...list.map((c) => Number(c.open) || 0))
  return list.map((c) => {
    const open = Number(c.open) || 0
    const raw = Math.round((open / max) * 100)
    return {
      ...c,
      label: categoryLabel(c.category),
      widthPct: Math.max(raw, open ? 6 : 3),
    }
  })
}

/** Severity counts as ordered shares of the whole (percentages sum to ~100). */
export function severityShares(counts = {}) {
  const total = ACTION_SEVERITIES.reduce((s, o) => s + (Number(counts[o.v]) || 0), 0)
  return ACTION_SEVERITIES.map((o) => {
    const n = Number(counts[o.v]) || 0
    return { key: o.v, label: o.label, count: n, pct: total ? (n / total) * 100 : 0 }
  })
}

/** Row shape the EnterpriseTable renders and sorts on. */
export function actionTableRows(rows = [], nowMs) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    ...r,
    _categoryLabel: categoryLabel(r.category),
    _severityLabel: severityLabel(r.severity),
    _statusLabel: statusLabel(r.status),
    _overdue: isOverdue(r, nowMs),
    _daysOverdue: daysOverdue(r, nowMs),
    _score: rankScore(r, nowMs),
  }))
}

export const ACTION_EXPORT_COLUMNS = Object.freeze([
  ['title', 'Title'], ['category', 'Category'], ['severity', 'Severity'], ['status', 'Status'],
  ['asset_no', 'Asset'], ['assigned_to', 'Assigned to'], ['due_date', 'Due date'],
  ['days_overdue', 'Days overdue'], ['priority_score', 'Priority'], ['source', 'Source'],
  ['recommended_action', 'Recommended action'],
])

/** Export rows: labels not tokens, blanks stay blank (never a fabricated 0). */
export function actionExportRows(rows = [], nowMs) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    title: r.title || '',
    category: categoryLabel(r.category),
    severity: severityLabel(r.severity),
    status: statusLabel(r.status),
    asset_no: r.asset_no || '',
    assigned_to: r.assigned_to || '',
    due_date: r.due_date || '',
    days_overdue: isOverdue(r, nowMs) ? daysOverdue(r, nowMs) : '',
    priority_score: r.priority_score ?? '',
    source: r.source || '',
    recommended_action: r.recommended_action || '',
  }))
}
