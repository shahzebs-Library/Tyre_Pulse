/**
 * The Platform Map's promise is TRANSPARENCY: everything the platform has,
 * described in plain English, plus an honest gap list. These tests make that
 * promise structural:
 *  - every console page in the REAL sidebar must carry a description, so a
 *    new page cannot ship invisible to the owner
 *  - every stated gap must say who can move it forward
 */
import { describe, it, expect } from 'vitest'
import {
  CONSOLE_DESCRIPTIONS, NOT_BUILT, consoleSections, undescribedConsoleRoutes,
  webSections, mobileSections, filterSections, platformCounts,
} from '../lib/platformMap'
import { CONSOLE_NAV } from '../console/components/ConsoleLayout'
import { MOBILE_MODULES } from '../lib/mobileModules'

describe('console coverage - the map cannot drift from the sidebar', () => {
  it('every console nav route has a plain-English description', () => {
    // A new console page without a description here is a page the owner
    // cannot understand from the map - the whole point of the page.
    expect(undescribedConsoleRoutes(CONSOLE_NAV)).toEqual([])
  })

  it('descriptions are sentences, not labels repeated', () => {
    Object.entries(CONSOLE_DESCRIPTIONS).forEach(([route, what]) => {
      expect(what.length, route).toBeGreaterThan(20)
    })
  })

  it('consoleSections merges nav + descriptions', () => {
    const secs = consoleSections(CONSOLE_NAV)
    const flat = secs.flatMap((s) => s.items)
    expect(flat.length).toBeGreaterThan(30)
    expect(flat.every((i) => i.what)).toBe(true)
  })
})

describe('the honest gap list', () => {
  it('every gap names who can move it: you / customer file / build', () => {
    expect(NOT_BUILT.length).toBeGreaterThan(0)
    NOT_BUILT.forEach((g) => {
      expect(['you', 'customer file', 'build']).toContain(g.who)
      expect(g.title.length).toBeGreaterThan(3)
      expect(g.what.length).toBeGreaterThan(30)
    })
  })
})

describe('shaping + search', () => {
  it('mobileSections groups the real registry and states who a module opens to', () => {
    const secs = mobileSections(MOBILE_MODULES)
    expect(secs.length).toBeGreaterThan(2)
    const flat = secs.flatMap((s) => s.items)
    expect(flat.length).toBe(MOBILE_MODULES.length)
    // An empty roles list is honest: admins only, grantable per person.
    const restricted = flat.find((i) => i.openTo.includes('admins only'))
    expect(restricted).toBeTruthy()
  })

  it('filterSections matches labels AND descriptions, and drops empty groups', () => {
    const secs = consoleSections(CONSOLE_NAV)
    const hits = filterSections(secs, 'duplicate')
    expect(hits.length).toBeGreaterThan(0)
    expect(filterSections(secs, 'zzz-no-such-thing')).toEqual([])
    // blank term returns everything untouched
    expect(filterSections(secs, '')).toBe(secs)
  })

  it('platformCounts totals every surface', () => {
    const c = platformCounts({ consoleNav: CONSOLE_NAV, navCatalog: [{ label: 'G', items: [{ label: 'A' }] }], mobileModules: MOBILE_MODULES })
    expect(c.consolePages).toBeGreaterThan(30)
    expect(c.webAreas).toBe(1)
    expect(c.mobileModules).toBe(MOBILE_MODULES.length)
    expect(c.gaps).toBe(NOT_BUILT.length)
  })
})
