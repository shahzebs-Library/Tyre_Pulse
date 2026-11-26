/**
 * Read-only ERP evidence reconciliation for tyre inspection defects.
 *
 * It SUGGESTS; it never establishes a link and never marks work complete. A
 * person confirms, with a written reason, through the database function that
 * re-checks everything here (observation_erp_decide).
 *
 * The wheel is compared through the shared tyre position service, on the
 * asset's own wheel layout: an inspection stores a slot id (R1Ro) and the ERP a
 * position code (RHCO), and comparing those as text can never match. A position
 * that is ambiguous, missing, inconsistent, or on a machine whose layout is not
 * known is NEVER a match and never a conflict: it is pending manual review.
 *
 * SQL mirror: observation_erp_evaluate in
 * supabase/pending_migrations/20261116091000_observation_erp_decide_on_position_service.sql.
 */
import { resolveLayout, comparePositions, POSITION_STATUS } from './tyrePositionService'
import { isStrongSerial } from './tyreLifetime'

const key = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '')
const dateOnly = (v) => String(v || '').slice(0, 10)
const daysBetween = (before, after) => {
  const a = Date.parse(dateOnly(before)), b = Date.parse(dateOnly(after))
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null
}
export const sameErpIdentity = (a, b) =>
  !!key(a?.asset_no || a?.asset_code) && key(a?.asset_no || a?.asset_code) === key(b?.asset_no || b?.asset_code)
    && !!key(a?.country) && key(a.country) === key(b?.country)

/** Plain words for why a wheel could not be established. */
export const POSITION_REASON_TEXT = {
  tyreless_equipment: 'This equipment is registered without tyres',
  unknown_vehicle_type: 'The vehicle type of this asset is not known',
  no_vehicle_type: 'The vehicle type of this asset is not known',
  asset_not_unique: 'This asset code is registered more than once',
  missing_position: 'No wheel position was recorded',
  unreadable_position: 'The recorded wheel position could not be read',
  slot_not_on_layout: 'The inspected wheel does not exist on this vehicle layout',
  position_not_on_layout: 'The ERP wheel position does not exist on this vehicle layout',
  axle_group_not_on_layout: 'The ERP wheel position names an axle this vehicle does not have',
  dual_code_on_single_wheel: 'The ERP names an inner or outer tyre on a single wheel',
  axle_not_specified: 'The ERP position does not say which axle',
  inner_outer_not_specified: 'The ERP position does not say inner or outer',
  numbering_scheme_differs: 'The ERP numbers the axles differently from this vehicle layout',
  erp_spelling_not_verified: 'This ERP wheel spelling has not been verified for this vehicle layout',
  spare_not_on_layout: 'This vehicle layout has no spare wheel',
  spare_not_specified: 'The record does not say which spare wheel',
  slot_and_code_disagree: 'The recorded position reads as two different wheels',
  layout_changed_since_record: 'The vehicle layout was changed after the inspection',
  inspection_layout_differs_from_asset: 'The inspection was recorded on a different wheel layout than this asset has',
}
export const positionReasonText = (reason) => POSITION_REASON_TEXT[reason] || 'The wheel position could not be established'

/**
 * The asset's wheel layout for a matching run.
 * `layoutContext`: { vehicleType (fleet register), axleCount, customLayouts,
 *   layoutHistory (stored layout versions), positionMappings (verified per-layout spellings) }.
 * The inspection's own vehicle_type is used only when the register has none.
 */
export function layoutForObservation(inspection, layoutContext = {}) {
  const registered = String(layoutContext.vehicleType || '').trim()
  const recorded = String(inspection?.vehicle_type || '').trim()
  const asset = {
    vehicleType: registered || recorded,
    assetNo: inspection?.asset_no,
    country: inspection?.country,
    axleCount: layoutContext.axleCount ?? null,
    customLayouts: layoutContext.customLayouts || null,
    layoutHistory: layoutContext.layoutHistory || null,
    positionMappings: layoutContext.positionMappings || null,
    // The database's wheel-matching rules version (3 = before the shared tyre map's pump codes).
    rulesVersion: layoutContext.rulesVersion || null,
    asOf: dateOnly(inspection?.inspection_date || inspection?.completed_date || inspection?.created_at),
  }
  const layout = resolveLayout(asset)
  let conflict = false
  if (layout.status === POSITION_STATUS.RESOLVED && recorded) {
    const rec = resolveLayout({ ...asset, vehicleType: recorded })
    conflict = rec.status === POSITION_STATUS.RESOLVED && rec.key !== layout.key
  }
  return { layout, conflict }
}

