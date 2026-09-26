import { describe, it, expect } from 'vitest'
import { actionKind, diffFields, summarizeAudit, toScalar } from '../lib/accessAuditView'

describe('accessAuditView', () => {
  it('toScalar renders blanks as N/A', () => {
    expect(toScalar(null)).toBe('N/A')
    expect(toScalar([])).toBe('N/A')
    expect(toScalar(['a', 'b'])).toBe('a, b')
    expect(toScalar({ x: 1 })).toBe('{"x":1}')
  })

  it('diffFields lists only changed keys in a stable order', () => {
    expect(diffFields({ role: 'Reporter', a: 1 }, { role: 'Manager', a: 1, z: true })).toEqual([
      { key: 'role', from: 'Reporter', to: 'Manager' },
      { key: 'z', from: 'N/A', to: 'true' },
    ])
    expect(diffFields(null, null)).toEqual([])
  })

  it('classifies actions, removal before grant', () => {
    expect(actionKind('grant_revoked')).toBe('removal')
    expect(actionKind('grant')).toBe('grant')
    expect(actionKind('role_change')).toBe('role')
    expect(actionKind('set_country')).toBe('scope')
    expect(actionKind('')).toBe('other')
  })

  it('summarizes actors, targets, kinds and the latest entry', () => {
    const s = summarizeAudit([
      { actor: 'a', target_user: 'u1', action: 'grant', at: '2026-09-01T00:00:00Z' },
      { actor: 'a', target_user: 'u2', action: 'revoke', at: '2026-09-03T00:00:00Z' },
      { actor: 'b', action: 'update', at: 'not a date' },
    ])
    expect(s).toMatchObject({ total: 3, actors: 2, targets: 2, latest: '2026-09-03T00:00:00.000Z' })
    expect(s.byKind).toMatchObject({ grant: 1, removal: 1, change: 1 })
  })
})
