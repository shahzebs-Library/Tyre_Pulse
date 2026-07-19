import { describe, it, expect } from 'vitest'
import { isBuiltInRole, reduceRoleCounts, duplicateName } from '../lib/api/customRoles'
import { navItemAllowedForCustomRole, governingModuleKey, NAV_MODULE_KEY, ALWAYS_ALLOWED_PATHS } from '../lib/navAccess'

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

describe('customRoles — reduceRoleCounts (assigned-user awareness)', () => {
  it('counts profile rows per requested role name', () => {
    const rows = [
      { role: 'Yard Supervisor' }, { role: 'Yard Supervisor' }, { role: 'Claims Reviewer' },
    ]
    expect(reduceRoleCounts(rows, ['Yard Supervisor', 'Claims Reviewer'])).toEqual({
      'Yard Supervisor': 2, 'Claims Reviewer': 1,
    })
  })

  it('seeds every requested name with an honest 0 when no users are assigned', () => {
    expect(reduceRoleCounts([], ['Yard Supervisor', 'Night Shift'])).toEqual({
      'Yard Supervisor': 0, 'Night Shift': 0,
    })
  })

  it('ignores rows whose role was not requested and malformed rows', () => {
    const rows = [{ role: 'Admin' }, { role: null }, {}, null, { role: 'Yard Supervisor' }]
    expect(reduceRoleCounts(rows, ['Yard Supervisor'])).toEqual({ 'Yard Supervisor': 1 })
  })

  it('is safe on empty or missing inputs', () => {
    expect(reduceRoleCounts(null, null)).toEqual({})
    expect(reduceRoleCounts(undefined, [])).toEqual({})
    expect(reduceRoleCounts([], ['', null, 'A'])).toEqual({ A: 0 })
  })

  it('does not count prototype-polluting role names via inherited keys', () => {
    expect(reduceRoleCounts([{ role: 'toString' }, { role: 'constructor' }], ['A'])).toEqual({ A: 0 })
  })
})

describe('customRoles — duplicateName (per-row Duplicate action)', () => {
  it('appends " copy" to the source name', () => {
    expect(duplicateName('Yard Supervisor', [])).toBe('Yard Supervisor copy')
  })

  it('bumps a numeric suffix until the name is free (case-insensitive)', () => {
    const existing = ['Yard Supervisor', 'yard supervisor COPY', 'Yard Supervisor copy 2']
    expect(duplicateName('Yard Supervisor', existing)).toBe('Yard Supervisor copy 3')
  })

  it('never lands on a built-in role name', () => {
    // "Admin copy" is free, fine; but a contrived source cannot resolve to a built-in.
    expect(isBuiltInRole(duplicateName('Admin', []))).toBe(false)
  })

  it('trims and handles empty/odd input without throwing', () => {
    expect(duplicateName('  Spaced  ', [])).toBe('Spaced copy')
    expect(duplicateName('', [])).toBe('copy')
    expect(duplicateName('X', null)).toBe('X copy')
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

  it('hides unmapped paths for custom roles when the module is NOT granted', () => {
    expect(navItemAllowedForCustomRole('/some-unmapped-page', grant('accidents'))).toBe(false)
  })

  it('shows a specialty (unmapped) page when its slug module IS granted', () => {
    // Pages with no curated NAV_MODULE_KEY resolve to their route slug — the exact
    // key the Access Manager stores — so a grant on them now reaches the page.
    expect(navItemAllowedForCustomRole('/board-overview', grant('board_overview'))).toBe(true)
    expect(navItemAllowedForCustomRole('/roi-calculator', grant('roi_calculator'))).toBe(true)
    expect(navItemAllowedForCustomRole('/board-overview', grant('accidents'))).toBe(false)
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

describe('navAccess — governingModuleKey (route -> permission module)', () => {
  it('prefers the curated NAV_MODULE_KEY mapping', () => {
    expect(governingModuleKey('/')).toBe('dashboard')
    expect(governingModuleKey('/accidents')).toBe('accidents')
    expect(governingModuleKey('/tyres')).toBe('tyre_records')
  })

  it('slugs specialty routes with no curated mapping (matches stored keys)', () => {
    expect(governingModuleKey('/board-overview')).toBe('board_overview')
    expect(governingModuleKey('/roi-calculator')).toBe('roi_calculator')
    expect(governingModuleKey('/tyre-age-compliance')).toBe('tyre_age_compliance')
  })

  it('is stable on odd input', () => {
    expect(governingModuleKey('/')).toBe('dashboard')
    expect(governingModuleKey('')).toBe('root')
    expect(governingModuleKey(null)).toBe('root')
  })
})
