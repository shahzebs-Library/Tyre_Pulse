/**
 * Working context - the permission-aware "where am I working" tree.
 *
 * The rows below mirror the SHAPE of the live `sites` register (measured): KSA
 * carries regions (CENTRAL / WESTERN), UAE and Egypt carry none, one stray row
 * spells KSA as 'Saudi Arabia', and AMAALA is listed twice. Every one of those is
 * a real condition the tree must survive, so they are all represented here.
 */
import { describe, it, expect } from 'vitest'
import {
  EMPTY_CONTEXT,
  buildContextTree,
  allowedContext,
  normalizeContext,
  canSwitchContext,
  contextLabel,
  contextShortLabel,
  contextToCountry,
  contextLeafCount,
} from '../lib/workingContext'

const ROWS = [
  { name: 'NHC', country: 'KSA', region: 'CENTRAL' },
  { name: 'QIDDIYA-UPPER PLATEAU', country: 'KSA', region: 'CENTRAL' },
  { name: 'DHAHBAN', country: 'KSA', region: 'WESTERN' },
  { name: 'AMAALA', country: 'KSA', region: 'WESTERN' },
  // The register really does list AMAALA twice; the duplicate carries no region.
  { name: 'AMAALA', country: 'KSA', region: '' },
  // A KSA site nobody has placed in a region yet.
  { name: 'RUMAH', country: 'KSA', region: null },
  // The stray duplicate spelling of KSA.
  { name: 'RIY-MET', country: 'Saudi Arabia', region: 'CENTRAL' },
  { name: 'JEBEL ALI', country: 'UAE', region: null },
  { name: 'ABU DHABI', country: 'UAE', region: '' },
  { name: 'CAIRO', country: 'Egypt', region: null },
  // Junk rows: no name (registers the country only), no country (dropped).
  { name: '   ', country: 'Egypt', region: null },
  { name: 'NOWHERE', country: '  ', region: 'X' },
]

const tree = () => buildContextTree(ROWS)
const ksa = (t = tree()) => t.find(n => n.country === 'KSA')

describe('buildContextTree', () => {
  it('groups by country, sorted, with the Saudi Arabia alias folded into KSA', () => {
    const t = tree()
    expect(t.map(n => n.country)).toEqual(['Egypt', 'KSA', 'UAE'])
    expect(ksa(t).sites).toContain('RIY-MET')
  })

  it('lists every site of a country in the flat list, sorted and de-duplicated', () => {
    expect(ksa().sites).toEqual([
      'AMAALA', 'DHAHBAN', 'NHC', 'QIDDIYA-UPPER PLATEAU', 'RIY-MET', 'RUMAH',
    ])
  })

  it('keeps the region from the first row that names one for a duplicated site', () => {
    const western = ksa().regions.find(r => r.region === 'WESTERN')
    expect(western.sites).toEqual(['AMAALA', 'DHAHBAN'])
  })

  it('renders Country > Site directly for a country with no regions', () => {
    const t = tree()
    const uae = t.find(n => n.country === 'UAE')
    expect(uae.regions).toEqual([])
    expect(uae.sites).toEqual(['ABU DHABI', 'JEBEL ALI'])
  })

  it('leaves an unplaced site out of the regions but present in the flat list', () => {
    const k = ksa()
    expect(k.sites).toContain('RUMAH')
    expect(k.regions.flatMap(r => r.sites)).not.toContain('RUMAH')
  })

  it('registers a country from a blank-name row (the COUNTRIES fallback) and drops a blank country', () => {
    const t = buildContextTree([
      { name: '', country: 'KSA', region: '' },
      { name: '', country: 'UAE', region: '' },
      { name: 'ORPHAN', country: null, region: '' },
    ])
    expect(t.map(n => n.country)).toEqual(['KSA', 'UAE'])
    expect(t[0].sites).toEqual([])
  })

  it('never throws on junk input', () => {
    expect(buildContextTree(null)).toEqual([])
    expect(buildContextTree(undefined)).toEqual([])
    expect(buildContextTree([null, 42, 'x'])).toEqual([])
  })
})

