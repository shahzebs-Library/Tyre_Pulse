import { describe, it, expect } from 'vitest'
import { stageDepartment } from '../lib/accidentStages'
import {
  buildClaimBoard, claimBoardKpis, teamRows, waitingRows, skippedRows, teamExportRows, dayText,
} from '../lib/claimProgressBoardAnalytics'

const DAY = 86400000
const NOW = new Date('2026-07-28T00:00:00Z').getTime()
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString()
const ev = (accident_id, stage, { entered, exited = null, skipped = false, basis = 'observed' } = {}) => ({
  accident_id, stage, department: stageDepartment(stage), entered_at: entered, exited_at: exited, skipped, basis,
})

describe('claimProgressBoardAnalytics', () => {
  it('does not cap the waiting list at ten', () => {
    const cases = Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, asset_no: `TM${i}`, workflow_stage: 'insurance_claim' }))
    const events = cases.map((c, i) => ev(c.id, 'insurance_claim', { entered: at(i + 1) }))
    const board = buildClaimBoard(cases, events, NOW)
    expect(board.waiting).toHaveLength(14)
    expect(waitingRows(board)[0].heldDays).toBeGreaterThanOrEqual(waitingRows(board)[13].heldDays)
    const k = claimBoardKpis(board)
    expect(k.open).toBe(14)
    expect(k.teamsHolding).toBeGreaterThanOrEqual(1)
    expect(k.longestDays).toBe(14)
    expect(k.longestLabel).toMatch(/TM13/)
  })

  it('reports null longest wait and missing-field count when nothing is timed', () => {
    const board = buildClaimBoard([{ id: 'a', workflow_stage: 'reported' }], [], NOW)
    const k = claimBoardKpis(board)
    expect(k.longestDays).toBeNull()
    expect(k.casesMissingFields).toBeNull()
    expect(k.ledgerReady).toBe(false)
  })

  it('flattens team, skipped and export rows with approx labels', () => {
    const board = {
      teams: [{ department: 'Insurance', holdingNow: 2, medianDays: 25, worstDays: 40, anyEstimated: true, missingFields: 3, casesWithGaps: 1, skippedStages: 0 }],
      skips: { total: 2, cases: [{ id: 'x', reference: 'ACC-1', count: 2, stages: [{ label: 'Repair approval' }, { label: 'Final inspection' }] }] },
      waiting: [],
    }
    expect(teamRows(board)[0]).toMatchObject({ approx: true, holdingNow: 2 })
    expect(teamExportRows(board)[0]).toMatchObject({ median: '25d approx', worst: '40d' })
    expect(skippedRows(board)[0]).toEqual({ id: 'x', reference: 'ACC-1', count: 2, stages: 'Repair approval, Final inspection' })
    expect(claimBoardKpis(board)).toMatchObject({ skippedStages: 2, skippedCases: 1 })
  })

  it('formats durations honestly', () => {
    expect(dayText(null)).toBe('N/A')
    expect(dayText(0.5)).toBe('12h')
    expect(dayText(3)).toBe('3d')
  })
})
