/**
 * workOrdersAnalytics - pure helpers behind the Work Orders page. The table
 * and KPIs are SERVER-DRIVEN (get_work_orders_page / get_work_order_stats);
 * this module owns what the page used to compute inline: the KPI view over the
 * server aggregate, overdue / days-open rules, the server sort vocabulary,
 * selection mapping and paging arithmetic. No I/O; time is injected as `now`.
 *
 * HONEST NULLS: when the aggregate could not be read, every KPI is null (N/A),
 * never a 0 that reads as "no open job cards".
 */
import { isClosedWoStatus } from './workOrderStatus'

/** Columns the server can sort by (mirrors the RPC's whitelist). */
export const SORT_FIELDS = Object.freeze([
  { key: 'opened_at', label: 'Opened' },
  { key: 'work_order_no', label: 'Work order no.' },
  { key: 'asset_no', label: 'Asset' },
  { key: 'work_type', label: 'Type' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'technician_name', label: 'Technician' },
  { key: 'target_completion', label: 'Target' },
  { key: 'total_cost', label: 'Total cost' },
])

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** KPI view of the server aggregate; every figure null when the aggregate is missing. */
export function pageStats(statsData) {
  if (!statsData) {
    return { open: null, inProgress: null, awaitParts: null, overdue: null, completedToday: null, totalCost: null, avgDaysOpen: null }
  }
  return {
    open: numOrNull(statsData.open) ?? 0,
    inProgress: numOrNull(statsData.in_progress) ?? 0,
    awaitParts: numOrNull(statsData.waiting_parts) ?? 0,
    overdue: numOrNull(statsData.overdue) ?? 0,
    completedToday: numOrNull(statsData.completed_today) ?? 0,
    totalCost: numOrNull(statsData.total_cost),
    // An average over zero cards is not measurable.
    avgDaysOpen: numOrNull(statsData.avg_days_open),
  }
}

/** Compact money label ("SAR 12.3k"), N/A when unknown. */
export function compactMoney(value, currency = '') {
  const n = numOrNull(value)
  if (n === null) return 'N/A'
  const prefix = currency ? `${currency} ` : ''
  if (Math.abs(n) >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${prefix}${(n / 1_000).toFixed(1)}k`
  return `${prefix}${Math.round(n).toLocaleString()}`
}

/** [label, count] entries from a server breakdown array, descending. */
export function breakdownEntries(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((b) => [b?.label ?? 'Unknown', Number(b?.n) || 0])
    .sort((a, b) => b[1] - a[1])
}

/** An open job card past its target completion. */
export function isOverdue(wo, now = Date.now()) {
  if (!wo?.target_completion) return false
  if (isClosedWoStatus(wo.status)) return false
  const t = new Date(wo.target_completion).getTime()
  return Number.isFinite(t) && t < (now instanceof Date ? now.getTime() : now)
}

/** Whole days a card has been (or was) open; null when opened_at is missing. */
export function daysOpen(wo, now = Date.now()) {
  const start = new Date(wo?.opened_at).getTime()
  if (!Number.isFinite(start)) return null
  const endRaw = wo?.completed_at ? new Date(wo.completed_at).getTime() : (now instanceof Date ? now.getTime() : now)
  if (!Number.isFinite(endRaw)) return null
  return Math.max(0, Math.floor((endRaw - start) / 86400000))
}

export const totalPages = (total, pageSize) => Math.max(1, Math.ceil((Number(total) || 0) / Math.max(1, pageSize)))

/** Set<id> <-> TanStack rowSelection object. */
export function selectionFromIds(ids) {
  const o = {}
  for (const id of ids || []) o[String(id)] = true
  return o
}

/**
 * Merge a table's page-scoped selection back into the page's global Set, so
 * selections on other server pages survive paging.
 */
export function mergeSelection(prevIds, nextSelection, pageRowIds) {
  const next = new Set(prevIds || [])
  const onPage = new Set((pageRowIds || []).map(String))
  for (const id of [...next]) if (onPage.has(String(id))) next.delete(id)
  for (const [k, v] of Object.entries(nextSelection || {})) {
    if (!v) continue
    const match = (pageRowIds || []).find((id) => String(id) === k)
    next.add(match !== undefined ? match : k)
  }
  return next
}

/** How many filters narrow the register (for the "Clear filters" affordance). */
export function activeFilterCount({ search = '', status = 'All', priority = 'All', type = 'All', from = '', to = '' } = {}) {
  return [search?.trim(), status !== 'All', priority !== 'All', type !== 'All', from, to].filter(Boolean).length
}