export function evaluateErpCandidate({ inspection, finding, workOrder, fitments = [], expenses = [], layoutContext = {} }) {
  const reasons = [], conflicts = [], notes = []
  if (!sameErpIdentity(inspection, workOrder)) conflicts.push('Different country or asset')
  const job = key(workOrder?.work_order_no)
  if (!job) conflicts.push('ERP work order has no job card number')
  const sameJobFitments = fitments.filter(f => key(f.job_card) === job && sameErpIdentity(inspection, f))
  const inspectionDate = inspection.inspection_date || inspection.completed_date || inspection.created_at
  const dated = (f) => {
    const removalGap = daysBetween(inspectionDate, f.removal_date)
    const fitmentGap = daysBetween(inspectionDate, f.issue_date)
    return (removalGap != null && removalGap >= 0) || (fitmentGap != null && fitmentGap >= 0)
  }

  // ONE layout for both sides: the asset's own.
  const { layout, conflict: layoutConflict } = layoutForObservation(inspection, layoutContext)
  const observed = finding?.rawPosition || finding?.position
  const serial = key(finding?.serial)
  const strongSerial = !!serial && isStrongSerial(serial)

  const same = [], pending = [], different = []
  const pendingReasons = {}
  for (const f of sameJobFitments) {
    const cmp = layoutConflict
      ? { match: null, status: POSITION_STATUS.INCONSISTENT, reason: 'inspection_layout_differs_from_asset' }
      : comparePositions(layout, observed, f.tyre_position || f.position)
    const row = { fitment: f, cmp, isSerial: strongSerial && key(f.serial_no) === serial, dated: dated(f) }
    if (cmp.match === true) same.push(row)
    else if (cmp.match === false) different.push(row)
    else { pending.push(row); pendingReasons[cmp.reason] = (pendingReasons[cmp.reason] || 0) + 1 }
  }
  const sameDated = same.filter(r => r.dated)
  const serialPendingDated = pending.filter(r => r.isSerial && r.dated)
  const serialOtherWheel = different.filter(r => r.isSerial)
  const serialRows = [...same, ...pending, ...different].filter(r => r.isSerial)

  if (layoutConflict && sameJobFitments.length) conflicts.push(positionReasonText('inspection_layout_differs_from_asset'))
  if (serialOtherWheel.length) conflicts.push('The observed tyre serial is recorded on a different wheel in the ERP')
  if (same.length && !sameDated.length) conflicts.push('Tyre movement date is missing or predates observation')
  if (sameJobFitments.length && !same.length && !pending.length) conflicts.push('ERP tyre positions are on other wheels of this vehicle')

  if (sameDated.length) reasons.push('Tyre movement on the same wheel after the inspection')
  if (serialRows.length) reasons.push('Observed tyre serial is on this job card')
  // Serial supports the evidence; it never stands in for the wheel. With the wheel
  // unresolved, a decision needs a separately authorised, documented exception.
  const serialOnly = !sameDated.length && serialPendingDated.length > 0 && !serialOtherWheel.length && !layoutConflict
  if (serialOnly) notes.push('The observed serial is on this job card, but the wheel could not be matched. A serial alone does not allow confirmation')
  if (serial && !strongSerial) notes.push('The recorded serial is not a usable tyre serial, so it was not used as evidence')
  if (strongSerial && sameJobFitments.length && !serialRows.length) {
    notes.push('The observed serial is not on this job card. A replacement tyre carries its own serial')
  }
  for (const r of Object.keys(pendingReasons)) notes.push(positionReasonText(r))

  const related = expenses.filter(e => key(e.work_order_no) === job && sameErpIdentity(inspection, e))
  if (related.length) reasons.push('Expense lines found for this job card')
  // Never derive a tyre cost from a work order or a tyre lifecycle record.
  const start = workOrder.opened_at || workOrder.completed_at
  const delta = daysBetween(inspectionDate, start)
  if (delta != null && delta < 0) conflicts.push('Work order began before the recorded inspection')
  if (delta != null && delta >= 0 && delta <= 90) reasons.push('Work date follows inspection')
  if (delta != null && delta > 90) reasons.push('Work date is over 90 days after inspection')
  const description = key([workOrder.description, workOrder.notes].filter(Boolean).join(' '))
  if (/TYRE|TIRE|PUNCTURE|WHEEL/.test(description)) reasons.push('Tyre-related job description')

  // A job card alone, a cost line alone or a serial alone is insufficient to call a tyre
  // repaired: it takes a dated movement on the SAME resolved wheel.
  const tyreEvidence = sameDated.length > 0
  const sufficient = tyreEvidence && !!job && conflicts.length === 0 && delta != null && delta >= 0
  const positionState = !sameJobFitments.length ? 'no_tyre_movement'
    : (layoutConflict || serialOtherWheel.length) ? 'inconsistent'
      : tyreEvidence ? 'offered_for_review'
        : pending.length ? 'pending_manual_review'
          : same.length ? 'no_dated_movement' : 'different_wheel'
  // Only job cards that bear on this tyre are shown: a tyre movement on or after the
  // inspection (whatever wheel it turned out to be, so a pending or conflicting one is
  // still visible), or a tyre-related job that follows it. Old workshop history is not.
  const tyreJob = /TYRE|TIRE|PUNCTURE|WHEEL/.test(description)
  const relevant = sameJobFitments.some(dated) || (delta != null && delta >= 0 && tyreJob)
  const status = conflicts.length ? 'conflict'
    : sufficient ? 'review'
      : positionState === 'pending_manual_review' ? 'manual_review' : 'insufficient'
  return {
    workOrder, fitments: sameJobFitments, expenses: related,
    status, reasons, conflicts, notes, relevant, eligibleToConfirm: sufficient,
    serialExceptionPossible: serialOnly && !!job && conflicts.length === 0 && delta != null && delta >= 0,
    positionState,
    evidenceSummary: {
      tyreRows: sameJobFitments.length, expenseRows: related.length,
      positionMatched: same.length > 0, positionPending: pending.length, positionDifferent: different.length,
      canonicalPosition: same[0]?.cmp.canonical || null, layoutKey: layout.key || null,
      serialMatched: serialRows.length > 0, serialOnly, workDayGap: delta,
    },
  }
}
export function matchObservationToErp(input) {
  const { inspection, finding, workOrders = [], fitments = [], expenses = [], layoutContext = {} } = input
  return workOrders.filter(wo => sameErpIdentity(inspection, wo))
    .map(workOrder => evaluateErpCandidate({ inspection, finding, workOrder, fitments, expenses, layoutContext }))
    .filter(candidate => candidate.relevant || candidate.eligibleToConfirm)
    .sort((a,b) => Number(b.eligibleToConfirm)-Number(a.eligibleToConfirm)
      || b.reasons.length-a.reasons.length || key(a.workOrder.work_order_no).localeCompare(key(b.workOrder.work_order_no)))
}

/**
 * A confirmed link is not permanently trusted: a later ERP re-import can
 * revise the original job card. Callers must show the changed fields for
 * manual re-verification, not silently declare the work still approved.
 */
export function detectConfirmedErpDrift(snapshot, current) {
  if (!snapshot || !current) return ['Confirmed ERP job card is unavailable']
  const fields = ['work_order_no','asset_no','country','status','description','notes','opened_at','completed_at']
  return fields.filter(field => String(snapshot[field] ?? '').slice(0, 19) !== String(current[field] ?? '').slice(0, 19))
}
