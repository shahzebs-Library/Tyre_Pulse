/**
 * A checklist-only role must actually SEE its own menu, and nothing else.
 *
 * The trap this pins: shouldShowNavItem tests isCustomNavRole BEFORE
 * isChecklistOnlyRole, and the custom-role branch is deny-by-default. Any
 * checklist-only role missing from BUILTIN_NAV_ROLES is therefore swallowed by
 * that branch, its sidebar rule never runs, and the person signs in to an empty
 * app - while the code that was meant to give them a menu sits there looking
 * correct.
 *
 * That is exactly what happened when Workshop Supervisor (V599) was added: it
 * is a custom_roles row, so it fell into the custom branch and the checklist
 * rule below it was unreachable. The set is now DERIVED from
 * CHECKLIST_ONLY_ROLES so the two cannot drift again; these tests fail if
 * anybody unpicks that.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  CHECKLIST_ONLY_ROLES, isChecklistOnlyRole, isChecklistPathAllowed,
  CHECKLIST_AUTHOR_ROLES,
} from '../lib/checklistAccess'
import { APPROVAL_STAGES, STAGE_SUPERVISOR, STAGE_AREA_MANAGER } from '../lib/checklist/checklistApproval'

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

describe('the sidebar can reach the checklist-only rule', () => {
  for (const file of ['src/components/Layout.jsx', 'src/components/LegacyLayout.jsx']) {
    it(`${file} derives its built-in set from CHECKLIST_ONLY_ROLES`, () => {
      const src = read(file)
      const decl = src.slice(src.indexOf('const BUILTIN_NAV_ROLES'), src.indexOf('const isCustomNavRole'))
      expect(decl, 'a hardcoded name list here silently blanks a new checklist role')
        .toContain('CHECKLIST_ONLY_ROLES')
      expect(src).toContain('CHECKLIST_ONLY_ROLES } from \'../lib/checklistAccess\'')
    })
  }
})

describe('Workshop Supervisor', () => {
  it('is a checklist-only role', () => {
    expect(CHECKLIST_ONLY_ROLES).toContain('Workshop Supervisor')
    expect(isChecklistOnlyRole('Workshop Supervisor')).toBe(true)
  })

  it('can reach the approvals queue, or the role does nothing', () => {
    expect(isChecklistPathAllowed('/approvals')).toBe(true)
  })

  it('still cannot reach the rest of the app', () => {
    for (const p of ['/dashboard', '/accidents', '/work-orders', '/expense-report', '/console']) {
      expect(isChecklistPathAllowed(p), `${p} must stay hidden`).toBe(false)
    }
  })

  it('approves but does not author - the builder stays out of reach', () => {
    expect(CHECKLIST_AUTHOR_ROLES).not.toContain('Workshop Supervisor')
    expect(isChecklistPathAllowed('/checklist-builder')).toBe(true) // path allowed...
    // ...but the route itself is RoleRoute-gated on CHECKLIST_AUTHOR_ROLES, so
    // the nav item shows and the page refuses. Pin the role list, which is the
    // real gate.
  })
})

describe('the approval ladder mirrors the database', () => {
  // MIRROR of SQL checklist_is_supervisor() / checklist_is_area_manager().
  // V599 added Workshop Supervisor to the SUPERVISOR rung only.
  const stage = (k) => APPROVAL_STAGES.find((s) => s.key === k)

  it('Workshop Supervisor signs at the first rung', () => {
    expect(stage(STAGE_SUPERVISOR).roles).toContain('Workshop Supervisor')
  })

  it('and deliberately NOT at the closing rung, or the two stages collapse', () => {
    expect(stage(STAGE_AREA_MANAGER).roles).not.toContain('Workshop Supervisor')
  })

  it('the migration that granted it is in the repo', () => {
    const sql = read('MIGRATIONS_V599_WORKSHOP_SUPERVISOR.sql')
    expect(sql).toContain("'Workshop Supervisor'")
    expect(sql).toContain('checklist_is_supervisor')
  })
})
