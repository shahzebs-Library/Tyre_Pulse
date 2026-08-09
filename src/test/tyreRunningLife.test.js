import { describe, it, expect } from 'vitest'
import {
  shapeRow, shapeRunningLife, summarize, bandFor, filterRows, fmtNum,
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
