/**
 * tyreCostAuditView.js - pure shaping for the Tyre Cost Audit section.
 * The audit RULES live in ./tyreCostAudit.js (mirrored by SQL); this file only
 * turns RPC/table output into KPI tiles and breakdowns. Money is kept per
 * currency and never added across currencies.
 */
import { AUDIT_CLASSES, COST_PENDING_LABEL } from './tyreCostAudit'

export const MISSING_CLASSES = Object.freeze([
  'exact_match', 'same_month_item_match', 'conflict', 'month_mismatch',
  'zero_line_uncertain', 'mixed_tyre_tube', 'spec_mismatch', 'unresolved',
])
export const UNRESOLVED_CLASSES = Object.freeze(['unresolved', 'zero_line_uncertain', 'month_mismatch'])
export const DECIDE_ROLES = Object.freeze(['Admin', 'Manager', 'Director'])
export const APPROVABLE_CLASSES = Object.freeze(['exact_match', 'same_month_item_match', 'priced_estimate_not_verified'])

export const STATUSES = Object.freeze([
  ['proposed', 'Proposed'], ['approved', 'Approved'], ['rejected', 'Rejected'],
  ['applied', 'Applied'], ['undone', 'Undone'], ['superseded', 'Superseded'],
])

export const PRICE_SOURCE_NOTE = 'Prices come from ERP store-issue lines (the expense grid). No invoice, GRN or PO records exist in the database, so nothing here is checked against an invoice.'

const n = (v) => { if (v == null || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null }
const round2 = (x) => Math.round(x * 100) / 100

export const classLabel = (cls) => AUDIT_CLASSES[cls]?.label || cls || 'N/A'
export const classAction = (cls) => AUDIT_CLASSES[cls]?.action || ''

export function canDecide({ role, isSuperAdmin } = {}) {
  return !!isSuperAdmin || DECIDE_ROLES.includes(String(role || ''))
}
export function canApply({ role, isSuperAdmin } = {}) {
  return !!isSuperAdmin || String(role || '') === 'Admin'
}

function addMoney(map, currency, amount) {
  const a = n(amount)
  if (a == null) return
  const c = currency || 'UNKNOWN'
  map[c] = round2((map[c] || 0) + a)
}

/** Summary KPIs from a scan result (`by_country_class`). Null when no scan was run. */
export function scanKpis(scan) {
  if (!scan || !Array.isArray(scan.by_country_class)) return null
  const byClass = {}
  const proposedByCurrency = {}
  const byCountry = {}
  for (const r of scan.by_country_class) {
    const cnt = n(r.n) || 0
    byClass[r.class] = (byClass[r.class] || 0) + cnt
    addMoney(proposedByCurrency, r.currency, r.proposed)
    const key = r.country || 'Unknown'
    const c = byCountry[key] || (byCountry[key] = { country: key, currency: r.currency || null, checked: 0, byClass: {}, proposed: null })
    c.checked += cnt
    c.byClass[r.class] = (c.byClass[r.class] || 0) + cnt
    if (n(r.proposed) != null) c.proposed = round2((c.proposed || 0) + n(r.proposed))
  }
  const sum = (list) => list.reduce((a, k) => a + (byClass[k] || 0), 0)
  return {
    checked: n(scan.checked) ?? Object.values(byClass).reduce((a, b) => a + b, 0),
    byClass,
    missingNonWarranty: sum(MISSING_CLASSES),
    warrantyExcluded: byClass.excluded_warranty || 0,
    exactMatches: byClass.exact_match || 0,
    unresolved: sum(UNRESOLVED_CLASSES),
    conflicts: byClass.conflict || 0,
    proposedByCurrency,
    byCountry: Object.values(byCountry).sort((a, b) => a.country.localeCompare(b.country)),
  }
}

/** KPIs over SAVED findings: proposed (open) and approved amounts per currency. */
export function savedKpis(rows = []) {
  const proposedByCurrency = {}
  const approvedByCurrency = {}
  const byStatus = {}
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1
    if (r.status === 'proposed') addMoney(proposedByCurrency, r.currency, r.proposed_cost)
    if (r.status === 'approved') addMoney(approvedByCurrency, r.currency, r.proposed_cost)
  }
  return { total: rows.length, byStatus, proposedByCurrency, approvedByCurrency }
}

/** Group findings by month / site / item_code; money per currency per group. */
export function breakdown(rows = [], dim = 'month') {
  const g = new Map()
  for (const r of rows) {
    const key = (r[dim] == null || r[dim] === '') ? 'Not recorded' : String(r[dim])
    const e = g.get(key) || { key, findings: 0, proposed: 0, proposedByCurrency: {} }
    e.findings += 1
    if (n(r.proposed_cost) != null) { e.proposed += 1; addMoney(e.proposedByCurrency, r.currency, r.proposed_cost) }
    g.set(key, e)
  }
  const list = [...g.values()]
  return dim === 'month'
    ? list.sort((a, b) => b.key.localeCompare(a.key))
    : list.sort((a, b) => b.findings - a.findings || a.key.localeCompare(b.key))
}

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** "SAR 1,234.5 | AED 20"; 'N/A' when there is nothing. Never one blended total. */
export function moneyText(byCurrency) {
  const e = Object.entries(byCurrency || {}).filter(([, v]) => n(v) != null)
  if (!e.length) return 'N/A'
  return e.sort(([a], [b]) => a.localeCompare(b)).map(([c, v]) => `${c} ${nf.format(v)}`).join(' | ')
}

/** A single cost cell: unknown is "Cost Pending Verification", never 0. */
export function costCell(value, currency) {
  const v = n(value)
  if (v == null) return COST_PENDING_LABEL
  return `${currency ? `${currency} ` : ''}${nf.format(v)}`
}

/** Reasons as plain text lines (the column is jsonb, usually an array of strings). */
export function reasonsOf(row) {
  const r = row?.reasons
  if (Array.isArray(r)) return r.map(String).filter(Boolean)
  if (typeof r === 'string' && r.trim()) return [r.trim()]
  return []
}

/** Excel rows: values stay values; unknown cost is the pending label, not 0. */
export function exportRows(rows = []) {
  return rows.map((r) => ({
    country: r.country || '', site: r.site || '', asset_no: r.asset_no || '', serial_no: r.serial_no || '',
    job_card: r.job_card || '', month: r.month || '', brand: r.tyre?.brand || '', size: r.tyre?.size || '',
    class: classLabel(r.class), status: r.status || '',
    original_cost: n(r.original_cost) ?? COST_PENDING_LABEL,
    proposed_cost: n(r.proposed_cost) ?? '', currency: r.currency || '',
    item_code: r.item_code || '', source_line_id: r.source_line_id || '', confidence: r.confidence || '',
    reasons: reasonsOf(r).join('; '), decision_note: r.decision_note || '', applied_batch: r.applied_batch || '',
  }))
}
export const EXPORT_KEYS = ['country', 'site', 'asset_no', 'serial_no', 'job_card', 'month', 'brand', 'size', 'class', 'status', 'original_cost', 'proposed_cost', 'currency', 'item_code', 'source_line_id', 'confidence', 'reasons', 'decision_note', 'applied_batch']
export const EXPORT_HEADERS = ['Country', 'Site', 'Asset', 'Serial', 'Job card', 'Month', 'Brand', 'Size', 'Finding', 'Status', 'Original cost', 'Proposed cost', 'Currency', 'Item code', 'Source line', 'Confidence', 'Reasons', 'Decision note', 'Applied batch']
