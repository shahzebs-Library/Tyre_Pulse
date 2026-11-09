/**
 * Tyre data accuracy from 1 January 2025 onward - pure shaping over
 * public.get_tyre_evidence_audit (migration 20261111090000). Read only.
 *
 * MIRROR: the evidence classes and reason tokens come from the SQL view
 * public.v_tyre_fitment_evidence. Change both together.
 */

export const TRUSTED_FROM = '2025-01-01'

export const EVIDENCE_CLASSES = [
  { id: 'VERIFIED', label: 'Verified', tone: '#16a34a', note: 'Real serial, job card found, readings and price evidenced, no conflict.' },
  { id: 'PARTIALLY_VERIFIED', label: 'Partially verified', tone: '#2563eb', note: 'Real fitment with a gap: serial not verified, job card not found, a missing reading or a missing price.' },
  { id: 'PROVISIONAL', label: 'Provisional', tone: '#d97706', note: 'Fitment odometer is the placeholder 1, or the purchase price is an estimate.' },
  { id: 'MISSING_EVIDENCE', label: 'Missing evidence', tone: '#6b7280', note: 'No real serial and no job card that exists in the job card register.' },
  { id: 'CONFLICTING', label: 'Conflicting', tone: '#dc2626', note: 'Reversed or future dates, overlapping fitment, two active tyres on one wheel, a serial active on two vehicles, or a life above the class cap.' },
  { id: 'DUPLICATE', label: 'Duplicate copy', tone: '#7c3aed', note: 'Identical content to an earlier-loaded row. Only the copies are counted.' },
]
export const CLASS_BY_ID = Object.fromEntries(EVIDENCE_CLASSES.map((c) => [c.id, c]))

export const REASON_LABEL = {
  duplicate_copy: 'Identical copy of an earlier row',
  reversed_dates_or_km: 'Removal before fitment (date or km)',
  future_date: 'Date in the future',
  overlapping_fitment: 'Overlaps another fitment of the same tyre',
  two_active_on_wheel: 'Two active tyres on one wheel',
  serial_active_on_two_vehicles: 'Serial active on two vehicles',
  life_above_class_cap: 'Life above the vehicle-class cap',
  serial_not_verified: 'Serial not verified',
  job_card_not_found: 'Job card not found',
  fitment_km_placeholder: 'Fitment odometer is the placeholder 1',
  fitment_km_missing: 'No fitment odometer',
  removal_km_missing: 'Removed with no removal odometer',
  life_not_measurable: 'Completed but life not measurable',
  price_estimated: 'Purchase price estimated',
  price_missing: 'Purchase price missing',
  price_disputed: 'Purchase price disputed',
}

export const LEGACY_FINDING_LABEL = {
  serial_refitted_later: 'Same serial fitted elsewhere later',
  superseded_on_wheel: 'A later tyre was fitted on this wheel',
  no_later_evidence: 'No later evidence - current status unverified',
}

export const LEGACY_ACTION_LABEL = {
  close_fitment_on_or_before_next_fit_date: 'Propose: close this fitment on or before the next fit date (removal km unknown)',
  keep_original_mark_current_status_unverified: 'Keep the record; treat as unverified current occupancy',
}

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Class counts per country, with the verified share. Unknown classes are kept, not dropped. */
export function shapeClasses(classes) {
  return Object.entries(classes || {}).map(([country, counts]) => {
    const c = counts || {}
    const total = Object.values(c).reduce((s, n) => s + (num(n) || 0), 0)
    const verified = num(c.VERIFIED) || 0
    return {
      country,
      total,
      counts: Object.fromEntries(EVIDENCE_CLASSES.map((k) => [k.id, num(c[k.id]) || 0])),
      verifiedPct: total > 0 ? Math.round((verified / total) * 1000) / 10 : null,
    }
  }).sort((a, b) => a.country.localeCompare(b.country))
}

/** Reason counts per country, largest first, labelled. */
export function shapeFlags(flags) {
  return Object.entries(flags || {}).map(([country, counts]) => ({
    country,
    reasons: Object.entries(counts || {})
      .map(([reason, n]) => ({ reason, label: REASON_LABEL[reason] || reason, count: num(n) || 0 }))
      .sort((a, b) => b.count - a.count),
  })).sort((a, b) => a.country.localeCompare(b.country))
}

export const COVERAGE_BAND = 0.15
export const MIN_ISSUED_FOR_RATIO = 5

/**
 * Compare installations RECORDED for a month with tyres the ERP ISSUED that month
 * (expense grid quantity). Installs = new physical tyres + unidentified fitments
 * minus identical duplicate copies (refits are a reused tyre, not an issue).
 *
 *   RECONCILED      within +/-15%
 *   UNDER_RECORDED  fewer installs than issues (fitment records missing)
 *   OVER_RECORDED   more installs than issues (backlog or opening-baseline load, or duplicates)
 *   NO_ERP_ISSUES   installs recorded but no tyre issue on the grid
 *   NO_FITMENTS     issues on the grid but no installation recorded
 *   LOW_VOLUME      fewer than 5 tyres issued: a ratio would mean nothing
 */
