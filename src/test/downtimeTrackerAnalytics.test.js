import { describe, it, expect } from 'vitest'
import {
  presetStart, last12Months, workOrderHours, actualHoursByAsset, downtimeHours, causeLabel,
  filterEvents, downtimeKpis, availabilityTrend, siteBreakdown, causeBreakdown, monthlyCost,
  vehicleRows, heatmap, recommendations, eventExportRows,
} from '../lib/downtimeTrackerAnalytics'

const NOW = new Date(2026, 8, 27, 12).getTime()
const events = [
  { asset_no: 'TM1', site: 'NHC', risk_level: 'Critical', issue_date: '2026-09-01', reason_for_removal: 'burst' },
  { asset_no: 'TM1', site: 'NHC', risk_level: 'Low', issue_date: '2026-09-11' },
  { asset_no: 'TM2', site: 'JED', risk_level: 'Medium', issue_date: '2026-08-15', reason_for_removal: 'low pressure' },
  { asset_no: 'TM3', site: 'JED', risk_level: null, issue_date: '2026-07-01' },
]

describe('downtimeTrackerAnalytics', () => {
  it('computes period starts and month windows from an injected clock', () => {
    expect(presetStart('All', NOW)).toBeNull()
    expect(presetStart('This month', NOW)).toBe('2026-09-01')
    expect(presetStart('30d', NOW)).toBe('2026-08-28')
    const m = last12Months(NOW)
    expect(m).toHaveLength(12)
    expect(m[11]).toBe('2026-09')
  })

  // ENG-7 (2026-11-12). These four tests used to pin an ASSUMED 2 to 4 hours per
  // tyre event as "the downtime hours" and a made-up default rate as its cost.
  // The assumption is still available, but only under its own name: measured
  // hours come from job card timestamps, anything else is null (N/A) with the
  // assumed figure reported beside it.
  it('measures from job card timestamps and reports the assumption separately', () => {
    expect(workOrderHours({ opened_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T06:00:00Z' })).toBe(6)
    expect(workOrderHours({ opened_at: '2026-09-01' })).toBeNull()
    const act = actualHoursByAsset([
      { asset_no: 'TM1', opened_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T10:00:00Z' },
      { asset_no: 'TM1', opened_at: '2026-09-02T00:00:00Z', completed_at: '2026-09-02T02:00:00Z' },
    ])
    expect(act.get('TM1')).toBe(6)
    expect(downtimeHours(events[0], act)).toEqual({ hours: 6, actual: true, assumedHours: null, modelHours: 6 })
    // no job card for TM2: measured hours unknown, the 2 h is an assumption
    expect(downtimeHours(events[2], act)).toEqual({ hours: null, actual: false, assumedHours: 2, modelHours: 2 })
    // implausible timestamps are never a measurement: a year-0026 date, a
    // five month "repair", and a job closed before it opened
    expect(workOrderHours({ opened_at: '0026-09-01T00:00:00Z', completed_at: '2026-09-01T06:00:00Z' })).toBeNull()
    expect(workOrderHours({ opened_at: '2026-01-01', completed_at: '2026-06-01' })).toBeNull()
    expect(workOrderHours({ opened_at: '2026-09-02', completed_at: '2026-09-01' })).toBeNull()
  })

  it('labels causes and filters', () => {
    expect(causeLabel(events[0])).toBe('Critical Failure')
    expect(causeLabel(events[2])).toBe('Pressure Issue')
    expect(causeLabel(events[3])).toBe('Unknown')
    expect(filterEvents(events, { risk: 'unrated' })).toHaveLength(1)
    expect(filterEvents(events, { cutoff: '2026-08-01' })).toHaveLength(3)
    expect(filterEvents(events, { cause: 'Pressure Issue' })).toHaveLength(1)
    expect(filterEvents(events, { search: 'jed' })).toHaveLength(2)
  })

  it('reports honest KPIs', () => {
    const k = downtimeKpis(events, { cutoff: null, now: NOW })
    expect(k.totalEvents).toBe(4)
    // No job card at all: nothing was measured. The old 10 h was 4 + 2 + 2 + 2 assumed.
    expect(k.totalHours).toBeNull()
    expect(k.measuredHours).toBeNull()
    expect(k.availability).toBeNull()
    expect(k.totalCost).toBeNull()
    expect(k.assumedHours).toBe(10)
    expect(k.unmeasuredEvents).toBe(4)
    expect(k.availabilityAssumed).toBeGreaterThan(0)
    expect(k.rateConfigured).toBe(false)
    expect(k.uniqueVehicles).toBe(3)
    expect(k.mtbeHours).toBe(240)
    expect(k.unplannedPct).toBe(25)
    // With job cards for TM1 and a configured rate: 2 events measured at 6 h each.
    const act = actualHoursByAsset([
      { asset_no: 'TM1', opened_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T10:00:00Z' },
      { asset_no: 'TM1', opened_at: '2026-09-02T00:00:00Z', completed_at: '2026-09-02T02:00:00Z' },
    ], { now: NOW })
    const m = downtimeKpis(events, { cutoff: null, now: NOW, actualByAsset: act, rate: 100 })
    expect(m.measuredHours).toBe(12)
    expect(m.totalCost).toBe(1200) // measured hours only
    expect(m.assumedHours).toBe(4)
    expect(m.modelledCost).toBe(1600)
    expect(m.availability).toBeNull() // two events are still unmeasured
    const empty = downtimeKpis([], { now: NOW })
    expect(empty.availability).toBeNull()
    expect(empty.mtbeHours).toBeNull()
    expect(empty.unplannedPct).toBeNull()
  })

  it('returns a null trend when no vehicles are in scope', () => {
    expect(availabilityTrend([], { now: NOW }).values.every((v) => v == null)).toBe(true)
    const tr = availabilityTrend(events, { now: NOW })
    expect(tr.values[11]).toBeLessThan(100)
  })

  it('breaks down by site, cause, month and vehicle', () => {
    expect(siteBreakdown(events)[0]).toMatchObject({ site: 'NHC', unplanned: 4, planned: 2 })
    expect(causeBreakdown(events).map((c) => c.cause)).toEqual(['Critical Failure', 'Pressure Issue', 'Routine Replacement', 'Unknown'])
    const mc = monthlyCost(events, { now: NOW, rate: 100 })
    expect(mc[11]).toMatchObject({ month: '2026-09', unplanned: 400, planned: 200 })
    expect(mc[11].cumulative).toBe(1000)
    const v = vehicleRows(events, { now: NOW })
    expect(v[0]).toMatchObject({ asset: 'TM1', eventCount: 2, avgBetween: 10, basis: 'Assumed', measuredHours: null, assumedHours: 6, totalCost: null })
    // without a configured rate there is no cost, not a default one
    expect(monthlyCost(events, { now: NOW })[11]).toMatchObject({ planned: null, unplanned: null, cumulative: null })
    expect(v.find((x) => x.asset === 'TM2').avgBetween).toBeNull()
    expect(heatmap(events, { now: NOW }).rows[0].asset).toBe('TM1')
  })

  it('builds structured recommendations and exports', () => {
    const k = downtimeKpis(events, { now: NOW })
    const r = recommendations(events, vehicleRows(events, { now: NOW }), k)
    expect(r[0]).toMatchObject({ key: 'vehicle', params: { asset: 'TM1', count: 2 } })
    expect(r.some((x) => x.key === 'critical')).toBe(true)
    expect(recommendations([], [], {})).toEqual([])
    const x = eventExportRows(events, { rate: 100 })
    expect(x[3].risk_level).toBe('Not rated')
    expect(x[0].data_source).toBe('Assumed (no job card with valid timestamps)')
    expect(x[0].downtime_hours).toBe('N/A')
    expect(x[0].assumed_hours).toBe(4)
  })
})
