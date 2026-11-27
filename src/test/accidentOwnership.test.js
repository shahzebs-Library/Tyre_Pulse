import { describe, it, expect } from 'vitest'
import {
  formatSlaMinutes, hoursToMinutes, minutesToHours, stepsMissingSla, stepsWithoutOwner,
  notifyRuleSummary, sortTasks, splitTasks, taskCounts, daysLabel, slaStateLabel,
  caseGaps, currentStep, holderLabel, OWNER_WORKSTREAMS,
} from '../lib/accidentOwnership'
import { caseStatusForStage } from '../lib/accidentCase'

describe('accident ownership helpers', () => {
  it('never invents an SLA: blank and bad values read Not set', () => {
    expect(formatSlaMinutes(null)).toBe('Not set')
    expect(formatSlaMinutes(0)).toBe('Not set')
    expect(formatSlaMinutes(240)).toBe('4 h')
    expect(formatSlaMinutes(2880)).toBe('2 days')
    expect(formatSlaMinutes(90)).toBe('90 min')
    expect(hoursToMinutes('')).toBeNull()
    expect(hoursToMinutes('4')).toBe(240)
    expect(Number.isNaN(hoursToMinutes('-1'))).toBe(true)
    expect(minutesToHours(null)).toBe('')
    expect(minutesToHours(90)).toBe('1.5')
  })

  it('finds steps with no owner and no SLA target', () => {
    const rules = [
      { workstream_key: 'repair', owner_role: 'PMV Manager', sla_minutes_major: 480, active: true },
      { workstream_key: 'insurance', owner_role: null, owner_user_ids: ['u1'], active: true },
      { workstream_key: 'finance', owner_role: 'Admin', country: 'KSA', sla_minutes_minor: 60, active: true },
    ]
    expect(stepsWithoutOwner(rules)).not.toContain('repair')
    expect(stepsWithoutOwner(rules)).not.toContain('insurance')
    expect(stepsWithoutOwner(rules)).toContain('handover')
    const missing = stepsMissingSla(rules)
    expect(missing).not.toContain('repair')
    expect(missing).toContain('finance') // a country override is not the org-wide target
    expect(missing).toHaveLength(OWNER_WORKSTREAMS.length - 1)
  })

  it('summarises who a rule tells', () => {
    expect(notifyRuleSummary({ notify_owner: true, roles: ['Manager'], user_ids: ['x'], notify_driver: true }, { x: 'Sara' }))
      .toBe('Step owner, Manager, Sara, The driver who reported')
    expect(notifyRuleSummary({ roles: ['Director'], only_when_serious: true, serious_cost: 20000 }))
      .toMatch(/only severe, injury or cost from 20,000/)
    expect(notifyRuleSummary({ event_key: 'accident.stalled', notify_owner: true, stalled_days: null }))
      .toMatch(/days not set/)
    expect(notifyRuleSummary({})).toBe('Nobody')
  })

  it('orders tasks overdue first and splits mine from my team', () => {
    const tasks = [
      { workstream_id: 'a', overdue: false, sla_state: 'none', days_in_step: 9, assigned_to_me: false },
      { workstream_id: 'b', overdue: true, sla_state: 'breached', days_in_step: 1, assigned_to_me: true },
      { workstream_id: 'c', overdue: false, sla_state: 'warning', due_at: '2026-01-01T00:00:00Z', assigned_to_me: true },
    ]
    expect(sortTasks(tasks).map((t) => t.workstream_id)).toEqual(['b', 'c', 'a'])
    const { mine, team } = splitTasks(tasks)
    expect(mine.map((t) => t.workstream_id)).toEqual(['b', 'c'])
    expect(team.map((t) => t.workstream_id)).toEqual(['a'])
    expect(taskCounts(tasks)).toEqual({ total: 3, overdue: 1, dueSoon: 1, mine: 2 })
    expect(slaStateLabel(tasks[1])).toBe('Overdue')
    expect(slaStateLabel(tasks[0])).toBe('No target')
  })

  it('labels days and holders honestly', () => {
    expect(daysLabel(0.2)).toBe('today')
    expect(daysLabel(1)).toBe('1 day')
    expect(daysLabel(3.46)).toBe('3.5 days')
    expect(daysLabel(null)).toBe('N/A')
    expect(holderLabel({ holder_name: 'VINAY' })).toBe('VINAY')
    expect(holderLabel({ holder_role: 'Admin' })).toBe('Admin (any)')
    expect(holderLabel({})).toBe('No owner')
  })

  it('reports missing case data and the current step', () => {
    const ws = [
      { workstream_key: 'repair', status: 'assigned', owner_role: 'PMV Manager' },
      { workstream_key: 'fleet_validation', status: 'completed', owner_id: 'u' },
      { workstream_key: 'insurance', status: 'not_started' },
    ]
    const gaps = caseGaps({ responsible_owner_id: null, root_cause: '', police_report_no: null, photos: [] }, ws).map((g) => g.key)
    expect(gaps).toEqual(['owner', 'step_owner', 'root_cause', 'police', 'photos'])
    expect(caseGaps({ responsible_owner_id: 'u', root_cause: 'speed', police_report_no: 'P1', photos: { scene: ['a'] } }, [])).toEqual([])
    expect(currentStep(ws).workstream_key).toBe('insurance')
  })

  it('mirrors the SQL stage -> case status rule and never returns closed', () => {
    expect(caseStatusForStage('reported')).toBe('submitted')
    expect(caseStatusForStage('insurance_claim')).toBe('insurance_review')
    expect(caseStatusForStage('closed')).toBe('closure_review')
    expect(caseStatusForStage('nope')).toBeNull()
  })
})
