import { describe, it, expect } from 'vitest'
import {
  WORKFLOW_STAGES, STAGE_FLOW, stageLabel, stageOf, nextStages,
  stageFromStatus, statusFromStage, severityLabel, isCritical,
  evaluateRouting, resolveRecipients, buildAccidentKpis, isOpenStage, isClosedStage,
} from '../lib/accidentWorkflow'

describe('accidentWorkflow stages', () => {
  it('has the 12-stage lifecycle with a closed + cancelled terminal', () => {
    expect(WORKFLOW_STAGES.length).toBe(12)
    expect(STAGE_FLOW).toContain('reported')
    expect(STAGE_FLOW).toContain('closed')
    expect(STAGE_FLOW).not.toContain('cancelled')
  })

  it('maps legacy status <-> stage consistently with the SQL', () => {
    expect(stageFromStatus('under_review')).toBe('initial_review')
    expect(stageFromStatus('awaiting_approval')).toBe('repair_approval')
    expect(stageFromStatus('released')).toBe('vehicle_release')
    expect(statusFromStage('hse_investigation')).toBe('under_review')
    expect(statusFromStage('vehicle_release')).toBe('released')
    expect(statusFromStage('cancelled')).toBe('closed')
  })

  it('stageOf prefers workflow_stage but falls back to legacy status', () => {
    expect(stageOf({ workflow_stage: 'repair_approval' })).toBe('repair_approval')
    expect(stageOf({ status: 'insurance_claim' })).toBe('insurance_claim')
    expect(stageOf({ workflow_stage: 'bogus', status: 'released' })).toBe('vehicle_release')
  })

  it('nextStages advances one step and offers close/cancel', () => {
    const n = nextStages('reported')
    expect(n).toContain('initial_review')
    expect(n).toContain('closed')
    expect(n).toContain('cancelled')
    expect(nextStages('closed')).not.toContain('closed')
  })

  it('open/closed helpers', () => {
    expect(isOpenStage('repair_in_progress')).toBe(true)
    expect(isClosedStage('closed')).toBe(true)
    expect(isClosedStage('cancelled')).toBe(true)
  })

  it('severity + critical detection', () => {
    expect(severityLabel('severe')).toBe('Major')
    expect(isCritical({ severity: 'severe' })).toBe(true)
    expect(isCritical({ severity: 'minor', injuries: true })).toBe(true)
    expect(isCritical({ severity: 'minor', injury_count: 2 })).toBe(true)
    expect(isCritical({ severity: 'minor' })).toBe(false)
  })

  it('stageLabel is human', () => {
    expect(stageLabel('hse_investigation')).toBe('HSE Investigation')
  })
})

describe('evaluateRouting', () => {
  const rules = [
    { id: 'base', active: true, event_key: null, match_severities: [], to_roles: ['Manager'], cc_roles: ['Director'], departments: ['Operations'] },
    { id: 'crit', active: true, event_key: null, match_severities: ['severe', 'fatal'], to_roles: ['Director'], departments: ['HSE / Safety'] },
    { id: 'vor', active: true, event_key: 'accident.vor_changed', require_vor: true, to_roles: ['Manager'], departments: ['Workshop'] },
    { id: 'cost', active: true, event_key: null, min_cost: 20000, to_roles: ['Director'], departments: ['Finance'] },
    { id: 'off', active: false, event_key: null, to_roles: ['Legal'], departments: ['Legal'] },
  ]

  it('always matches the baseline rule', () => {
    const r = evaluateRouting(rules, { severity: 'minor', estimated_damage_cost: 100 })
    expect(r.toRoles).toContain('Manager')
    expect(r.departments).toContain('Operations')
    expect(r.departments).not.toContain('Legal') // inactive rule ignored
  })

  it('pulls HSE for severe and Finance for high cost', () => {
    const r = evaluateRouting(rules, { severity: 'severe', estimated_damage_cost: 50000 })
    expect(r.departments).toEqual(expect.arrayContaining(['Operations', 'HSE / Safety', 'Finance']))
    expect(r.toRoles).toEqual(expect.arrayContaining(['Manager', 'Director']))
  })

  it('respects event_key + require_vor', () => {
    const noVor = evaluateRouting(rules, { severity: 'minor', vor: false }, 'accident.vor_changed')
    expect(noVor.departments).not.toContain('Workshop')
    const withVor = evaluateRouting(rules, { severity: 'minor', vor: true }, 'accident.vor_changed')
    expect(withVor.departments).toContain('Workshop')
  })
})

