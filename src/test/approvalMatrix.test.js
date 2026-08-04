import { describe, it, expect } from 'vitest'
import {
  specificity, ruleMatches, resolveApprovers, primaryApprover,
  approverLabel, scopeLabel, validateRule, entityLabel,
} from '../lib/approvalMatrix'

const roleRule = {
  id: 'r-role', entity_type: 'inspection', match_country: 'KSA',
  approver_role: 'Manager', level: 1, active: true, created_at: '2026-01-01',
}
const siteRule = {
  id: 'r-site', entity_type: 'inspection', match_country: 'KSA', match_site: 'NHC',
  approver_user_id: 'u-sup', level: 1, active: true, created_at: '2026-01-02',
}
const namedRule = {
  id: 'r-named', entity_type: 'inspection', match_country: 'KSA', match_site: 'NHC',
  match_role: 'Tyre Man', match_user_id: 'u-ahmed',
  approver_user_id: 'u-saleh', level: 1, active: true, created_at: '2026-01-03',
}
const all = [roleRule, siteRule, namedRule]

describe('specificity', () => {
  it('counts only the pinned match fields', () => {
    expect(specificity(roleRule)).toBe(1)
    expect(specificity(siteRule)).toBe(2)
    expect(specificity(namedRule)).toBe(4)
  })
  it('treats blank strings as wildcards, not values', () => {
    expect(specificity({ match_country: '  ', match_site: '' })).toBe(0)
  })
  it('is safe on null', () => { expect(specificity(null)).toBe(0) })
})

describe('ruleMatches', () => {
  const ctx = { entity_type: 'inspection', country: 'KSA', site: 'NHC', role: 'Tyre Man', user_id: 'u-ahmed' }
  it('a blank field matches anything', () => {
    expect(ruleMatches(roleRule, ctx)).toBe(true)
  })
  it('a pinned field must match exactly', () => {
    expect(ruleMatches(siteRule, { ...ctx, site: 'DIRIYAH-G1' })).toBe(false)
  })
  it('ignores inactive rules', () => {
    expect(ruleMatches({ ...roleRule, active: false }, ctx)).toBe(false)
  })
  it('never crosses entity types', () => {
    expect(ruleMatches(roleRule, { ...ctx, entity_type: 'accident' })).toBe(false)
  })
})

// THE behaviour the whole feature rests on: all three styles coexist and the
// narrowest match wins. Mirrors the live SQL check on resolve_approvers.
describe('precedence: named person > site > role', () => {
  it('named person wins for that person at that site', () => {
    const r = primaryApprover(all, {
      entity_type: 'inspection', country: 'KSA', site: 'NHC', role: 'Tyre Man', user_id: 'u-ahmed',
    })
    expect(r.id).toBe('r-named')
  })
  it('site rule wins for a different person at that site', () => {
    const r = primaryApprover(all, {
      entity_type: 'inspection', country: 'KSA', site: 'NHC', role: 'Tyre Man', user_id: 'u-other',
    })
    expect(r.id).toBe('r-site')
  })
  it('role rule is the fallback at another site', () => {
    const r = primaryApprover(all, {
      entity_type: 'inspection', country: 'KSA', site: 'DIRIYAH-G1', role: 'Tyre Man', user_id: 'u-other',
    })
    expect(r.id).toBe('r-role')
  })
  it('returns null when nothing matches, rather than guessing', () => {
    expect(primaryApprover(all, { entity_type: 'inspection', country: 'UAE' })).toBeNull()
  })
  it('orders level 1 before an escalation level', () => {
    const esc = { ...roleRule, id: 'r-esc', level: 2 }
    const out = resolveApprovers([esc, roleRule], { entity_type: 'inspection', country: 'KSA' })
    expect(out.map((r) => r.id)).toEqual(['r-role', 'r-esc'])
  })
  it('is safe on rubbish input', () => {
    expect(resolveApprovers(null, {})).toEqual([])
  })
})

describe('validateRule', () => {
  it('accepts a well-formed rule', () => {
    expect(validateRule(roleRule)).toEqual([])
  })
  it('demands exactly one approver', () => {
    expect(validateRule({ entity_type: 'inspection' }).join()).toMatch(/exactly one approver/i)
    expect(validateRule({ entity_type: 'inspection', approver_role: 'Manager', approver_user_id: 'u1' })
      .join()).toMatch(/exactly one approver/i)
  })
  it('rejects a non-positive escalation window', () => {
    expect(validateRule({ ...roleRule, escalate_after_days: 0 }).join()).toMatch(/above zero/i)
  })
  it('allows escalation to be left blank', () => {
    expect(validateRule({ ...roleRule, escalate_after_days: '' })).toEqual([])
  })
})

describe('labels', () => {
  const users = { 'u-saleh': { full_name: 'Saleh K.' }, 'u-ahmed': { full_name: 'Ahmed R.' } }
  it('names the approver', () => {
    expect(approverLabel(namedRule, users)).toBe('Saleh K.')
    expect(approverLabel(roleRule, users)).toBe('Any Manager')
  })
  it('describes the scope in plain words', () => {
    expect(scopeLabel(siteRule)).toBe('at NHC, in KSA')
    expect(scopeLabel({})).toBe('Everything (fallback)')
    expect(scopeLabel(namedRule, users)).toContain('Ahmed R.')
  })
  it('falls back honestly for an unknown entity', () => {
    expect(entityLabel('inspection')).toBe('Tyre inspection')
    expect(entityLabel(null)).toBe('N/A')
  })
})
