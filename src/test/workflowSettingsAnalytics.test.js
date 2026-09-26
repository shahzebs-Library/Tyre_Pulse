import { describe, it, expect } from 'vitest'
import {
  chainSlaHours, definitionIssues, healthLevel, definitionRows, summarizeDefinitions,
  entityCoverage, summarizeInstances, filterDefinitionRows, definitionExportRows,
} from '../lib/workflowSettingsAnalytics'

const step = (o) => ({ name: 'S', assignee_type: 'role', approver_role: 'manager', sla_hours: 24, ...o })
const def = (o) => ({ id: Math.random().toString(36), name: 'W', entity_type: 'accident', trigger_event: 'accident.created', active: true, steps: [step()], ...o })

describe('workflowSettingsAnalytics', () => {
  it('sums chain SLA and returns null without any', () => {
    expect(chainSlaHours(def({ steps: [step(), step({ sla_hours: 48 })] }))).toBe(72)
    expect(chainSlaHours(def({ steps: [step({ sla_hours: null })] }))).toBeNull()
  })

  it('detects configuration issues', () => {
    expect(definitionIssues(def())).toEqual([])
    expect(definitionIssues(def({ steps: [] }))).toContain('no_steps')
    expect(definitionIssues(def({ steps: [step({ assignee_type: 'user', approver_user_id: '' })] }))).toContain('user_step_unassigned')
    expect(definitionIssues(def({ steps: [step({ sla_hours: 0 })] }))).toContain('step_no_sla')
    expect(definitionIssues(def({ steps: [step({ optional: true })] }))).toContain('all_optional')
    expect(definitionIssues(def({ steps: Array.from({ length: 11 }, () => step()) }))).toContain('too_many_steps')
    const a = def({ id: 'a' }); const b = def({ id: 'b' })
    expect(definitionIssues(a, [a, b])).toContain('trigger_conflict')
    expect(definitionIssues(a, [a, { ...b, active: false }])).not.toContain('trigger_conflict')
  })

  it('grades health', () => {
    expect(healthLevel([])).toBe('ok')
    expect(healthLevel(['step_no_sla'])).toBe('warning')
    expect(healthLevel(['no_steps'])).toBe('error')
  })

  it('builds rows and summary', () => {
    const defs = [
      def({ steps: [step({ require_signature: true }), step({ require_photo: true, condition: { field: 'x', value: 1 } })] }),
      def({ entity_type: 'work_order', active: false }),
    ]
    const rows = definitionRows(defs)
    expect(rows[0].evidence).toEqual({ signature: 1, photo: 1, gps: 0 })
    expect(rows[0].conditional).toBe(1)
    const s = summarizeDefinitions(defs)
    expect(s).toMatchObject({ total: 2, active: 1, inactive: 1, entities: 2, activeEntities: 1, withEvidence: 1, avgSteps: 1.5 })
    expect(summarizeDefinitions([]).avgSteps).toBeNull()
  })

  it('reports entity coverage with uncovered first', () => {
    const cov = entityCoverage([def(), def({ entity_type: 'po', active: false })], ['gate_pass'])
    expect(cov[0].uncovered).toBe(true)
    expect(cov.find((c) => c.entity === 'accident')).toMatchObject({ active: 1, uncovered: false })
  })

  it('summarizes instance usage and SLA honestly', () => {
    const now = '2026-09-26T12:00:00Z'
    const inst = [
      { status: 'pending', definition_name: 'W', current_step: 0, steps: [{ sla_hours: 24 }], step_started_at: '2026-09-24T12:00:00Z' },
      { status: 'pending', definition_name: 'W', current_step: 0, steps: [{ sla_hours: 24 }], step_started_at: '2026-09-26T06:00:00Z' },
      { status: 'pending', definition_name: 'W', current_step: 0, steps: [{}], step_started_at: '2026-09-01T00:00:00Z' },
      { status: 'approved', definition_name: 'X', started_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T10:00:00Z' },
      { status: 'rejected', definition_name: 'X', started_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T20:00:00Z' },
    ]
    const s = summarizeInstances(inst, { now, sampleOf: 40 })
    expect(s.slaTracked).toBe(2)
    expect(s.overdue).toBe(1)
    expect(s.slaCompliancePct).toBe(50)
    expect(s.approvalRatePct).toBe(50)
    expect(s.medianCycleHours).toBe(15)
    expect(s.sampleOf).toBe(40)
    expect(s.byDefinition[0]).toMatchObject({ name: 'W', runs: 3, overdue: 1 })
    expect(summarizeInstances([]).slaCompliancePct).toBeNull()
  })

  it('filters and exports rows', () => {
    const rows = definitionRows([def({ name: 'Accident chain' }), def({ name: 'PO', entity_type: 'po', steps: [] })])
    expect(filterDefinitionRows(rows, { search: 'chain' })).toHaveLength(1)
    expect(filterDefinitionRows(rows, { health: 'error' })).toHaveLength(1)
    expect(filterDefinitionRows(rows, { entity: 'po' })).toHaveLength(1)
    expect(definitionExportRows(rows)[1].issues).toContain('No approval steps')
  })
})
