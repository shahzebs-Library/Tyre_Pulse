import { describe, it, expect } from 'vitest'
import {
  REMOVAL_TYPES,
  normEventType,
  eventTypeLabel,
  eventTime,
  eventTypeBreakdown,
  monthlyTrend,
  topAssets,
  topPositions,
  bySite,
  removalReasonQuality,
  meanIntervalDays,
  computeKpis,
  filterEvents,
  distinctValues,
  analyzeServiceEvents,
} from './tyreServiceEventsAnalytics'

const ev = (o) => ({ event_type: 'inspection', event_date: '2026-07-01', ...o })

const SAMPLE = [
  ev({ event_type: 'rotation', event_date: '2026-07-10', asset_no: 'TRK-1', tyre_serial: 'SN1', position: 'Steer L', site: 'Jeddah', cost: 20 }),
  ev({ event_type: 'rotation', event_date: '2026-06-05', asset_no: 'TRK-1', tyre_serial: 'SN1', position: 'Steer L', site: 'Jeddah', cost: 10 }),
  ev({ event_type: 'repair', event_date: '2026-07-12', asset_no: 'TRK-1', tyre_serial: 'SN2', position: 'Drive R', site: 'Riyadh', cost: 50, notes: 'nail puncture' }),
  ev({ event_type: 'replacement', event_date: '2026-07-15', asset_no: 'TRK-2', tyre_serial: 'SN3', position: 'Drive R', site: 'Riyadh', cost: 400, notes: '' }),
  ev({ event_type: 'inspection', event_date: '2026-05-01', asset_no: 'TRK-2', tyre_serial: 'SN3', position: 'Steer L', site: 'Jeddah' }),
  ev({ event_type: 'inflation', event_date: '2026-07-20', asset_no: '', tyre_serial: 'SN4', site: 'Jeddah' }),
]

describe('normEventType / labels', () => {
  it('keeps known types and folds unknown to other', () => {
    expect(normEventType('rotation')).toBe('rotation')
    expect(normEventType('ROTATION')).toBe('rotation')
    expect(normEventType('mystery')).toBe('other')
    expect(normEventType(null)).toBe('other')
  })
  it('labels are human readable', () => {
    expect(eventTypeLabel('replacement')).toBe('Replacement')
    expect(eventTypeLabel('zzz')).toBe('Other')
  })
  it('REMOVAL_TYPES are the corrective interventions', () => {
    expect(REMOVAL_TYPES).toContain('replacement')
    expect(REMOVAL_TYPES).toContain('repair')
    expect(REMOVAL_TYPES).not.toContain('rotation')
  })
})

describe('eventTime', () => {
  it('parses date-only strings', () => {
    expect(eventTime({ event_date: '2026-07-10' })).toBe(Date.parse('2026-07-10T00:00:00Z'))
  })
  it('falls back to created_at and returns null when absent', () => {
    expect(eventTime({ created_at: '2026-01-02T03:04:05Z' })).toBe(Date.parse('2026-01-02T03:04:05Z'))
    expect(eventTime({})).toBeNull()
    expect(eventTime({ event_date: 'not-a-date' })).toBeNull()
  })
})

describe('eventTypeBreakdown', () => {
  it('empty input is honest zero', () => {
    const b = eventTypeBreakdown([])
    expect(b.total).toBe(0)
    expect(b.items).toEqual([])
    expect(b.byType.rotation).toBe(0)
  })
  it('counts, sorts desc and computes percentages', () => {
    const b = eventTypeBreakdown(SAMPLE)
    expect(b.total).toBe(6)
    expect(b.byType.rotation).toBe(2)
    expect(b.items[0].type).toBe('rotation')
    expect(b.items[0].count).toBe(2)
    expect(b.items[0].pct).toBeCloseTo(33.3, 1)
    // only present types surface
    expect(b.items.find((i) => i.type === 'other')).toBeUndefined()
    expect(b.items.every((i) => i.color && i.label)).toBe(true)
  })
  it('ignores non-object rows', () => {
    expect(eventTypeBreakdown([null, 1, ev({ event_type: 'repair' })]).total).toBe(1)
  })
})

describe('monthlyTrend', () => {
  it('produces N contiguous buckets ending at ref', () => {
    const t = monthlyTrend(SAMPLE, 3, new Date('2026-07-15T00:00:00Z'))
    expect(t.map((b) => b.key)).toEqual(['2026-05', '2026-06', '2026-07'])
    expect(t.map((b) => b.label)).toEqual(['May 2026', 'Jun 2026', 'Jul 2026'])
  })
  it('buckets events into the right month with per-type split', () => {
    const t = monthlyTrend(SAMPLE, 3, new Date('2026-07-15T00:00:00Z'))
    const jul = t.find((b) => b.key === '2026-07')
    expect(jul.total).toBe(4)
    expect(jul.byType.rotation).toBe(1)
    expect(jul.byType.replacement).toBe(1)
    const jun = t.find((b) => b.key === '2026-06')
    expect(jun.total).toBe(1)
  })
  it('crosses a year boundary correctly', () => {
    const t = monthlyTrend([], 3, new Date('2026-01-15T00:00:00Z'))
    expect(t.map((b) => b.key)).toEqual(['2025-11', '2025-12', '2026-01'])
  })
})

