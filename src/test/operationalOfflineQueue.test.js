import { describe, expect, it } from 'vitest'
import { validateOperationalMutation } from '../lib/operationalOfflineQueue'

describe('mobile operational queue contract', () => {
  it('accepts only allowlisted mutations with an idempotency key', () => {
    expect(validateOperationalMutation({ type: 'action.update', payload: { id: '1' }, idempotencyKey: 'action:1:start' }))
      .toMatchObject({ type: 'action.update', idempotencyKey: 'action:1:start' })
    expect(() => validateOperationalMutation({ type: 'admin.delete', payload: {}, idempotencyKey: 'x' })).toThrow()
    expect(() => validateOperationalMutation({ type: 'action.update', payload: {} })).toThrow()
  })
})
