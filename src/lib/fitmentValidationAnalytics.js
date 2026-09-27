/**
 * fitmentValidationAnalytics - pure presentation engine for /fitment-validation.
 *
 * Classification (summarizeFitments) and the validation rules
 * (validateFitment / matchRules) live in src/lib/fitmentValidation.js and are
 * NOT duplicated here. This module owns what the page shows ABOUT them: audit
 * filtering, the mismatch-by-site ranking, the validation-ledger and rule-set
 * summaries, and export shapes. No I/O, no React; `now` is injectable.
 *
 * Honesty rules:
 *   - A rate over zero decisions is null (N/A), never 0% or 100%.
 *   - The ledger read is capped (the service returns the latest N rows), so
 *     the summary reports `capped` when the read may be truncated.
 */

const DAY_MS = 86_400_000

export const BAND_LABELS = Object.freeze({ mismatch: 'Wrong size', match: 'Correct size', unknown: 'No data' })

/** Pretty vehicle label for an audit row. */
export function vehicleLabel(r) {
  return [r?.make, r?.model].filter(Boolean).join(' ') || r?.vehicle_type || ''
}

/** Distinct sorted non-empty sites from audit rows. */
export function auditSiteOptions(rows) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.site).filter(Boolean))].sort()
}

/**
 * Filter audit rows by result band, site and a free-text query over asset,
 * make/model, vehicle type, spec and every fitted size.
 */
export function filterAuditRows(rows, { band = 'all', site = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (band !== 'all' && r.band !== band) return false
    if (site && r.site !== site) return false
    if (q) {
      const fitted = Array.isArray(r.fittedSizes) ? r.fittedSizes.join(' ') : ''
      const hay = `${r.asset_no || ''} ${r.make || ''} ${r.model || ''} ${r.vehicle_type || ''} ${r.spec || ''} ${fitted}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Wrong-size asset count per site, descending, top `n` (unsited = 'Unassigned'). */
export function mismatchBySite(rows, n = 10) {
  const m = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.band !== 'mismatch') continue
    const k = r.site || 'Unassigned'
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, n)
    .map(([site, count]) => ({ site, count }))
}

/**
 * Audit headline. `compliancePct` is the share of CHECKABLE assets (match +
 * mismatch) fitted at the right size; null when nothing is checkable.
 */
export function auditSummary(counts) {
  const c = counts || {}
  const match = Number(c.match) || 0
  const mismatch = Number(c.mismatch) || 0
  const unknown = Number(c.unknown) || 0
  const checkable = match + mismatch
  const total = Number(c.total) || match + mismatch + unknown
  return {
    total,
    match,
    mismatch,
    unknown,
    checkable,
    compliancePct: checkable > 0 ? Math.round((match / checkable) * 1000) / 10 : null,
    coveragePct: total > 0 ? Math.round((checkable / total) * 1000) / 10 : null,
  }
}

/** Export rows for the audit register (every filtered row). */
export function auditExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    asset_no: r.asset_no || '',
    vehicle: vehicleLabel(r),
    site: r.site || '',
    spec: r.spec || '',
    fitted: Array.isArray(r.fittedSizes) ? r.fittedSizes.join(', ') : '',
    mismatch: BAND_LABELS[r.band] || r.band || '',
    fittedCount: r.fittedCount ?? 0,
    status: r.status || '',
  }))
}

function issueCounts(h) {
  return {
    violations: Array.isArray(h?.violations) ? h.violations.length : 0,
    warnings: Array.isArray(h?.warnings) ? h.warnings.length : 0,
  }
}

/** Ledger row enriched with issue counts and a stable result label. */
export function historyRows(validations) {
  return (Array.isArray(validations) ? validations : []).map((h) => {
    const { violations, warnings } = issueCounts(h)
    return {
      ...h,
      result: h?.is_valid ? 'Approved' : 'Rejected',
      violationCount: violations,
      warningCount: warnings,
      issueLabel: violations === 0 && warnings === 0
        ? 'Clean'
        : [violations ? `${violations} violation${violations === 1 ? '' : 's'}` : '', warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : ''].filter(Boolean).join(', '),
    }
  })
}

/** Filter ledger rows by result and a query over serial / asset / position. */
export function filterHistory(rows, { result = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((h) => {
    if (result === 'approved' && !h.is_valid) return false
    if (result === 'rejected' && h.is_valid) return false
    if (q && !`${h.tyre_serial || ''} ${h.asset_no || ''} ${h.position_code || ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

/**
 * Validation-ledger summary. Approval rate is null with no decisions.
 * `capped` is true when the read returned exactly `limit` rows (there may be
 * older ones the page cannot see).
 */
export function historySummary(validations, { now = new Date(), limit = 100 } = {}) {
  const list = Array.isArray(validations) ? validations : []
  const since = now.getTime() - 7 * DAY_MS
  let approved = 0
  let withWarnings = 0
  let last7 = 0
  const reasons = new Map()
  for (const h of list) {
    if (h?.is_valid) approved += 1
    const { warnings } = issueCounts(h)
    if (warnings > 0) withWarnings += 1
    const t = h?.validated_at ? new Date(h.validated_at).getTime() : NaN
    if (Number.isFinite(t) && t >= since) last7 += 1
    for (const v of Array.isArray(h?.violations) ? h.violations : []) {
      const key = v?.rule || 'other'
      reasons.set(key, (reasons.get(key) || 0) + 1)
    }
  }
  const total = list.length
  const topViolation = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0] || null
  return {
    total,
    approved,
    rejected: total - approved,
    approvalRatePct: total > 0 ? Math.round((approved / total) * 1000) / 10 : null,
    withWarnings,
    last7Days: last7,
    topViolation: topViolation ? { rule: topViolation[0], count: topViolation[1] } : null,
    capped: total > 0 && total >= limit,
  }
}

/** Rule-set summary. */
export function rulesSummary(rules) {
  const list = Array.isArray(rules) ? rules : []
  const active = list.filter((r) => r?.is_active !== false).length
  const types = new Set()
  let scoped = 0
  for (const r of list) {
    const t = Array.isArray(r?.applies_to_vehicle_types) ? r.applies_to_vehicle_types : []
    if (t.length) scoped += 1
    t.forEach((x) => types.add(String(x).toLowerCase()))
  }
  return { total: list.length, active, inactive: list.length - active, vehicleTypes: types.size, fleetWide: list.length - scoped }
}

/** Filter rules by active state and a query over name, notes, types and sizes. */
export function filterRules(rules, { state = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rules) ? rules : []).filter((r) => {
    const isActive = r?.is_active !== false
    if (state === 'active' && !isActive) return false
    if (state === 'inactive' && isActive) return false
    if (q) {
      const join = (v) => (Array.isArray(v) ? v.join(' ') : '')
      const hay = `${r.rule_name || ''} ${r.notes || ''} ${join(r.applies_to_vehicle_types)} ${join(r.applies_to_axle_roles)} ${join(r.approved_sizes)}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
