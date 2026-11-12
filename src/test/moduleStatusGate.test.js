import { describe, it, expect } from 'vitest'
import { pathModuleStatus, isPathSwitchedOff } from '../lib/navAccess'
import { isCommandVisible } from '../lib/commandSearch'

const statusOf = (map) => (key) => map[key] || 'live'

describe('Module Control reaches every route', () => {
  it('reads live for an unknown key and when no reader is supplied', () => {
    expect(pathModuleStatus('/gps-tracking', statusOf({})).status).toBe('live')
    expect(pathModuleStatus('/gps-tracking', undefined).status).toBe('live')
  })

  it('switches off a page that has no curated key, by its route slug', () => {
    const s = statusOf({ gps_tracking: 'disabled' })
    expect(isPathSwitchedOff('/gps-tracking', s)).toBe(true)
    expect(isPathSwitchedOff('/trips', s)).toBe(false)
  })

  it('switches off a page through its curated module key', () => {
    expect(isPathSwitchedOff('/pm-programs', statusOf({ pm_programs: 'disabled' }))).toBe(true)
  })

  it('lets one page go off on its own slug without touching siblings on a shared key', () => {
    const s = statusOf({ analytics: 'live', brand_perf: 'disabled' })
    expect(isPathSwitchedOff('/brand-perf', s)).toBe(true)
    expect(isPathSwitchedOff('/analytics', s)).toBe(false)
  })

  it('reports maintenance but does not treat it as switched off', () => {
    const r = pathModuleStatus('/trips', statusOf({ trips: 'maintenance' }))
    expect(r).toEqual({ status: 'maintenance', key: 'trips' })
    expect(isPathSwitchedOff('/trips', statusOf({ trips: 'maintenance' }))).toBe(false)
  })

  it('never gates Settings, so nobody can be locked out', () => {
    expect(isPathSwitchedOff('/settings', statusOf({ settings: 'disabled' }))).toBe(false)
  })

  it('drops a switched-off module from search, admins included', () => {
    const admin = { role: 'Admin' }
    const cmd = { path: '/gps-tracking' }
    const allow = () => true
    expect(isCommandVisible(cmd, admin, allow, new Set(), true, statusOf({}))).toBe(true)
    expect(isCommandVisible(cmd, admin, allow, new Set(), true, statusOf({ gps_tracking: 'disabled' }))).toBe(false)
  })
})
