import { describe, it, expect } from 'vitest'
import {
  eventType, registerEvents, inferMovements, meterAt, buildViewTimeline, filterViewEvents,
  tabEvents, documentRows, monthAxis, chartMonths, costByMonth, costCurrencies, downtimeByMonth,
  historyKpis, assetHeader, historyViewExportRows, typeCounts, periodStartMs,
} from '../lib/vehicleHistoryView'
import { buildTimeline, meterHistory, downtimeEpisodes } from '../lib/assetHistory'

const NOW = '2026-09-29T12:00:00Z'

function ev(source, at, extra = {}) {
  const ms = at ? new Date(at).getTime() : null
  return {
    id: extra.id || `${source}:${at}`, source, at, atMs: ms, day: at ? at.slice(0, 10) : null,
    undated: ms === null, title: extra.title || source, detail: null, value: extra.value ?? null,
    currency: extra.currency ?? null, countsToSpend: extra.countsToSpend === true, row: extra.row || {},
  }
}

describe('eventType', () => {
  it('splits job cards into service and repair by work type', () => {
    expect(eventType(ev('job_card', '2026-01-01', { row: { work_type: 'Preventive Maintenance' } }))).toBe('service')
    expect(eventType(ev('job_card', '2026-01-01', { row: { work_type: 'Repair' } }))).toBe('repair')
    expect(eventType(ev('tyre_removal', '2026-01-01'))).toBe('tyre')
    expect(eventType(ev('parts_line', '2026-01-01'))).toBe('parts')
    expect(eventType(ev('odometer', '2026-01-01'))).toBe('meter')
  })
})

describe('registerEvents', () => {
  it('only emits dated register facts', () => {
    const out = registerEvents({ operation_start_date: '2020-02-01', insurance_start: '2025-11-15', mvip_issue: null })
    expect(out.map((e) => e.type)).toEqual(['registration', 'policy'])
    expect(registerEvents(null)).toEqual([])
  })
})

describe('inferMovements', () => {
  it('reports site changes and ignores a one-record blip', () => {
    const events = [
      ev('job_card', '2026-01-01', { row: { site: 'NHC' } }),
      ev('inspection', '2026-02-01', { row: { site: 'NHC' } }),
      ev('job_card', '2026-03-01', { row: { site: 'JED' } }), // blip
      ev('job_card', '2026-04-01', { row: { site: 'NHC' } }),
      ev('job_card', '2026-05-01', { row: { site: 'DIRIYAH' } }),
      ev('parts_line', '2026-06-01', { row: { site: 'STORE' } }), // issuing store, excluded
    ]
    const moves = inferMovements(events)
    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ fromSite: 'NHC', toSite: 'DIRIYAH', type: 'movement' })
  })
})

describe('meterAt', () => {
  const meters = meterHistory(
    [{ reading_date: '2026-01-01', odometer_km: 1000 }, { reading_date: '2026-03-01', odometer_km: 3000 }],
    [{ reading_date: '2026-02-01', engine_hours: 50 }],
  )
  it('prefers the event own reading', () => {
    const m = meterAt(ev('job_card', '2026-02-15', { row: { odometer: 2500 } }), meters)
    expect(m).toMatchObject({ km: 2500, kmOwn: true, hours: 50, hoursOwn: false })
  })
  it('borrows the latest reading on or before the date, or null', () => {
    expect(meterAt(ev('inspection', '2026-02-15'), meters).km).toBe(1000)
    expect(meterAt(ev('inspection', '2025-12-01'), meters).km).toBeNull()
  })
})

