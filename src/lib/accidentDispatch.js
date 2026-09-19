/**
 * accidentDispatch.js - the 4-step "Dispatch and Handover" stepper (mock M2):
 *   1 Dispatched -> 2 Arrived -> 3 Signed acceptance -> 4 Vendor assessment / quotation starts
 *
 * Pure, no I/O. The steps are the DISPATCH_STEPPER contract in
 * accidentCaseVocab (web + Flutter share it). Each step's state is DERIVED
 * from real recorded facts on the accident_dispatches row - departure_at,
 * arrived_at, custody_accepted/accepted_at - with two honest fallbacks for a
 * case recorded before that table existed: a downtime row's
 * delivered_to_workshop_at (the vehicle did arrive) and an accepted
 * accident_handover_inspections row (a receipt was signed). Step 4 reads the
 * repair order's quotation_status - the vendor's assessment has started once
 * a quotation has at least been requested.
 *
 * States: 'complete' (done), 'next' (the FIRST step not yet done - the one
 * that is actionable now), 'pending' (every later step). Once everything is
 * done nothing is 'next'.
 */
import { DISPATCH_STEPPER } from './accidentCaseVocab'

/** Kept for callers/tests that import the step list from here. */
export const DISPATCH_STEPS = DISPATCH_STEPPER

const AFTER_DEPARTURE = ['in_transit', 'arrived', 'accepted']
const AFTER_ARRIVAL = ['arrived', 'accepted']
const QUOTATION_STARTED = ['requested', 'received', 'approved', 'rejected']

/**
 * @param {{dispatch?:object|null, downtime?:object|null, handoverRows?:object[], repairOrder?:object|null}} p
 * @returns {{key:string, n:number, label:string, done:boolean, current:boolean,
 *   state:'complete'|'next'|'pending', at:string|null}[]}
 */
export function dispatchSteps({ dispatch, downtime, handoverRows = [], repairOrder } = {}) {
  const dsp = dispatch || {}
  const dt = downtime || {}
  const ro = repairOrder || {}
  const acceptedReceipt = (handoverRows || []).some((r) => r?.decision === 'accepted')

  const facts = {
    dispatched: {
      done: !!dsp.departure_at || AFTER_DEPARTURE.includes(dsp.live_status),
      at: dsp.departure_at || null,
    },
    arrived: {
      done: !!dsp.arrived_at || AFTER_ARRIVAL.includes(dsp.live_status) || !!dt.delivered_to_workshop_at,
      at: dsp.arrived_at || dt.delivered_to_workshop_at || null,
    },
    signed_acceptance: {
      done: (!!dsp.custody_accepted && (!!dsp.accepted_at || dsp.live_status === 'accepted')) || acceptedReceipt,
      at: dsp.accepted_at || null,
    },
    vendor_assessment: {
      done: QUOTATION_STARTED.includes(ro.quotation_status),
      at: null,
    },
  }

  let nextAssigned = false
  return DISPATCH_STEPPER.map((step) => {
    const f = facts[step.key] || { done: false, at: null }
    const done = !!f.done
    const current = !done && !nextAssigned
    if (current) nextAssigned = true
    return { ...step, done, current, state: done ? 'complete' : current ? 'next' : 'pending', at: f.at }
  })
}
