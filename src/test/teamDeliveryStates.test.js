import { describe, it, expect } from 'vitest'
import { queueRowState, summarizeDelivery, DELIVERY_STATES, DELIVERY_LABELS } from '../lib/teamDeliveryStates'

describe('team delivery states', () => {
  it('maps queue rows to explicit states and never to an OS-delivered state', () => {
    expect(queueRowState({ status: 'pending' })).toBe('queued')
    expect(queueRowState({ status: 'delivered', result: { push: 3 } })).toBe('accepted_by_fcm')
    expect(queueRowState({ status: 'delivered', result: { push: 0 } })).toBe('failed')
    expect(queueRowState({ status: 'delivered' })).toBe('failed')
    expect(queueRowState({ status: 'failed' })).toBe('failed')
    expect(queueRowState({ status: 'skipped' })).toBe('failed')
    expect(queueRowState(null)).toBe('not_queued')
    expect(DELIVERY_STATES).toEqual(['queued', 'accepted_by_fcm', 'opened_in_app', 'failed'])
    for (const label of Object.values(DELIVERY_LABELS)) expect(label.toLowerCase()).not.toMatch(/delivered|received on/)
  })
  it('headline prefers opened > accepted > queued > failed', () => {
    const ev = [
      { user_id: 'u1', event_type: 'opened_by_user' },
      { user_id: 'u1', event_type: 'opened_by_user' },
      { user_id: 'u2', event_type: 'received_foreground' },
    ]
    const s = summarizeDelivery([{ status: 'delivered', result: { push: 5 } }], ev)
    expect(s.headline).toBe('opened_in_app')
    expect(s.counts.opened_in_app).toBe(1)
    expect(s.acceptedDevices).toBe(5)
    expect(s.foregroundUsers).toBe(1)
    expect(summarizeDelivery([{ status: 'delivered', result: { push: 2 } }], []).headline).toBe('accepted_by_fcm')
    expect(summarizeDelivery([{ status: 'pending' }], []).headline).toBe('queued')
    const f = summarizeDelivery([{ status: 'failed', last_error: 'HTTP 500' }], [])
    expect(f.headline).toBe('failed')
    expect(f.lastError).toBe('HTTP 500')
    expect(summarizeDelivery([], []).headline).toBe('not_queued')
  })
  it('tolerates junk input', () => {
    expect(summarizeDelivery(undefined, null).headline).toBe('not_queued')
    expect(summarizeDelivery([{ status: 'delivered', result: { push: 'x' } }], []).headline).toBe('failed')
  })
})
