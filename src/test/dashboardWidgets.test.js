import { describe, it, expect } from 'vitest'
import {
  closedWoStatusTokens, openWorkOrderCount, recentMonths, stackWorkshopJobs,
  utilisationTrend, inspectionProgress, rollingWindows, trendChange,
  freshnessStatus, heatmapSiteWeekday, mergeTimeline, sanitizeWidgetConfig,
  MAX_NOTE_LENGTH,
} from '../lib/dashboardWidgets'
import { isClosedWoStatus } from '../lib/workOrderStatus'
import {
  WIDGET_BY_ID, DEFAULT_LAYOUT, validateLayout, placeWidget, updateWidgetConfig,
} from '../lib/dashboardBuilder'
import { librarySections, canvasSummary, sectionOf } from '../lib/dashboardBuilderView'
import { WIDGET_CATALOG } from '../lib/dashboardBuilder'

const NOW = new Date(2026, 9, 5, 10, 0, 0) // 5 Oct 2026, local

describe('closedWoStatusTokens / openWorkOrderCount', () => {
  it('lists only closed spellings, in the cases the database stores', () => {
    const t = closedWoStatusTokens()
    expect(t).toEqual(expect.arrayContaining(['Closed', 'Completed', 'Cancelled', 'closed', 'COMPLETED']))
    t.forEach(x => expect(isClosedWoStatus(x)).toBe(true))
    expect(t).not.toContain('Open')
    expect(t).not.toContain('In Progress')
  })

  it('open = total minus closed, null when a count is unknown', () => {
    expect(openWorkOrderCount(89913, 89778)).toEqual({ total: 89913, closed: 89778, open: 135 })
    expect(openWorkOrderCount(null, 5).open).toBeNull()
    expect(openWorkOrderCount(10, undefined).open).toBeNull()
    expect(openWorkOrderCount(0, 0).open).toBe(0)
  })
})

describe('recentMonths', () => {
  it('returns 6 months oldest first, current month bounded at today', () => {
    const m = recentMonths(NOW, 6)
    expect(m).toHaveLength(6)
    expect(m[0].key).toBe('2026-05')
    expect(m[0].from).toBe('2026-05-01')
    expect(m[0].to).toBe('2026-05-31')
    expect(m[5]).toMatchObject({ key: '2026-10', from: '2026-10-01', to: '2026-10-05' })
  })
})

describe('stackWorkshopJobs', () => {
  it('folds legacy statuses, ranks by volume and groups the tail as Other', () => {
    const months = [
      { label: 'Sep', by_status: [{ label: 'Closed', n: 10 }, { label: 'Completed', n: 5 }, { label: 'Open', n: 2 }] },
      { label: 'Oct', by_status: [{ label: 'In Progress', n: 3 }, { label: 'On Hold', n: 1 }] },
    ]
    const s = stackWorkshopJobs(months, 2)
    expect(s.labels).toEqual(['Sep', 'Oct'])
    expect(s.series.map(x => x.status)).toEqual(['Completed', 'In Progress', 'Other'])
    expect(s.series[0].data).toEqual([15, 0])
    expect(s.series[2].data).toEqual([2, 1])
    expect(s.total).toBe(21)
  })

  it('a month that could not be read stays null, never zero', () => {
    const s = stackWorkshopJobs([{ label: 'A', by_status: null }, { label: 'B', by_status: [{ label: 'New', n: 4 }] }])
    expect(s.series[0].data).toEqual([null, 4])
    expect(s.measured).toBe(true)
  })

  it('empty input is honest', () => {
    const s = stackWorkshopJobs([])
    expect(s.total).toBe(0)
    expect(s.series).toEqual([])
    expect(s.measured).toBe(false)
  })
})

describe('utilisationTrend', () => {
  it('averages per capture date and skips missing utilisation', () => {
    const rows = [
      { captured_at: '2026-09-01T00:00:00Z', utilization_pct: 60 },
      { captured_at: '2026-09-01T05:00:00Z', utilization_pct: 70 },
      { captured_at: '2026-08-01', utilization_pct: 50 },
      { captured_at: '2026-08-01', utilization_pct: null },
      { captured_at: null, utilization_pct: 90 },
    ]
    expect(utilisationTrend(rows)).toEqual([
      { date: '2026-08-01', avg: 50, assets: 1 },
      { date: '2026-09-01', avg: 65, assets: 2 },
    ])
    expect(utilisationTrend([])).toEqual([])
  })
})

