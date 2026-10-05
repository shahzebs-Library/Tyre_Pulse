import { describe, it, expect } from 'vitest'
import {
  fuelHeadline, rangeBounds, dailyVariance, isAfterHours, afterHoursSplit, hotspotBand,
  locationHotspots, alertTimeline, recommendedActions, cardMisuseRows, locationOptions,
} from '../lib/fuelTheftAlertsView'

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0).toISOString()
const rows = [
  { id: 1, status: 'open', severity: 'high', location: 'East Depot', drop_litres: 100, detected_at: at(2026, 6, 10, 23) },
  { id: 2, status: 'dismissed', severity: 'low', location: 'east depot', drop_litres: 20, detected_at: at(2026, 6, 10, 9) },
  { id: 3, status: 'confirmed', severity: 'medium', location: 'West Hub', detected_at: at(2026, 6, 12, 3) },
  { id: 4, status: 'resolved', severity: 'critical', drop_litres: 50, detected_at: at(2026, 6, 1, 14) },
  { id: 5, status: 'investigating' },
]
const now = new Date(2026, 5, 15, 10).getTime()

describe('fuelTheftAlertsView', () => {
  it('headline counts and false positive rate, no invented recovery', () => {
    const k = fuelHeadline(rows)
    expect(k.active).toBe(1)
    expect(k.unresolved).toBe(3)
    expect(k.decided).toBe(3)
    expect(k.falsePositivePct).toBe(33.3)
    expect(k.recovered).toBeNull()
    expect(k.siphoning).toBeNull()
    expect(fuelHeadline([]).falsePositivePct).toBeNull()
  })
  it('defaults to 30 days ending now', () => {
    const { start, end } = rangeBounds('', '', now)
    expect(Math.round((end - start) / 86400000)).toBe(29)
  })
  it('daily variance sums drops as negative litres, empty days null', () => {
    const v = dailyVariance(rows, { from: '2026-06-01', to: '2026-06-12', now })
    expect(v.days).toHaveLength(12)
    const d10 = v.days.find((d) => d.day === '2026-06-10')
    expect(d10).toEqual({ day: '2026-06-10', litres: -120, count: 2 })
    expect(v.days.find((d) => d.day === '2026-06-12')).toEqual({ day: '2026-06-12', litres: null, count: 1 })
    expect(v.totalLitres).toBe(-170)
  })
  it('after-hours window wraps midnight', () => {
    expect(isAfterHours(at(2026, 6, 1, 23))).toBe(true)
    expect(isAfterHours(at(2026, 6, 1, 4))).toBe(true)
    expect(isAfterHours(at(2026, 6, 1, 12))).toBe(false)
    expect(isAfterHours(null)).toBeNull()
    const s = afterHoursSplit(rows)
    expect(s).toEqual({ total: 2, timed: 4, high: 1, medium: 1, low: 0, unrated: 0 })
  })
  it('groups hotspots by location case-insensitively', () => {
    expect(hotspotBand(12)).toBe('high')
    expect(hotspotBand(5)).toBe('medium')
    expect(hotspotBand(1)).toBe('low')
    const h = locationHotspots(rows)
    expect(h.byCount[0]).toMatchObject({ location: 'East Depot', count: 2, open: 1, litres: 120 })
    expect(h.byLitres.map((e) => e.location)).toEqual(['East Depot'])
    expect(h.unlocated).toBe(2)
  })
  it('timeline from real timestamps and guidance by status', () => {
    const tl = alertTimeline({ detected_at: at(2026, 6, 1, 10), created_at: at(2026, 6, 1, 11), updated_at: at(2026, 6, 2, 9), status: 'resolved', drop_litres: 40 })
    expect(tl.map((e) => e.text)).toEqual(['Fuel drop detected (-40 L)', 'Alert logged in Tyre Pulse', 'Last updated, status resolved'])
    expect(alertTimeline(null)).toEqual([])
    expect(recommendedActions({ status: 'open', severity: 'high' })).toHaveLength(5)
    expect(recommendedActions({ status: 'open', severity: 'low' })).toHaveLength(4)
    expect(recommendedActions({ status: 'resolved' })).toHaveLength(1)
  })

  it('groups repeat loss by asset with honest null litres and worst band', () => {
    const list = cardMisuseRows([
      { asset_no: 'A1', severity: 'low', drop_litres: 10 },
      { asset_no: 'A1', severity: 'critical', drop_litres: 5 },
      { asset_no: 'B2', severity: 'medium' },
      { severity: 'high' },
    ])
    expect(list[0]).toEqual({ asset_no: 'A1', alerts: 2, litres: 15, band: 'high' })
    expect(list[1]).toEqual({ asset_no: 'B2', alerts: 1, litres: null, band: 'medium' })
    expect(list).toHaveLength(2)
    expect(cardMisuseRows([])).toEqual([])
  })

  it('lists distinct locations case-insensitively', () => {
    expect(locationOptions(rows)).toEqual(['East Depot', 'West Hub'])
  })
})
