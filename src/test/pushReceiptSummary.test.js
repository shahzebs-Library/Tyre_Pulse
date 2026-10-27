import { describe, it, expect } from 'vitest'
import { shapeReceiptSummary } from '../lib/api/deliveryHealth'

describe('shapeReceiptSummary', () => {
  it('returns null for missing input', () => {
    expect(shapeReceiptSummary(null)).toBeNull()
  })
  it('maps counts and computes the accepted rate', () => {
    const r = shapeReceiptSummary({ days: 7, total: 10, accepted: 8, failed: 1, invalid_token: 1, by_channel: { fcm: 10 }, top_errors: [{ error: 'UNREGISTERED', count: 1 }] })
    expect(r.acceptedRate).toBe(0.8)
    expect(r.invalidToken).toBe(1)
    expect(r.topErrors).toHaveLength(1)
  })
  it('keeps unknown fields null, never 0, and no rate on zero total', () => {
    const r = shapeReceiptSummary({ total: 0 })
    expect(r.accepted).toBeNull()
    expect(r.acceptedRate).toBeNull()
  })
})