export function coverageStatus(m) {
  const installs = Math.max(0, (num(m?.new_physical) || 0) + (num(m?.unidentified) || 0) - (num(m?.duplicate_copies) || 0))
  const issued = num(m?.grid_issued_qty)
  if (!issued) return { installs, issued, ratio: null, status: installs > 0 ? 'NO_ERP_ISSUES' : 'NO_FITMENTS' }
  if (installs === 0) return { installs, issued, ratio: 0, status: 'NO_FITMENTS' }
  const ratio = Math.round((installs / issued) * 100) / 100
  if (issued < MIN_ISSUED_FOR_RATIO) return { installs, issued, ratio, status: 'LOW_VOLUME' }
  if (ratio < 1 - COVERAGE_BAND) return { installs, issued, ratio, status: 'UNDER_RECORDED' }
  if (ratio > 1 + COVERAGE_BAND) return { installs, issued, ratio, status: 'OVER_RECORDED' }
  return { installs, issued, ratio, status: 'RECONCILED' }
}

export const COVERAGE_LABEL = {
  RECONCILED: 'Reconciled',
  UNDER_RECORDED: 'Fitments missing',
  OVER_RECORDED: 'More fitments than issues',
  NO_ERP_ISSUES: 'No ERP tyre issue',
  NO_FITMENTS: 'No fitment recorded',
  LOW_VOLUME: 'Too few to compare',
}

export function shapeMonthly(monthly) {
  return (monthly || []).map((m) => ({
    country: m.country,
    month: String(m.month || '').slice(0, 7),
    fitments: num(m.fitments) || 0,
    newPhysical: num(m.new_physical) || 0,
    refits: num(m.refits) || 0,
    unidentified: num(m.unidentified) || 0,
    duplicateCopies: num(m.duplicate_copies) || 0,
    removals: num(m.removals) || 0,
    scrapped: num(m.scrapped) || 0,
    gridIssuedQty: num(m.grid_issued_qty),
    gridTyreCost: num(m.grid_tyre_cost),
    currency: m.currency || null,
    ...coverageStatus(m),
  }))
}

/** Per country: how many months fall in each coverage status. */
export function coverageSummary(rows) {
  const out = {}
  for (const r of rows || []) {
    const c = (out[r.country] ||= { months: 0 })
    c.months += 1
    c[r.status] = (c[r.status] || 0) + 1
  }
  return out
}

export function shapeLegacy(rows) {
  return (rows || []).map((r) => ({
    ...r,
    findingLabel: LEGACY_FINDING_LABEL[r.finding] || r.finding,
    actionLabel: LEGACY_ACTION_LABEL[r.proposed_action] || r.proposed_action,
  }))
}

export function shapeAudit(res) {
  return {
    from: res?.from || TRUSTED_FROM,
    to: res?.to || null,
    baseline: res?.baseline || {},
    classes: shapeClasses(res?.classes),
    flags: shapeFlags(res?.flags),
    legacy: shapeLegacy(res?.legacy_active),
    monthly: shapeMonthly(res?.monthly),
  }
}

export const MONTHLY_EXPORT_COLUMNS = [
  ['country', 'Country'], ['month', 'Month'], ['fitments', 'Fitment rows'], ['newPhysical', 'New physical tyres'],
  ['refits', 'Refits'], ['unidentified', 'Serial not verified'], ['duplicateCopies', 'Duplicate copies'],
  ['installs', 'Installs (new + unidentified - copies)'], ['issued', 'ERP tyres issued'], ['ratio', 'Installs / issued'],
  ['status', 'Coverage'], ['removals', 'Removals'], ['scrapped', 'Scrapped'], ['gridTyreCost', 'ERP tyre cost'], ['currency', 'Currency'],
]

export const EVIDENCE_EXPORT_COLUMNS = [
  ['id', 'Record id'], ['country', 'Country'], ['asset_no', 'Asset'], ['position', 'Position'], ['serial_no', 'Serial'],
  ['fit_date', 'Fitted'], ['removal_date', 'Removed'], ['status', 'Status'], ['km_at_fitment', 'Fit km'],
  ['km_at_removal', 'Removal km'], ['job_card', 'Job card'], ['purchase_cost_status', 'Price status'],
  ['evidence_class', 'Evidence class'], ['reasons_text', 'Reasons'],
]

export function evidenceExportRows(rows) {
  return (rows || []).map((r) => ({
    ...r,
    reasons_text: (r.reasons || []).map((x) => REASON_LABEL[x] || x).join('; '),
  }))
}
