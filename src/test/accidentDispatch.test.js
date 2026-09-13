import { describe, it, expect } from 'vitest'
import { dispatchSteps, DISPATCH_STEPS } from '../lib/accidentDispatch'

describe('dispatchSteps', () => {
  it('marks every step not-done and the first one current with no data at all', () => {
    const steps = dispatchSteps({})
    expect(steps.map((s) => s.done)).toEqual([false, false, false, false])
    expect(steps.map((s) => s.current)).toEqual([true, false, false, false])
  })

  it('never fabricates a done step - recovery needs BOTH recovery_required and a towing reference', () => {
    expect(dispatchSteps({ downtime: { recovery_required: true } })[0].done).toBe(false)
    expect(dispatchSteps({ downtime: { towing_reference: 'TOW-1' } })[0].done).toBe(false)
    expect(dispatchSteps({ downtime: { recovery_required: true, towing_reference: 'TOW-1' } })[0].done).toBe(true)
  })

  it('advances current to the delivered step once recovery is complete', () => {
    const steps = dispatchSteps({ downtime: { recovery_required: true, towing_reference: 'TOW-1' } })
    expect(steps[0].done).toBe(true)
    expect(steps[0].current).toBe(false)
    expect(steps[1].current).toBe(true)
  })

  it('marks "delivered" done only from a real delivered_to_workshop_at timestamp', () => {
    expect(dispatchSteps({ downtime: {} })[1].done).toBe(false)
    expect(dispatchSteps({ downtime: { delivered_to_workshop_at: '2026-08-01T09:00:00Z' } })[1].done).toBe(true)
  })

  it('marks "inspected" done as soon as ANY handover inspection is recorded', () => {
    expect(dispatchSteps({ handoverRows: [] })[2].done).toBe(false)
    expect(dispatchSteps({ handoverRows: [{ decision: 'rejected' }] })[2].done).toBe(true)
  })

  it('marks "returned" done from vehicle_status=returned_to_operation, never guessed from an accepted receipt alone', () => {
    expect(dispatchSteps({ handoverRows: [{ decision: 'accepted' }] })[3].done).toBe(false)
    expect(dispatchSteps({ downtime: { vehicle_status: 'returned_to_operation' } })[3].done).toBe(true)
  })

  it('marks nothing current once every step is done', () => {
    const steps = dispatchSteps({
      downtime: {
        recovery_required: true, towing_reference: 'TOW-1', delivered_to_workshop_at: '2026-08-01T09:00:00Z',
        vehicle_status: 'returned_to_operation',
      },
      handoverRows: [{ decision: 'accepted' }],
    })
    expect(steps.every((s) => s.done)).toBe(true)
    expect(steps.some((s) => s.current)).toBe(false)
  })

  it('DISPATCH_STEPS carries exactly 4 steps in the mockup order', () => {
    expect(DISPATCH_STEPS.map((s) => s.key)).toEqual(['recovery', 'delivered', 'inspected', 'returned'])
  })
})