describe('buildViewTimeline + filters', () => {
  const sources = {
    job_card: { ok: true, rows: [{ id: 'w1', work_order_no: 'JC1', work_type: 'Service', opened_at: '2026-06-01T08:00:00Z', production_out_at: '2026-06-01T08:00:00Z', production_in_at: '2026-06-03T08:00:00Z', site: 'NHC', country: 'KSA' }] },
    parts_line: { ok: true, rows: [
      { id: 'p1', event_date: '2026-06-02', line_cost: 100, tyre_cost: 0, spare_cost: 60, oil_cost: 30, country: 'KSA', currency: 'SAR' },
      { id: 'p2', event_date: '2026-07-02', line_cost: 500, tyre_cost: 500, spare_cost: 0, oil_cost: 0, country: 'KSA', currency: 'SAR' },
    ] },
    breakdown: { ok: true, rows: [{ id: 'b1', reported_on: '2026-08-01', returned_on: '2026-08-05', returned_to_service: true }] },
    odometer: { ok: true, rows: [{ id: 'o1', reading_date: '2026-05-01', odometer_km: 9000 }] },
  }
  const timeline = buildTimeline(sources, { now: NOW, country: 'KSA' })
  const meters = meterHistory(sources.odometer.rows, [])
  const downtime = downtimeEpisodes(sources.job_card.rows, sources.breakdown.rows, { now: NOW })
  const fleet = { asset_no: 'TM1', operation_start_date: '2022-01-01', status: 'Active', current_km: 12000, site: 'NHC' }
  const view = buildViewTimeline({ timeline, fleet, meters, downtime, now: NOW })

  it('is newest first and typed', () => {
    const dated = view.filter((e) => !e.undated)
    for (let i = 1; i < dated.length; i++) expect(dated[i - 1].atMs).toBeGreaterThanOrEqual(dated[i].atMs)
    expect(view.find((e) => e.source === 'job_card').type).toBe('service')
  })

  it('attaches downtime days to job cards and breakdown starts only', () => {
    expect(view.find((e) => e.source === 'job_card').downtimeDays).toBe(2)
    expect(view.find((e) => e.id === 'breakdown:b1').downtimeDays).toBe(4)
    expect(view.find((e) => e.id === 'breakdown_return:b1').downtimeDays).toBeNull()
  })

  it('key events hide store issues and meter readings; search and type narrow', () => {
    const key = filterViewEvents(view, { type: 'key' })
    expect(key.some((e) => e.type === 'parts' || e.type === 'meter')).toBe(false)
    expect(filterViewEvents(view, { type: 'all' }).length).toBe(view.length)
    expect(filterViewEvents(view, { type: 'breakdown' }).every((e) => e.type === 'breakdown')).toBe(true)
    expect(filterViewEvents(view, { type: 'all', search: 'jc1' }).length).toBeGreaterThan(0)
    expect(typeCounts(view).parts).toBe(2)
  })

  it('period filter drops older and undated events', () => {
    const recent = filterViewEvents(view, { type: 'all', months: 12, now: NOW })
    expect(recent.some((e) => e.id === 'register:service_start')).toBe(false)
    expect(periodStartMs(null, NOW)).toBeNull()
  })

  it('tab rows follow the tab types', () => {
    expect(tabEvents(view, 'cost').every((e) => e.type === 'parts' || e.type === 'cost')).toBe(true)
    expect(tabEvents(view, 'service').length).toBeGreaterThan(0)
  })

  it('costs by month split into grid buckets, one currency only', () => {
    const months = monthAxis(12, NOW)
    expect(months).toHaveLength(12)
    expect(months[11]).toBe('2026-09')
    const c = costByMonth(view, { currency: 'SAR', months })
    expect(c.totals).toEqual({ service: 30, tyres: 500, repairs: 60, other: 10 })
    expect(c.total).toBe(600)
    expect(c.lines).toBe(2)
    expect(costByMonth(view, { currency: 'AED', months }).lines).toBe(0)
    expect(costCurrencies(view)).toEqual(['SAR'])
  })

  it('downtime by month is null only when a month has cards but none measurable', () => {
    const months = monthAxis(12, NOW)
    const d = downtimeByMonth(downtime.episodes, { months })
    expect(d.days[months.indexOf('2026-06')]).toBe(2)
    expect(d.days[months.indexOf('2026-01')]).toBe(0)
    const un = downtimeByMonth([{ at: '2026-06-01', total: null }], { months })
    expect(un.days[months.indexOf('2026-06')]).toBeNull()
    expect(un.total).toBe(0)
  })

  it('KPIs come from real sources with a basis', () => {
    const k = historyKpis({ fleet, events: view, meters, downtime, now: NOW })
    expect(k.totalKm).toBe(12000)
    expect(k.kmBasis).toBe('Register odometer')
    expect(k.activeYears).toBeCloseTo(4.7, 1)
    expect(k.maintenanceEvents).toBe(1)
    expect(k.incidents).toBe(1)
    expect(k.downtimeDays).toBe(2)
  })

  it('KPIs are null, not zero, when unmeasurable', () => {
    const k = historyKpis({ fleet: null, events: [], meters: null, downtime: null, now: NOW })
    expect(k.totalKm).toBeNull()
    expect(k.activeYears).toBeNull()
    expect(k.downtimeDays).toBeNull()
  })

  it('header finds the last service', () => {
    const h = assetHeader(fleet, view)
    expect(h.lastServiceAt).toBe('2026-06-01')
    expect(h.utilizationPct).toBeNull()
    expect(h.operator).toBeNull()
  })

  it('export rows keep blanks blank', () => {
    const rows = historyViewExportRows(view)
    expect(rows).toHaveLength(view.length)
    const reg = rows.find((r) => r.title === 'Entered service')
    expect(reg.cost).toBe('')
  })
})

describe('documentRows', () => {
  it('lists only recorded documents with an expiry state', () => {
    const rows = documentRows({ registration_no: 'ABC 123', insurance_expiry: '2026-10-10', mvip_expiry: '2025-01-01' }, { now: NOW })
    expect(rows.map((r) => r.key)).toEqual(['registration', 'insurance', 'mvip'])
    expect(rows[1].state.key).toBe('due')
    expect(rows[2].state.key).toBe('expired')
    expect(documentRows({}, { now: NOW })).toEqual([])
  })
})

describe('chartMonths', () => {
  it('uses the period, or spans history capped at 60', () => {
    expect(chartMonths(24, [], NOW)).toHaveLength(24)
    expect(chartMonths(null, [ev('job_card', '2026-07-01')], NOW)).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(chartMonths(null, [ev('job_card', '2010-01-01')], NOW)).toHaveLength(60)
  })
})
