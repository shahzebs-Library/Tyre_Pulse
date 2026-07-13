import { describe, it, expect } from 'vitest'
import {
  SKILL_CATALOGUE, CERT_CATALOGUE, LEVEL_LABELS,
  certExpiryStatus, computeExpiry, lifecycleScore, skillsMatrix,
  slaBreached, slaCompliancePct, skillsGap, SLA_HOURS,
  skillById, certById,
} from '../lib/technicianScorecard'

const DAY = 86400000
const NOW = Date.parse('2026-07-13T00:00:00Z')
const inDays = (n) => new Date(NOW + n * DAY).toISOString()

describe('competency catalogues', () => {
  it('ships 12 skills and 9 certs with stable shapes', () => {
    expect(SKILL_CATALOGUE).toHaveLength(12)
    expect(CERT_CATALOGUE).toHaveLength(9)
    for (const s of SKILL_CATALOGUE) {
      expect(s.skill_id).toBeTruthy()
      expect(s.name).toBeTruthy()
      expect(['core', 'hardware', 'specialist', 'management']).toContain(s.category)
      expect(s.max_level).toBe(3)
    }
    for (const c of CERT_CATALOGUE) {
      expect(c.cert_id).toBeTruthy()
      expect(typeof c.validity_years).toBe('number')
    }
    // ids are unique
    expect(new Set(SKILL_CATALOGUE.map((s) => s.skill_id)).size).toBe(12)
    expect(new Set(CERT_CATALOGUE.map((c) => c.cert_id)).size).toBe(9)
    expect(LEVEL_LABELS[1]).toBe('Basic')
    expect(LEVEL_LABELS[3]).toBe('Expert')
    expect(skillById('tyre_change')?.category).toBe('core')
    expect(certById('tpms')?.validity_years).toBe(2)
    expect(skillById('nope')).toBeUndefined()
  })
})

describe('certExpiryStatus (boundaries)', () => {
  it('classifies unknown / expired / warning / valid on day boundaries', () => {
    expect(certExpiryStatus(null, NOW)).toEqual({ days: null, status: 'unknown' })
    expect(certExpiryStatus('not-a-date', NOW).status).toBe('unknown')
    // expired (strictly < 0 days)
    expect(certExpiryStatus(inDays(-1), NOW)).toMatchObject({ status: 'expired' })
    // exactly 0 days remaining → not expired yet, but within warning window
    expect(certExpiryStatus(NOW, NOW)).toMatchObject({ days: 0, status: 'warning' })
    // 59 days → warning, 60 days → valid (boundary)
    expect(certExpiryStatus(inDays(59), NOW).status).toBe('warning')
    expect(certExpiryStatus(inDays(60), NOW).status).toBe('valid')
    expect(certExpiryStatus(inDays(400), NOW).status).toBe('valid')
  })
  it('computes signed day counts', () => {
    expect(certExpiryStatus(inDays(-10), NOW).days).toBe(-10)
    expect(certExpiryStatus(inDays(30), NOW).days).toBe(30)
  })
})

describe('computeExpiry', () => {
  it('adds the validity window to the issue date', () => {
    expect(computeExpiry('2024-01-15', 2)).toBe('2026-01-15')
    expect(computeExpiry('2023-06-30', 3)).toBe('2026-06-30')
  })
  it('returns null on missing inputs', () => {
    expect(computeExpiry(null, 2)).toBeNull()
    expect(computeExpiry('2024-01-01', null)).toBeNull()
    expect(computeExpiry('bad', 2)).toBeNull()
  })
})

describe('lifecycleScore (bands + unrated)', () => {
  it('is unrated with no completed work and zero pass rate', () => {
    expect(lifecycleScore({ completed: 0, passRate: 0, certCount: 0 })).toEqual({
      score: null, band: 'unrated', label: 'Unrated',
    })
    // certs alone still can't rate without any delivery signal
    expect(lifecycleScore({ completed: 0, passRate: 0, certCount: 5 }).band).toBe('unrated')
  })
  it('scores volume + quality + certs and bands correctly', () => {
    // 500 jobs (40) + 100% pass (50) + 5 certs (10) = 100 → expert
    const top = lifecycleScore({ completed: 500, passRate: 100, certCount: 5 })
    expect(top.score).toBe(100)
    expect(top.band).toBe('expert')
    expect(top.label).toBe('Expert — 100/100')
    // caps: 1000 jobs still 40, 10 certs still 10
    expect(lifecycleScore({ completed: 1000, passRate: 100, certCount: 10 }).score).toBe(100)
    // developing band
    const dev = lifecycleScore({ completed: 100, passRate: 80, certCount: 1 })
    // (100/500)*40=8 + 0.8*50=40 + 1*2=2 = 50 → developing
    expect(dev.score).toBe(50)
    expect(dev.band).toBe('developing')
    // needs_training
    const low = lifecycleScore({ completed: 10, passRate: 40, certCount: 0 })
    expect(low.band).toBe('needs_training')
    expect(low.score).toBeLessThan(50)
  })
  it('bands proficient at the 70 boundary', () => {
    // (250/500)*40=20 + 1.0*50=50 = 70 → proficient
    expect(lifecycleScore({ completed: 250, passRate: 100, certCount: 0 }).band).toBe('proficient')
  })
})

