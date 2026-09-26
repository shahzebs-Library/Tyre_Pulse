import { describe, it, expect } from 'vitest'
import {
  filterEventsBase, countryOptionsFor, driverTripStats, bandScorecard,
  safetyKpiValues, eventExportRows, correlationExportRows, scorecardExportRows,
  eventMatchesSearch, EVENT_TYPE_LABEL,
} from '../lib/driverSafetyAnalytics'

const EVENTS = [
  { id: 1, country: 'KSA', severity: 'high', driver_name: 'Ahmed', asset_no: 'TM1', location: 'Riyadh', event_type: 'speeding' },
  { id: 2, country: 'UAE', severity: 'low', driver_name: 'Bilal', asset_no: 'TM2', notes: 'wet road', event_type: 'harsh_brake' },
  { id: 3, country: 'KSA', severity: 'low', driver_name: 'Ahmed', asset_no: 'TM3', event_type: 'idling' },
]

describe('driverSafetyAnalytics', () => {
  it('filters by country, severity and free-text search', () => {
    expect(filterEventsBase(EVENTS, { country: 'KSA' }).map((r) => r.id)).toEqual([1, 3])
    expect(filterEventsBase(EVENTS, { severity: 'low' }).map((r) => r.id)).toEqual([2, 3])
    expect(filterEventsBase(EVENTS, { search: 'WET' }).map((r) => r.id)).toEqual([2])
    expect(filterEventsBase(EVENTS, {}).length).toBe(3)
    expect(filterEventsBase(null, {})).toEqual([])
    expect(eventMatchesSearch({}, '  ')).toBe(true)
  })

  it('lists distinct sorted countries without blanks', () => {
    expect(countryOptionsFor([...EVENTS, { country: '' }, { country: null }])).toEqual(['KSA', 'UAE'])
  })

  it('aggregates trip km and counts per named driver only', () => {
    const { kmByDriver, countByDriver } = driverTripStats([
      { driver_name: ' Ahmed ', distance_km: '100' },
      { driver_name: 'Ahmed', distance_km: 50 },
      { driver_name: '', distance_km: 999 },
      { driver_name: 'Bilal', distance_km: 'x' },
    ])
    expect(kmByDriver.get('Ahmed')).toBe(150)
    expect(countByDriver.get('Ahmed')).toBe(2)
    expect(kmByDriver.get('Bilal')).toBe(0)
    expect(kmByDriver.has('')).toBe(false)
  })

  it('never invents utilisation for a driver with no trip km', () => {
    const banded = bandScorecard(
      [{ driver_name: 'Ahmed', score: 90 }, { driver_name: 'Chen', score: 50 }],
      [{ driver_name: 'Ahmed', distance_km: 200 }],
    )
    const ahmed = banded.find((d) => d.driver_name === 'Ahmed')
    const chen = banded.find((d) => d.driver_name === 'Chen')
    expect(ahmed.utilization).toBe(100)
    expect(ahmed.tripCount).toBe(1)
    expect(chen.utilization).toBeNull()
    expect(chen.km).toBe(0)
    expect(chen.composite.band).toBe('inactive')
  })

  it('reports KPIs as null when nothing is loaded, and share as null with no events', () => {
    expect(safetyKpiValues(null, { loaded: false })).toEqual({ events: null, high: null, drivers: null, penalty: null, highShare: null, coaching: null })
    const empty = safetyKpiValues({ totalEvents: 0, highSeverityCount: 0, distinctDrivers: 0, totalPenaltyPoints: 0 }, { loaded: true, coachingCount: 0 })
    expect(empty.highShare).toBeNull()
    expect(empty.events).toBe(0)
    const k = safetyKpiValues({ totalEvents: 4, highSeverityCount: 1, distinctDrivers: 2, totalPenaltyPoints: 10.4 }, { coachingCount: 1 })
    expect(k.highShare).toBe(0.25)
    expect(k.penalty).toBe(10)
    expect(k.coaching).toBe(1)
  })

  it('shapes export rows with readable labels and blank unknowns', () => {
    const [row] = eventExportRows([{ event_type: 'harsh_brake', speed_kmh: 0 }])
    expect(row.event_type).toBe(EVENT_TYPE_LABEL.harsh_brake)
    expect(row.speed_kmh).toBe(0)
    expect(row.g_force).toBe('')
    const [c] = correlationExportRows([{ driver_name: 'A', tyres: 2, removals: 1, driverCausedRemovalRate: 0.5, driverCpk: null, prematureRemovalRate: null }])
    expect(c.driverCausedRemovalRate).toBe('50%')
    expect(c.driverCpk).toBe('')
    expect(c.prematureRemovalRate).toBe('')
    const [s] = scorecardExportRows([{ driver_name: 'A', events: 3, riskIndex: 12.34, score: 70, grade: 'C', band: 'watch', composite: { band: 'steady' }, km: 0, tripCount: 0, weakestCategory: 'idling' }], { idling: 'Excessive idling' })
    expect(s).toMatchObject({ riskIndex: 12.3, composite: 'steady', km: '', trips: '', topIssue: 'Excessive idling' })
  })
})
