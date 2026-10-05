import { describe, it, expect } from 'vitest'
import { evaluateChecks, readinessScore, criticalOpen, phaseReadiness, taskKpis, nextActions } from '../lib/onboardingReadinessView'
import { userRoleFacts } from '../lib/api/onboardingReadiness'

const good = {
  orgNamed: true, companyLogo: true, sites: 10, sitesWithRegion: 10, fleet: 50, fleetUntyped: 0,
  approvedUsers: 5, pendingUsers: 0, matrixRows: 40, customRolesWithoutModules: [], unscopedUsers: 0,
  tyres: 100, hasWorkOrders: true, hasExpenses: true, hasImportBatches: true, apiKeys: 1, devices: 3, inspections: 9,
}

describe('onboardingReadinessView', () => {
  it('all measured facts good -> 100 with training/sign-off unknown', () => {
    const checks = evaluateChecks(good, [])
    const s = readinessScore(checks)
    expect(s.score).toBe(100)
    expect(s.unknown).toBe(2)
    expect(criticalOpen(checks)).toEqual([])
  })

  it('null facts are unknown, never counted as failures', () => {
    const checks = evaluateChecks({}, [])
    expect(checks.every((c) => c.status === 'unknown')).toBe(true)
    expect(readinessScore(checks).score).toBeNull()
    expect(phaseReadiness(checks).every((p) => p.pct === null)).toBe(true)
  })

  it('zero fleet and a locked-out custom role are critical failures', () => {
    const checks = evaluateChecks({ ...good, fleet: 0, fleetUntyped: 0, customRolesWithoutModules: ['Fleet Supervisor'] }, [])
    const crit = criticalOpen(checks).map((c) => c.id)
    expect(crit).toEqual(['FLT-003', 'USR-004'])
    const acts = nextActions(checks, [])
    expect(acts[0].priority).toBe('High')
    expect(acts.find((a) => a.id === 'USR-004').title).toMatch(/Fleet Supervisor/)
  })

  it('training and go-live come from the task checklist', () => {
    const tasks = [
      { id: 'a', phase: 'training', status: 'completed', required: true },
      { id: 'b', phase: 'go_live', status: 'in_progress', required: true },
    ]
    const checks = evaluateChecks(good, tasks)
    expect(checks.find((c) => c.id === 'TRN-001').status).toBe('pass')
    expect(checks.find((c) => c.id === 'GOL-001').status).toBe('fail')
    const golive = phaseReadiness(checks, tasks).find((p) => p.key === 'golive')
    expect(golive).toMatchObject({ pct: 0, tasksTotal: 1, tasksDone: 0 })
  })

  it('task KPIs: due this week, overdue, blocked', () => {
    const now = new Date(2026, 9, 5)
    const tasks = [
      { id: '1', phase: 'setup', status: 'completed', due_date: '2026-10-01' },
      { id: '2', phase: 'team', status: 'blocked', due_date: '2026-10-07' },
      { id: '3', phase: 'data_import', status: 'not_started', due_date: '2026-10-03', title: 'Late' },
      { id: '4', phase: 'data_import', status: 'in_progress', due_date: '2026-10-20' },
    ]
    const k = taskKpis(tasks, now)
    expect(k).toMatchObject({ total: 4, completed: 1, completionPct: 25, blocked: 1, dueThisWeek: 1, overdue: 1, dueThisWeekPhases: 1 })
    expect(taskKpis([], now).completionPct).toBeNull()
    const acts = nextActions([], tasks, now)
    expect(acts.map((a) => a.title)).toEqual(expect.arrayContaining(['Overdue: Late']))
  })
})

describe('userRoleFacts', () => {
  it('derives approvals, scope gaps and locked-out custom roles', () => {
    const profiles = [
      { role: 'Admin', approved: true, country: null, sites: null },
      { role: 'Manager', approved: true, country: ['KSA'], sites: ['ALL'] },
      { role: 'Manager', approved: true, country: ['KSA'], sites: [] },
      { role: 'Fleet Supervisor', approved: true, country: ['KSA'], sites: ['ALL'] },
      { role: 'Insurance Officer', approved: true, country: ['KSA'], sites: ['ALL'] },
      { role: 'Reporter', approved: false },
      { role: 'Reporter', approved: true, locked: true },
    ]
    const matrix = [{ role: 'Insurance Officer', enabled: true }, { role: 'Fleet Supervisor', enabled: false }]
    expect(userRoleFacts(profiles, matrix)).toEqual({
      approvedUsers: 5, pendingUsers: 1, unscopedUsers: 1, matrixRows: 1, customRolesWithoutModules: ['Fleet Supervisor'],
    })
    expect(userRoleFacts(null, null).approvedUsers).toBeNull()
  })
})
