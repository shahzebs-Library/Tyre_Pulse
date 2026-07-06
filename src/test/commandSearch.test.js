import { describe, it, expect } from 'vitest'
import {
  NAV_COMMANDS,
  ACTION_COMMANDS,
  RECORD_SOURCES,
  isCommandVisible,
  visibleCommands,
  visibleRecordSources,
  scoreCommand,
  rankCommands,
  buildOrClause,
  mapRecordRows,
} from '../lib/commandSearch'

const admin = { role: 'Admin' }
const manager = { role: 'Manager' }
const inspector = { role: 'Inspector' }
const tyreMan = { role: 'Tyre Man' }
const allowAll = () => true
const denyAll = () => false

// ─────────────────────────────────────────────────────────────────────────────
// RBAC visibility - must mirror Layout.jsx shouldShowNavItem + App.jsx ModuleRoute
// ─────────────────────────────────────────────────────────────────────────────
describe('isCommandVisible', () => {
  it('hides everything when there is no profile', () => {
    expect(isCommandVisible({ path: '/tyres' }, null, allowAll)).toBe(false)
    expect(isCommandVisible({ path: '/tyres' }, undefined, allowAll)).toBe(false)
  })

  it('Inspector only sees /inspections and /settings', () => {
    expect(isCommandVisible({ path: '/inspections' }, inspector, allowAll)).toBe(true)
    expect(isCommandVisible({ path: '/settings' }, inspector, allowAll)).toBe(true)
    expect(isCommandVisible({ path: '/tyres' }, inspector, allowAll)).toBe(false)
    expect(isCommandVisible({ path: '/audit', adminOnly: true }, inspector, allowAll)).toBe(false)
  })

  it('adminOnly commands are hidden from non-Admin roles', () => {
    const cmd = { path: '/audit', adminOnly: true }
    expect(isCommandVisible(cmd, admin, allowAll)).toBe(true)
    expect(isCommandVisible(cmd, manager, allowAll)).toBe(false)
    expect(isCommandVisible(cmd, tyreMan, allowAll)).toBe(false)
  })

  it('roles-restricted commands require role membership', () => {
    const cmd = { path: '/analytics', roles: ['Admin', 'Manager', 'Director'] }
    expect(isCommandVisible(cmd, manager, allowAll)).toBe(true)
    expect(isCommandVisible(cmd, tyreMan, allowAll)).toBe(false)
  })

  it('moduleKey commands are gated through hasPermission', () => {
    const cmd = { path: '/analytics', roles: ['Admin', 'Manager', 'Director'], moduleKey: 'analytics' }
    expect(isCommandVisible(cmd, manager, allowAll)).toBe(true)
    expect(isCommandVisible(cmd, manager, denyAll)).toBe(false)
  })

  it('ungated commands are visible to any non-Inspector role', () => {
    expect(isCommandVisible({ path: '/tyres' }, tyreMan, denyAll)).toBe(true)
    expect(isCommandVisible({ path: '/tyres' }, manager, denyAll)).toBe(true)
  })
})

describe('visibleCommands', () => {
  it('Admin with full permissions sees the whole registry', () => {
    expect(visibleCommands(NAV_COMMANDS, admin, allowAll)).toHaveLength(NAV_COMMANDS.length)
  })

  it('Manager never sees adminOnly entries', () => {
    const visible = visibleCommands(NAV_COMMANDS, manager, allowAll)
    expect(visible.some((c) => c.adminOnly)).toBe(false)
    expect(visible.some((c) => c.path === '/tyres')).toBe(true)
  })

  it('Inspector sees only the inspection surface', () => {
    const visible = visibleCommands([...NAV_COMMANDS, ...ACTION_COMMANDS], inspector, allowAll)
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.every((c) => c.path === '/inspections' || c.path === '/settings')).toBe(true)
  })
})

