/**
 * Who signs, and the trap that made it not matter.
 *
 * normaliseRole silently turns any role it does not know into 'reporter'. Every
 * supervisory role was missing from it, so the PMV Manager and the Workshop
 * Maintenance Area Manager - two real people - were seen by the phone as
 * reporters, and V599's Workshop Supervisor could not have opened a checklist at
 * all. Tightening WHO SIGNS would have been meaningless while the phone could
 * not tell any of them apart from a reporter.
 */
import { normaliseRole } from '../lib/types'
import { MODULE_BY_KEY, moduleAllowedByRole, SUPERVISOR_ROLES } from '../lib/permissions'

describe('the phone can tell the supervisory roles apart', () => {
  const cases: Array<[string, string]> = [
    ['PMV Manager', 'pmv_manager'],
    ['Workshop Area Manager', 'workshop_area_manager'],
    ['Workshop Maintenance Area Manager', 'workshop_maintenance_area_manager'],
    ['Maintenance Supervisor', 'maintenance_supervisor'],
    ['Workshop Supervisor', 'workshop_supervisor'],
  ]
  for (const [dbRole, expected] of cases) {
    it(`${dbRole} is not silently a reporter`, () => {
      expect(normaliseRole(dbRole)).toBe(expected)
    })
  }

  it('an unknown role still falls back, which is why the list matters', () => {
    expect(normaliseRole('Some Role Nobody Added')).toBe('reporter')
  })
})

describe('who may reach an approvals queue', () => {
  it('every supervisory role can', () => {
    for (const role of SUPERVISOR_ROLES) {
      expect(moduleAllowedByRole('approvals', role)).toBe(true)
    }
  })

  it('a Manager cannot - that is the tightening', () => {
    expect(moduleAllowedByRole('approvals', 'manager')).toBe(false)
  })

  it('a Director still can, and only because of the final checklist rung', () => {
    // Exactly one person holds an area-manager role. A closing rung nobody else
    // can reach jams the moment they take leave.
    expect(moduleAllowedByRole('approvals', 'director')).toBe(true)
  })

  it('a tradesman or a field role cannot', () => {
    for (const role of ['mechanic', 'electrician', 'driver', 'tyre_man', 'reporter', 'inspector'] as const) {
      expect(moduleAllowedByRole('approvals', role)).toBe(false)
    }
  })

  it('a tyre data collector can access approvals', () => {
    expect(moduleAllowedByRole('approvals', 'tyre_data_collector')).toBe(true)
  })
})

describe('nothing was taken away from the two real people affected', () => {
  // Both were treated as reporters before, so they must keep everything a
  // reporter had - otherwise "recognising the role" is a downgrade.
  const REPORTER_HAD = ['serial', 'meter', 'reportIssue', 'calendar'] as const

  for (const key of REPORTER_HAD) {
    it(`${key} still opens for every supervisory role`, () => {
      expect(moduleAllowedByRole(key, 'reporter')).toBe(true)
      for (const role of SUPERVISOR_ROLES) {
        expect(moduleAllowedByRole(key, role)).toBe(true)
      }
    })
  }

  it('and they gained the checklists they supervise', () => {
    for (const role of SUPERVISOR_ROLES) {
      expect(moduleAllowedByRole('checklists', role)).toBe(true)
    }
  })
})

describe('the registry stays honest', () => {
  it('approvals lists its roles literally, not through a spread', () => {
    // The web mirror guard parses this file as TEXT; a spread reads as the
    // literal characters "...SUPERVISOR_ROLES" and the two stacks then look
    // like they disagree when they do not.
    expect(MODULE_BY_KEY.approvals.roles).not.toContain('...SUPERVISOR_ROLES')
    expect(MODULE_BY_KEY.approvals.roles.length).toBeGreaterThan(5)
  })
})
