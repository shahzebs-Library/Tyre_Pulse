import { describe, it, expect } from 'vitest'
import {
  inspectionOverview, focusMatches, focusSummary, OVERVIEW_FOCUS, FOCUS_KEYS,
} from '../lib/inspectionTyreFlags'

/**
 * The overview tiles on the Inspections register are clickable drill-downs. The contract
 * that matters is that the TILE and the FILTER agree, so this file pins them against each
 * other rather than against hand-written expectations.
 *
 * The subtle part is that three tiles do not count inspections at all. "Tyres past life"
 * counts TYRES, "Vehicles with tyres due" counts VEHICLES - so the filtered row count is
 * legitimately smaller than the tile, and the screen has to SAY so. These tests pin that
 * relationship in the direction it is actually true, which is the only way it stays
 * honest as the data changes.
 */

const flagMap = {
  // one vehicle, 2 overdue + 1 due soon
  TM001: { count: 3, overdue: ['LHF1', 'LHF2'], dueSoon: ['RHR1'] },
  // one vehicle, due soon only
  TM002: { count: 1, overdue: [], dueSoon: ['LHF1'] },
  // present but nothing due - must NOT count as flagged
  TM003: { count: 0, overdue: [], dueSoon: [] },
}

const rows = [
  // two inspections on the SAME flagged vehicle - the tyre counts must not double
  { id: 1, asset_no: 'TM001', approval_status: 'approved', inspection_date: '2026-08-01',
    tyre_conditions: [{ position: 'LHF1', condition: 'Damaged' }] },
  { id: 2, asset_no: 'TM001', approval_status: 'pending_approval', inspection_date: '2026-08-02',
    tyre_conditions: [] },
  { id: 3, asset_no: 'TM002', approval_status: 'approved', inspection_date: '2026-08-03',
    tyre_conditions: [{ position: 'RHF1', condition: 'Puncture' }] },
  // unflagged vehicle, legacy 'pending' token
  { id: 4, asset_no: 'TM003', approval_status: 'pending', inspection_date: '2026-08-04',
    tyre_conditions: [] },
  // no asset at all - must never crash a predicate
  { id: 5, asset_no: '', approval_status: 'approved', inspection_date: '2026-08-05',
    tyre_conditions: [] },
]

const apply = (key) => rows.filter((r) => focusMatches(r, key, flagMap))
const overview = inspectionOverview(rows, flagMap, {})

describe('overview tiles drill down to the rows behind them', () => {
  it('every tile key has a definition and a predicate', () => {
    for (const k of FOCUS_KEYS) {
      expect(OVERVIEW_FOCUS[k].label).toBeTruthy()
      expect(['inspections', 'vehicles', 'tyres']).toContain(OVERVIEW_FOCUS[k].measures)
    }
  })

  it('inspection-counting tiles filter to EXACTLY their own number', () => {
    // These two are the only tiles where tile number == row count, and that has to hold
    // exactly or the drill-down is lying.
    expect(apply('approved')).toHaveLength(overview.approved)
    expect(apply('pending')).toHaveLength(overview.pendingApproval)
  })

  it('the legacy "pending" token is counted the same way the tile counts it', () => {
    // inspectionOverview accepts both 'pending_approval' and 'pending'; the filter must
    // not quietly drop the legacy rows.
    expect(apply('pending').map((r) => r.id)).toEqual([2, 4])
  })

  it('vehicle- and tyre-counting tiles filter to FEWER rows than the tile, never more', () => {
    // The honest relationship: the tile counts things, the table lists inspections.
    expect(focusSummary(apply('tyres_due'), 'tyres_due', flagMap).units)
      .toBe(overview.vehiclesWithTyresDue)
    expect(focusSummary(apply('overdue'), 'overdue', flagMap).units).toBe(overview.tyresOverdue)
    expect(focusSummary(apply('due_soon'), 'due_soon', flagMap).units).toBe(overview.tyresDueSoon)
    expect(focusSummary(apply('damaged'), 'damaged', flagMap).units).toBe(overview.damagedFound)
  })

  it('two inspections on one vehicle do not double-count its tyres', () => {
    // TM001 appears twice and holds 2 overdue tyres. The answer is 2, not 4.
    expect(overview.tyresOverdue).toBe(2)
    expect(focusSummary(apply('overdue'), 'overdue', flagMap).units).toBe(2)
    expect(apply('overdue').map((r) => r.id)).toEqual([1, 2])
  })

  it('a vehicle whose flag entry has count 0 is not flagged', () => {
    expect(apply('tyres_due').some((r) => r.asset_no === 'TM003')).toBe(false)
  })

  it('an unknown or empty focus shows everything, never nothing', () => {
    // A stale URL carrying a retired focus must not render an empty register that reads
    // as "there are no inspections".
    for (const k of ['', 'all', undefined, null, 'retired_key']) {
      expect(rows.filter((r) => focusMatches(r, k, flagMap))).toHaveLength(rows.length)
    }
    expect(focusSummary(rows, 'retired_key', flagMap)).toBeNull()
  })

  it('survives a missing flagMap and rows without an asset', () => {
    expect(() => rows.map((r) => focusMatches(r, 'overdue'))).not.toThrow()
    expect(rows.filter((r) => focusMatches(r, 'overdue', {}))).toHaveLength(0)
    expect(focusSummary([], 'overdue', {})).toEqual(
      expect.objectContaining({ rows: 0, units: 0 }),
    )
  })
})