describe('rankings', () => {
  it('topAssets ranks by count with spend and last date', () => {
    const a = topAssets(SAMPLE, 5)
    expect(a[0].asset_no).toBe('TRK-1')
    expect(a[0].count).toBe(3)
    expect(a[0].totalCost).toBe(80)
    expect(a[0].lastDate).toBe('2026-07-12')
    // blank asset_no excluded
    expect(a.find((x) => x.asset_no === '')).toBeUndefined()
  })
  it('topPositions groups by position', () => {
    const p = topPositions(SAMPLE)
    const drive = p.find((x) => x.position === 'Drive R')
    expect(drive.count).toBe(2)
  })
  it('bySite aggregates and honours limit', () => {
    const s = bySite(SAMPLE)
    expect(s.find((x) => x.site === 'Jeddah').count).toBe(4)
    expect(bySite(SAMPLE, 1).length).toBe(1)
  })
})

describe('removalReasonQuality', () => {
  it('measures documented vs blank on corrective events only', () => {
    const q = removalReasonQuality(SAMPLE)
    // repair (notes) + replacement (blank) = 2 removal events
    expect(q.removalEvents).toBe(2)
    expect(q.documented).toBe(1)
    expect(q.blank).toBe(1)
    expect(q.documentedPct).toBe(50)
  })
  it('is zero-safe with no removal events', () => {
    const q = removalReasonQuality([ev({ event_type: 'rotation' })])
    expect(q.removalEvents).toBe(0)
    expect(q.documentedPct).toBe(0)
  })
})

describe('meanIntervalDays', () => {
  it('averages consecutive gaps per serial', () => {
    const rows = [
      ev({ tyre_serial: 'A', event_date: '2026-01-01' }),
      ev({ tyre_serial: 'A', event_date: '2026-01-11' }),
      ev({ tyre_serial: 'A', event_date: '2026-01-21' }),
    ]
    const r = meanIntervalDays(rows)
    expect(r.meanDays).toBe(10)
    expect(r.pairs).toBe(2)
    expect(r.keys).toBe(1)
  })
  it('returns null when no serial has two dated events', () => {
    const r = meanIntervalDays([ev({ tyre_serial: 'A' }), ev({ tyre_serial: 'B' })])
    expect(r.meanDays).toBeNull()
    expect(r.pairs).toBe(0)
  })
})

describe('computeKpis', () => {
  it('rolls up totals, period, distinct assets/tyres, quality', () => {
    const k = computeKpis(SAMPLE, { periodDays: 30, now: new Date('2026-07-25T00:00:00Z') })
    expect(k.total).toBe(6)
    expect(k.distinctAssets).toBe(2) // TRK-1, TRK-2 (blank excluded)
    expect(k.distinctTyres).toBe(4)
    expect(k.totalCost).toBe(480)
    expect(k.topType.type).toBe('rotation')
    // events within 30 days of 2026-07-25: 10,12,15,20 Jul = 4
    expect(k.thisPeriod).toBe(4)
    expect(k.removalDocumentedPct).toBe(50)
  })
  it('is empty-honest', () => {
    const k = computeKpis([])
    expect(k.total).toBe(0)
    expect(k.topType).toBeNull()
    expect(k.meanDaysBetween).toBeNull()
  })
})

describe('filterEvents', () => {
  it('filters by type, site and search (ANDed)', () => {
    expect(filterEvents(SAMPLE, { type: 'rotation' }).length).toBe(2)
    expect(filterEvents(SAMPLE, { site: 'Riyadh' }).length).toBe(2)
    expect(filterEvents(SAMPLE, { search: 'nail' }).length).toBe(1)
    expect(filterEvents(SAMPLE, { type: 'rotation', site: 'Riyadh' }).length).toBe(0)
  })
  it('filters by date range inclusive', () => {
    const r = filterEvents(SAMPLE, { from: '2026-07-01', to: '2026-07-13' })
    expect(r.length).toBe(2) // 10 Jul rotation + 12 Jul repair
  })
  it("'all' and empty are no-ops", () => {
    expect(filterEvents(SAMPLE, { type: 'all', site: 'all', search: '' }).length).toBe(6)
  })
})

describe('distinctValues / analyzeServiceEvents', () => {
  it('distinctValues sorted and de-duped', () => {
    expect(distinctValues(SAMPLE, 'site')).toEqual(['Jeddah', 'Riyadh'])
  })
  it('master roll-up composes all sections and is []-safe', () => {
    const a = analyzeServiceEvents(SAMPLE, { now: new Date('2026-07-25T00:00:00Z'), months: 3 })
    expect(a.kpis.total).toBe(6)
    expect(a.breakdown.items[0].type).toBe('rotation')
    expect(a.trend.length).toBe(3)
    expect(a.topAssets[0].asset_no).toBe('TRK-1')
    expect(a.sites).toEqual(['Jeddah', 'Riyadh'])
    const empty = analyzeServiceEvents([])
    expect(empty.kpis.total).toBe(0)
    expect(empty.trend.length).toBe(12)
    expect(empty.topAssets).toEqual([])
  })
})
