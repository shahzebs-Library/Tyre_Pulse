import { describe, it, expect } from 'vitest'
import { buildReadings } from '../lib/pressureIntelligenceAnalytics'
import {
  viewStatus, filterView, latestPerAsset, specLookup, decorate, fleetKpis,
  distributionSegments, positionBars, dailyTrend, alertRows, vehicleRows,
  fleetExportRows, FLEET_EXPORT_COLS, FLEET_EXPORT_HEADERS, vehicleTypesOf,
} from '../lib/pressureIntelligenceView'

const ins = (id, asset, date, tc, extra = {}) => ({ id, asset_no: asset, inspection_date: date, vehicle_type: 'BUS', site: 'NHC', tyre_conditions: tc, ...extra })
const wheels = (psi, extra = {}) => ({
  LHF1: { pressure_psi: psi[0], ...(extra.LHF1 || {}) },
  RHF1: { pressure_psi: psi[1] },
  LHR1: { pressure_psi: psi[2] },
  RHR1: { pressure_psi: psi[3] },
})

const DATA = [
  ins(1, 'TM1', '2026-09-20', wheels([100, 100, 100, 100])),
  ins(2, 'TM1', '2026-09-25', wheels([100, 100, 70, 100], { LHF1: { serial_number: 'SN-1' } })),
  ins(3, 'TM2', '2026-09-24', wheels([100, 100, 130, 100], { LHF1: { condition: 'Flat' } }), { vehicle_type: 'TR-MIXER' }),
  ins(4, 'TM3', '2026-09-24', { LHF1: { pressure_psi: 100 } }),
]
const readings = buildReadings(DATA)

describe('pressureIntelligenceView', () => {
  it('reads the serial from the raw record and marks severe conditions critical', () => {
    const r = readings.find((x) => x.inspectionId === 2 && x.position === 'LHF1')
    expect(r.serial).toBe('SN-1')
    expect(readings.find((x) => x.inspectionId === 3 && x.position === 'LHF1').critical).toBe(true)
  })

  it('critical outranks the pressure verdict; unmeasured stays unmeasured', () => {
    expect(viewStatus({ status: 'ok', critical: true })).toBe('critical')
    expect(viewStatus({ status: 'under' })).toBe('under')
    expect(viewStatus({ status: 'weird' })).toBe('unmeasured')
    expect(viewStatus(null)).toBe('unmeasured')
  })

  it('keeps only the latest inspection per asset', () => {
    const cur = latestPerAsset(readings)
    expect(new Set(cur.filter((r) => r.asset_no === 'TM1').map((r) => r.inspectionId))).toEqual(new Set([2]))
    expect(cur).toHaveLength(9)
  })

  it('computes headline counts over current wheels, never inventing a value', () => {
    const k = fleetKpis(latestPerAsset(readings))
    expect(k.total).toBe(9)
    expect(k.vehicles).toBe(3)
    expect(k.under).toBe(1)
    expect(k.over).toBe(1)
    expect(k.critical).toBe(1)
    expect(k.unmeasured).toBe(1)
    expect(k.ok).toBe(5)
    expect(k.typicalPsi).toBe(100)
    expect(fleetKpis([]).typicalPsi).toBeNull()
    expect(fleetKpis([]).okPct).toBeNull()
    expect(distributionSegments(k).map((s) => s.key)).toContain('unmeasured')
  })

  it('matches a specification only on exact vehicle type and axle', () => {
    const look = specLookup([{ vehicle_type: 'bus', position: 'Steer', recommended_pressure: '110' }, { vehicle_type: 'X', position: 'Drive', recommended_pressure: 'n/a' }])
    expect(look('BUS', 'Steer')).toBe(110)
    expect(look('TR-MIXER', 'Steer')).toBeNull()
    expect(look('X', 'Drive')).toBeNull()
    const d = decorate(latestPerAsset(readings), look)
    const steer = d.find((r) => r.asset_no === 'TM1' && r.group === 'Steer')
    expect(steer.spec).toBe(110)
    expect(d.find((r) => r.asset_no === 'TM1' && r.pressure === 70).psiDiff).toBe(-30)
  })

  it('filters by vehicle type, axle and display status', () => {
    expect(filterView(readings, { vehicleType: 'tr-mixer' }).every((r) => r.asset_no === 'TM2')).toBe(true)
    expect(filterView(readings, { status: 'critical' })).toHaveLength(1)
    expect(vehicleTypesOf(DATA)).toEqual(['BUS', 'TR-MIXER'])
  })

  it('builds axle bars and a 7-day trend anchored to the latest reading', () => {
    const bars = positionBars(latestPerAsset(readings))
    expect(bars.length).toBeGreaterThan(0)
    const t = dailyTrend(readings)
    expect(t.end).toBe('2026-09-25')
    expect(t.labels).toHaveLength(7)
    expect(t.labels[0]).toBe('2026-09-19')
    expect(t.series[0].values.some((v) => v === null)).toBe(true)
    expect(dailyTrend([])).toEqual({ labels: [], series: [], end: null, start: null })
  })

  it('orders alerts critical first and summarises vehicles', () => {
    const cur = latestPerAsset(readings)
    const a = alertRows(cur)
    expect(viewStatus(a[0])).toBe('critical')
    expect(a).toHaveLength(3)
    const v = vehicleRows(cur)
    expect(v[0].asset_no).toBe('TM2')
    expect(v.find((x) => x.asset_no === 'TM3').state).toBe('unmeasured')
  })

  it('exports every column with N/A for unknowns', () => {
    const rows = fleetExportRows(decorate(latestPerAsset(readings)))
    expect(FLEET_EXPORT_COLS).toHaveLength(FLEET_EXPORT_HEADERS.length)
    expect(rows.find((r) => r.asset_no === 'TM3').median).toBe('N/A')
    expect(rows.find((r) => r.asset_no === 'TM3').statusLabel).toBe('Not measured')
  })
})
