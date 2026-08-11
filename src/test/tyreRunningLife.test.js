import { describe, it, expect } from 'vitest'
import {
  shapeRow, shapeRunningLife, summarize, bandFor, filterRows, fmtNum,
  coverage, coverageNote,
} from '../lib/tyreRunningLife'

const row = (over = {}) => ({
  serial_no: 'S1', asset_no: 'TM100', position: 'LHF1', vehicle_type: 'TR-MIXER',
  unit: 'km', site: 'NHC', country: 'KSA', brand: 'PIRELLI', size: '315/80R22.5',
  fitted_on: '2026-01-01', km_at_fitment: 100000, current_km: 130000, km_run: 30000,
  hours_at_fitment: null, current_hours: null, hours_run: null,
  expected_life_km: 60000, life_sample: 40, remaining_km: 30000, life_used_pct: 50,
  ...over,
})

describe('tyreRunningLife', () => {
  it('shapes a row with numeric coercion and hour-unit mapping', () => {
    const r = shapeRow(row({ unit: 'engine_hours', km_run: '30000' }))
    expect(r.unit).toBe('hours')
    expect(r.kmRun).toBe(30000)
    expect(r.remainingKm).toBe(30000)
  })

  it('null stays null - never a fabricated zero', () => {
    const r = shapeRow(row({ km_run: null, remaining_km: null, life_used_pct: null }))
    expect(r.kmRun).toBeNull()
    expect(r.remainingKm).toBeNull()
    expect(bandFor(r)).toBe('unknown')
    expect(fmtNum(r.kmRun)).toBe('N/A')
  })

  it('bands: overdue at 0 remaining, due-soon under 10k or >=90% used', () => {
    expect(bandFor(shapeRow(row({ remaining_km: 0, life_used_pct: 120 })))).toBe('overdue')
    expect(bandFor(shapeRow(row({ remaining_km: 5000, life_used_pct: 80 })))).toBe('due-soon')
    expect(bandFor(shapeRow(row({ remaining_km: 20000, life_used_pct: 92 })))).toBe('due-soon')
    expect(bandFor(shapeRow(row({ remaining_km: 25000, life_used_pct: 65 })))).toBe('mid-life')
    expect(bandFor(shapeRow(row({ remaining_km: 40000, life_used_pct: 30 })))).toBe('healthy')
  })

  it('summarize counts measurable/overdue/due-soon and averages only measured pcts', () => {
    const rows = [
      shapeRow(row({ remaining_km: 0, life_used_pct: 150 })),
      shapeRow(row({ remaining_km: 4000, life_used_pct: 93 })),
      shapeRow(row({ km_run: null, remaining_km: null, life_used_pct: null })),
      shapeRow(row({ hours_run: 500 })),
    ]
    const s = summarize(rows)
    expect(s.total).toBe(4)
    expect(s.measurableKm).toBe(3)
    expect(s.measurableHours).toBe(1)
    expect(s.overdue).toBe(1)
    expect(s.dueSoon).toBe(1)
    expect(s.avgUsedPct).toBe(Math.round((150 + 93 + 50) / 3))
  })

  it('summarize of nothing is honest zero/null', () => {
    const s = summarize([])
    expect(s.total).toBe(0)
    expect(s.avgUsedPct).toBeNull()
  })

  it('filterRows: search across serial/asset/site, band filter, unit filter', () => {
    const rows = [
      shapeRow(row()),
      shapeRow(row({ serial_no: 'S2', asset_no: 'BH020', unit: 'engine_hours', remaining_km: 0 })),
    ]
    expect(filterRows(rows, { search: 'bh020' })).toHaveLength(1)
    expect(filterRows(rows, { band: 'overdue' })).toHaveLength(1)
    expect(filterRows(rows, { unit: 'hours' })).toHaveLength(1)
    expect(filterRows(rows, {})).toHaveLength(2)
  })

  it('shapeRunningLife degrades a failed payload', () => {
    expect(shapeRunningLife(null).ok).toBe(false)
    expect(shapeRunningLife({ ok: false }).rows).toEqual([])
    const good = shapeRunningLife({ ok: true, rows: [row()] })
    expect(good.ok).toBe(true)
    expect(good.rows).toHaveLength(1)
    expect(good.summary.total).toBe(1)
  })
})

describe('V489 additions: days + basis', () => {
  it('shapes days and basis fields', () => {
    const r = shapeRow({
      serial_no: 'S9', asset_no: 'TM1', km_run: 30000, expected_life_km: 60000,
      remaining_km: 30000, life_used_pct: 50, days_on: 120, expected_days: 300,
      day_sample: 40, remaining_days: 180, life_basis: 'measured_type', life_sample: 25,
    })
    expect(r.daysOn).toBe(120)
    expect(r.remainingDays).toBe(180)
    expect(r.lifeBasis).toBe('measured_type')
  })

  it('basisLabel: manual has no sample, measured shows it, missing is honest', async () => {
    const { basisLabel } = await import('../lib/tyreRunningLife')
    expect(basisLabel(shapeRow({ life_basis: 'manual' }))).toBe('Your target')
    expect(basisLabel(shapeRow({ life_basis: 'measured_type', life_sample: 25 }))).toBe('Type avg (25)')
    expect(basisLabel(shapeRow({ life_basis: 'measured_size', life_sample: 7 }))).toBe('Size avg (7)')
    expect(basisLabel(shapeRow({}))).toBe('No baseline')
  })
})

