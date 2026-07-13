import { describe, it, expect } from 'vitest'
import { isBuiltInRole } from '../lib/api/customRoles'
import { navItemAllowedForCustomRole, NAV_MODULE_KEY, ALWAYS_ALLOWED_PATHS } from '../lib/navAccess'

describe('customRoles — isBuiltInRole', () => {
  it('flags built-in role names (case-insensitive)', () => {
    expect(isBuiltInRole('Admin')).toBe(true)
    expect(isBuiltInRole('admin')).toBe(true)
    expect(isBuiltInRole('Data Monitor Officer')).toBe(true) // now a built-in
    expect(isBuiltInRole('Maintenance Supervisor')).toBe(true)
  })
  it('allows genuinely custom names', () => {
    expect(isBuiltInRole('Yard Supervisor')).toBe(false)
    expect(isBuiltInRole('Claims Reviewer')).toBe(false)
    expect(isBuiltInRole('')).toBe(false)
  })
})

describe('navAccess — custom-role sidebar filter', () => {
  const grant = (...keys) => (k) => keys.includes(k)

  it('always allows Settings regardless of grants', () => {
    expect(navItemAllowedForCustomRole('/settings', grant())).toBe(true)
    expect(ALWAYS_ALLOWED_PATHS.has('/settings')).toBe(true)
  })

  it('shows a mapped item only when its module is granted', () => {
    const canAccidents = grant('accidents')
    expect(navItemAllowedForCustomRole('/accidents', canAccidents)).toBe(true)
    expect(navItemAllowedForCustomRole('/analytics', canAccidents)).toBe(false)
    expect(navItemAllowedForCustomRole('/tyres', grant('tyre_records'))).toBe(true)
  })

  it('hides unmapped paths for custom roles (restrictive by default)', () => {
    expect(navItemAllowedForCustomRole('/some-unmapped-page', grant('accidents'))).toBe(false)
  })

  it('maps the dashboard and known module paths', () => {
    expect(NAV_MODULE_KEY['/']).toBe('dashboard')
    expect(NAV_MODULE_KEY['/accidents']).toBe('accidents')
    expect(NAV_MODULE_KEY['/analytics']).toBe('analytics')
    expect(navItemAllowedForCustomRole('/', grant('dashboard'))).toBe(true)
  })

  it('is safe when no permission checker is provided', () => {
    expect(navItemAllowedForCustomRole('/accidents', undefined)).toBe(false)
    expect(navItemAllowedForCustomRole('/settings', undefined)).toBe(true)
  })
})
