import { describe, it, expect } from 'vitest'
import {
  maskEmail, shortName, initials, signInBucket, matchesSignInFacet, healthScore, healthLabel,
  orgState, orgRecords, isEmptyOrg, orgNeedsAttention, limitLabel, planFit, fmtMoney,
  isCustomPlan, planPriceLabel, invoicePreview, displaySettingValue, uncataloguedKeys, CATALOG_KEYS,
} from '../lib/consolePlatform'
import { diffCsv } from '../console/pages/platform/users/BulkCsvDialog'

const NOW = Date.parse('2026-09-30T09:00:00Z')
const DAY = 86400000

describe('people helpers', () => {
  it('masks emails and never returns the full address', () => {
    expect(maskEmail('anum@tyrepulse.com')).toMatch(/^a\*+@tyrepulse\.com$/)
    expect(maskEmail('')).toBeFalsy()
  })
  it('shortens names and builds initials', () => {
    expect(shortName('Bassam Mohammed Al Harbi')).toMatch(/^Bassam/)
    expect(initials('Anum Khan')).toBe('AK')
  })
  it('buckets sign-in recency, with never for a missing value', () => {
    expect(signInBucket(null, NOW)).toBe('never')
    expect(matchesSignInFacet(new Date(NOW - 2 * DAY).toISOString(), '7d', NOW)).toBe(true)
    expect(matchesSignInFacet(new Date(NOW - 40 * DAY).toISOString(), 'over30', NOW)).toBe(true)
    expect(matchesSignInFacet(null, 'never', NOW)).toBe(true)
  })
})

describe('health score', () => {
  it('returns a number with deductions and a label', () => {
    const r = healthScore({ auth: { last_sign_in_at: new Date(NOW).toISOString() }, returned: { all_time: 0, last_30d: 0 }, notices: { returned_unread: 0 }, errors: { web_30d: 0 }, devices: [] })
    expect(r).toHaveProperty('score')
    expect(Array.isArray(r.deductions)).toBe(true)
    expect(typeof healthLabel(r.score)).toBe('string')
  })
})

describe('organizations', () => {
  const stats = { members: 0, vehicles: 0, tyre_records: 0, job_cards: 0, expense_lines: 0, inspections: 0 }
  it('recognises an empty organization and counts records', () => {
    expect(isEmptyOrg(stats)).toBe(true)
    expect(isEmptyOrg(null)).toBe(false)
    expect(orgRecords({ ...stats, vehicles: 4, job_cards: 3 })).toBe(7)
    expect(orgRecords(null)).toBe(null)
    expect(orgState({ name: 'Egypt' }, stats)).toBe('empty')
    expect(orgState({ name: 'X', locked: true }, stats)).toBe('locked')
  })
  it('flags the unenforced cap and Lock as owner decisions, and offers archive for empty orgs', () => {
    const orgs = [
      { id: 'a', name: 'Default Organisation', max_users: 100, plan: 'standard' },
      { id: 'b', name: 'Egypt', max_users: 100, plan: 'starter' },
    ]
    const items = orgNeedsAttention(orgs, { a: { ...stats, members: 726, vehicles: 1618 }, b: stats }, { platformCap: 500 })
    const cap = items.find((i) => i.key === 'cap')
    expect(cap.decision).toBe(true)
    expect(cap.body).toMatch(/Neither is enforced/)
    expect(items.find((i) => i.key === 'lock').decision).toBe(true)
    expect(items.find((i) => i.key === 'empty').archive).toBe(true)
    expect(items.find((i) => i.key === 'plan').to).toBe('/console/billing')
  })
})

describe('billing', () => {
  const trial = { code: 'trial', price_monthly: '0', max_vehicles: 25, max_users: 3, max_api_keys: 1, currency: 'USD' }
  const starter = { code: 'starter', price_monthly: '49', max_vehicles: 100, max_users: 10, max_api_keys: 2, currency: 'USD' }
  const enterprise = { code: 'enterprise', price_monthly: '0', max_vehicles: null, max_users: null, max_api_keys: null, currency: 'USD' }
  it('labels limits and custom plans honestly', () => {
    expect(limitLabel(null)).toBe('Unlimited')
    expect(limitLabel(25)).toBe('25')
    expect(isCustomPlan(enterprise)).toBe(true)
    expect(isCustomPlan(trial)).toBe(false)
    expect(planPriceLabel(enterprise)).toBe('Custom')
    expect(planPriceLabel(starter)).toBe('$49')
    expect(fmtMoney(null)).toBe('N/A')
  })
  it('reports which limits a plan would block', () => {
    const usage = { users: 726, vehicles: 1618, apiKeys: 0 }
    expect(planFit(trial, usage)).toEqual({ fits: false, blocks: ['users', 'vehicles'] })
    expect(planFit(enterprise, usage).fits).toBe(true)
  })
  it('previews a part-month charge and no amount for a custom plan', () => {
    const p = invoicePreview(starter, new Date(2026, 8, 16))
    expect(p.daysInMonth).toBe(30)
    expect(p.daysLeft).toBe(15)
    expect(p.prorated).toBe(24.5)
    expect(invoicePreview(enterprise).price).toBe(null)
  })
})

describe('settings', () => {
  it('masks email values and strips JSON quotes', () => {
    expect(displaySettingValue({ type: 'email' }, 'team@greenconcrete.sa')).toMatch(/^t\*+@greenconcrete\.sa$/)
    expect(displaySettingValue({ type: 'text' }, '"SAR"')).toBe('SAR')
    expect(displaySettingValue({ type: 'text' }, null)).toBe(null)
  })
  it('lists keys the catalogue does not describe', () => {
    expect(CATALOG_KEYS.has('maintenance_mode')).toBe(true)
    expect(uncataloguedKeys([{ key: 'maintenance_mode' }, { key: 'zz_new' }])).toEqual(['zz_new'])
  })
})

describe('bulk CSV diff', () => {
  const people = [
    { id: 'u1', full_name: 'Ali Hassan', role: 'Tyre Man', sites: ['NHC'], approved: true },
    { id: 'u2', full_name: 'Omar Saleh', role: 'Driver', sites: [], approved: false },
  ]
  it('finds role, site and approval changes and skips unknown rows', () => {
    const { changes, problems } = diffCsv([
      { 'User ID': 'u1', Role: 'Inspector', Sites: 'NHC;DIRIYAH' },
      { 'User ID': 'u2', Approved: 'yes' },
      { 'User ID': 'nope', Role: 'Driver' },
      { 'User ID': 'u1', Role: 'Not A Role' },
    ], people, ['Tyre Man', 'Inspector', 'Driver'])
    expect(changes).toHaveLength(2)
    expect(changes[0]).toMatchObject({ id: 'u1', role: 'Inspector', sites: ['NHC', 'DIRIYAH'] })
    expect(changes[1]).toMatchObject({ id: 'u2', approve: true })
    expect(problems.join(' ')).toMatch(/no person/)
    expect(problems.join(' ')).toMatch(/unknown role/)
  })
  it('reports nothing when the file matches', () => {
    expect(diffCsv([{ 'User ID': 'u1', Role: 'Tyre Man', Sites: 'NHC' }], people, ['Tyre Man']).changes).toEqual([])
  })
})
