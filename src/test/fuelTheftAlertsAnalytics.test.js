import { describe, it, expect } from 'vitest'
import {
  enrichAlerts, filterAlerts, lossByCurrency, lossBasis, severityBreakdown, statusBreakdown,
  repeatAssets, buildAlertKpis, buildAlertInsights, alertExportRows, isOpenAlert,
} from '../lib/fuelTheftAlertsAnalytics'

const NOW = new Date('2026-07-20T12:00:00Z').getTime()
const ROWS = [
  { id: 1, asset_no: 'T1', drop_litres: 100, fuel_price_per_litre: 2, severity: 'critical', status: 'open', currency: 'SAR', detected_at: '2026-07-01T10:00:00Z' },
  { id: 2, asset_no: 'T1', estimated_loss: 50, severity: 'low', status: 'resolved', currency: 'SAR', detected_at: '2026-07-18T10:00:00Z' },
  { id: 3, asset_no: 'T2', severity: 'Medium', status: 'Investigating', detected_at: '2026-07-19T10:00:00Z', drop_litres: 40, expected_litres: 10 },
]

describe('fuelTheftAlertsAnalytics', () => {
  it('derives loss basis and keeps an unrecorded loss null', () => {
    expect(lossBasis(ROWS[0])).toBe('derived')
    expect(lossBasis(ROWS[1])).toBe('stored')
    expect(lossBasis(ROWS[2])).toBe('unknown')
    const e = enrichAlerts(ROWS, NOW, 'SAR')
    expect(e[2].loss).toBeNull()
    expect(e[2].excessLitres).toBe(30)
    expect(e[0].ageDays).toBe(19)
    expect(e[1].ageDays).toBeNull()
  })

  it('filters by status (case-insensitive), open state and date window', () => {
    expect(filterAlerts(ROWS, { status: 'investigating' }).map((r) => r.id)).toEqual([3])
    expect(filterAlerts(ROWS, { openOnly: true }).map((r) => r.id)).toEqual([1, 3])
    expect(filterAlerts(ROWS, { from: '2026-07-18' }).map((r) => r.id)).toEqual([2, 3])
    expect(isOpenAlert({ status: 'Dismissed' })).toBe(false)
  })

  it('never totals losses across currencies', () => {
    expect(lossByCurrency(ROWS, 'SAR').total).toBe(250)
    const mixed = lossByCurrency([...ROWS, { estimated_loss: 9, currency: 'AED' }], 'SAR')
    expect(mixed.total).toBeNull()
    expect(mixed.mixed).toBe(true)
  })

  it('builds KPIs, breakdowns, repeat assets and insights', () => {
    const k = buildAlertKpis(ROWS, NOW, 'SAR')
    expect(k).toMatchObject({ total: 3, open: 2, criticalOpen: 1, litresLost: 140, oldestOpenDays: 19, staleOpen: 1, unknownLoss: 1 })
    expect(severityBreakdown(ROWS).find((s) => s.key === 'medium').count).toBe(1)
    expect(statusBreakdown(ROWS).find((s) => s.key === 'investigating').count).toBe(1)
    const rep = repeatAssets(ROWS, 'SAR')
    expect(rep).toHaveLength(1)
    expect(rep[0]).toMatchObject({ asset_no: 'T1', alerts: 2, open: 1 })
    expect(rep[0].loss.total).toBe(250)
    expect(buildAlertInsights(ROWS, NOW, 'SAR').length).toBeGreaterThan(2)
    expect(buildAlertKpis([], NOW).litresLost).toBeNull()
  })

  it('exports blanks and a loss basis', () => {
    const x = alertExportRows(ROWS, NOW, 'SAR')
    expect(x[0]).toMatchObject({ estimated_loss: 200, loss_basis: 'Drop x price', currency: 'SAR', severity: 'Critical' })
    expect(x[2]).toMatchObject({ estimated_loss: '', loss_basis: 'Not recorded', currency: '' })
  })
})
