/**
 * Admin surfaces are admin only. No leakage.
 *
 * The Admin Console used to admit Manager and Director. It links straight to
 * User Management, the Access Manager and admin approvals - all of which gate
 * on isAdmin internally - and to Analytics and Reports, which are admin-only
 * MODULES. So a Manager who opened it got a console where most doors refused
 * them, and the refusals looked like the app was broken rather than like a
 * permission boundary.
 *
 * Nothing they can use was lost: Manager and Director keep the Accident
 * Dashboard, which they reach directly from Home.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { MODULE_BY_KEY, moduleAllowedByRole } from '../lib/permissions'

const ADMIN_ONLY = ['admin', 'users'] as const
const NON_ADMIN_ROLES = [
  'manager', 'director', 'inspector', 'tyre_man', 'reporter',
  'driver', 'mechanic', 'electrician', 'tyre_data_collector',
] as const

describe('admin modules admit nobody but admin', () => {
  for (const key of ADMIN_ONLY) {
    it(`${key} lists no non-admin role`, () => {
      expect(MODULE_BY_KEY[key].roles).toEqual([])
    })

    for (const role of NON_ADMIN_ROLES) {
      it(`${key} refuses ${role}`, () => {
        expect(moduleAllowedByRole(key, role as never)).toBe(false)
      })
    }
  }

  it('admin itself still passes, or the console is unreachable by anyone', () => {
    for (const key of ADMIN_ONLY) {
      expect(moduleAllowedByRole(key, 'admin' as never)).toBe(true)
    }
  })
})

describe('the console never offers a door that refuses the opener', () => {
  const src = readFileSync(join(__dirname, '..', 'app', '(app)', 'admin', 'index.tsx'), 'utf8')

  it('gates the analytics and reports tiles on their own modules', () => {
    // Both are admin-only modules; an ungated tile here is a link to a refusal.
    expect(src).toContain("canAccess('analytics')")
    expect(src).toContain("canAccess('reports')")
  })

  it('keeps the sensitive destinations behind isAdmin', () => {
    for (const dest of ['/(app)/admin/users', '/(app)/admin/approvals']) {
      expect(src).toContain(dest)
    }
    expect(src).toMatch(/isAdmin\(profile\?\.role\)/)
  })
})

describe('what Manager and Director keep', () => {
  it('the accident dashboard, reached from Home rather than the console', () => {
    for (const role of ['manager', 'director'] as const) {
      expect(moduleAllowedByRole('accidents', role as never)).toBe(true)
    }
  })
})
