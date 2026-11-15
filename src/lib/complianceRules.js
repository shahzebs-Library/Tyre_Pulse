/**
 * complianceRules - the ONE definition of pressure and tread compliance shared by
 * the Compliance register and the Safety score views (both are views of
 * /compliance). Before this, the two views used three different pressure rules
 * (a fixed PSI band on tyre records, a 10% band around a recommended pressure
 * that is never recorded, and the kpiEngine rule) and could print different
 * percentages for the same fleet.
 *
 * PRESSURE: kpiEngine.computePressureCompliance. Each inspection's recorded
 * pressures are compared with that vehicle's own median, 15% tolerance, at
 * least four readings; null when nothing is measurable.
 *
 * TREAD: judged only from recorded tread depths. When no tyre in scope carries
 * a tread depth the answer is "Not recorded" - never a percentage, and never
 * "0 failures", because nothing was checked.
 */
import { computePressureCompliance, pressureReadings, PRESSURE_TOLERANCE, PRESSURE_MIN_READINGS } from './kpiEngine'

export const NOT_RECORDED = 'Not recorded'
export const PRESSURE_TOLERANCE_PCT = Math.round(PRESSURE_TOLERANCE * 100)
export { PRESSURE_MIN_READINGS }

export const PRESSURE_RULE_TEXT =
  `Each recorded pressure is compared with the median of the same vehicle in the same inspection. A reading more than ${PRESSURE_TOLERANCE_PCT}% above or below that median is outside tolerance. An inspection needs at least ${PRESSURE_MIN_READINGS} readings to be judged.`

/** Shared pressure compliance over a set of inspections. */
export function pressureRule(inspections = []) {
  const r = computePressureCompliance(Array.isArray(inspections) ? inspections : [])
  const readings = r.readings || 0
  const compliant = readings > 0 ? (r.compliantCount || 0) : null
  return {
    pct: r.compliancePct,
    readings,
    compliant,
    outside: readings > 0 ? readings - compliant : null,
    measuredInspections: r.measuredInspections || 0,
    notMeasuredInspections: r.notMeasuredInspections || 0,
    basis: r.basis,
    bySite: (r.bySite || [])
      .filter((s) => s.compliancePct != null)
      .map((s) => ({ site: s.site, pct: s.compliancePct, readings: s.readings, inspections: s.count })),
  }
}

/** True when the inspection carries at least one usable pressure reading. */
export const hasPressureReading = (inspection) => pressureReadings(inspection).length > 0

/** How many tyres in scope carry a usable tread depth. */
export function treadRecordedCount(tyres = []) {
  let n = 0
  for (const r of Array.isArray(tyres) ? tyres : []) {
    const v = r?.tread_depth
    if (v === null || v === undefined || v === '') continue
    if (Number.isFinite(Number(v))) n += 1
  }
  return n
}

/** A tread figure, or "Not recorded" when no tyre in scope has a tread depth. */
export function treadFigure(recordedCount, figure) {
  return recordedCount > 0 ? figure : NOT_RECORDED
}
