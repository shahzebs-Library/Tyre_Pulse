/**
 * dataTrustOps.js - PURE engine for Data Trust Phase 2 (no I/O).
 * Shapers + vocab for the quality, reconciliation, monitor and correction-case
 * surfaces. ASCII only; honest nulls; no fabricated values.
 */

export const SEVERITY_RANK = { critical: 0, error: 1, fail: 1, warning: 2, warn: 2, info: 3, pass: 4 }
export function severityRank(s) { return SEVERITY_RANK[String(s || '').toLowerCase()] ?? 9 }

/** Keep the latest result per rule_key, newest first, ranked worst-first. */
export function shapeQualityResults(rows) {
  const seen = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = r.rule_key
    if (!seen.has(k)) seen.set(k, r) // rows arrive newest-first
  }
  return [...seen.values()]
    .map((r) => ({
      ruleKey: r.rule_key,
      status: r.status,
      severity: r.severity,
      measured: Number(r.measured_value) || 0,
      failureCount: Number(r.failure_count) || 0,
      message: r.message || '',
      drilldown: r.drilldown || null,
      checkedAt: r.checked_at || null,
    }))
    .sort((a, b) => (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1) || b.measured - a.measured)
}

export function qualitySummary(shaped) {
  const rows = Array.isArray(shaped) ? shaped : []
  return {
    total: rows.length,
    fail: rows.filter((r) => r.status === 'fail').length,
    warn: rows.filter((r) => r.status === 'warn').length,
    pass: rows.filter((r) => r.status === 'pass').length,
    affected: rows.reduce((s, r) => s + (r.failureCount || 0), 0),
  }
}

/** Latest reconciliation per recon_key. */
export function shapeReconciliation(rows) {
  const seen = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!seen.has(r.recon_key)) seen.set(r.recon_key, r)
  }
  return [...seen.values()].map((r) => ({
    reconKey: r.recon_key,
    label: r.label || r.recon_key,
    expected: r.expected_value == null ? null : Number(r.expected_value),
    actual: r.actual_value == null ? null : Number(r.actual_value),
    difference: r.difference == null ? null : Number(r.difference),
    unit: r.unit || '',
    status: r.status,
    affected: Number(r.affected_count) || 0,
    drilldown: r.drilldown || null,
    runAt: r.run_at || null,
  }))
}

export function reconSummary(shaped) {
  const rows = Array.isArray(shaped) ? shaped : []
  return {
    total: rows.length,
    balanced: rows.filter((r) => r.status === 'balanced').length,
    variance: rows.filter((r) => r.status === 'variance').length,
  }
}

// ── Correction cases ──────────────────────────────────────────────────────────
export const CASE_STATUSES = ['reported', 'investigating', 'proposed', 'approved', 'applied', 'reconciled', 'closed', 'rejected']
export const CASE_STATUS_LABEL = {
  reported: 'Reported', investigating: 'Investigating', proposed: 'Proposed', approved: 'Approved',
  applied: 'Applied', reconciled: 'Reconciled', closed: 'Closed', rejected: 'Rejected',
}
const CASE_FLOW = {
  reported: ['investigating', 'rejected'],
  investigating: ['proposed', 'rejected'],
  proposed: ['approved', 'rejected'],
  approved: ['applied', 'rejected'],
  applied: ['reconciled', 'rejected'],
  reconciled: ['closed'],
  closed: [],
  rejected: [],
}
export function nextStatuses(status) { return CASE_FLOW[status] || [] }
export function caseStatusTone(status) {
  if (status === 'closed' || status === 'reconciled') return 'good'
  if (status === 'rejected') return 'quiet'
  if (status === 'reported') return 'warning'
  return 'info'
}

// The spec's "detect small causes" list - the root-cause vocabulary for a case.
export const ROOT_CAUSE_CATEGORIES = [
  'Wrong date', 'Wrong time zone', 'Wrong currency', 'Wrong unit', 'Incorrect rounding',
  'Duplicate upload', 'API retry', 'Missing data', 'Null value', 'Incorrect join',
  'Many-to-many multiplication', 'Cancelled record', 'Draft record', 'Test record',
  'Soft-deleted record', 'Stale cache', 'Late-arriving data', 'Historical master-data change',
  'Incorrect status mapping', 'Permission filtering', 'Inconsistent export', 'Offline mobile duplicate',
  'Schema change', 'Old deployment', 'Scheduled-job failure', 'Other',
]

export const CASE_SEVERITIES = ['low', 'medium', 'high', 'critical']

/** Group pipeline runs by status for the monitor tiles. */
export function pipelineSummary(runs) {
  const rows = Array.isArray(runs) ? runs : []
  const isFail = (s) => /fail|error/i.test(String(s || ''))
  const isOk = (s) => /commit|success|sent|done/i.test(String(s || ''))
  return {
    total: rows.length,
    failed: rows.filter((r) => isFail(r.status)).length,
    ok: rows.filter((r) => isOk(r.status)).length,
    other: rows.filter((r) => !isFail(r.status) && !isOk(r.status)).length,
  }
}
