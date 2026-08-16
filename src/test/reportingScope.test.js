/**
 * Reporting scope - which countries an analytics surface aggregates over. A
 * DIFFERENT concept from the working context: it may span countries, and a scope
 * that resolves to nothing must never read as "all".
 */
import { describe, it, expect } from 'vitest'
import { buildContextTree } from '../lib/workingContext'
import {
  SCOPE_ALL,
  EMPTY_SCOPE,
  allowedScopeCountries,
  normalizeScope,
  scopeLabel,
  scopeCountries,
} from '../lib/reportingScope'

const ROWS = [
  { name: 'NHC', country: 'KSA', region: 'CENTRAL' },
  { name: 'DHAHBAN', country: 'KSA', region: 'WESTERN' },
  { name: 'RIY-MET', country: 'Saudi Arabia', region: 'CENTRAL' },
  { name: 'JEBEL ALI', country: 'UAE', region: null },
  { name: 'CAIRO', country: 'Egypt', region: null },
]
const tree = () => buildContextTree(ROWS)
const ALL3 = ['Egypt', 'KSA', 'UAE']

describe('allowedScopeCountries', () => {
  it('gives an admin every country, folding the alias', () => {
    expect(allowedScopeCountries({ role: 'Admin' }, tree())).toEqual(ALL3)
  })

  it('gives the three-country user all three', () => {
    const p = { role: 'Manager', country: ['KSA', 'UAE', 'Egypt'], sites: ['ALL'] }
    expect(allowedScopeCountries(p, tree())).toEqual(ALL3)
  })

  it('limits a single-country user to their own country', () => {
    const p = { role: 'Director', country: ['Egypt'], sites: ['ALL'] }
    expect(allowedScopeCountries(p, tree())).toEqual(['Egypt'])
  })
})

describe('scopeCountries', () => {
  it('expands the ALL sentinel to every allowed country', () => {
    expect(scopeCountries({ countries: [SCOPE_ALL] }, ALL3)).toEqual(ALL3)
  })

  it('keeps a multi-select in the caller order, canonically spelled', () => {
    expect(scopeCountries({ countries: ['uae', ' egypt '] }, ALL3)).toEqual(['UAE', 'Egypt'])
  })

  it('drops a country the user may not see (persisted state is never trusted)', () => {
    expect(scopeCountries({ countries: ['KSA', 'UAE'] }, ['KSA'])).toEqual(['KSA'])
  })

  it('de-duplicates repeated entries', () => {
    expect(scopeCountries({ countries: ['KSA', 'ksa'] }, ALL3)).toEqual(['KSA'])
  })

  it('resolves an empty scope to nothing, never to all', () => {
    expect(scopeCountries(EMPTY_SCOPE, ALL3)).toEqual([])
    expect(scopeCountries(null, ALL3)).toEqual([])
    expect(scopeCountries({ countries: ['Nowhere'] }, ALL3)).toEqual([])
  })

  it('tolerates a bare array or string', () => {
    expect(scopeCountries(['KSA'], ALL3)).toEqual(['KSA'])
    expect(scopeCountries('Egypt', ALL3)).toEqual(['Egypt'])
  })
})

describe('scopeLabel', () => {
  it('says All countries only when the scope really covers every allowed one', () => {
    expect(scopeLabel({ countries: [SCOPE_ALL] }, ALL3)).toBe('All countries')
    expect(scopeLabel({ countries: ALL3 }, ALL3)).toBe('All countries')
  })

  it('names a single country instead of calling it all', () => {
    expect(scopeLabel({ countries: ['KSA'] }, ALL3)).toBe('KSA')
    expect(scopeLabel({ countries: [SCOPE_ALL] }, ['Egypt'])).toBe('Egypt')
  })

  it('counts a partial multi-select', () => {
    expect(scopeLabel({ countries: ['KSA', 'UAE'] }, ALL3)).toBe('2 countries')
  })

  it('is honest about an empty scope', () => {
    expect(scopeLabel(EMPTY_SCOPE, ALL3)).toBe('No countries')
    expect(scopeLabel({ countries: ['KSA'] }, [])).toBe('No countries')
  })

  it('uses ASCII only', () => {
    const banned = /[–—·•→‘’“”]/
    ;[
      scopeLabel({ countries: [SCOPE_ALL] }, ALL3),
      scopeLabel({ countries: ['KSA', 'UAE'] }, ALL3),
      scopeLabel(EMPTY_SCOPE, ALL3),
    ].forEach(l => expect(l).not.toMatch(banned))
  })
})

describe('normalizeScope', () => {
  it('leaves a valid ALL scope alone', () => {
    expect(normalizeScope({ countries: [SCOPE_ALL] }, ALL3))
      .toEqual({ scope: { countries: [SCOPE_ALL] }, changed: false, reason: null })
  })

  it('leaves a valid explicit scope alone', () => {
    expect(normalizeScope({ countries: ['KSA', 'UAE'] }, ALL3))
      .toEqual({ scope: { countries: ['KSA', 'UAE'] }, changed: false, reason: null })
  })

  it('drops disallowed entries and says so', () => {
    const r = normalizeScope({ countries: ['KSA', 'UAE'] }, ['KSA'])
    expect(r).toEqual({ scope: { countries: ['KSA'] }, changed: true, reason: 'countries_unavailable' })
  })

  it('falls back to ALL when nothing usable was saved and several are allowed', () => {
    expect(normalizeScope(null, ALL3))
      .toEqual({ scope: { countries: [SCOPE_ALL] }, changed: true, reason: 'initial' })
    expect(normalizeScope(EMPTY_SCOPE, ALL3).scope).toEqual({ countries: [SCOPE_ALL] })
  })

  it('falls back to the single allowed country rather than the ALL sentinel', () => {
    expect(normalizeScope(null, ['Egypt']).scope).toEqual({ countries: ['Egypt'] })
    expect(normalizeScope({ countries: [SCOPE_ALL] }, ['Egypt']))
      .toEqual({ scope: { countries: ['Egypt'] }, changed: true, reason: null })
  })

  it('reports no access rather than pretending to cover everything', () => {
    expect(normalizeScope({ countries: [SCOPE_ALL] }, []))
      .toEqual({ scope: { countries: [] }, changed: true, reason: 'no_access' })
  })

  it('replaces a wholly disallowed scope with the default', () => {
    const r = normalizeScope({ countries: ['Nowhere'] }, ALL3)
    expect(r).toEqual({
      scope: { countries: [SCOPE_ALL] }, changed: true, reason: 'countries_unavailable',
    })
  })

  it('is idempotent (its own output normalizes to itself unchanged)', () => {
    ;[ALL3, ['Egypt'], ['KSA', 'UAE']].forEach((allowed) => {
      const once = normalizeScope(null, allowed).scope
      expect(normalizeScope(once, allowed)).toEqual({ scope: once, changed: false, reason: null })
    })
  })
})