describe('inspectionProgress', () => {
  it('counts this month only and gives no percentage without a plan', () => {
    const rows = [
      { scheduled_date: '2026-10-01', status: 'Done' },
      { scheduled_date: '2026-10-03', status: 'Scheduled', completed_date: '2026-10-03' },
      { scheduled_date: '2026-10-20', status: 'Scheduled' },
      { scheduled_date: '2026-09-28', status: 'Done' },
    ]
    expect(inspectionProgress(rows, NOW)).toMatchObject({ planned: 3, done: 2, pct: 66.7 })
    expect(inspectionProgress([], NOW).pct).toBeNull()
  })
})

describe('rollingWindows / trendChange', () => {
  it('builds two back-to-back windows ending today', () => {
    expect(rollingWindows(NOW, 30)).toEqual({
      from: '2026-09-06', to: '2026-10-05', prevFrom: '2026-08-07', prevTo: '2026-09-05', days: 30,
    })
  })

  it('gives a direction only when the previous period is measurable and above zero', () => {
    expect(trendChange(120, 100)).toMatchObject({ pct: 20, direction: 'up', delta: 20 })
    expect(trendChange(80, 100)).toMatchObject({ pct: -20, direction: 'down' })
    expect(trendChange(100, 100)).toMatchObject({ pct: 0, direction: 'flat' })
    expect(trendChange(5, 0)).toMatchObject({ pct: null, direction: null, delta: 5 })
    expect(trendChange(5, null)).toMatchObject({ pct: null, direction: null, previous: null })
    expect(trendChange(null, 4)).toMatchObject({ current: null, direction: null })
  })
})

describe('freshnessStatus', () => {
  it('rates each feed and takes the worst readable one overall', () => {
    const r = freshnessStatus({
      work_orders: '2026-10-05', parts_consumption: '2026-10-01', tyre_records: '2026-09-01',
      inspections: null, accidents: '2026-10-04',
    }, NOW)
    const by = Object.fromEntries(r.items.map(i => [i.table, i]))
    expect(by.work_orders).toMatchObject({ days: 0, status: 'fresh' })
    expect(by.parts_consumption).toMatchObject({ days: 4, status: 'stale' })
    expect(by.tyre_records.status).toBe('old')
    expect(by.inspections).toMatchObject({ status: 'unknown', days: null })
    expect(r.overall).toBe('old')
  })

  it('is unknown when nothing could be read', () => {
    expect(freshnessStatus({}, NOW).overall).toBe('unknown')
  })
})

describe('heatmapSiteWeekday', () => {
  it('builds a site x weekday matrix, busiest site first, skipping unusable rows', () => {
    const rows = [
      { site: 'NHC', inspection_date: '2026-10-04' }, // Sunday
      { site: 'NHC', inspection_date: '2026-10-05' }, // Monday
      { site: 'NHC', inspection_date: '2026-10-05' },
      { site: 'JED', inspection_date: '2026-10-05' },
      { site: '', inspection_date: '2026-10-05' },
      { site: 'JED', inspection_date: null },
    ]
    const h = heatmapSiteWeekday(rows)
    expect(h.sites).toEqual(['NHC', 'JED'])
    expect(h.cells[0]).toEqual([1, 2, 0, 0, 0, 0, 0])
    expect(h.max).toBe(2)
    expect(h.total).toBe(4)
    expect(h.skipped).toBe(2)
  })
})

describe('mergeTimeline', () => {
  it('merges three registers newest first and drops rows without a time', () => {
    const ev = mergeTimeline({
      workOrders: [{ work_order_no: 'GC/1', asset_no: 'TM1', status: 'Closed', created_at: '2026-10-05T08:00:00Z' }],
      accidents: [{ reference_no: 'ACC-1', asset_no: 'TM2', severity: 'minor', created_at: '2026-10-05T09:00:00Z' }],
      inspections: [{ asset_no: 'TM3', status: 'Done', created_at: '2026-10-04T09:00:00Z' }, { asset_no: 'X' }],
    })
    expect(ev.map(e => e.type)).toEqual(['accident', 'work_order', 'inspection'])
    expect(ev[1].sub).toBe('TM1 | Completed')
    expect(mergeTimeline({}, 5)).toEqual([])
  })
})

