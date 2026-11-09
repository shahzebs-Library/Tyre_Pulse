import { describe, it, expect } from 'vitest'
import { assetCpkRows } from '../lib/engineeringKpiAnalytics'

const r = (o) => ({ serial_no: 'YMA55312', country: 'KSA', status: 'Removed', ...o })

describe('assetCpkRows avg life per physical tyre', () => {
  const kpis = { cpkByAsset: [{ asset_no: 'TM3', avgCpk: 0.02 }, { asset_no: 'TM1', avgCpk: 0.01 }] }
  const three = [
    r({ id: 1, asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 1000 }),
    r({ id: 2, asset_no: 'TM2', issue_date: '2025-03-05', removal_date: '2025-06-01', km_at_fitment: 50000, km_at_removal: 60000, cost_per_tyre: 1000 }),
    r({ id: 3, asset_no: 'TM3', issue_date: '2025-06-05', removal_date: '2025-09-01', km_at_fitment: 5000, km_at_removal: 35000, cost_per_tyre: 1000 }),
  ]
  it('one tyre on 3 vehicles is one tyre on its latest asset with 60,000 km', () => {
    const rows = assetCpkRows(kpis, three, null)
    const tm3 = rows.find((x) => x.assetNo === 'TM3')
    expect(tm3.avgLifeKm).toBe(60000)
    expect(tm3.tyres).toBe(1)
    expect(rows.find((x) => x.assetNo === 'TM1').avgLifeKm).toBeNull()
  })
  it('a refit on the same vehicle does not split or double the tyre', () => {
    const refit = [three[0], { ...three[1], asset_no: 'TM1' }]
    const tm1 = assetCpkRows(kpis, refit, null).find((x) => x.assetNo === 'TM1')
    expect(tm1.tyres).toBe(1)
    expect(tm1.avgLifeKm).toBe(30000)
  })
  it('records (fitment events) stay per row', () => {
    const tm1 = assetCpkRows(kpis, [three[0], { ...three[1], asset_no: 'TM1' }], null).find((x) => x.assetNo === 'TM1')
    expect(tm1.records).toBe(2)
  })
})
