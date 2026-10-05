import { describe, it, expect } from 'vitest'
import {
  agoText, tvKpis, monthSpendByCurrency, money, liveAlertRows, jobActivityRows,
  rotationRows, screenRows, themeChartOption, clockParts, jobStatusTone,
} from '../lib/displayDashboardView'

const NOW = new Date('2026-10-05T12:00:00Z')

describe('displayDashboardView', () => {
  it('agoText reads relative times and is null-safe', () => {
    expect(agoText(null, NOW)).toBe('')
    expect(agoText('2026-10-05T11:50:00Z', NOW)).toBe('10 min ago')
    expect(agoText('2026-10-05T09:00:00Z', NOW)).toBe('3 h ago')
    expect(agoText('2026-10-04T12:00:00Z', NOW)).toBe('1 day ago')
    expect(agoText('garbage', NOW)).toBe('')
  })

  it('tvKpis never shows a number for a source that did not load', () => {
    const tiles = tvKpis({
      availability: { total: 10, available: 8, pct: 80 },
      alertSummary: { bySeverity: { Critical: 2 } },
      woBoard: { total: 5, inProgress: 3 },
      todayInsp: { total: 4 },
      ready: { fleet: true, alerts: false, workOrders: true, inspections: true },
    })
    const by = Object.fromEntries(tiles.map((t) => [t.key, t]))
    expect(by.vehicles.value).toBe(8)
    expect(by.alerts.value).toBeNull()
    expect(by.workshop.value).toBe(5)
    expect(by.health.display).toBe('80%')
  })

  it('tvKpis gives N/A health for an empty fleet rather than 0%', () => {
    const tiles = tvKpis({ availability: { total: 0, available: 0, pct: 0 }, alertSummary: {}, woBoard: {}, todayInsp: {}, ready: { fleet: true } })
    expect(tiles.find((t) => t.key === 'health').display).toBe('N/A')
  })

  it('monthSpendByCurrency keeps currencies apart and skips unpriced rows', () => {
    const rows = [
      { country: 'KSA', cost_per_tyre: 1000, qty: 2, issue_date: '2026-10-02' },
      { country: 'UAE', cost_per_tyre: 500, qty: null, issue_date: '2026-10-03' },
      { country: 'KSA', cost_per_tyre: null, issue_date: '2026-10-03' },
      { country: 'KSA', cost_per_tyre: 900, issue_date: '2026-09-30' },
      { country: null, cost_per_tyre: 50, issue_date: '2026-10-01' },
    ]
    const out = monthSpendByCurrency(rows, NOW)
    expect(out.lines).toEqual([
      { country: 'KSA', currency: 'SAR', amount: 2000, tyres: 2 },
      { country: 'UAE', currency: 'AED', amount: 500, tyres: 1 },
    ])
    expect(out.unknownCountry).toBe(1)
    expect(money(2000, 'SAR')).toBe('SAR 2,000')
    expect(money(null, 'SAR')).toBe('N/A')
  })

  it('liveAlertRows sorts worst first then newest', () => {
    const rows = liveAlertRows([
      { id: 1, severity: 'Low', message: 'a', created_at: '2026-10-05T11:59:00Z' },
      { id: 2, severity: 'Critical', message: 'b', created_at: '2026-10-05T10:00:00Z' },
      { id: 3, severity: 'weird', message: '', created_at: null },
    ], NOW)
    expect(rows.map((r) => r.id)).toEqual([2, 1, 3])
    expect(rows[2].severity).toBe('Info')
    expect(rows[2].message).toBe('Alert')
  })

  it('jobActivityRows marks a job delayed only when its target date passed', () => {
    const rows = jobActivityRows([
      { id: 'a', asset_no: 'TM1', status: 'In Progress', target_completion: '2026-10-01' },
      { id: 'b', asset_no: 'TM2', status: 'Open' },
    ], NOW)
    expect(rows[0].status).toBe('Delayed')
    expect(rows[0].tone).toBe('bad')
    expect(rows[1].status).toBe('Open')
    expect(jobStatusTone('Awaiting Parts')).toBe('warn')
  })

  it('rotationRows reflects the picker state and the board on screen', () => {
    const rows = rotationRows([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], { b: false }, { rotateSecs: 30, activeKey: 'a' })
    expect(rows[0]).toMatchObject({ on: true, live: true, state: 'On screen', duration: '30 sec' })
    expect(rows[1]).toMatchObject({ on: false, state: 'Off' })
  })

  it('screenRows reads report shares honestly', () => {
    const rows = screenRows([
      { id: 1, name: 'Control room', token: 't', pages: ['x', 'y'], view_count: 4, last_viewed_at: '2026-10-05T11:00:00Z', active: true },
      { id: 2, name: '', expires_at: '2026-01-01', layout: { boards: [{}, {}, {}] }, active: true },
    ], NOW)
    expect(rows[0]).toMatchObject({ boards: 2, views: 4, status: 'Live link', lastViewed: '1 h ago' })
    expect(rows[1]).toMatchObject({ name: 'Unnamed screen', boards: 3, status: 'Expired', lastViewed: 'Never opened' })
  })

  it('themeChartOption re-inks dark chart text for light mode and keeps functions', () => {
    const fmt = () => 'x'
    const opt = { textStyle: { color: '#f1f5f9' }, axis: [{ color: 'rgba(148, 163, 184, 0.28)', formatter: fmt }], keep: '#22c55e' }
    expect(themeChartOption(opt, false)).toBe(opt)
    const out = themeChartOption(opt, true)
    expect(out.textStyle.color).toBe('#101828')
    expect(out.axis[0].color).toBe('rgba(16,24,40,0.18)')
    expect(out.axis[0].formatter).toBe(fmt)
    expect(out.keep).toBe('#22c55e')
    expect(opt.textStyle.color).toBe('#f1f5f9')
  })

  it('clockParts is safe on a bad date', () => {
    expect(clockParts(new Date('x'))).toEqual({ date: '', time: '' })
    expect(clockParts(NOW).date).toMatch(/Oct 2026/)
  })
})