describe('inFittedRange', () => {
  it('passes everything with no range; excludes undated rows when a range is active', async () => {
    const { inFittedRange } = await import('../lib/tyreRunningLife')
    const dated = shapeRow(row({ fitted_on: '2026-03-15' }))
    const undated = shapeRow(row({ fitted_on: null }))
    expect(inFittedRange(dated)).toBe(true)
    expect(inFittedRange(undated)).toBe(true)
    expect(inFittedRange(dated, '2026-03-01', '2026-03-31')).toBe(true)
    expect(inFittedRange(dated, '2026-04-01', '')).toBe(false)
    expect(inFittedRange(dated, '', '2026-02-28')).toBe(false)
    expect(inFittedRange(undated, '2026-01-01', '')).toBe(false)
  })
})

describe('filterDescription', () => {
  it('describes no filters honestly', async () => {
    const { filterDescription } = await import('../lib/tyreRunningLife')
    expect(filterDescription()).toBe('All active tyres')
    expect(filterDescription({ search: '  ', band: 'all', unit: 'all' })).toBe('All active tyres')
  })

  it('composes search, band, unit and date range in plain English', async () => {
    const { filterDescription } = await import('../lib/tyreRunningLife')
    expect(filterDescription({ search: 'TM1', band: 'due-soon', unit: 'km', fromDate: '2026-01-01', toDate: '2026-06-30' }))
      .toBe('search "TM1", state: Due soon, km-measured assets only, fitted 2026-01-01 to 2026-06-30')
    expect(filterDescription({ fromDate: '2026-01-01' })).toBe('fitted from 2026-01-01')
    expect(filterDescription({ toDate: '2026-06-30' })).toBe('fitted up to 2026-06-30')
    expect(filterDescription({ unit: 'hours' })).toBe('hour-measured assets only')
  })
})

describe('actionRows', () => {
  it('selects only overdue + due-soon, overdue first, most-used first within a group', async () => {
    const { actionRows } = await import('../lib/tyreRunningLife')
    const rows = [
      shapeRow(row({ serial_no: 'HEALTHY', remaining_km: 40000, life_used_pct: 30 })),
      shapeRow(row({ serial_no: 'SOON-93', remaining_km: 4000, life_used_pct: 93 })),
      shapeRow(row({ serial_no: 'OVER-150', remaining_km: 0, life_used_pct: 150 })),
      shapeRow(row({ serial_no: 'SOON-98', remaining_km: 1000, life_used_pct: 98 })),
      shapeRow(row({ serial_no: 'UNKNOWN', km_run: null, remaining_km: null, life_used_pct: null })),
    ]
    const out = actionRows(rows)
    expect(out.map((r) => r.serial)).toEqual(['OVER-150', 'SOON-98', 'SOON-93'])
  })

  it('empty in, empty out', async () => {
    const { actionRows } = await import('../lib/tyreRunningLife')
    expect(actionRows([])).toEqual([])
    expect(actionRows()).toEqual([])
  })
})

describe('dueLabel', () => {
  it('Due for overdue/due-soon, Not due otherwise, Unknown when unmeasurable', async () => {
    const { dueLabel } = await import('../lib/tyreRunningLife')
    expect(dueLabel(shapeRow(row({ remaining_km: 0, life_used_pct: 130 })))).toBe('Due')
    expect(dueLabel(shapeRow(row({ remaining_km: 3000, life_used_pct: 95 })))).toBe('Due')
    expect(dueLabel(shapeRow(row({ remaining_km: 30000, life_used_pct: 50 })))).toBe('Not due')
    expect(dueLabel(shapeRow(row({ km_run: null, remaining_km: null, life_used_pct: null })))).toBe('Unknown')
  })
})

describe('coverage - why a Km run cell is blank', () => {
  // Shape mirrors the live KSA fleet: of 3,505 active tyres only 2,059 can show
  // a km run, and NONE of them is missing its fitment km - the gap is entirely
  // that the vehicle's current odometer is unknown, plus plant on hour meters.
  const row = (over = {}) => ({ kmRun: 1000, unit: 'km', currentKm: 5000, kmAtFitment: 4000, ...over })

  it('separates the three real reasons a km run is missing', () => {
    const c = coverage([
      row(),                                                   // measurable
      row({ kmRun: null, currentKm: null }),                   // no odometer on the vehicle
      row({ kmRun: null, currentKm: null }),
      row({ kmRun: null, unit: 'engine_hours' }),              // plant, correctly on hours
      row({ kmRun: null, kmAtFitment: null }),                 // no fitment km
    ])
    expect(c.noCurrentKm).toBe(2)
    expect(c.onHours).toBe(1)
    expect(c.noFitmentKm).toBe(1)
  })

  it('says nothing when every tyre on screen is measurable', () => {
    const s = summarize([row(), row()])
    expect(coverageNote(s)).toBe('')
  })

  it('names the count and points at the fix', () => {
    const s = summarize([row(), row({ kmRun: null, currentKm: null })])
    const note = coverageNote(s)
    expect(note).toContain('1 of 2')
    expect(note).toMatch(/no current odometer reading/i)
    // it must tell the reader what to DO, not just that data is missing
    expect(note).toMatch(/log a meter reading/i)
  })

  it('returns an empty note for an empty view rather than dividing by nothing', () => {
    expect(coverageNote(summarize([]))).toBe('')
    expect(coverageNote(null)).toBe('')
  })
})
