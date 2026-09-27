import { describe, it, expect } from 'vitest'
import {
  enrichBatteries, filterBatteries, batteryKpis, attentionList, warrantyState,
  healthBand, batteryExportRows, activeBatteryFilterCount, EMPTY_BATTERY_FILTERS, assetOptions,
} from '../lib/batteriesAnalytics'

const NOW = Date.parse('2026-09-27T00:00:00Z')

const ROWS = [
  { id: 1, serial_no: 'B1', asset_no: 'TRK-1', brand: 'Exide', status: 'healthy', health_pct: 92, install_date: '2025-01-01', warranty_months: 24 },
  { id: 2, serial_no: 'B2', asset_no: 'TRK-2', brand: 'Varta', status: 'weak', health_pct: 55, install_date: '2024-10-01', warranty_months: 24 },
  { id: 3, serial_no: 'B3', asset_no: 'TRK-1', brand: 'Bosch', status: 'healthy', health_pct: '', install_date: '', warranty_months: '' },
  { id: 4, serial_no: 'B4', asset_no: 'TRK-3', status: 'replace', health_pct: 30, install_date: '2023-01-01', warranty_months: 12 },
  { id: 5, serial_no: 'B5', asset_no: 'TRK-4', status: 'retired', health_pct: 10, install_date: '2022-01-01', warranty_months: 12 },
]

describe('batteriesAnalytics', () => {
  const enriched = enrichBatteries(ROWS, NOW)

  it('classifies health honestly, never inventing 0% for a missing reading', () => {
    expect(healthBand(null).label).toBe('Not measured')
    expect(healthBand(80).key).toBe('good')
    expect(healthBand(60).key).toBe('fair')
    expect(healthBand(20).key).toBe('poor')
    expect(enriched[2]._health).toBeNull()
  })

  it('places warranty in a window against the injected clock', () => {
    expect(warrantyState(enriched[0], NOW).key).toBe('active')
    expect(warrantyState(enriched[1], NOW).key).toBe('soon')
    expect(warrantyState(enriched[2], NOW).key).toBe('unknown')
    expect(warrantyState(enriched[3], NOW).key).toBe('expired')
  })

  it('rolls up KPIs, excluding retired batteries from warranty exposure', () => {
    const k = batteryKpis(enriched)
    expect(k.total).toBe(5)
    expect(k.inService).toBe(4)
    expect(k.expiringSoon).toBe(1)
    expect(k.outOfWarranty).toBe(1)
    expect(k.measured).toBe(4)
    expect(k.measuredPct).toBe(80)
    expect(batteryKpis([]).measuredPct).toBeNull()
    expect(batteryKpis([]).avgHealth).toBeNull()
  })

  it('filters by search, status, asset, warranty and attention', () => {
    expect(filterBatteries(enriched, { search: 'bosch' }).map((r) => r.id)).toEqual([3])
    expect(filterBatteries(enriched, { status: 'weak' }).map((r) => r.id)).toEqual([2])
    expect(filterBatteries(enriched, { asset: 'TRK-1' }).map((r) => r.id)).toEqual([1, 3])
    expect(filterBatteries(enriched, { warranty: 'expired' }).map((r) => r.id)).toEqual([4, 5])
    expect(filterBatteries(enriched, { attentionOnly: true }).map((r) => r.id)).toEqual([2, 4])
    expect(filterBatteries(enriched, EMPTY_BATTERY_FILTERS)).toHaveLength(5)
  })

  it('orders the attention list replace-first then by lowest health', () => {
    expect(attentionList(enriched).map((r) => r.id)).toEqual([4, 2])
  })

  it('exports labels and keeps unknowns blank', () => {
    const out = batteryExportRows(enriched)
    expect(out[1]).toMatchObject({ status: 'Weak', warranty_state: 'Expiring soon', attention: 'Yes' })
    expect(out[2]).toMatchObject({ health_pct: '', expiry: '', health_band: 'Not measured', warranty_state: 'Not recorded' })
  })

  it('counts filters and lists assets', () => {
    expect(activeBatteryFilterCount(EMPTY_BATTERY_FILTERS)).toBe(0)
    expect(activeBatteryFilterCount({ search: 'x', status: 'weak', attentionOnly: true })).toBe(3)
    expect(assetOptions(ROWS)).toEqual(['TRK-1', 'TRK-2', 'TRK-3', 'TRK-4'])
  })
})