import {
  opsPeriodRange, opsLoadStart, spendByCurrency, dailySeries, productionSummary, siteBoard,
} from '../lib/displayDashboardView'

describe('operations summary period (fix round)', () => {
  const now = new Date(2026, 9, 5, 12, 0)
  it('builds local-calendar windows', () => {
    expect(opsPeriodRange('today', now)).toMatchObject({ from: '2026-10-05', to: '2026-10-05', days: 1 })
    expect(opsPeriodRange('7d', now)).toMatchObject({ from: '2026-09-29', to: '2026-10-05', days: 7 })
    expect(opsPeriodRange('mtd', now)).toMatchObject({ from: '2026-10-01', days: 5 })
    expect(opsLoadStart(now)).toBe('2026-09-29')
  })
  it('keeps spend per currency inside the window and never blends', () => {
    const r = spendByCurrency([
      { issue_date: '2026-10-05', cost_per_tyre: 100, qty: 2, country: 'KSA' },
      { issue_date: '2026-10-04', cost_per_tyre: 50, country: 'UAE' },
      { issue_date: '2026-09-01', cost_per_tyre: 999, country: 'KSA' },
      { issue_date: '2026-10-05', cost_per_tyre: null, country: 'KSA' },
    ], opsPeriodRange('7d', now))
    expect(r.lines).toEqual([
      { country: 'KSA', currency: 'SAR', amount: 200, tyres: 2 },
      { country: 'UAE', currency: 'AED', amount: 50, tyres: 1 },
    ])
  })
  it('zero-fills a daily series', () => {
    const s = dailySeries([{ d: '2026-10-03' }, { d: '2026-10-03' }, { d: '2026-01-01' }], opsPeriodRange('7d', now), 'd')
    expect(s).toEqual([0, 0, 0, 0, 2, 0, 0])
  })
  it('counts approved m3 only and reports null when nothing approved', () => {
    const range = opsPeriodRange('today', now)
    expect(productionSummary([{ period_date: '2026-10-05', approved_m3: null }], range).m3).toBeNull()
    expect(productionSummary([{ period_date: '2026-10-05', approved_m3: 12 }, { period_date: '2026-10-05', approved_m3: 8 }], range))
      .toMatchObject({ m3: 20, loads: 2 })
  })
})

describe('siteBoard', () => {
  it('pins vehicles to sites with activity tone and legend counts', () => {
    const b = siteBoard({
      fleet: [{ site: 'NHC', status: 'Active' }, { site: 'NHC', status: 'Inactive' }, { site: 'JED' }],
      jobs: [{ site: 'JED' }],
      inspectionsToday: [],
      alerts: [{ severity: 'Critical', site: 'NHC' }, { severity: 'High', site: 'JED' }],
    })
    expect(b.sites.map((s) => [s.site, s.vehicles, s.tone])).toEqual([['NHC', 2, 'alert'], ['JED', 1, 'workshop']])
    expect(b.legend.find((l) => l.key === 'active').count).toBe(2)
    expect(b.legend.find((l) => l.key === 'inactive').count).toBe(1)
    expect(b.legend.find((l) => l.key === 'alert').count).toBe(1)
  })
})