describe('resolveRecipients', () => {
  const acc = { site: 'NHC', country: 'Saudi Arabia' }
  const profiles = [
    { id: 'a', role: 'Manager', site: 'NHC', country: ['Saudi Arabia'], approved: true, locked: false },
    { id: 'b', role: 'Manager', site: 'REDSEA', country: ['Saudi Arabia'], approved: true, locked: false }, // wrong site
    { id: 'c', role: 'Director', site: null, country: [], approved: true, locked: false }, // org-wide, all countries
    { id: 'd', role: 'Manager', site: 'NHC', country: ['Egypt'], approved: true, locked: false }, // wrong country
    { id: 'e', role: 'Reporter', site: null, country: [], approved: true, locked: false }, // wrong role
    { id: 'f', role: 'Manager', site: null, country: [], approved: true, locked: true }, // locked
  ]
  it('filters by role, site, country, approval, lock', () => {
    const got = resolveRecipients(profiles, ['Manager', 'Director'], acc).map((p) => p.id)
    expect(got).toEqual(expect.arrayContaining(['a', 'c']))
    expect(got).not.toContain('b')
    expect(got).not.toContain('d')
    expect(got).not.toContain('e')
    expect(got).not.toContain('f')
  })
  it('site set on profile via sites[] array matches', () => {
    const p = [{ id: 'g', role: 'Manager', site: 'HQ', sites: ['NHC'], country: [], approved: true, locked: false }]
    expect(resolveRecipients(p, ['Manager'], acc).map((x) => x.id)).toContain('g')
  })
})

describe('buildAccidentKpis', () => {
  const now = '2026-07-20'
  const rows = [
    { workflow_stage: 'reported', severity: 'minor', incident_date: '2026-07-01', site: 'NHC', driver_name: 'Ali' },
    { workflow_stage: 'repair_in_progress', severity: 'severe', injuries: true, incident_date: '2026-06-01', site: 'NHC', vor: true, vor_since: '2026-06-25', repair_cost: 5000, driver_name: 'Sam' },
    { workflow_stage: 'closed', severity: 'moderate', incident_date: '2026-05-01', release_date: '2026-05-11', site: 'REDSEA', repair_cost: 2000, recovered_amount: 1500, claim_amount: 3000, driver_name: 'Ali' },
    { workflow_stage: 'insurance_claim', severity: 'minor', incident_date: '2026-07-10', claim_amount: 8000, claim_status: 'filed', expected_release_date: '2026-07-01', site: 'NHC', police_report_no: '', driver_name: 'Sam' },
  ]
  const k = buildAccidentKpis(rows, { now, vorSlaDays: 7 })

  it('counts core KPIs honestly', () => {
    expect(k.total).toBe(4)
    expect(k.open).toBe(3) // all but the closed one
    expect(k.critical).toBe(1) // the severe+injury row
    expect(k.injuryCases).toBe(1)
    expect(k.vor).toBe(1)
    expect(k.vorOverSla).toBe(1) // off road since 25 Jun, >7 days by 20 Jul
    expect(k.repairInProgress).toBe(1)
    expect(k.repairCompleted).toBe(1) // the closed one
  })

  it('costs, closure time and claim integration', () => {
    expect(k.totalRepairCost).toBe(7000) // 5000 + 2000
    expect(k.avgClosureDays).toBe(10) // 1 -> 11 May
    expect(k.pendingClaims).toBeGreaterThanOrEqual(1) // the filed, not-closed claim
    expect(k.claimsDelayed).toBe(1) // filed claim past expected release
    expect(k.insuranceRecovery).toBe(1500)
    expect(Array.isArray(k.bySite)).toBe(true)
    expect(k.byDriver.find((d) => d.label === 'Ali').value).toBe(2)
  })
})
