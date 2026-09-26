import { describe, it, expect } from 'vitest'
import { orgStatus, summarizeOrgs } from '../lib/consoleOrganisations'

describe('consoleOrganisations', () => {
  it('lock outranks active', () => {
    expect(orgStatus({ active: true, locked: true })).toBe('Locked')
    expect(orgStatus({ active: true, locked: false })).toBe('Active')
    expect(orgStatus({ active: false })).toBe('Inactive')
    expect(orgStatus(null)).toBe('Inactive')
  })

  it('summarizes counts, plans and distinct countries', () => {
    const s = summarizeOrgs([
      { active: true, plan: 'enterprise', countries: ['KSA', 'UAE'] },
      { active: true, locked: true, plan: 'starter', country: 'Egypt' },
      { active: false, countries: ['KSA'] },
    ])
    expect(s).toMatchObject({ total: 3, active: 1, locked: 1, inactive: 1, countries: 3 })
    expect(s.byPlan).toEqual({ enterprise: 1, starter: 1, unset: 1 })
  })

  it('handles non-array input', () => {
    expect(summarizeOrgs(undefined).total).toBe(0)
  })
})
