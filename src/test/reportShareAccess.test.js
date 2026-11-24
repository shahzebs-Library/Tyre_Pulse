import { describe, expect, it } from 'vitest'
import { mustClearShareSnapshot } from '../lib/reportShareAccess'

describe('Report Sharing public viewer authorization refresh', () => {
  it.each(['revoked', 'expired', 'invalid', 'forbidden'])('clears an already-rendered board when the server returns %s', reason => {
    expect(mustClearShareSnapshot({ ok: false, reason })).toBe(true)
  })
  it.each(['unavailable', 'network_error', null])('preserves the last valid board during %s', reason => {
    expect(mustClearShareSnapshot({ ok: false, reason })).toBe(false)
  })
  it('never clears a successful snapshot', () => {
    expect(mustClearShareSnapshot({ ok: true, reason: 'revoked' })).toBe(false)
  })
})
