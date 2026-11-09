import { describe, it, expect } from 'vitest'
import { detectAlerts, ALERT_TYPES } from '../lib/alertEngine'

function mockSupabase(tyres) {
  const builder = (rows) => {
    const b = {
      select: () => b, eq: () => b, neq: () => b, in: () => b, lt: () => b, lte: () => b, gte: () => b, gt: () => b,
      is: () => b, not: () => b, or: () => b, order: () => b, limit: () => b,
      range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    }
    return b
  }
  return { from: (t) => builder(t === 'tyre_records' ? tyres : []) }
}

const fleet = Array.from({ length: 6 }, (_, i) => ({
  id: `f${i}`, serial_no: `FLEET0000${i}`, country: 'KSA', asset_no: `F${i}`, status: 'Removed', removal_date: '2025-05-01',
  issue_date: '2025-01-01', cost_per_tyre: 500, km_at_fitment: 0, km_at_removal: 10000,
}))

describe('alertEngine HIGH_CPK on physical tyre lifetime CPK', () => {
  it('a tyre fitted on 3 vehicles is one tyre: its summed km keeps it below the threshold', async () => {
    const tyre = (id, asset, fit, rem, cost, d) => ({ id, serial_no: 'SER1234567', country: 'KSA', asset_no: asset, status: 'Removed', removal_date: d, issue_date: d, cost_per_tyre: cost, km_at_fitment: fit, km_at_removal: rem })
    const rows = [...fleet, tyre('a', 'X', 0, 2000, 500, '2025-01-01'), tyre('b', 'X', 2000, 12000, 500, '2025-02-01'), tyre('c', 'X', 12000, 22000, null, '2025-03-01')]
    const alerts = await detectAlerts(mockSupabase(rows), null)
    expect(alerts.filter((a) => a.type === ALERT_TYPES.HIGH_CPK && a.title.includes(' X'))).toHaveLength(0)
  })
  it('does not alert on a provisional (still fitted) tyre partial life', async () => {
    const young = (id) => ({ id, serial_no: `YOUNG0000${id}`, country: 'KSA', asset_no: 'Y', status: 'Fitted', issue_date: '2025-10-01', cost_per_tyre: 5000, km_at_fitment: 100, total_km: 500 })
    const alerts = await detectAlerts(mockSupabase([...fleet, young(1), young(2)]), null)
    expect(alerts.filter((a) => a.type === ALERT_TYPES.HIGH_CPK)).toHaveLength(0)
  })
  it('still alerts on completed tyres with a real high lifetime CPK (refit not a second purchase)', async () => {
    const hi = (id) => ({ id, serial_no: `HIGH0000${id}`, country: 'KSA', asset_no: 'H', status: 'Removed', removal_date: '2025-04-01', issue_date: '2025-02-01', cost_per_tyre: 5000, km_at_fitment: 0, km_at_removal: 1000 })
    const alerts = await detectAlerts(mockSupabase([...fleet, hi(1), hi(2)]), null)
    const a = alerts.find((x) => x.type === ALERT_TYPES.HIGH_CPK && x.title.includes(' H'))
    expect(a).toBeDefined()
    expect(a.data.tyres).toBe(2)
  })
})
