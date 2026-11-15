/**
 * Audit Pack (/checklist-audit) is guarded by RoleRoute(CHECKLIST_AUTHOR_ROLES).
 * The sidebar and command search must offer it to exactly that set (plus super
 * admins), so a Workshop Supervisor never clicks it into Access Denied.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  isChecklistNavVisible, canAuthorChecklists, CHECKLIST_AUTHOR_ROLES, isChecklistPathAllowed,
} from '../lib/checklistAccess'
import { isCommandVisible, NAV_COMMANDS } from '../lib/commandSearch'

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
const allow = () => true
const cmd = NAV_COMMANDS.find((c) => c.path === '/checklist-audit')

describe('Audit Pack visibility follows the route guard', () => {
  it('route admits CHECKLIST_AUTHOR_ROLES', () => {
    expect(read('src/App.jsx')).toMatch(/path="\/checklist-audit"[^\n]*RoleRoute allowed=\{CHECKLIST_AUTHOR_ROLES\}/)
  })

  it('a non-author checklist-only role does not see it', () => {
    expect(isChecklistPathAllowed('/checklist-audit')).toBe(true)
    expect(isChecklistNavVisible('/checklist-audit', 'Workshop Supervisor', false)).toBe(false)
    expect(isCommandVisible(cmd, { role: 'Workshop Supervisor' }, allow, new Set(), false)).toBe(false)
    // The other author-only checklist pages are hidden the same way.
    for (const p of ['/checklist-builder', '/checklist-schedules', '/checklist-insights']) {
      expect(isChecklistNavVisible(p, 'Workshop Supervisor', false)).toBe(false)
    }
    // Its own checklist pages stay visible.
    expect(isChecklistNavVisible('/checklists', 'Workshop Supervisor', false)).toBe(true)
    expect(isChecklistNavVisible('/approvals', 'Workshop Supervisor', false)).toBe(true)
  })

  it('Manager and Maintenance Supervisor see it', () => {
    for (const role of ['Manager', 'Maintenance Supervisor']) {
      expect(canAuthorChecklists(role, false)).toBe(true)
      expect(isCommandVisible(cmd, { role }, allow, new Set(), false)).toBe(true)
    }
  })

  it('every author role sees it, other built-in roles do not, super admin always does', () => {
    for (const role of CHECKLIST_AUTHOR_ROLES) expect(isCommandVisible(cmd, { role }, allow, new Set(), false)).toBe(true)
    for (const role of ['Tyre Man', 'Reporter', 'Driver', 'Inspector']) {
      expect(isCommandVisible(cmd, { role }, allow, new Set(), false)).toBe(false)
    }
    expect(isCommandVisible(cmd, { role: 'Workshop Supervisor' }, allow, new Set(), true)).toBe(true)
    expect(isCommandVisible(cmd, { role: 'Tyre Man' }, allow, new Set(), true)).toBe(true)
  })

  for (const file of ['src/components/Layout.jsx', 'src/components/LegacyLayout.jsx']) {
    it(`${file} gates the sidebar item on the author list`, () => {
      const src = read(file)
      expect(src).toMatch(/to: '\/checklist-audit',[^}]*roles: CHECKLIST_AUTHOR_ROLES/)
      expect(src).toContain("if (item.to === '/checklist-audit') return canAuthorChecklists(profile?.role, isSuperAdmin)")
      expect(src).toContain('isChecklistPathAllowed(item.to, hasPermission) && isChecklistNavVisible(item.to, profile?.role, isSuperAdmin)')
    })
  }
})
