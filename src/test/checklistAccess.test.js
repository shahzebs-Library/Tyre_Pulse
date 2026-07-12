import { describe, it, expect } from 'vitest'
import {
  isChecklistOnlyRole, isChecklistPathAllowed, CHECKLIST_AUTHOR_ROLES, CHECKLIST_ONLY_ROLES,
} from '../lib/checklistAccess'

describe('checklist-only access rules', () => {
  it('identifies the checklist-only role', () => {
    expect(isChecklistOnlyRole('Maintenance Supervisor')).toBe(true)
    expect(isChecklistOnlyRole('  Maintenance Supervisor ')).toBe(true)
    expect(isChecklistOnlyRole('Admin')).toBe(false)
    expect(isChecklistOnlyRole('')).toBe(false)
    expect(isChecklistOnlyRole(null)).toBe(false)
  })

  it('allows only checklist paths', () => {
    for (const p of [
      '/checklists', '/checklists/abc/run', '/checklists/submission/x',
      '/my-checklists', '/checklist-builder', '/checklist-builder/t1',
      '/checklist-schedules', '/checklist-insights', '/help', '/profile',
    ]) expect(isChecklistPathAllowed(p)).toBe(true)

    for (const p of ['/', '/tyres', '/analytics', '/accidents', '/stock', '/users', '/checklistX', '/settings']) {
      expect(isChecklistPathAllowed(p)).toBe(false)
    }
  })

  it('the checklist-only role can author checklists', () => {
    expect(CHECKLIST_AUTHOR_ROLES).toEqual(expect.arrayContaining(['Admin', 'Manager', 'Director', 'Maintenance Supervisor']))
    expect(CHECKLIST_ONLY_ROLES).toContain('Maintenance Supervisor')
  })
})
