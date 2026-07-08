import { describe, it, expect } from 'vitest'
import {
  siteKey, groupSitesByCountry, siteOptionsForCountry, emptySite,
  SITE_TYPES, SITE_FIELDS,
} from '../lib/api/sites'

const rows = [
  { country: 'KSA', site_name: 'Riyadh Depot', status: 'active' },
  { country: 'KSA', site_name: 'Jeddah Yard',  status: 'active' },
  { country: 'KSA', site_name: 'Dammam Old',   status: 'inactive' },
  { country: 'UAE', site_name: 'Dubai Hub',    status: 'active' },
  { country: 'ksa', site_name: 'riyadh depot', status: 'active' }, // dup (case/space)
]

describe('siteKey', () => {
  it('is case/space-insensitive and country-scoped', () => {
    expect(siteKey(' KSA ', 'Riyadh Depot')).toBe(siteKey('ksa', 'riyadh depot'))
    expect(siteKey('KSA', 'Riyadh')).not.toBe(siteKey('UAE', 'Riyadh'))
  })
})

describe('groupSitesByCountry', () => {
  it('buckets rows by country and defaults blank to Unassigned', () => {
    const g = groupSitesByCountry([{ country: 'KSA', site_name: 'A' }, { country: '', site_name: 'B' }])
    expect(g.KSA).toHaveLength(1)
    expect(g.Unassigned).toHaveLength(1)
  })
})

describe('siteOptionsForCountry', () => {
  it('returns sorted, de-duplicated active names for the country', () => {
    expect(siteOptionsForCountry(rows, 'KSA')).toEqual(['Jeddah Yard', 'Riyadh Depot'])
  })
  it('hides inactive sites by default but includes them when asked', () => {
    expect(siteOptionsForCountry(rows, 'KSA')).not.toContain('Dammam Old')
    expect(siteOptionsForCountry(rows, 'KSA', { activeOnly: false })).toContain('Dammam Old')
  })
  it('scopes to the requested country', () => {
    expect(siteOptionsForCountry(rows, 'UAE')).toEqual(['Dubai Hub'])
  })
  it('empty country returns all active de-duplicated names across countries', () => {
    expect(siteOptionsForCountry(rows, '')).toEqual(['Dubai Hub', 'Jeddah Yard', 'Riyadh Depot'])
  })
})

describe('emptySite', () => {
  it('carries the country and every editable field with valid defaults', () => {
    const s = emptySite('KSA')
    expect(s.country).toBe('KSA')
    expect(s.site_type).toBe('other')
    expect(s.status).toBe('active')
    for (const f of SITE_FIELDS) expect(f in s).toBe(true)
    expect(SITE_TYPES).toContain(s.site_type)
  })
})
