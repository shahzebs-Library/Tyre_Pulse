import { describe, it, expect } from 'vitest'
import { recommendTechnicians } from '../lib/workshopAssign.js'
import { STATUS } from '../lib/workshopLive.js'

const technicians = [
  { id: 'u1', full_name: 'Ali', site: 'JEDDAH' },
  { id: 'u2', full_name: 'Sam', site: 'JEDDAH' },
  { id: 'u3', full_name: 'Off', site: 'JEDDAH' },
]

const board = [
  { userId: 'u1', name: 'Ali', status: STATUS.AVAILABLE, site: 'JEDDAH' },
  { userId: 'u2', name: 'Sam', status: STATUS.AVAILABLE, site: 'JEDDAH' },
  { userId: 'u3', name: 'Off', status: STATUS.OFF_DUTY, site: 'JEDDAH' },
]

describe('workshopAssign engine', () => {
  it('ranks the skill-matched technician first', () => {
    const skillsByUser = { u1: ['wheel_alignment'], u2: ['tyre_change'] }
    const out = recommendTechnicians(
      { work_type: 'Wheel Alignment', site: 'JEDDAH' },
      { technicians, skillsByUser, board, assignments: [] },
    )
    expect(out[0].userId).toBe('u1')
    expect(out[0].score).toBeGreaterThan(out[1].score)
    expect(out[0].reasons.join(' ')).toMatch(/skilled/i)
  })

  it('excludes off-duty / absent technicians', () => {
    const out = recommendTechnicians(
      { work_type: 'Wheel Alignment', site: 'JEDDAH' },
      { technicians, skillsByUser: { u1: ['wheel_alignment'] }, board, assignments: [] },
    )
    expect(out.some((r) => r.userId === 'u3')).toBe(false)
  })

  it('breaks a tie on workload (fewer active assignments wins)', () => {
    // Both available, no skill data => equal skill/availability/site; u2 has more load.
    const out = recommendTechnicians(
      { work_type: 'General service', site: 'JEDDAH' },
      {
        technicians,
        skillsByUser: {},
        board,
        assignments: [{ user_id: 'u2', active: true }, { user_id: 'u2', active: true }],
      },
    )
    const u1 = out.find((r) => r.userId === 'u1')
    const u2 = out.find((r) => r.userId === 'u2')
    expect(u1.score).toBeGreaterThan(u2.score)
    expect(out[0].userId).toBe('u1')
  })

  it('keeps the skill component neutral when no skill data exists (no false high)', () => {
    const withData = recommendTechnicians(
      { work_type: 'Wheel Alignment', site: 'JEDDAH' },
      { technicians, skillsByUser: { u1: ['wheel_alignment'] }, board, assignments: [] },
    )
    const noData = recommendTechnicians(
      { work_type: 'Wheel Alignment', site: 'JEDDAH' },
      { technicians, skillsByUser: {}, board, assignments: [] },
    )
    // A confirmed skill match (40) beats the neutral half-weight (20).
    expect(withData.find((r) => r.userId === 'u1').score)
      .toBeGreaterThan(noData.find((r) => r.userId === 'u1').score)
    expect(noData[0].reasons.join(' ')).toMatch(/not available/i)
  })

  it('marks the available flag and returns reasons', () => {
    const out = recommendTechnicians(
      { work_type: 'Tyre change', site: 'JEDDAH' },
      { technicians, skillsByUser: { u1: ['tyre_change'] }, board, assignments: [] },
    )
    const u1 = out.find((r) => r.userId === 'u1')
    expect(u1.available).toBe(true)
    expect(Array.isArray(u1.reasons)).toBe(true)
    expect(u1.reasons.length).toBeGreaterThan(0)
  })

  it('handles empty input', () => {
    expect(recommendTechnicians({}, {})).toEqual([])
    expect(recommendTechnicians(null, { technicians: [], board: [] })).toEqual([])
  })
})