describe('sanitizeWidgetConfig + layout config', () => {
  it('keeps note text bounded and drops unsafe image addresses', () => {
    expect(sanitizeWidgetConfig('note', { title: ' Hi ', text: 'x'.repeat(MAX_NOTE_LENGTH + 10) }).text).toHaveLength(MAX_NOTE_LENGTH)
    expect(sanitizeWidgetConfig('image', { url: 'javascript:alert(1)' }).url).toBe('')
    expect(sanitizeWidgetConfig('image', { url: 'data:text/html,hi' }).url).toBe('')
    expect(sanitizeWidgetConfig('image', { url: 'https://x.test/logo.png', caption: 'Logo' }))
      .toEqual({ url: 'https://x.test/logo.png', caption: 'Logo' })
    expect(sanitizeWidgetConfig('stat', { a: 1 })).toBeNull()
  })

  it('only Note / Image widgets carry config; old layouts keep their shape', () => {
    expect(placeWidget('total-vehicles')).toEqual({ widgetId: 'total-vehicles', w: 1, h: 'sm' })
    expect(placeWidget('text-note').config).toEqual({ title: '', text: '' })
    const l = validateLayout({ name: 'x', widgets: [
      { widgetId: 'total-vehicles', w: 1, h: 'sm', config: { text: 'ignored' } },
      { widgetId: 'image-logo', w: 1, h: 'md', config: { url: 'https://x.test/a.png' } },
    ] })
    expect(l.widgets[0]).toEqual({ widgetId: 'total-vehicles', w: 1, h: 'sm' })
    expect(l.widgets[1].config.url).toBe('https://x.test/a.png')
  })

  it('updateWidgetConfig edits one Note / Image widget and ignores the rest', () => {
    const l = validateLayout({ name: 'x', widgets: [{ widgetId: 'text-note', w: 1, h: 'md' }, { widgetId: 'total-vehicles', w: 1, h: 'sm' }] })
    const next = updateWidgetConfig(l, 0, { title: 'Shift', text: 'Night shift starts 19:00' })
    expect(next.widgets[0].config).toEqual({ title: 'Shift', text: 'Night shift starts 19:00' })
    expect(l.widgets[0].config).toEqual({ title: '', text: '' })
    expect(updateWidgetConfig(l, 1, { text: 'x' })).toBe(l)
    expect(updateWidgetConfig(l, 9, { text: 'x' })).toBe(l)
  })
})

describe('catalog, starter layout and library', () => {
  it('exposes the mockup widgets', () => {
    ;['open-work-orders', 'fleet-location', 'utilisation-trend', 'workshop-jobs', 'inspection-progress',
      'work-orders-trend', 'data-freshness', 'inspection-heatmap', 'activity-timeline', 'text-note', 'image-logo',
    ].forEach(id => expect(WIDGET_BY_ID[id]).toBeTruthy())
  })

  it('starter layout opens with the mockup KPI row and paired charts', () => {
    const ids = DEFAULT_LAYOUT.widgets.map(w => w.widgetId)
    expect(ids.slice(0, 4)).toEqual(['total-vehicles', 'fleet-availability', 'open-work-orders', 'critical-tyres'])
    expect(ids).toEqual(expect.arrayContaining(['utilisation-trend', 'fleet-location', 'workshop-jobs']))
  })

  it('places the new kinds in library sections, with a Text & Media group', () => {
    expect(sectionOf('progress')).toBe('kpi')
    expect(sectionOf('heatmap')).toBe('visual')
    expect(sectionOf('timeline')).toBe('data')
    expect(sectionOf('note')).toBe('media')
    const media = librarySections(WIDGET_CATALOG).find(s => s.key === 'media')
    expect(media.items.map(i => i.id)).toEqual(['text-note', 'image-logo'])
  })

  it('Note / Image widgets are not counted as live data sources', () => {
    const l = validateLayout({ name: 'x', widgets: [{ widgetId: 'text-note' }, { widgetId: 'image-logo' }] })
    expect(canvasSummary(l, WIDGET_BY_ID).sources).toBe(0)
  })
})