describe('visibleRecordSources', () => {
  it('Admin searches all record sources', () => {
    expect(visibleRecordSources(RECORD_SOURCES, admin, allowAll)).toHaveLength(RECORD_SOURCES.length)
  })

  it('non-admin roles do not search admin-only entities (suppliers, drivers)', () => {
    const ids = visibleRecordSources(RECORD_SOURCES, manager, allowAll).map((s) => s.id)
    expect(ids).not.toContain('suppliers')
    expect(ids).not.toContain('drivers')
    expect(ids).toContain('vehicles')
    expect(ids).toContain('tyres')
  })

  it('Inspector only searches inspections', () => {
    const ids = visibleRecordSources(RECORD_SOURCES, inspector, allowAll).map((s) => s.id)
    expect(ids).toEqual(['inspections'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Ranking
// ─────────────────────────────────────────────────────────────────────────────
describe('scoreCommand / rankCommands', () => {
  const cmds = [
    { id: 'a', label: 'Dashboard', path: '/' },
    { id: 'b', label: 'Fleet Analytics', path: '/fleet' },
    { id: 'c', label: 'Fleet Master', path: '/fleet-master' },
    { id: 'd', label: 'Live Fleet Status', path: '/live-fleet' },
    { id: 'e', label: 'Settings', path: '/settings', keywords: ['preferences'] },
  ]

  it('returns 0 for empty or non-matching queries', () => {
    expect(scoreCommand(cmds[0], '')).toBe(0)
    expect(scoreCommand(cmds[0], '   ')).toBe(0)
    expect(scoreCommand(cmds[0], 'zzz')).toBe(0)
  })

  it('prefers exact match over prefix over word-prefix over substring', () => {
    const exact = scoreCommand({ label: 'Fleet', path: '/x' }, 'fleet')
    const prefix = scoreCommand(cmds[1], 'fleet')       // label starts with query
    const wordPrefix = scoreCommand(cmds[3], 'fleet')   // "Live Fleet Status"
    const substring = scoreCommand({ label: 'Refleeting', path: '/x' }, 'fleet')
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(wordPrefix)
    expect(wordPrefix).toBeGreaterThan(substring)
  })

  it('is case-insensitive', () => {
    expect(scoreCommand(cmds[1], 'FLEET')).toBe(scoreCommand(cmds[1], 'fleet'))
  })

  it('matches on path and keywords as weakest signals', () => {
    expect(scoreCommand(cmds[2], '/fleet-master')).toBeGreaterThan(0)
    expect(scoreCommand(cmds[4], 'preferences')).toBeGreaterThan(0)
  })

  it('rankCommands sorts by score, is stable, and respects the limit', () => {
    const ranked = rankCommands(cmds, 'fleet')
    expect(ranked[0].id).toBe('b') // prefix beats word-prefix
    expect(ranked.map((c) => c.id)).toContain('c')
    expect(ranked.map((c) => c.id)).not.toContain('a')
    expect(rankCommands(cmds, 'fleet', 1)).toHaveLength(1)
    expect(rankCommands(cmds, '')).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Query building + record mapping
// ─────────────────────────────────────────────────────────────────────────────
describe('buildOrClause', () => {
  it('builds an ilike or-clause across fields', () => {
    expect(buildOrClause(['asset_no', 'make'], 'volvo'))
      .toBe('asset_no.ilike.%volvo%,make.ilike.%volvo%')
  })

  it('strips PostgREST-breaking characters (commas, parens, backslash, star)', () => {
    expect(buildOrClause(['name'], 'ab,c(d)\\*e')).toBe('name.ilike.%abcde%')
  })

  it('returns null when the sanitized term is too short', () => {
    expect(buildOrClause(['name'], 'a')).toBeNull()
    expect(buildOrClause(['name'], ',,(')).toBeNull()
    expect(buildOrClause(['name'], null)).toBeNull()
  })
})

describe('mapRecordRows', () => {
  const source = (id) => RECORD_SOURCES.find((s) => s.id === id)

  it('vehicle rows deep-link to /vehicle/:assetNo (URL-encoded)', () => {
    const [item] = mapRecordRows(source('vehicles'), [
      { id: 7, asset_no: 'TRK 001', make: 'Volvo', model: 'FH16', site: 'Muscat' },
    ])
    expect(item.path).toBe('/vehicle/TRK%20001')
    expect(item.label).toBe('TRK 001')
    expect(item.sub).toBe('Volvo · FH16 · Muscat')
    expect(item.id).toBe('vehicles-7')
  })

  it('vehicle rows without asset_no fall back to the fleet page', () => {
    const [item] = mapRecordRows(source('vehicles'), [{ id: 8, make: 'MAN' }])
    expect(item.path).toBe('/fleet-master')
  })

  it('tyre, supplier, driver and inspection rows map to their module pages', () => {
    expect(mapRecordRows(source('tyres'), [{ id: 1, serial_no: 'SN1', brand: 'Michelin' }])[0].path).toBe('/tyres')
    expect(mapRecordRows(source('suppliers'), [{ id: 2, supplier_name: 'Acme', supplier_code: 'AC1' }])[0].path).toBe('/suppliers')
    expect(mapRecordRows(source('drivers'), [{ id: 3, driver_id: 'D9', driver_name: 'Ali' }])[0].path).toBe('/driver-management')
    expect(mapRecordRows(source('inspections'), [{ id: 4, asset_no: 'TRK9' }])[0].path).toBe('/inspections')
  })

  it('handles null/empty row sets', () => {
    expect(mapRecordRows(source('tyres'), null)).toEqual([])
    expect(mapRecordRows(source('tyres'), [])).toEqual([])
  })
})
