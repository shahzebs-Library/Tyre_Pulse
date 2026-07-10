/**
 * Starter workflow templates — structural contract tests.
 *
 * These templates seed the visual workflow builder with the four reference
 * flows from APPROVAL_WORKFLOW_ENGINE.md §1. They must always satisfy the
 * client-side validation the builder enforces (mirroring the server's
 * validate_workflow_steps): at least one step, every step named and assigned a
 * role. Broken templates would surface as un-saveable definitions, so we lock
 * the contract here.
 */
import { describe, it, expect } from 'vitest'
import { STARTER_TEMPLATES } from '../lib/workflow/starterTemplates'

const EXPECTED_NAMES = [
  'Daily Vehicle Inspection',
  'Tyre Replacement',
  'Accident',
  'Purchase Request',
]

const VALID_OPS = ['=', '!=', '>', '>=', '<', '<=']

describe('starterTemplates', () => {
  it('exports exactly the four reference-flow templates', () => {
    expect(Array.isArray(STARTER_TEMPLATES)).toBe(true)
    expect(STARTER_TEMPLATES).toHaveLength(4)
  })

  it('contains all four expected template names', () => {
    const names = STARTER_TEMPLATES.map(t => t.name)
    for (const expected of EXPECTED_NAMES) {
      expect(names).toContain(expected)
    }
  })

  it('every template has an entity_type and a trigger_event', () => {
    for (const tpl of STARTER_TEMPLATES) {
      expect(typeof tpl.entity_type).toBe('string')
      expect(tpl.entity_type.trim().length).toBeGreaterThan(0)
      expect(typeof tpl.trigger_event).toBe('string')
      expect(tpl.trigger_event.trim().length).toBeGreaterThan(0)
    }
  })

  it('every template has at least one step', () => {
    for (const tpl of STARTER_TEMPLATES) {
      expect(Array.isArray(tpl.steps)).toBe(true)
      expect(tpl.steps.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('every step has a non-empty name and an approver_role', () => {
    for (const tpl of STARTER_TEMPLATES) {
      for (const s of tpl.steps) {
        expect(typeof s.name).toBe('string')
        expect(s.name.trim().length).toBeGreaterThan(0)
        expect(typeof s.approver_role).toBe('string')
        expect(s.approver_role.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('every step carries a complete requirement-flag schema', () => {
    const boolFlags = [
      'require_signature',
      'require_photo',
      'require_gps',
      'require_comment_on_return',
      'allow_return',
      'optional',
    ]
    for (const tpl of STARTER_TEMPLATES) {
      for (const s of tpl.steps) {
        expect(s.assignee_type).toBe('role')
        expect(typeof s.sla_hours).toBe('number')
        expect(s.sla_hours).toBeGreaterThan(0)
        for (const flag of boolFlags) {
          expect(typeof s[flag]).toBe('boolean')
        }
      }
    }
  })

  it('any step condition uses a valid operator and a field', () => {
    for (const tpl of STARTER_TEMPLATES) {
      for (const s of tpl.steps) {
        if (s.condition) {
          expect(typeof s.condition.field).toBe('string')
          expect(s.condition.field.trim().length).toBeGreaterThan(0)
          expect(VALID_OPS).toContain(s.condition.op)
          expect(s.condition.value).toBeDefined()
        }
      }
    }
  })
})
