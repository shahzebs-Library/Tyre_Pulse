import { describe, it, expect } from 'vitest'
import { summarizeTechnicians } from '../lib/technicianScorecard'
import {
  filterLeaderboard, leaderboardKpis, leaderboardExportRows, buildTechnicianRows, technicianKpis,
  matrixRows, matrixKpis, certRegister, filterCerts, certKpis, certExportRows,
} from '../lib/technicianScorecardAnalytics'

const NOW = Date.UTC(2026, 8, 26)
const orders = [
  { id: 1, technician_name: 'Ali', status: 'Completed', priority: 'normal', created_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T10:00:00Z', total_cost: 100 },
  { id: 2, technician_name: 'Ali', status: 'Completed', priority: 'normal', created_at: '2026-09-02T00:00:00Z', completed_at: '2026-09-04T00:00:00Z', total_cost: 300 },
  { id: 3, technician_name: 'Omar', status: 'Open', priority: 'unknown', created_at: '2026-09-05T00:00:00Z', total_cost: 0 },
]
const profiles = [
  { id: 'u1', full_name: 'Ali', role: 'Tyre Man' },
  { id: 'u2', full_name: 'Omar', role: 'Mechanic' },
  { id: 'u3', full_name: 'Sara', role: 'Reporter' },
]
const skills = [
  { id: 's1', user_id: 'u1', skill_id: 'tyre_change', level: 3 },
  { id: 's2', user_id: 'u2', skill_id: 'tyre_change', level: 1 },
]
const certs = [
  { id: 'c1', user_id: 'u1', cert_name: 'Old', expiry_date: '2026-01-01' },
  { id: 'c2', user_id: 'u1', cert_name: 'Soon', expiry_date: '2026-10-10' },
  { id: 'c3', user_id: 'u2', cert_name: 'Good', expiry_date: '2030-01-01' },
  { id: 'c4', user_id: 'u9', cert_name: 'Undated', expiry_date: null },
]

describe('technicianScorecardAnalytics', () => {
  const { rows } = summarizeTechnicians(orders)

  it('filters the leaderboard by name, minimum jobs and rating', () => {
    expect(filterLeaderboard(rows, { search: 'om' }).map((r) => r.technician)).toEqual(['Omar'])
    expect(filterLeaderboard(rows, { minJobs: 2 }).map((r) => r.technician)).toEqual(['Ali'])
    expect(filterLeaderboard(rows, { rating: 'Needs Improvement' }).map((r) => r.technician)).toEqual(['Omar'])
  })

  it('reports rates as null when there is nothing to measure', () => {
    const k = leaderboardKpis(rows, orders, NOW)
    expect(k.jobs).toBe(3)
    expect(k.completionRate).toBeCloseTo(66.7, 1)
    expect(k.slaCompliance).toBe(50) // order 2 took 48h against a 24h normal SLA
    const none = leaderboardKpis([], [], NOW)
    expect(none.completionRate).toBeNull()
    expect(none.avgTurnaround).toBeNull()
    expect(none.avgCostPerJob).toBeNull()
    expect(none.slaCompliance).toBeNull()
    const exp = leaderboardExportRows(filterLeaderboard(rows, { search: 'omar' }))
    expect(exp[0].avgTurnaround).toBe('N/A')
  })

  it('builds competency rows for workshop roles and joins performance by name', () => {
    const t = buildTechnicianRows({ profiles, skills, certs, ranked: rows }, NOW)
    expect(t.map((r) => r.name)).toEqual(['Ali', 'Omar'])
    const ali = t[0]
    expect(ali.expiring).toBe(2)
    expect(ali.expertSkills).toBe(1)
    expect(ali.perf.jobs).toBe(2)
    expect(ali.life.score).not.toBeNull()
    const all = buildTechnicianRows({ profiles, skills, certs, ranked: rows, allRoles: true }, NOW)
    expect(all).toHaveLength(3)
    expect(all.find((r) => r.name === 'Sara').life.band).toBe('unrated')
    const k = technicianKpis(all)
    expect(k).toMatchObject({ people: 3, assessed: 2, certified: 2, atRisk: 1 })
    expect(technicianKpis([]).avgLifecycle).toBeNull()
  })

  it('rolls the skills matrix and flags uncovered catalogue skills', () => {
    expect(matrixRows(skills)[0]).toMatchObject({ skill_id: 'tyre_change', l1: 1, l3: 1, total: 2 })
    expect(matrixRows(skills, { category: 'management' })).toEqual([])
    const k = matrixKpis(skills)
    expect(k.assessed).toBe(2)
    expect(k.expertShare).toBe(50)
    expect(k.uncovered.length).toBeGreaterThan(0)
    expect(matrixKpis([]).expertShare).toBeNull()
  })

  it('builds the certification register with compliance over dated certs only', () => {
    const reg = certRegister(certs, profiles, NOW)
    expect(reg.map((c) => c.status)).toEqual(['expired', 'warning', 'valid', 'unknown'])
    expect(reg[3].technician).toBe('Unknown user')
    expect(filterCerts(reg, { status: 'valid' })).toHaveLength(1)
    expect(filterCerts(reg, { search: 'soon' })).toHaveLength(1)
    const k = certKpis(reg)
    expect(k).toMatchObject({ total: 4, expired: 1, warning: 1, valid: 1, unknown: 1 })
    expect(k.compliance).toBeCloseTo(33.3, 1)
    expect(certKpis([]).compliance).toBeNull()
    expect(certExportRows(reg)[3].days).toBe('N/A')
  })
})