describe('allowedContext', () => {
  it('gives a super-admin every country and site', () => {
    const p = { is_super_admin: true, country: ['KSA'], sites: ['NHC'] }
    expect(allowedContext(p, tree())).toEqual(tree())
  })

  it('gives an Admin every country and site', () => {
    const p = { role: 'Admin', country: ['Egypt'], sites: ['CAIRO'] }
    expect(allowedContext(p, tree()).map(n => n.country)).toEqual(['Egypt', 'KSA', 'UAE'])
  })

  it('treats an empty country list and the all sentinel as every country', () => {
    expect(allowedContext({ role: 'Reporter', country: [] }, tree())).toHaveLength(3)
    expect(allowedContext({ role: 'Reporter', country: null }, tree())).toHaveLength(3)
    expect(allowedContext({ role: 'Reporter', country: ['all'] }, tree())).toHaveLength(3)
  })

  it('gives a single-country user exactly one country', () => {
    const p = { role: 'Director', country: ['Egypt'], sites: ['ALL'] }
    expect(allowedContext(p, tree()).map(n => n.country)).toEqual(['Egypt'])
  })

  it('gives the real three-country user all three (the pinned-to-KSA regression)', () => {
    const p = { role: 'Manager', country: ['KSA', 'UAE', 'Egypt'], sites: ['ALL'] }
    expect(allowedContext(p, tree()).map(n => n.country)).toEqual(['Egypt', 'KSA', 'UAE'])
  })

  it('matches a held country case-insensitively and through the alias', () => {
    const p = { role: 'Manager', country: ['  ksa  ', 'Saudi Arabia'], sites: ['ALL'] }
    expect(allowedContext(p, tree()).map(n => n.country)).toEqual(['KSA'])
  })

  it('filters sites for a site-scoped user and drops a country left with none', () => {
    const p = { role: 'Manager', country: ['KSA', 'UAE'], sites: ['nhc', ' DHAHBAN '] }
    const out = allowedContext(p, tree())
    expect(out.map(n => n.country)).toEqual(['KSA'])
    expect(out[0].sites).toEqual(['DHAHBAN', 'NHC'])
    // Regions are pruned to the surviving sites only.
    expect(out[0].regions.map(r => r.region)).toEqual(['CENTRAL', 'WESTERN'])
    expect(out[0].regions.find(r => r.region === 'WESTERN').sites).toEqual(['DHAHBAN'])
  })

  it('keeps a country whose sites are unknown even for a site-scoped user', () => {
    // A failed register read leaves country-only nodes: site scope cannot be
    // applied, and dropping the country would blank the picker entirely.
    const fallback = buildContextTree([{ name: '', country: 'KSA', region: '' }])
    const p = { role: 'Manager', country: ['KSA'], sites: ['NHC'] }
    expect(allowedContext(p, fallback).map(n => n.country)).toEqual(['KSA'])
  })

  it('treats a missing profile as unrestricted (still loading, RLS is the boundary)', () => {
    expect(allowedContext(null, tree())).toHaveLength(3)
  })
})

describe('normalizeContext', () => {
  const all = () => tree()

  it('accepts a valid saved context unchanged and derives its region', () => {
    const r = normalizeContext({ country: 'KSA', region: null, site: 'NHC' }, all())
    expect(r.changed).toBe(false)
    expect(r.reason).toBeNull()
    expect(r.context).toEqual({ country: 'KSA', region: 'CENTRAL', site: 'NHC' })
  })

  it('picks the first allowed country when nothing was saved', () => {
    const r = normalizeContext(null, all())
    expect(r).toMatchObject({ changed: true, reason: 'initial' })
    expect(r.context.country).toBe('Egypt')
  })

  it('falls back when the saved country is no longer allowed', () => {
    const allowed = allowedContext({ role: 'Manager', country: ['UAE'], sites: ['ALL'] }, all())
    const r = normalizeContext({ country: 'KSA', region: null, site: 'NHC' }, allowed)
    expect(r).toMatchObject({ changed: true, reason: 'country_unavailable' })
    expect(r.context.country).toBe('UAE')
  })

  it('pins the single site when the fallback country has exactly one', () => {
    const allowed = allowedContext({ role: 'Manager', country: ['Egypt'], sites: ['ALL'] }, all())
    const r = normalizeContext({ country: 'KSA' }, allowed)
    expect(r.context).toEqual({ country: 'Egypt', region: null, site: 'CAIRO' })
  })

  it('keeps the country and clears the site when the site is no longer allowed', () => {
    const allowed = allowedContext({ role: 'Manager', country: ['KSA'], sites: ['NHC'] }, all())
    const r = normalizeContext({ country: 'KSA', region: 'WESTERN', site: 'DHAHBAN' }, allowed)
    expect(r).toMatchObject({ changed: true, reason: 'site_unavailable' })
    expect(r.context).toEqual({ country: 'KSA', region: null, site: null })
  })

  it('clears a region that does not exist on the saved country', () => {
    const r = normalizeContext({ country: 'UAE', region: 'CENTRAL', site: null }, all())
    expect(r).toMatchObject({ changed: true, reason: 'region_unavailable' })
    expect(r.context).toEqual({ country: 'UAE', region: null, site: null })
  })

  it('accepts a region-only context that does exist', () => {
    const r = normalizeContext({ country: 'KSA', region: 'western', site: null }, all())
    expect(r).toMatchObject({ changed: false, reason: null })
    expect(r.context).toEqual({ country: 'KSA', region: 'WESTERN', site: null })
  })

  it('reports no access rather than inventing a place', () => {
    const r = normalizeContext({ country: 'KSA' }, [])
    expect(r).toMatchObject({ changed: true, reason: 'no_access' })
    expect(r.context).toEqual(EMPTY_CONTEXT)
  })
})

