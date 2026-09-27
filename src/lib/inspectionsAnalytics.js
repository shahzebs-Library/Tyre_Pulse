/**
 * inspectionsAnalytics - the pure half of the Inspections register.
 *
 * Everything here used to live inline in src/pages/Inspections.jsx. It is pulled
 * out so it can be tested without mounting a 4,000-line page, and so the page,
 * the checklist PDF and the register columns all read ONE definition of each
 * rule. No I/O, no React, and `now` is injectable wherever a date is involved.
 *
 * What deliberately does NOT live here: the scoping of the register itself
 * (scopeInspections, inspectionOverview, focusMatches - lib/inspectionTyreFlags),
 * the tyre-completeness gate (lib/tyreCompleteness) and the condition banding
 * (lib/inspectionView riskForCondition). Those already have one home each and
 * are reused, never copied.
 */
import { riskForCondition } from './inspectionView'

// ── Record types ──────────────────────────────────────────────────────────────
export const INSPECTION_TYPES = ['Routine', 'Pressure', 'Visual', 'Full', 'Pre-Trip']
export const OBSERVATION_TYPES = ['Site Observation']
export const TRAINING_TYPES = ['Safety Training', 'Training Session']
export const ALL_TYPES = [...INSPECTION_TYPES, ...OBSERVATION_TYPES, ...TRAINING_TYPES]
export const STATUSES = ['Scheduled', 'In Progress', 'Done', 'Overdue', 'Cancelled']
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical']
export const RISK_LEVELS = ['good', 'warning', 'critical', 'none']

export function isObservationType(t) { return OBSERVATION_TYPES.includes(t) }
export function isTrainingType(t) { return TRAINING_TYPES.includes(t) }
export function isInspectionType(t) { return INSPECTION_TYPES.includes(t) }

/**
 * The DB `inspections.inspection_type` CHECK only allows tyre-inspection types.
 * Observation and training records share the table, so their display type is
 * persisted in `custom_data.record_type` while the constrained column is written
 * with a CHECK-valid value. `resolveRecordType` restores the display type on read.
 */
export function dbInspectionType(displayType) {
  return INSPECTION_TYPES.includes(displayType) ? displayType : 'Routine'
}
export function resolveRecordType(row) {
  const rt = row?.custom_data?.record_type
  return (isObservationType(rt) || isTrainingType(rt) || INSPECTION_TYPES.includes(rt))
    ? rt
    : row?.inspection_type
}

/** Which register tab a display type belongs to. */
export function tabForType(t) {
  if (isInspectionType(t)) return 'inspections'
  if (isObservationType(t)) return 'observations'
  if (isTrainingType(t)) return 'training'
  return null
}

// ── URL list encoding ─────────────────────────────────────────────────────────
/**
 * A multi-value filter has to survive in the URL, and the URL holds strings.
 * Comma-joined, with the existing 'all' sentinel for "no filter" so a saved link
 * still resolves. `toList` hands the filter engine a real array - the raw string
 * would be read as ONE value named "TR-MIXER,PUMPS" and silently match nothing.
 */
export function toList(v) {
  if (Array.isArray(v)) return v.filter(Boolean)
  if (v == null || v === '' || v === 'all') return []
  return String(v).split(',').map((s) => s.trim()).filter(Boolean)
}
/** Back to the URL form. An empty selection is 'all', never an empty string. */
export function fromList(arr) {
  const list = (Array.isArray(arr) ? arr : []).filter(Boolean)
  return list.length ? list.join(',') : 'all'
}

