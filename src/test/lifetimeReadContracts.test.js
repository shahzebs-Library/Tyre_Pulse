import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { computeCpkFleet } from '../lib/kpiEngine'

// The callers of the lifetime engine must select the fields it groups on,
// otherwise every fitment becomes an unrelated tyre and refit km is lost.
const NEED = ['serial_no', 'status', 'removal_date', 'total_km']
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('lifetime read contracts', () => {
  for (const file of ['src/lib/api/engineeringKpi.js', 'src/lib/api/costCenter.js']) {
    it(`${file} selects the lifetime identity fields`, () => {
      const src = read(file)
      for (const col of NEED) expect(src).toMatch(new RegExp(`[,'\\s]${col}[,'\\s]`))
    })
  }

  it('a two-stint tyre priced once reports lifetime CPK over both stints', () => {
    const rows = [
      { id: 'a', serial_no: 'ABC12345', country: 'KSA', asset_no: 'TM1', issue_date: '2026-01-01', removal_date: '2026-03-01',
        status: 'Removed', cost_per_tyre: 1000, km_at_fitment: 10000, km_at_removal: 30000, total_km: 20000 },
      { id: 'b', serial_no: 'ABC12345', country: 'KSA', asset_no: 'TM2', issue_date: '2026-03-05', removal_date: '2026-05-01',
        status: 'Removed', cost_per_tyre: null, km_at_fitment: 50000, km_at_removal: 70000, total_km: 20000 },
    ]
    expect(computeCpkFleet(rows).fleetAvgCpk).toBeCloseTo(0.025, 6)
  })
})
