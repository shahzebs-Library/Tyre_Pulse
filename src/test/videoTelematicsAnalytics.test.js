import { describe, it, expect } from 'vitest'
import {
  filterDashcamEvents, dashcamKpis, driverRiskRanking, monthlyEventTrend, dashcamExportRows, NO_DRIVER,
} from '../lib/videoTelematicsAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, asset_no: 'A', driver_name: 'Ali', event_type: 'collision', severity: 'critical', event_at: '2026-09-25T10:00:00Z', speed_kmh: 90, reviewed: false, video_url: 'https://x/1.mp4' },
  { id: 2, asset_no: 'A', driver_name: 'Ali', event_type: 'harsh_brake', severity: 'low', event_at: '2026-09-01T10:00:00Z', reviewed: true },
  { id: 3, asset_no: 'B', driver_name: '', event_type: 'phone_use', severity: 'high', event_at: '2026-08-10T10:00:00Z', speed_kmh: 60, reviewed: false },
]

describe('videoTelematicsAnalytics', () => {
  it('review rate is null when there are no events', () => {
    expect(dashcamKpis([], { now: NOW }).reviewedPct).toBeNull()
    expect(dashcamKpis([], { now: NOW }).avgSpeedKmh).toBeNull()
  })

  it('computes backlog, speed, video coverage and recent counts', () => {
    const k = dashcamKpis(rows, { now: NOW })
    expect(k.totalEvents).toBe(3)
    expect(k.reviewedPct).toBe(33.3)
    expect(k.highRiskUnreviewed).toBe(2)
    expect(k.last7Days).toBe(1)
    expect(k.avgSpeedKmh).toBe(75)
    expect(k.videoCoverage).toBe(33.3)
    expect(k.oldestUnreviewedDays).toBe(48)
  })

  it('ranks drivers by severity-weighted score, unnamed drivers kept apart', () => {
    const r = driverRiskRanking(rows)
    expect(r[0]).toMatchObject({ driver: 'Ali', score: 6, critical: 1, events: 2 })
    expect(r[1]).toMatchObject({ driver: NO_DRIVER, score: 3 })
  })

  it('filters by driver, review state and date', () => {
    expect(filterDashcamEvents(rows, { driver: NO_DRIVER }).map((r) => r.id)).toEqual([3])
    expect(filterDashcamEvents(rows, { review: 'reviewed' }).map((r) => r.id)).toEqual([2])
    expect(filterDashcamEvents(rows, { from: '2026-09-01' }).map((r) => r.id)).toEqual([1, 2])
    expect(filterDashcamEvents(rows, { severity: 'high' }).map((r) => r.id)).toEqual([3])
  })

  it('monthly trend by severity and blank export for missing speed', () => {
    const t = monthlyEventTrend(rows, { now: NOW })
    expect(t[11]).toEqual({ month: '2026-09', low: 1, medium: 0, high: 0, critical: 1 })
    expect(t[10].high).toBe(1)
    expect(dashcamExportRows([rows[1]])[0].speed_kmh).toBe('')
  })
})
