import { describe, it, expect } from 'vitest'
import {
  MAX_ATTEMPTS, backoffMs, isConflictError, planAfterFailure, isDue,
} from '../lib/offlineQueue'

describe('backoffMs', () => {
  it('grows exponentially and is capped at 1 hour', () => {
    expect(backoffMs(1)).toBe(30_000)
    expect(backoffMs(2)).toBe(60_000)
    expect(backoffMs(3)).toBe(120_000)
    expect(backoffMs(99)).toBe(3_600_000) // cap
  })
  it('treats 0/negative attempts as at least one', () => {
    expect(backoffMs(0)).toBe(30_000)
    expect(backoffMs(-5)).toBe(30_000)
  })
})

describe('isConflictError', () => {
  it('detects a Postgres unique violation by code', () => {
    expect(isConflictError({ code: '23505' })).toBe(true)
  })
  it('detects it by message text', () => {
    expect(isConflictError({ message: 'duplicate key value violates unique constraint' })).toBe(true)
    expect(isConflictError({ message: 'row already exists' })).toBe(true)
  })
  it('is false for other errors and nullish input', () => {
    expect(isConflictError({ code: '400', message: 'bad request' })).toBe(false)
    expect(isConflictError(null)).toBe(false)
    expect(isConflictError(undefined)).toBe(false)
  })
})

describe('planAfterFailure', () => {
  const now = 1_000_000
  it('stays pending with a back-off window below the cap', () => {
    const p = planAfterFailure(0, now)
    expect(p.status).toBe('pending')
    expect(p.attempts).toBe(1)
    expect(new Date(p.next_attempt_at).getTime()).toBe(now + backoffMs(1))
  })
  it('increments the attempt count each time', () => {
    expect(planAfterFailure(2, now).attempts).toBe(3)
  })
  it('dead-letters once attempts would reach MAX_ATTEMPTS', () => {
    const p = planAfterFailure(MAX_ATTEMPTS - 1, now)
    expect(p.status).toBe('failed')
    expect(p.attempts).toBe(MAX_ATTEMPTS)
    expect(p.next_attempt_at).toBe(null)
  })
})

describe('isDue', () => {
  const now = 2_000_000
  it('is due when there is no scheduled time', () => {
    expect(isDue({}, now)).toBe(true)
    expect(isDue({ next_attempt_at: null }, now)).toBe(true)
  })
  it('is due when the scheduled time has passed', () => {
    expect(isDue({ next_attempt_at: new Date(now - 1).toISOString() }, now)).toBe(true)
  })
  it('is not due when the back-off window is still open', () => {
    expect(isDue({ next_attempt_at: new Date(now + 60_000).toISOString() }, now)).toBe(false)
  })
  it('is due when the scheduled time is unparseable (fail open)', () => {
    expect(isDue({ next_attempt_at: 'not-a-date' }, now)).toBe(true)
  })
})
