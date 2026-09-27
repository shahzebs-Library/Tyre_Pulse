import { describe, it, expect } from 'vitest'
import {
  filterSessions, distinctValues, currencyMix, summarizeSessions, sessionsByAsset,
  monthlyEnergy, sessionExportRows, SESSION_EXPORT_COLUMNS, statusLabel,
} from '../lib/chargingSessionsAnalytics'

const ROWS = [
  { id: 1, asset_no: 'EV1', station_name: 'Depot', energy_kwh: 40, cost: 60, currency: 'SAR', status: 'completed', started_at: '2026-05-10T08:00:00', start_soc: 20, end_soc: 80 },
  { id: 2, asset_no: 'EV1', station_name: 'Depot', energy_kwh: 10, cost: 20, currency: 'SAR', status: 'failed', started_at: '2026-06-02T08:00:00' },
  { id: 3, asset_no: 'EV2', station_name: 'Mall', energy_kwh: null, cost: null, status: null, started_at: null },
]

describe('chargingSessionsAnalytics', () => {
  it('filters by asset, status, station and text', () => {
    expect(filterSessions(ROWS, { asset: 'EV1' })).toHaveLength(2)
    expect(filterSessions(ROWS, { status: 'failed' })[0].id).toBe(2)
    expect(filterSessions(ROWS, { station: 'Mall' })[0].id).toBe(3)
    expect(filterSessions(ROWS, { query: 'depot' })).toHaveLength(2)
    expect(distinctValues(ROWS, 'station_name')).toEqual(['Depot', 'Mall'])
  })

  it('adds money only inside one currency', () => {
    expect(currencyMix(ROWS)).toEqual({ currencies: ['SAR'], single: 'SAR', mixed: false })
    const s = summarizeSessions(ROWS)
    expect(s.totalCost).toBe(80)
    expect(s.avgCostPerKwh).toBeCloseTo(1.6)
    const mixed = summarizeSessions([...ROWS, { asset_no: 'EV3', energy_kwh: 5, cost: 5, currency: 'AED' }])
    expect(mixed.mixedCurrency).toBe(true)
    expect(mixed.totalCost).toBeNull()
    expect(mixed.avgCostPerKwh).toBeNull()
  })

  it('reports N/A cost, not zero, when nothing is costed', () => {
    expect(summarizeSessions([ROWS[2]]).totalCost).toBeNull()
    expect(summarizeSessions([]).issueRatePct).toBeNull()
  })

  it('counts failed and interrupted sessions as issues', () => {
    const s = summarizeSessions(ROWS)
    expect(s.statusCounts.failed).toBe(1)
    expect(s.unsetStatus).toBe(1)
    expect(Math.round(s.issueRatePct)).toBe(33)
  })

  it('rolls up by asset with a null cost for uncosted assets', () => {
    const out = sessionsByAsset(ROWS)
    expect(out[0]).toMatchObject({ asset: 'EV1', sessions: 2, kwh: 50, cost: 80 })
    expect(out[1]).toMatchObject({ asset: 'EV2', cost: null, costPerKwh: null })
  })

  it('buckets energy by month and counts undated sessions separately', () => {
    const { buckets, undated } = monthlyEnergy(ROWS, new Date('2026-06-15T12:00:00').getTime(), 3)
    expect(buckets.map((b) => b.kwh)).toEqual([0, 40, 10])
    expect(undated).toBe(1)
  })

  it('exports every column with readable status', () => {
    const out = sessionExportRows(ROWS)
    expect(Object.keys(out[0])).toEqual(SESSION_EXPORT_COLUMNS.map((c) => c.key))
    expect(out[0].cost_per_kwh).toBe(1.5)
    expect(out[2].status).toBe('Not set')
    expect(statusLabel('in_progress')).toBe('In progress')
  })
})
