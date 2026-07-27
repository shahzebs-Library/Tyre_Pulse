import { describe, it, expect } from 'vitest'
import {
  periodWindow, change, comparisonRows, cpkView, monthlySeries, lastYearAligned,
  movers, evidenceBreakdown, buildCostCpkExport,
} from '../lib/costCpk'

// The snapshot below is the shape get_cost_cpk_overview actually returns, with
// the real KSA numbers from 2025-08-01..2026-07-31.
const SNAP = {
  ok: true,
  currency: 'SAR',
  blended: false,
  min_coverage: 0.25,
  windows: {
    current: { from: '2025-08-01', to: '2026-07-31' },
    previous: { from: '2024-08-01', to: '2025-07-31' },
    last_year: { from: '2024-08-01', to: '2025-07-31' },
    days: 365,
    previous_is_last_year: true,
  },
  totals: {
    current: { tyre: 2856963, spare: 2677303, oil: 431787, total: 5966053, lines: 29558, assets: 618 },
    previous: { tyre: 2634811, spare: 4035402, oil: 882236, total: 7552449, lines: 22816, assets: 523 },
    last_year: { tyre: 2634811, spare: 4035402, oil: 882236, total: 7552449, lines: 22816, assets: 523 },
  },
  cpk: {
    current: { km: 18214944, cpk: 0.225, spend_matched: 4091508, spend_total: 5966053, coverage_pct: 0.6858, assets_measured: 341, comparable: true },
    previous: { km: 29165, cpk: 1.893, spend_matched: 55216, spend_total: 7552449, coverage_pct: 0.0073, assets_measured: 5, comparable: false },
    last_year: { km: 29165, cpk: 1.893, spend_matched: 55216, spend_total: 7552449, coverage_pct: 0.0073, assets_measured: 5, comparable: false },
  },
  monthly: [
    { m: '2025-05', tyre: 10, spare: 20, oil: 5, total: 35 },
    { m: '2025-06', tyre: 12, spare: 22, oil: 6, total: 40 },
    { m: '2026-05', tyre: 30, spare: 40, oil: 10, total: 80 },
    { m: '2026-06', tyre: 35, spare: 45, oil: 12, total: 92 },
  ],
  by_site: [
    { label: 'NHC-ST', spend: 1014040, prev_spend: 1359571, lines: 6071 },
    { label: 'DIRIYAH-ST', spend: 600147, prev_spend: 333783, lines: 2645 },
    { label: 'MISK-ST', spend: 0, prev_spend: 65790, lines: 0 },
    { label: 'STEADY-ST', spend: 500, prev_spend: 500, lines: 3 },
  ],
  by_evidence: [
    { label: 'code-range', spend: 2613868, lines: 4554 },
    { label: 'default', spend: 2049051, lines: 18879 },
    { label: 'reviewed-master', spend: 97148, lines: 565 },
  ],
}