describe('skillsMatrix (bucketing)', () => {
  it('buckets levels per skill, joins catalogue names and sorts by holders', () => {
    const rows = [
      { skill_id: 'tyre_change', level: 3 },
      { skill_id: 'tyre_change', level: 1 },
      { skill_id: 'tyre_change', level: 2 },
      { skill_id: 'wheel_balancing', level: 2 },
      { skill_id: 'wheel_balancing', level: 2 },
    ]
    const m = skillsMatrix(rows)
    expect(m[0].skill_id).toBe('tyre_change') // 3 holders → first
    expect(m[0]).toMatchObject({ l1: 1, l2: 1, l3: 1, total: 3, name: skillById('tyre_change').name })
    expect(m[1]).toMatchObject({ skill_id: 'wheel_balancing', l2: 2, total: 2 })
  })
  it('clamps out-of-range/absent levels to L1 and keeps unknown skills', () => {
    const m = skillsMatrix([{ skill_id: 'mystery', level: 9 }, { skill_id: 'mystery' }])
    expect(m[0]).toMatchObject({ skill_id: 'mystery', name: 'mystery', l3: 1, l1: 1, total: 2 })
  })
  it('handles empty / non-array input', () => {
    expect(skillsMatrix([])).toEqual([])
    expect(skillsMatrix(null)).toEqual([])
  })
})

describe('slaBreached', () => {
  it('uses SLA_HOURS per priority; completed jobs judged on completion time', () => {
    expect(SLA_HOURS).toMatchObject({ emergency: 1, urgent: 4, high: 8, normal: 24, low: 72 })
    const created = '2026-01-01T00:00:00Z'
    // normal = 24h; completed 20h later → within SLA
    expect(slaBreached('normal', created, '2026-01-01T20:00:00Z', NOW)).toBe(false)
    // completed 30h later → breached
    expect(slaBreached('normal', created, '2026-01-02T06:00:00Z', NOW)).toBe(true)
    // urgent = 4h; completed 5h later → breached
    expect(slaBreached('urgent', created, '2026-01-01T05:00:00Z', NOW)).toBe(true)
  })
  it('open jobs judged against now', () => {
    const created = inDays(-2) // 48h ago
    expect(slaBreached('normal', created, null, NOW)).toBe(true)  // 24h target exceeded
    expect(slaBreached('low', created, null, NOW)).toBe(false)    // 72h target not yet
  })
  it('unknown priority or missing created_at is not a breach', () => {
    expect(slaBreached('whenever', '2026-01-01T00:00:00Z', null, NOW)).toBe(false)
    expect(slaBreached('normal', null, null, NOW)).toBe(false)
    expect(slaBreached('normal', 'bad-date', null, NOW)).toBe(false)
  })
})

describe('slaCompliancePct', () => {
  it('computes % not breached over qualifying orders', () => {
    const orders = [
      { priority: 'normal', created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T10:00:00Z' }, // ok
      { priority: 'urgent', created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T10:00:00Z' }, // breach (4h)
      { priority: 'unknown', created_at: '2026-01-01T00:00:00Z' }, // ignored
      { priority: 'normal' }, // ignored (no created_at)
    ]
    expect(slaCompliancePct(orders, NOW)).toBe(50) // 1 of 2 qualifying ok
  })
  it('returns null when nothing qualifies', () => {
    expect(slaCompliancePct([{ priority: 'unknown' }], NOW)).toBeNull()
    expect(slaCompliancePct([], NOW)).toBeNull()
    expect(slaCompliancePct(null, NOW)).toBeNull()
  })
})

describe('skillsGap', () => {
  it('returns catalogue skills the technician does not hold', () => {
    const held = SKILL_CATALOGUE.slice(0, 10).map((s) => s.skill_id)
    const gap = skillsGap(held)
    expect(gap).toHaveLength(2)
    expect(gap.every((s) => !held.includes(s.skill_id))).toBe(true)
  })
  it('returns the full catalogue when nothing is held', () => {
    expect(skillsGap([])).toHaveLength(12)
    expect(skillsGap(null)).toHaveLength(12)
  })
  it('returns empty when every skill is held', () => {
    expect(skillsGap(SKILL_CATALOGUE.map((s) => s.skill_id))).toEqual([])
  })
})
