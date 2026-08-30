import { describe, expect, it } from 'vitest'
import { buildSubject } from '../hooks/useCan'

describe('buildSubject super-admin identity', () => {
  it('honours the deployed is_super_admin profile flag regardless of coarse role', () => {
    const subject = buildSubject({ id: 'u1', role: 'Reporter', is_super_admin: true }, 'org1')
    expect(subject.isSuperAdmin).toBe(true)
  })

  it('does not widen a normal user merely because a super-admin field is absent', () => {
    const subject = buildSubject({ id: 'u2', role: 'Reporter' }, 'org1')
    expect(subject.isSuperAdmin).toBe(false)
  })
})
