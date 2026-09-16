import { describe, it, expect } from 'vitest'
import { dispatchSteps, DISPATCH_STEPS } from '../lib/accidentDispatch'
import { DISPATCH_STEPPER } from '../lib/accidentCaseVocab'

const keys = (steps) => steps.map((s) => s.key)
const states = (steps) => steps.map((s) => s.state)

describe('dispatchSteps (mock M2 stepper)', () => {
  it('carries exactly the 4 DISPATCH_STEPPER steps in mock order', () => {
    expect(DISPATCH_STEPS).toBe(DISPATCH_STEPPER)
    expect(keys(dispatchSteps({}))).toEqual(['dispatched', 'arrived', 'signed_acceptance', 'vendor_assessment'])
    expect(dispatchSteps({}).map((s) => s.n)).toEqual([1, 2, 3, 4])
  })

  it('with no data nothing is complete, step 1 is next, the rest pending', () => {
    const steps = dispatchSteps({})
    expect(states(steps)).toEqual(['next', 'pending', 'pending', 'pending'])
    expect(steps.map((s) => s.done)).toEqual([false, false, false, false])
    expect(steps.every((s) => s.at === null)).toBe(true)
  })

  it('Dispatched completes from departure_at (with its date) or a post-departure live status', () => {
    const a = dispatchSteps({ dispatch: { departure_at: '2026-09-16T08:00:00Z' } })
    expect(a[0].state).toBe('complete')
    expect(a[0].at).toBe('2026-09-16T08:00:00Z')
    expect(a[1].state).toBe('next')
    expect(dispatchSteps({ dispatch: { live_status: 'in_transit' } })[0].done).toBe(true)
    expect(dispatchSteps({ dispatch: { live_status: 'preparing' } })[0].done).toBe(false)
  })

  it('Arrived completes from arrived_at, an arrived/accepted live status, or the legacy delivered_to_workshop_at', () => {
    expect(dispatchSteps({ dispatch: { arrived_at: '2026-09-16T09:08:00Z' } })[1].at).toBe('2026-09-16T09:08:00Z')
    expect(dispatchSteps({ dispatch: { live_status: 'arrived' } })[1].done).toBe(true)
    expect(dispatchSteps({ downtime: { delivered_to_workshop_at: '2026-09-16T09:30:00Z' } })[1]).toMatchObject({ done: true, at: '2026-09-16T09:30:00Z' })
    expect(dispatchSteps({ downtime: {} })[1].done).toBe(false)
  })

  it('Signed acceptance needs custody_accepted AND a timestamp/accepted status, or a legacy accepted receipt', () => {
    expect(dispatchSteps({ dispatch: { custody_accepted: true } })[2].done).toBe(false)
    expect(dispatchSteps({ dispatch: { custody_accepted: true, accepted_at: '2026-09-16T10:00:00Z' } })[2]).toMatchObject({ done: true, at: '2026-09-16T10:00:00Z' })
    expect(dispatchSteps({ dispatch: { custody_accepted: true, live_status: 'accepted' } })[2].done).toBe(true)
    expect(dispatchSteps({ handoverRows: [{ decision: 'rejected' }] })[2].done).toBe(false)
    expect(dispatchSteps({ handoverRows: [{ decision: 'accepted' }] })[2].done).toBe(true)
  })

  it('Vendor assessment starts only once a quotation has at least been requested', () => {
    expect(dispatchSteps({ repairOrder: { quotation_status: 'not_requested' } })[3].done).toBe(false)
    expect(dispatchSteps({ repairOrder: {} })[3].done).toBe(false)
    expect(dispatchSteps({ repairOrder: { quotation_status: 'requested' } })[3].done).toBe(true)
    expect(dispatchSteps({ repairOrder: { quotation_status: 'approved' } })[3].done).toBe(true)
  })

  it('the mock scenario: dispatched complete, arrived next, later steps pending', () => {
    const steps = dispatchSteps({ dispatch: { departure_at: '2026-09-16T08:00:00Z', live_status: 'in_transit' } })
    expect(states(steps)).toEqual(['complete', 'next', 'pending', 'pending'])
  })

  it('marks nothing next once every step is complete', () => {
    const steps = dispatchSteps({
      dispatch: { departure_at: '2026-09-16T08:00:00Z', arrived_at: '2026-09-16T09:00:00Z', custody_accepted: true, accepted_at: '2026-09-16T09:30:00Z', live_status: 'accepted' },
      repairOrder: { quotation_status: 'received' },
    })
    expect(steps.every((s) => s.state === 'complete')).toBe(true)
    expect(steps.some((s) => s.current)).toBe(false)
  })
})
