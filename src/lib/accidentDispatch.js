/**
 * accidentDispatch.js - the 4-step "Dispatch & Handover" progress stepper.
 * Pure, no I/O. Every step's done/current state is DERIVED from real recorded
 * facts (a downtime record's own columns, and whether a handover inspection
 * exists) - there is no separate "dispatch status" column anywhere in the
 * schema, so inventing one would be a fabricated field. "Current" is the
 * FIRST step (in order) that is not yet done; once every step is done, none
 * is current - the case has completed dispatch and handover.
 */

export const DISPATCH_STEPS = [
  { key: 'recovery', label: 'Recovery arranged' },
  { key: 'delivered', label: 'Delivered to workshop' },
  { key: 'inspected', label: 'Handover inspection' },
  { key: 'returned', label: 'Returned to service' },
]

/**
 * @param {{downtime?:object|null, handoverRows?:object[]}} p
 * @returns {{key:string, label:string, done:boolean, current:boolean}[]}
 */
export function dispatchSteps({ downtime, handoverRows = [] } = {}) {
  const d = downtime || {}
  const hasAcceptedHandover = handoverRows.some((r) => r?.decision === 'accepted')
  const doneFlags = {
    recovery: !!(d.recovery_required && d.towing_reference),
    delivered: !!d.delivered_to_workshop_at,
    inspected: handoverRows.length > 0,
    returned: d.vehicle_status === 'returned_to_operation' || hasAcceptedHandover && !!d.offroad_end,
  }

  let currentAssigned = false
  return DISPATCH_STEPS.map((step) => {
    const done = !!doneFlags[step.key]
    const current = !done && !currentAssigned
    if (current) currentAssigned = true
    return { ...step, done, current }
  })
}
