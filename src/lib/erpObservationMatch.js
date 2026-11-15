/**
 * Read-only ERP evidence reconciliation for tyre inspection defects.
 * Never establishes a verified link or marks work complete.
 * Country, asset, tyre identity, and chronology are independently checked.
 */
const key = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '')
const dateOnly = (v) => String(v || '').slice(0, 10)
const daysBetween = (before, after) => {
  const a = Date.parse(dateOnly(before)), b = Date.parse(dateOnly(after))
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null
}
export const sameErpIdentity = (a, b) =>
  !!key(a?.asset_no || a?.asset_code) && key(a?.asset_no || a?.asset_code) === key(b?.asset_no || b?.asset_code)
    && !!key(a?.country) && key(a.country) === key(b?.country)

export function evaluateErpCandidate({ inspection, finding, workOrder, fitments = [], expenses = [] }) {
  const reasons = [], conflicts = []
  if (!sameErpIdentity(inspection, workOrder)) conflicts.push('Different country or asset')
  const job = key(workOrder?.work_order_no)
  if (!job) conflicts.push('ERP work order has no job card number')
  const sameJobFitments = fitments.filter(f => key(f.job_card) === job && sameErpIdentity(inspection, f))
  const position = key(finding?.rawPosition || finding?.position)
  const serial = key(finding?.serial)
  const exactPosition = sameJobFitments.filter(f => key(f.position || f.tyre_position) === position)
  const exactSerial = sameJobFitments.filter(f => key(f.serial_no) === serial)
  if (sameJobFitments.length && position && !exactPosition.length) conflicts.push('ERP tyre positions do not match observation')
  if (serial && sameJobFitments.length && !exactSerial.length) conflicts.push('Recorded tyre serial not found on this job card')
  if (exactPosition.length) reasons.push('Matching wheel position in tyre consumption')
  if (serial && exactSerial.length) reasons.push('Matching tyre serial')
  const related = expenses.filter(e => key(e.work_order_no) === job && sameErpIdentity(inspection, e))
  if (related.length) reasons.push('Expense lines found for this job card')
  // Never derive a tyre cost from a work order or a tyre lifecycle record.
  const inspectionDate = inspection.inspection_date || inspection.completed_date || inspection.created_at
  const start = workOrder.opened_at || workOrder.completed_at
  const delta = daysBetween(inspectionDate, start)
  if (delta != null && delta < 0) conflicts.push('Work order began before the recorded inspection')
  if (delta != null && delta >= 0 && delta <= 90) reasons.push('Work date follows inspection')
  if (delta != null && delta > 90) reasons.push('Work date is over 90 days after inspection')
  const description = key([workOrder.description, workOrder.notes].filter(Boolean).join(' '))
  if (/TYRE|TIRE|PUNCTURE|WHEEL/.test(description)) reasons.push('Tyre-related job description')
  // A job card alone or a cost line alone is insufficient to call a tyre repaired.
  const sufficient = !!exactPosition.length && !!job && conflicts.length === 0 && delta != null && delta >= 0
  const status = conflicts.length ? 'conflict' : sufficient ? 'review' : 'insufficient'
  return {
    workOrder, fitments: sameJobFitments, expenses: related,
    status, reasons, conflicts, eligibleToConfirm: sufficient,
    evidenceSummary: { tyreRows: sameJobFitments.length, expenseRows: related.length, positionMatched: exactPosition.length > 0,
      serialMatched: !!serial && exactSerial.length > 0, workDayGap: delta },
  }
}
export function matchObservationToErp(input) {
  const { inspection, finding, workOrders = [], fitments = [], expenses = [] } = input
  return workOrders.filter(wo => sameErpIdentity(inspection, wo))
    .map(workOrder => evaluateErpCandidate({ inspection, finding, workOrder, fitments, expenses }))
    .sort((a,b) => Number(b.eligibleToConfirm)-Number(a.eligibleToConfirm)
      || b.reasons.length-a.reasons.length || key(a.workOrder.work_order_no).localeCompare(key(b.workOrder.work_order_no)))
}
