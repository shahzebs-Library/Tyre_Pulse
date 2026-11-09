import { describe, it, expect } from 'vitest'
import {
  sizeMetrics, sizeKpis, brandBreakdown, sizeBrandMatrix, positionCompliance, comboTrend,
} from '../lib/tyreSizeAnalytics'
import { typeSizeStats } from '../lib/sizeOptimizerView'
import { threeVehicles, refitSameVehicle, fit } from './lifetimeFixtures.groupB'

const sized = (rows, size = '315/80R22.5', brand = 'X') => rows.map((r) => ({ ...r, size, brand }))
const label = (s) => s

describe('size analytics on physical tyres', () => {
  it('one tyre on three vehicles is ONE tyre, priced once, km summed', () => {
    const rows = sized(threeVehicles())
    const [m] = sizeMetrics(rows, label)
    expect(m.count).toBe(1)
    expect(m.fitments).toBe(3)
    expect(m.avgLife).toBe(80000)
    expect(m.vehicles).toHaveLength(3)
    const k = sizeKpis(rows, [m])
    expect(k.total).toBe(1)
    expect(k.fleetAvgCpk).toBeCloseTo(900 / 80000, 10)
    expect(brandBreakdown(rows, '315/80R22.5', label)[0].count).toBe(1)
  })

  it('size CPK is weighted and a same-vehicle refit is not a second purchase', () => {
    // 5 identical refitted tyres so the size passes MIN_RECORDS_CPK.
    const rows = [1, 2, 3, 4, 5].flatMap((n) => sized(refitSameVehicle({ serial_no: `EP060420${n}` })))
    const [m] = sizeMetrics(rows, label)
    expect(m.count).toBe(5)
    expect(m.cpkSample).toBe(5)
    expect(m.avgCpk).toBeCloseTo(800 / 40000, 10)
    const matrix = sizeBrandMatrix(rows, [m], label)
    expect(matrix.matrix['315/80R22.5'].X).toBeCloseTo(800 / 40000, 10)
    const stats = [...typeSizeStats(rows, label).values()][0]
    expect(stats.count).toBe(5)
    expect(stats.avgCpk).toBeCloseTo(800 / 40000, 10)
  })

  it('failure rate and position compliance stay per fitment row', () => {
    const rows = sized(threeVehicles()).map((r, i) => ({ ...r, risk_level: i === 0 ? 'High' : 'Low', position: 'LHF1' }))
    const [m] = sizeMetrics(rows, label)
    expect(m.ratedCount).toBe(3)
    expect(m.failRate).toBeCloseTo(100 / 3, 6)
    expect(positionCompliance(rows, label)[0].total).toBe(3)
  })

  it('monthly combo trend buckets physical tyres by latest fitment month', () => {
    const rows = sized([...threeVehicles(), fit({ id: 'z', serial_no: 'ZZZ123456', issue_date: '2025-12-02', km_at_fitment: 10, km_at_removal: 10010, cost_per_tyre: 100 })])
    const t = comboTrend(rows, label, new Date(2025, 11, 20))
    const dec = t.months.indexOf('2025-12')
    const sep = t.months.indexOf('2025-09')
    expect(t.series[0].data[dec]).toBeCloseTo(100 / 10000, 10)
    expect(t.series[0].data[sep]).toBeCloseTo(900 / 80000, 10)
  })
})
