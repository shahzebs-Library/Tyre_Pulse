import { describe, it, expect } from 'vitest'
import {
  siteKey, groupSitesByCountry, siteOptionsForCountry, emptySite,
  SITE_TYPES, SITE_FIELDS, buildSiteRollup,
} from '../lib/api/sites'

const rows = [
  { country: 'KSA', name: 'Riyadh Depot', active: true },
  { country: 'KSA', name: 'Jeddah Yard',  active: true },
  { country: 'KSA', name: 'Dammam Old',   active: false },
  { country: 'UAE', name: 'Dubai Hub',    active: true },
  { country: 'ksa', name: 'riyadh depot', active: true }, // dup (case/space)
]

describe('siteKey', () => {
  it('is case/space-insensitive and country-scoped', () => {
    expect(siteKey(' KSA ', 'Riyadh Depot')).toBe(siteKey('ksa', 'riyadh depot'))
    expect(siteKey('KSA', 'Riyadh')).not.toBe(siteKey('UAE', 'Riyadh'))
  })
})

describe('groupSitesByCountry', () => {
  it('buckets rows by country and defaults blank to Unassigned', () => {
    const g = groupSitesByCountry([{ country: 'KSA', name: 'A' }, { country: '', name: 'B' }])
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

describe('buildSiteRollup', () => {
  const master = [
    { id: 's1', name: 'Riyadh Depot', country: 'KSA', region: 'Central', city: 'Riyadh', active: true, site_type: 'depot' },
    { id: 's2', name: 'Empty Yard', country: 'KSA', region: null, city: null, active: false, site_type: 'yard' },
  ]
  const assets = [
    { id: 'a1', asset_no: 'A1', site: 'Riyadh Depot', country: 'KSA', active: true },
    { id: 'a2', asset_no: 'A2', site: 'riyadh depot', country: 'KSA', active: false }, // case-insensitive merge
    { id: 'a3', asset_no: 'A3', site: 'NEOM', country: 'KSA', active: true },           // derived (not in master)
    { id: 'a4', asset_no: 'A4', site: '', country: 'KSA', active: true },               // no site → skipped
  ]

  it('merges master + fleet, counts assets, flags governed vs derived', () => {
    const roll = buildSiteRollup(master, assets)
    const byName = Object.fromEntries(roll.map(r => [r.name, r]))

    // governed site with fleet assets (case-insensitive match)
    expect(byName['Riyadh Depot'].governed).toBe(true)
    expect(byName['Riyadh Depot'].assetCount).toBe(2)
    expect(byName['Riyadh Depot'].activeAssetCount).toBe(1)

    // governed site with no assets — still listed, honest zero
    expect(byName['Empty Yard'].governed).toBe(true)
    expect(byName['Empty Yard'].assetCount).toBe(0)

    // site seen only in fleet data → derived
    expect(byName['NEOM'].governed).toBe(false)
    expect(byName['NEOM'].assetCount).toBe(1)

    // blank-site assets never create a phantom site
    expect(roll.some(r => r.name === '')).toBe(false)
  })

  it('is pure and safe on empty inputs', () => {
    expect(buildSiteRollup([], [])).toEqual([])
    expect(buildSiteRollup(undefined, undefined)).toEqual([])
  })
})

describe('emptySite', () => {
  it('carries the country and valid defaults', () => {
    const s = emptySite('KSA')
    expect(s.country).toBe('KSA')
    expect(s.site_type).toBe('other')
    expect(s.active).toBe(true)
    for (const f of SITE_FIELDS) expect(f in s).toBe(true)
    expect(SITE_TYPES).toContain(s.site_type)
  })
})
