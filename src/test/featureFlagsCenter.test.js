import { describe, it, expect } from 'vitest'
import {
  buildFlagRows, facetCounts, filterFlagRows, turnOffImpact, audienceText, reviewDate, kindOf, RELEASE_REVIEW_DAYS,
} from '../lib/featureFlagsCenter'

const NOW = Date.parse('2026-09-30T12:00:00Z')
const usage = {
  roles: [{ role: 'Driver', people: 674 }, { role: 'Manager', people: 3 }, { role: 'Admin', people: 2 }],
  subscriptions: 0, ai_calls_35d: 0, wash_30d: 84, new_24h: {},
}
const modules = [
  { module_id: 'vehicle_washing', name: 'Vehicle washing', category: 'Operations', status: 'live', created_at: '2026-07-18T00:00:00Z' },
  { module_id: 'brand_new', name: 'Brand new', category: 'Operations', status: 'live', created_at: '2026-09-29T00:00:00Z' },
  { module_id: 'old_release', name: 'Old release', category: 'Reports', status: 'maintenance', kind: 'release', created_at: '2026-06-01T00:00:00Z' },
]
const permMap = {
  Manager: { vehicle_washing: true, 'mobile:washing': true, brand_new: false },
  Driver: { 'mobile:washing': true, brand_new: false },
}
const config = [
  { key: 'allow_signups', value: 'true' }, { key: 'registration_open', value: 'true' },
  { key: 'ai_enabled', value: 'true' }, { key: 'dual_control_enabled', value: 'false' }, { key: 'ai_model', value: 'haiku' },
]

const STALE = ['ai_enabled', 'allow_signups', 'feature_flags.ai_tools', 'feature_flags.billing', 'old_release']

describe('feature flags center', () => {
  const rows = buildFlagRows({ modules, permMap, orgFlags: { billing: true, ai_tools: true }, config, usage, now: NOW })
  const byKey = (k) => rows.find((r) => r.key === k)

  it('builds modules, org flags, switches and phone screens; skips non-boolean config', () => {
    expect(byKey('vehicle_washing').type).toBe('module')
    expect(byKey('ai_model')).toBeUndefined()
    expect(byKey('dual_control_enabled').guarded).toBeTruthy()
    expect(rows.some((r) => r.type === 'phone')).toBe(true)
  })

  it('new areas with no role are admin-only; shared ones list web and phone audiences', () => {
    expect(byKey('brand_new').lifecycle).toBe('new_admin')
    const wash = byKey('vehicle_washing')
    expect(wash.adminOnly).toBe(false)
    expect(wash.audienceWeb).toEqual([{ role: 'Manager', people: 3 }])
    expect(audienceText(wash)).toMatch(/Web 1 roles, phone 2/)
    expect(wash.usage).toBe('84 washes 30d')
  })

  it('stale detection uses real usage and review dates', () => {
    expect(byKey('allow_signups').stale.reason).toMatch(/Duplicate/)
    expect(byKey('ai_enabled').stale.reason).toMatch(/0 AI calls/)
    expect(byKey('feature_flags.billing').stale.reason).toMatch(/0 subscriptions/)
    expect(byKey('old_release').stale).toBeTruthy()
  })

  it('kind and review date', () => {
    expect(kindOf('switch')).toBe('kill_switch')
    expect(kindOf('module', { kind: 'release' })).toBe('release')
    expect(reviewDate('permission', '2026-01-01')).toBeNull()
    expect(reviewDate('release', '2026-09-01T00:00:00Z').toISOString().slice(0, 10))
      .toBe(new Date(Date.parse('2026-09-01T00:00:00Z') + RELEASE_REVIEW_DAYS * 86400000).toISOString().slice(0, 10))
    expect(reviewDate('release', null, '2026-12-01').toISOString().slice(0, 10)).toBe('2026-12-01')
  })

  it('turning a module off only affects the web; phone people keep it', () => {
    const imp = turnOffImpact(byKey('vehicle_washing'), 2)
    expect(imp).toEqual({ webPeople: 3, phonePeople: 0, phoneKeeps: 677, pagesHidden: 2, total: 3 })
    expect(turnOffImpact(byKey('ai_enabled'))).toBeNull()
  })

  it('facets and filters', () => {
    const c = facetCounts(rows)
    expect(c.type.module).toBe(3)
    expect(filterFlagRows(rows, { types: ['module'], states: ['maintenance'] }).map((r) => r.key)).toEqual(['old_release'])
    expect(filterFlagRows(rows, { search: 'washing' }).length).toBeGreaterThan(0)
    expect(filterFlagRows(rows, { lifecycles: ['stale'] }).map((r) => r.key).sort()).toEqual(STALE)
  })
})
