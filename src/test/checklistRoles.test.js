import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CHECKLIST_TRADE_ROLES, CHECKLIST_OVERSIGHT_ROLES,
  normaliseRoleKey, templateRoleKeys, templateTargetsEveryone, isOversightRole,
  templateAllowsRole, filterTemplatesForRole,
  assignmentAllowsRole, filterAssignmentsForRole, roleTargetLabel,
} from '../lib/checklist/checklistRoles'

// The three published templates that exist live today. All carry
// assignee_roles NULL, which is the back-compat state this engine must honour.
const LIVE = [
  { name: 'Fleet Transit Mixer Checklist', assignee_roles: null },
  { name: 'Predictive Maintenance Checklist', assignee_roles: null },
  { name: 'Workshop Daily TM Inspection Checklist', assignee_roles: null },
]

describe('checklistRoles targeting', () => {
  it('an untargeted template is for everyone, which is what all live templates are', () => {
    for (const t of LIVE) {
      expect(templateTargetsEveryone(t)).toBe(true)
      for (const role of ['Tyre Man', 'Driver', 'Mechanic', 'Reporter', 'Inspector']) {
        expect(templateAllowsRole(t, role)).toBe(true)
      }
    }
    // The whole point of the NULL default: shipping V591 must not remove a
    // single checklist from a single person.
    expect(filterTemplatesForRole(LIVE, 'Tyre Man')).toHaveLength(3)
  })

  it('an empty array is treated as untargeted, not as "nobody"', () => {
    const t = { assignee_roles: [] }
    expect(templateTargetsEveryone(t)).toBe(true)
    expect(templateAllowsRole(t, 'Driver')).toBe(true)
  })

  it('matches across the three spellings of the same role', () => {
    // The DB stores 'Tyre Man', mobile's UserRole is 'tyre_man', a human might
    // type 'tyre man'. A raw string compare matches none of the others, which
    // is how a targeting rule silently reaches nobody.
    expect(normaliseRoleKey('Tyre Man')).toBe('tyre_man')
    expect(normaliseRoleKey('tyre_man')).toBe('tyre_man')
    expect(normaliseRoleKey('  tyre man ')).toBe('tyre_man')
    expect(normaliseRoleKey('Maintenance-Supervisor')).toBe('maintenance_supervisor')

    const t = { assignee_roles: ['Tyre Man'] }
    expect(templateAllowsRole(t, 'tyre_man')).toBe(true)
    expect(templateAllowsRole(t, 'Tyre Man')).toBe(true)
    expect(templateAllowsRole(t, 'tyre man')).toBe(true)
  })

  it('the owner scenario: trades get the workshop sheet, the driver gets theirs', () => {
    const workshop = { name: 'Workshop Daily', assignee_roles: ['Mechanic', 'Electrician'] }
    const driverSheet = { name: 'Pre-trip check', assignee_roles: ['Driver'] }
    const shared = { name: 'Site safety', assignee_roles: null }
    const all = [workshop, driverSheet, shared]

    expect(filterTemplatesForRole(all, 'mechanic').map((t) => t.name)).toEqual(['Workshop Daily', 'Site safety'])
    expect(filterTemplatesForRole(all, 'electrician').map((t) => t.name)).toEqual(['Workshop Daily', 'Site safety'])
    expect(filterTemplatesForRole(all, 'driver').map((t) => t.name)).toEqual(['Pre-trip check', 'Site safety'])
    // A trade must NOT be offered another trade's sheet.
    expect(templateAllowsRole(workshop, 'driver')).toBe(false)
    expect(templateAllowsRole(driverSheet, 'mechanic')).toBe(false)
  })

  it('oversight roles see every checklist, including ones they are not named on', () => {
    const workshop = { assignee_roles: ['Mechanic'] }
    for (const role of CHECKLIST_OVERSIGHT_ROLES) {
      expect(isOversightRole(role)).toBe(true)
      expect(templateAllowsRole(workshop, role)).toBe(true)
    }
    // A super admin passes even with an unrecognised role string.
    expect(templateAllowsRole(workshop, 'Something Else', { isSuperAdmin: true })).toBe(true)
    // ...but a plain unrecognised role does not.
    expect(templateAllowsRole(workshop, 'Something Else')).toBe(false)
  })

  it('an unknown role does not unlock a targeted template', () => {
    // The profile can still be loading. Showing a narrowed checklist to an
    // unknown role would defeat the feature; the list re-renders on arrival.
    const t = { assignee_roles: ['Mechanic'] }
    expect(templateAllowsRole(t, null)).toBe(false)
    expect(templateAllowsRole(t, '')).toBe(false)
    expect(templateAllowsRole(t, undefined)).toBe(false)
    // An untargeted one is still fine, so a loading profile never blanks the list.
    expect(templateAllowsRole({ assignee_roles: null }, null)).toBe(true)
  })

  it('survives junk in the column without throwing or matching everything', () => {
    expect(templateRoleKeys({ assignee_roles: 'Mechanic' })).toEqual([])   // not an array
    expect(templateTargetsEveryone({ assignee_roles: 'Mechanic' })).toBe(true)
    expect(templateRoleKeys({ assignee_roles: ['', '  ', null] })).toEqual([])
    expect(templateAllowsRole({ assignee_roles: ['', null] }, 'driver')).toBe(true)
    expect(templateAllowsRole(null, 'driver')).toBe(true)
    expect(templateAllowsRole(undefined, 'driver')).toBe(true)
  })

  it('assignment targeting: a null assignee_role is everyone’s to pick up', () => {
    const mine = { assignee_role: 'Mechanic' }
    const theirs = { assignee_role: 'Electrician' }
    const open = { assignee_role: null }
    const rows = [mine, theirs, open]

    expect(assignmentAllowsRole(open, 'driver')).toBe(true)
    expect(assignmentAllowsRole(mine, 'mechanic')).toBe(true)
    expect(assignmentAllowsRole(mine, 'driver')).toBe(false)
    expect(filterAssignmentsForRole(rows, 'mechanic')).toEqual([mine, open])
    expect(filterAssignmentsForRole(rows, 'Manager')).toEqual(rows)  // oversight
  })

  it('roleTargetLabel renders nothing when the checklist is for everyone', () => {
    // A chip reading "Everyone" on every single card is noise, so the caller
    // needs null rather than a string it has to special-case.
    expect(roleTargetLabel({ assignee_roles: null })).toBeNull()
    expect(roleTargetLabel({ assignee_roles: [] })).toBeNull()
    expect(roleTargetLabel({})).toBeNull()
    expect(roleTargetLabel({ assignee_roles: ['Mechanic', 'Electrician'] })).toBe('Mechanic, Electrician')
  })

  it('the trade shortlist leads with the roles the owner named', () => {
    expect(CHECKLIST_TRADE_ROLES.slice(0, 3)).toEqual(['Mechanic', 'Electrician', 'Driver'])
  })
})