describe('canSwitchContext / contextLeafCount', () => {
  it('counts a country with no known sites as one place', () => {
    const t = buildContextTree([{ name: '', country: 'KSA', region: '' }])
    expect(contextLeafCount(t)).toBe(1)
    expect(canSwitchContext(t)).toBe(false)
  })

  it('is false for a user with exactly one site in one country', () => {
    const allowed = allowedContext(
      { role: 'Manager', country: ['KSA'], sites: ['NHC'] }, tree(),
    )
    expect(contextLeafCount(allowed)).toBe(1)
    expect(canSwitchContext(allowed)).toBe(false)
  })

  it('is true for one country with several sites, and for several countries', () => {
    expect(canSwitchContext(allowedContext(
      { role: 'Manager', country: ['UAE'], sites: ['ALL'] }, tree(),
    ))).toBe(true)
    expect(canSwitchContext(tree())).toBe(true)
  })

  it('is false when nothing is allowed', () => {
    expect(canSwitchContext([])).toBe(false)
    expect(canSwitchContext(null)).toBe(false)
  })
})

describe('labels and the legacy bridge value', () => {
  it('names the site first, then the country', () => {
    expect(contextLabel({ country: 'KSA', region: 'CENTRAL', site: 'QIDDIYA-UPPER PLATEAU' }))
      .toBe('QIDDIYA-UPPER PLATEAU - KSA')
    expect(contextLabel({ country: 'KSA', region: 'WESTERN', site: null })).toBe('WESTERN - KSA')
    expect(contextLabel({ country: 'KSA' })).toBe('KSA')
    expect(contextLabel(EMPTY_CONTEXT)).toBe('All countries')
  })

  it('shortens to the most specific single token', () => {
    expect(contextShortLabel({ country: 'KSA', region: 'CENTRAL', site: 'NHC' })).toBe('NHC')
    expect(contextShortLabel({ country: 'KSA', region: 'CENTRAL' })).toBe('CENTRAL')
    expect(contextShortLabel({ country: 'UAE' })).toBe('UAE')
    expect(contextShortLabel(EMPTY_CONTEXT)).toBe('All')
  })

  it('uses ASCII only - no em dash, en dash, middle dot or arrow', () => {
    const banned = /[–—·•→‘’“”]/
    const labels = [
      contextLabel({ country: 'KSA', region: 'CENTRAL', site: 'NHC' }),
      contextLabel({ country: 'Saudi Arabia' }),
      contextLabel(EMPTY_CONTEXT),
      contextShortLabel(EMPTY_CONTEXT),
    ]
    labels.forEach(l => expect(l).not.toMatch(banned))
  })

  it('maps a context to the legacy activeCountry value', () => {
    expect(contextToCountry({ country: 'KSA', site: 'NHC' })).toBe('KSA')
    expect(contextToCountry({ country: 'Saudi Arabia' })).toBe('KSA')
    expect(contextToCountry(EMPTY_CONTEXT)).toBe('All')
    expect(contextToCountry(null)).toBe('All')
    expect(contextToCountry({ country: '   ' })).toBe('All')
  })
})