// ── Dates ─────────────────────────────────────────────────────────────────────
/** Local calendar day as YYYY-MM-DD. `toISOString` is UTC and rolls the day. */
export function isoDay(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The register's read of each row: the display record type restored, and any
 * record still open past its scheduled day shown as Overdue. A Done or
 * Cancelled record is never overdue, and a row with no scheduled date cannot be
 * judged, so it keeps its stored status.
 */
export function deriveRegisterRows(rows, now = new Date()) {
  const today = isoDay(now)
  return (rows || []).map((r) => ({
    ...r,
    inspection_type: resolveRecordType(r),
    status: r.status !== 'Done' && r.status !== 'Cancelled' && r.scheduled_date && r.scheduled_date < today
      ? 'Overdue'
      : r.status,
  }))
}

/** Per-tab record counts, over every loaded row. */
export function tabCounts(rows) {
  const c = { all: 0, inspections: 0, observations: 0, training: 0 }
  for (const r of rows || []) {
    c.all += 1
    const tab = tabForType(r.inspection_type)
    if (tab) c[tab] += 1
  }
  return c
}

/** Rows in one register tab. 'all' (and 'checklist') pass everything through. */
export function rowsForTab(rows, tab) {
  if (tab === 'inspections' || tab === 'observations' || tab === 'training') {
    return (rows || []).filter((r) => tabForType(r.inspection_type) === tab)
  }
  return rows || []
}

// ── Register KPIs ─────────────────────────────────────────────────────────────
/**
 * Status / severity headline over a scoped set. Rates are null when there is
 * nothing to divide by - an empty selection is "not measurable", never 0%.
 */
export function registerKpis(rows) {
  const list = rows || []
  const total = list.length
  const byStatus = { Scheduled: 0, 'In Progress': 0, Done: 0, Overdue: 0, Cancelled: 0 }
  let highSeverity = 0
  let withAction = 0
  for (const r of list) {
    if (r.status in byStatus) byStatus[r.status] += 1
    if (r.severity === 'High' || r.severity === 'Critical') highSeverity += 1
    if (r.linked_action_id) withAction += 1
  }
  const actionable = total - byStatus.Cancelled
  return {
    total,
    ...byStatus,
    open: byStatus.Scheduled + byStatus['In Progress'] + byStatus.Overdue,
    highSeverity,
    withAction,
    completionRate: actionable > 0 ? Math.round((byStatus.Done / actionable) * 1000) / 10 : null,
    overdueRate: actionable > 0 ? Math.round((byStatus.Overdue / actionable) * 1000) / 10 : null,
  }
}

// ── Vehicle-type inference ────────────────────────────────────────────────────
/** Vehicle type from the asset-code prefix (TM -> Tri-mixer ...). null when unknown. */
export function inferVehicleTypeFromAsset(assetNo) {
  const prefix = ((assetNo || '').match(/^[A-Za-z]+/) || [''])[0].toUpperCase().substring(0, 2)
  const map = { TM: 'Tri-mixer', MP: 'Concrete pump', WL: 'Wheel loader', SL: 'Skid loader', PL: 'Pickup', BH: 'Bus' }
  return map[prefix] || null
}

// ── Checklist readings ────────────────────────────────────────────────────────
const bandLabel = (band) => (
  band === 'good' ? 'Good' : band === 'warning' ? 'Wear' : band === 'critical' ? 'Damage' : 'No data'
)
/** The four report buckets a recorded condition falls into (banded, never exact-match). */
export function conditionBucket(condition) {
  return bandLabel(riskForCondition(condition))
}

const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)

/**
 * Summary of a checklist's recorded wheels, for the report's summary strip.
 * Only RECORDED readings count: a blank or zero pressure is "not measured", so
 * averages are null (N/A) when nothing was recorded, never a fabricated 0.
 */
export function checklistReadingStats(rows) {
  const counts = { Good: 0, Wear: 0, Damage: 0, 'No data': 0 }
  const pressures = []
  const treads = []
  let lowestTread = null
  for (const r of rows || []) {
    counts[conditionBucket(r.condition)] += 1
    const p = Number(r.pressure)
    if (Number.isFinite(p) && p > 0) pressures.push(p)
    const td = Number(r.treadDepth)
    if (Number.isFinite(td) && td > 0) {
      treads.push(td)
      if (!lowestTread || td < lowestTread.value) lowestTread = { pos: r.position || 'N/A', value: td }
    }
  }
  const medianPsi = median(pressures)
  return {
    positions: (rows || []).length,
    counts,
    recordedPressures: pressures.length,
    avgPsi: mean(pressures),
    medianPsi,
    avgTread: mean(treads),
    lowestTread,
    // A median of fewer than four readings is not a reference worth flagging against.
    flagPressure: pressures.length >= 4 && medianPsi > 0,
  }
}

/**
 * "Pressure vs median" cell. Over 15% off the median reads Check with the signed
 * percentage; an unrecorded reading is N/A rather than OK.
 */
export function pressureDeviationLabel(value, medianPsi) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || !(medianPsi > 0)) return 'N/A'
  const dev = (n - medianPsi) / medianPsi
  if (Math.abs(dev) > 0.15) return `Check ${dev > 0 ? '+' : '-'}${Math.round(Math.abs(dev) * 100)}%`
  return 'OK'
}

/** Checklist progress for the "N of M filled" line and the chips. */
export function checklistProgress(positions) {
  const list = positions || []
  const unfilled = list.filter((p) => !p.pressure)
  return {
    total: list.length,
    filled: list.length - unfilled.length,
    unfilled: unfilled.length,
    allFilled: unfilled.length === 0,
  }
}

/** Condition tallies for the saved-checklist badges. */
export function checklistConditionTally(positions) {
  const list = positions || []
  return {
    good: list.filter((p) => p.condition === 'Good').length,
    wear: list.filter((p) => p.condition === 'Wear').length,
    critical: list.filter((p) => p.condition === 'Damage' || p.condition === 'Puncture').length,
  }
}

/** Priority a corrective action raised from a record carries. */
export function actionPriority(severity) {
  return severity === 'Critical' ? 'Critical' : severity === 'High' ? 'High' : 'Medium'
}