describe('mobile mirror stays in step', () => {
  // Reads the mobile SOURCE rather than importing it: mobile/lib is TypeScript
  // compiled by a different toolchain, and the point is to catch the two files
  // drifting, which is what happened to src/lib/mobileModules.js.
  const src = readFileSync(resolve(__dirname, '../../mobile/lib/checklistRoles.ts'), 'utf8')

  it('exports the same function names', () => {
    for (const fn of [
      'normaliseRoleKey', 'templateRoleKeys', 'templateTargetsEveryone', 'isOversightRole',
      'templateAllowsRole', 'filterTemplatesForRole', 'assignmentAllowsRole',
      'filterAssignmentsForRole', 'roleTargetLabel',
    ]) {
      expect(src).toContain(`export function ${fn}`)
    }
  })

  it('declares the same trade and oversight role lists', () => {
    for (const role of CHECKLIST_TRADE_ROLES) expect(src).toContain(`'${role}'`)
    for (const role of CHECKLIST_OVERSIGHT_ROLES) expect(src).toContain(`'${role}'`)
    // The oversight list is the one that decides who bypasses targeting, so a
    // silent divergence there means a Manager sees everything on the web and
    // nothing extra on the phone.
    const block = src.slice(src.indexOf('CHECKLIST_OVERSIGHT_ROLES'))
    const arr = block.slice(block.indexOf('['), block.indexOf(']') + 1)
    expect(JSON.parse(arr.replace(/'/g, '"'))).toEqual(CHECKLIST_OVERSIGHT_ROLES)
  })

  it('normalises with the same rule (lowercase + underscore, spaces and dashes)', () => {
    expect(src).toContain(".toLowerCase().replace(/[\\s-]+/g, '_')")
  })
})