describe('periodWindow', () => {
  const day = new Date(Date.UTC(2026, 6, 27)) // 27 Jul 2026

  it('builds each period from an injected date, never the clock', () => {
    expect(periodWindow('this_month', day)).toEqual({ from: '2026-07-01', to: '2026-07-27' })
    expect(periodWindow('last_month', day)).toEqual({ from: '2026-06-01', to: '2026-06-30' })
    expect(periodWindow('last_3', day)).toEqual({ from: '2026-05-01', to: '2026-07-27' })
    expect(periodWindow('ytd', day)).toEqual({ from: '2026-01-01', to: '2026-07-27' })
    expect(periodWindow('last_12', day)).toEqual({ from: '2025-08-01', to: '2026-07-27' })
  })

  it('crosses a year boundary correctly', () => {
    const jan = new Date(Date.UTC(2026, 0, 15))
    expect(periodWindow('last_month', jan)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(periodWindow('last_3', jan)).toEqual({ from: '2025-11-01', to: '2026-01-15' })
  })

  it('handles the last day of a short month', () => {
    // last_month from 31 March must be all of February, not 31 February
    const mar = new Date(Date.UTC(2026, 2, 31))
    expect(periodWindow('last_month', mar)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
})

describe('change', () => {
  it('never returns a percentage against a zero base', () => {
    // "up from nothing" is not a percentage, it is a new cost line
    const c = change(0, 500)
    expect(c.pct).toBeNull()
    expect(c.direction).toBe('new')
  })

  it('calls out a cost line that stopped', () => {
    const c = change(65790, 0)
    expect(c.direction).toBe('stopped')
    expect(c.delta).toBe(-65790)
  })

  it('computes a normal rise and fall', () => {
    expect(change(100, 150)).toMatchObject({ delta: 50, pct: 0.5, direction: 'up' })
    expect(change(100, 75)).toMatchObject({ delta: -25, pct: -0.25, direction: 'down' })
    expect(change(100, 100).direction).toBe('flat')
  })

  it('reports unknown rather than zero when both sides are missing', () => {
    expect(change(null, null)).toMatchObject({ direction: 'unknown', delta: null })
  })
})

describe('comparisonRows', () => {
  it('gives every bucket plus a total, with both comparisons', () => {
    const { rows } = comparisonRows(SNAP)
    expect(rows.map((r) => r.key)).toEqual(['tyre', 'spare', 'oil', 'total'])
    const total = rows.find((r) => r.key === 'total')
    expect(total.current).toBe(5966053)
    expect(total.vsPrevious.direction).toBe('down')
    expect(total.vsPrevious.pct).toBeCloseTo(-0.21, 2)
  })

  it('flags when the previous window and last year are the same dates', () => {
    // a twelve month range makes them identical; drawing both is a duplicate bar
    expect(comparisonRows(SNAP).previousIsLastYear).toBe(true)
  })

  it('passes the blended flag through so money is never summed across currencies', () => {
    expect(comparisonRows({ ...SNAP, blended: true, currency: null }).blended).toBe(true)
  })

  it('survives an empty payload', () => {
    const { rows } = comparisonRows(null)
    expect(rows).toHaveLength(4)
    expect(rows[0].current).toBeNull()
  })
})

describe('cpkView', () => {
  it('withholds the comparison when the earlier window has almost no coverage', () => {
    // KSA really does look like 1.893 -> 0.225, an eight-fold "improvement" that
    // is entirely 5 measured assets against 341.
    const v = cpkView(SNAP)
    expect(v.current.cpk).toBe(0.225)
    expect(v.previous.cpk).toBe(1.893)
    expect(v.vsPrevious).toBeNull()
    expect(v.withheldReason).toMatch(/too few odometer readings/)
  })

  it('shows the comparison when both windows are well covered', () => {
    const good = {
      ...SNAP,
      cpk: {
        current: { ...SNAP.cpk.current },
        previous: { ...SNAP.cpk.previous, cpk: 0.3, coverage_pct: 0.6, comparable: true },
        last_year: { ...SNAP.cpk.last_year },
      },
    }
    const v = cpkView(good)
    expect(v.vsPrevious.direction).toBe('down')
    expect(v.withheldReason).toBeNull()
  })

  it('reports an unmeasured fleet as unknown, not as zero cost per km', () => {
    const none = { cpk: { current: { km: 0, cpk: null, coverage_pct: null, comparable: false } } }
    const v = cpkView(none)
    expect(v.current.cpk).toBeNull()
    expect(v.withheldReason).toMatch(/Not enough odometer readings/)
  })
})

describe('monthly series', () => {
  it('keeps the months in order and does not invent missing ones', () => {
    const s = monthlySeries(SNAP, 24)
    expect(s.labels).toEqual(['2025-05', '2025-06', '2026-05', '2026-06'])
    expect(s.total).toEqual([35, 40, 80, 92])
  })

  it('aligns last year to this year and leaves a gap where there is no match', () => {
    const ly = lastYearAligned(SNAP, 24)
    // 2026-05 and 2026-06 have 2025 counterparts; 2025-05/06 do not have 2024 ones
    expect(ly).toEqual([null, null, 35, 40])
  })

  it('tolerates an empty payload', () => {
    expect(monthlySeries(null).labels).toEqual([])
    expect(lastYearAligned(null)).toEqual([])
  })
})

describe('movers', () => {
  it('ranks by the size of the swing, not by spend', () => {
    const m = movers(SNAP, 'by_site', 10)
    expect(m[0].label).toBe('NHC-ST')      // -345,531
    expect(m[1].label).toBe('DIRIYAH-ST')  // +266,364
  })

  it('keeps a line that stopped, because it explains a fall', () => {
    const m = movers(SNAP, 'by_site', 10)
    const misk = m.find((r) => r.label === 'MISK-ST')
    expect(misk.direction).toBe('stopped')
  })

  it('drops the lines that did not move at all', () => {
    expect(movers(SNAP, 'by_site', 10).some((r) => r.label === 'STEADY-ST')).toBe(false)
  })

  it('returns empty for an unknown dimension', () => {
    expect(movers(SNAP, 'by_nothing')).toEqual([])
  })
})

describe('evidenceBreakdown', () => {
  it('measures how much money the fallback decided', () => {
    const e = evidenceBreakdown(SNAP)
    // 2,049,051 of 4,760,067 came from the fallback
    expect(e.weakShare).toBeCloseTo(0.43, 2)
    expect(e.rows.find((r) => r.key === 'default').weak).toBe(true)
    expect(e.rows.find((r) => r.key === 'reviewed-master').weak).toBe(false)
  })

  it('renames the raw provenance keys into something a manager can read', () => {
    const e = evidenceBreakdown(SNAP)
    expect(e.rows.find((r) => r.key === 'reviewed-master').label).toBe('Confirmed by a person')
  })

  it('returns a null share rather than dividing by zero', () => {
    expect(evidenceBreakdown({ by_evidence: [] }).weakShare).toBeNull()
  })
})

describe('buildCostCpkExport', () => {
  it('names the money columns after the currency', () => {
    const x = buildCostCpkExport(SNAP)
    expect(x.headers[2]).toBe('Current (SAR)')
  })

  it('never implies a single currency when the scope is blended', () => {
    const x = buildCostCpkExport({ ...SNAP, currency: null, blended: true })
    expect(x.headers[2]).toBe('Current (Mixed currencies)')
  })

  it('writes "Not comparable" instead of a misleading cpk change', () => {
    const row = buildCostCpkExport(SNAP).rows.find((r) => r.name.startsWith('Cost per km'))
    expect(row.change_vs_previous).toBe('Not comparable')
  })

  it('carries the movements for every dimension', () => {
    const sections = new Set(buildCostCpkExport(SNAP).rows.map((r) => r.section))
    expect(sections.has('Site movement')).toBe(true)
    expect(sections.has('Spend')).toBe(true)
  })
})
