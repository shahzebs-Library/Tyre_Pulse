import { describe, it, expect } from 'vitest'
import { pageSlice, clampPage, ageText, whenText } from '../console/pages/platformOps/paging'
import { latestRisk, gateImpact, behindLatest } from '../console/pages/mobileApp/releaseGuard'
import { gateRisk } from '../lib/mobileOps'

describe('platformOps paging', () => {
  it('slices a page and reports 1-based bounds', () => {
    const rows = Array.from({ length: 53 }, (_, i) => i)
    const p = pageSlice(rows, 3, 25)
    expect(p.rows).toEqual([50, 51, 52])
    expect(p).toMatchObject({ page: 3, pages: 3, total: 53, start: 51, end: 53 })
  })
  it('clamps an out-of-range page instead of showing an empty page', () => {
    expect(pageSlice([1, 2, 3], 9, 2).page).toBe(2)
    expect(clampPage(0, 10, 5)).toBe(1)
  })
  it('says 0 of 0 for an empty list', () => {
    expect(pageSlice([], 1, 10)).toMatchObject({ total: 0, start: 0, end: 0, pages: 1 })
    expect(pageSlice(null, 1, 10).rows).toEqual([])
  })
  it('never prints NaN ages', () => {
    const now = Date.parse('2026-09-26T12:00:00Z')
    expect(ageText(null, now)).toBeNull()
    expect(ageText('junk', now)).toBeNull()
    expect(ageText('2026-09-26T11:59:40Z', now)).toBe('just now')
    expect(ageText('2026-09-26T11:50:00Z', now)).toBe('10 min ago')
    expect(ageText('2026-09-24T12:00:00Z', now)).toBe('2 days ago')
    expect(whenText('junk')).toBe('N/A')
  })
})

describe('mobile release interlock', () => {
  it('refuses recording a release below the saved minimum (would strand the gate)', () => {
    expect(latestRisk('1.5.0', '1.6.0', '1.6.0').level).toBe('blocked')
  })
  it('refuses junk and blank releases', () => {
    expect(latestRisk('', null, null).level).toBe('blocked')
    expect(latestRisk('v1.x', null, null).level).toBe('blocked')
  })
  it('warns (not blocks) when recording an older release than on record', () => {
    expect(latestRisk('1.5.0', '', '1.6.0').level).toBe('warn')
  })
  it('clears a normal new release', () => {
    expect(latestRisk('1.7.0', '1.6.0', '1.6.0').level).toBe('clear')
  })
  it('the gate is still refused above the SAVED latest release', () => {
    expect(gateRisk('1.7.0', '1.6.0').level).toBe('blocked')
    expect(gateRisk('1.6.0', '1.6.0').level).toBe('clear')
  })
})

describe('gate impact', () => {
  const rows = [
    { app_version: '1.6.0', devices: 120 },
    { app_version: '1.3.2', devices: 7 },
    { app_version: '1.5.0', devices: 1 },
    { app_version: null, devices: 2 },
  ]
  it('counts devices a proposed minimum would put behind the update wall', () => {
    expect(gateImpact('1.6.0', rows)).toEqual({ behind: 8, ok: 120, unknown: 2, total: 130, gated: true })
  })
  it('an off gate blocks nobody', () => {
    expect(gateImpact('', rows)).toMatchObject({ behind: 0, gated: false })
  })
  it('compares numerically, not as text', () => {
    expect(gateImpact('1.10.0', [{ app_version: '1.9.0', devices: 3 }]).behind).toBe(3)
  })
  it('behindLatest is null without a recorded release', () => {
    expect(behindLatest('', rows)).toBeNull()
    expect(behindLatest('1.6.0', rows)).toBe(8)
  })
})

import { contrastRatio, auditPalette, isLightBackground } from '../console/pages/appearance/paletteCheck'

describe('report palette check', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('bad', '#ffffff')).toBeNull()
  })
  it('flags colours too pale for a white page and near-identical pairs', () => {
    const r = auditPalette(['#1d4ed8', '#fef08a', '#1d4ed9'])
    expect(r.weak.map((w) => w.index)).toEqual([1])
    expect(r.duplicates).toEqual([[0, 2]])
    expect(r.checked).toBe(3)
  })
  it('treats a light diagram background as unsafe for light labels', () => {
    expect(isLightBackground('#ffffff')).toBe(true)
    expect(isLightBackground('#000000')).toBe(false)
    expect(isLightBackground('nope')).toBe(false)
  })
})

import { navChanges } from '../console/pages/navigation/navDiff'

describe('navigation changes from default', () => {
  const defaults = [
    { key: 'a', label: 'A', defaultLabel: 'A', hidden: false, items: [{ key: 'x', label: 'X', hidden: false }, { key: 'y', label: 'Y', hidden: false }] },
    { key: 'b', label: 'B', defaultLabel: 'B', hidden: false, items: [{ key: 'z', label: 'Z', hidden: false }] },
  ]
  it('reports nothing for the default model', () => {
    expect(navChanges(defaults, defaults)).toEqual([])
  })
  it('reports renames, hides, moves and reorders', () => {
    const model = [
      { key: 'b', label: 'Bee', defaultLabel: 'B', hidden: true, items: [{ key: 'z', label: 'Z', hidden: false }, { key: 'x', label: 'X', hidden: true }] },
      { key: 'a', label: 'A', defaultLabel: 'A', hidden: false, items: [{ key: 'y', label: 'Y', hidden: false }] },
    ]
    const kinds = navChanges(defaults, model).map((c) => `${c.kind}:${c.target}`)
    expect(kinds).toEqual(expect.arrayContaining(['Renamed:B', 'Hidden:Bee', 'Reordered:Bee', 'Hidden:X', 'Moved:X', 'Reordered:A', 'Reordered:Y']))
  })
})
