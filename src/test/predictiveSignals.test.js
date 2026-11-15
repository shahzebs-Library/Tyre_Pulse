import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  projectEndDays, replacementOutlook, dueTyreRows, filterDueRows, dueExportRows, DUE_EXPORT_COLUMNS,
  remainingText, maintenanceRisk, riskExportRows, signalGaps, historyDemandRows,
  LONG_BREAKDOWN_DAYS, REPEAT_JOB_CARDS,
} from '../lib/predictiveSignals'
import { bandFor } from '../lib/tyreRunningLife'

const NOW = new Date('2026-11-12T08:00:00Z')
// Shaped running-life rows (see shapeRow in tyreRunningLife.js).
const tyre = (o = {}) => ({
  serial: 'S', asset: 'TM1', position: 'LHF1', size: '315/80R22.5', site: 'NHC', unit: 'km',
  daysOn: 200, kmRun: 40000, remainingKm: 20000, lifeUsedPct: 67, expectedLifeKm: 60000,
  remainingHours: null, hoursRun: null, hoursUsedPct: null, expectedLifeHours: null, remainingDays: null, ...o,
})

describe('projectEndDays', () => {
  it('uses the tyre own rate: 20,000 km left at 200 km a day is 100 days', () => {
    expect(projectEndDays(tyre())).toEqual({ days: 100, basis: 'own_rate' })
  })
  it('is 0 for a tyre already past its expected life', () => {
    const r = tyre({ remainingKm: 0, lifeUsedPct: 110 })
    expect(bandFor(r)).toBe('overdue')
    expect(projectEndDays(r)).toEqual({ days: 0, basis: 'overdue' })
  })
  it('takes whichever meter runs out first', () => {
    const r = tyre({ remainingHours: 300, hoursRun: 2000, hoursUsedPct: 60, expectedLifeHours: 5000 })
    // km says 100 days; hours says 300 / (2000 / 200) = 30 days.
    expect(projectEndDays(r).days).toBe(30)
  })
  it('does not trust a rate from a tyre fitted last week, and falls back to fleet days', () => {
    expect(projectEndDays(tyre({ daysOn: 7, kmRun: 9000, remainingDays: 55 }))).toEqual({ days: 55, basis: 'fleet_days' })
  })
  it('returns null, never a guess, when nothing is measurable', () => {
    expect(projectEndDays(tyre({ remainingKm: null, kmRun: null, lifeUsedPct: null }))).toEqual({ days: null, basis: null })
    expect(projectEndDays(null).days).toBeNull()
  })
})

describe('replacementOutlook', () => {
  const rows = [
    tyre({ serial: 'A', remainingKm: 0, lifeUsedPct: 120 }),                 // overdue
    tyre({ serial: 'B', remainingKm: 4000 }),                                // 20 days -> window 1
    tyre({ serial: 'C', remainingKm: 9000, size: '315/80 R 22.5' }),         // 45 days -> window 2
    tyre({ serial: 'D', remainingKm: 16000, size: '385/65R22.5' }),          // 80 days -> window 3
    tyre({ serial: 'E', remainingKm: 30000, lifeUsedPct: 50 }),              // 150 days -> later
    tyre({ serial: 'F', remainingKm: null, kmRun: null, lifeUsedPct: null }), // unknown
  ]
  const o = replacementOutlook(rows, { now: NOW })
  it('buckets by 30-day window and keeps overdue apart', () => {
    expect(o.overdue).toBe(1)
    expect(o.windows.map((w) => w.count)).toEqual([1, 1, 1])
    expect(o.upcoming).toBe(3)
    expect(o.needed).toBe(4)
    expect(o.later).toBe(1)
  })
  it('counts tyres it cannot project instead of dropping them', () => {
    expect(o.notProjectable).toBe(1)
    expect(o.total).toBe(6)
    expect(o.overdue + o.upcoming + o.later + o.notProjectable).toBe(o.total)
  })
  it('groups by size with spacing folded, largest need first', () => {
    expect(o.bySize[0]).toMatchObject({ size: '315/80R22.5', overdue: 1, w1: 1, w2: 1, w3: 0, total: 3 })
    expect(o.bySize[1]).toMatchObject({ size: '385/65R22.5', w3: 1, total: 1 })
  })
  it('labels windows with real dates and no dash punctuation', () => {
    expect(o.windows[0].label).toMatch(/^12 Nov to 12 Dec$/)
    expect(o.windows.map((w) => w.label).join(' ')).not.toMatch(/[–—-]/)
  })
  it('is all zeros with nothing unknown on an empty fleet', () => {
    const e = replacementOutlook([], { now: NOW })
    expect(e).toMatchObject({ total: 0, overdue: 0, upcoming: 0, notProjectable: 0, bySize: [] })
  })
})

describe('due tyre rows', () => {
  const rows = dueTyreRows([
    tyre({ serial: 'OK', remainingKm: 40000, lifeUsedPct: 30 }),
    tyre({ serial: 'SOON', remainingKm: 3000, lifeUsedPct: 95, site: 'JED' }),
    tyre({ serial: 'OVER', remainingKm: 0, lifeUsedPct: 130 }),
    tyre({ serial: 'HRS', unit: 'hours', remainingKm: null, kmRun: null, lifeUsedPct: null, remainingHours: 0, hoursUsedPct: 105, expectedLifeHours: 5000 }),
  ])
  it('keeps only past-life and due-soon tyres, past life first', () => {
    expect(rows.map((r) => r.serial)).toEqual(['OVER', 'HRS', 'SOON'])
    expect(rows[0].bandLabel).toBe('Past expected life')
  })
  it('states the remaining figure in the meter it was judged on', () => {
    expect(remainingText(rows.find((r) => r.serial === 'SOON'))).toBe('3,000 km')
    expect(remainingText(rows.find((r) => r.serial === 'HRS'))).toBe('0 hrs')
    expect(remainingText({ remaining: null })).toBe('N/A')
  })
  it('filters and exports with N/A for blanks', () => {
    expect(filterDueRows(rows, { site: 'JED' }).map((r) => r.serial)).toEqual(['SOON'])
    expect(filterDueRows(rows, { band: 'overdue' })).toHaveLength(2)
    expect(filterDueRows(rows, { q: 'soon' })).toHaveLength(1)
    const ex = dueExportRows([{ ...rows[0], brand: '', fittedOn: null }])
    expect(Object.keys(ex[0])).toEqual(DUE_EXPORT_COLUMNS.map((c) => c.key))
    expect(ex[0].brand).toBe('N/A')
    expect(ex[0].fittedOn).toBe('N/A')
  })
})

describe('maintenanceRisk', () => {
  const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString()
  const breakdowns = [
    { asset_no: 'IP065', country: 'KSA', site: 'NHC', reported_on: daysAgo(218).slice(0, 10), details: 'Evaporator coil', returned_to_service: false },
    { asset_no: 'TM2', country: 'KSA', reported_on: daysAgo(3).slice(0, 10), returned_to_service: false },
    { asset_no: 'TM3', country: 'KSA', reported_on: daysAgo(90).slice(0, 10), returned_on: daysAgo(60).slice(0, 10), returned_to_service: true },
  ]
  const jobCards = [
    ...[5, 20, 40].map((n) => ({ asset_no: 'tm 9', country: 'KSA', site: 'JED', opened_at: daysAgo(n), work_type: 'Emergency' })),
    ...[5, 20].map((n) => ({ asset_no: 'TM2', country: 'KSA', opened_at: daysAgo(n) })),
    { asset_no: 'TM2', country: 'KSA', opened_at: daysAgo(200) },                         // outside window
    { asset_no: 'TM2', country: 'KSA', opened_at: new Date(NOW.getTime() + 86400000 * 9).toISOString() }, // future typo
    ...[1, 2, 3].map((n) => ({ asset_no: 'TM9', country: 'UAE', opened_at: daysAgo(n) })), // other country, other machine
    ...[1, 2, 3].map((n) => ({ asset_no: 'IP065', country: 'KSA', opened_at: daysAgo(n) })),
  ]
  const { rows, summary } = maintenanceRisk({ breakdowns, jobCards, now: NOW })
  it('lists long open breakdowns and repeat job cards, both-flag first', () => {
    expect(rows.map((r) => `${r.country}|${r.asset}`)).toEqual(['KSA|IP065', 'KSA|tm 9', 'UAE|TM9'])
    expect(rows[0]).toMatchObject({ long: true, repeat: true, downDays: 218, jobCards: 3 })
    expect(rows[0].reason).toBe('Broken down 218 days. 3 job cards in 90 days')
  })
  it('does not list a short breakdown, a closed one, or two job cards', () => {
    expect(rows.find((r) => r.asset === 'TM2')).toBeUndefined()
    expect(rows.find((r) => r.asset === 'TM3')).toBeUndefined()
  })
  it('ignores job cards outside the window and in the future', () => {
    expect(summary.cardsInWindow).toBe(11)
  })
  it('keeps the same asset code in two countries apart', () => {
    expect(rows.filter((r) => /TM ?9/i.test(r.asset))).toHaveLength(2)
  })
  it('summarises with the thresholds it used', () => {
    expect(summary).toMatchObject({ atRisk: 3, longBreakdowns: 1, repeatAssets: 3, openBreakdowns: 2, longDays: LONG_BREAKDOWN_DAYS, repeatMin: REPEAT_JOB_CARDS })
  })
  it('reports unknown, not zero, when a source could not be read', () => {
    const noCards = maintenanceRisk({ breakdowns, jobCards: null, now: NOW })
    expect(noCards.summary.repeatAssets).toBeNull()
    expect(noCards.summary.cardsInWindow).toBeNull()
    expect(noCards.rows[0].jobCards).toBeNull()
    expect(riskExportRows(noCards.rows)[0].jobCards).toBe('N/A')
    const noBd = maintenanceRisk({ breakdowns: null, jobCards, now: NOW })
    expect(noBd.summary.longBreakdowns).toBeNull()
    expect(noBd.summary.openBreakdowns).toBeNull()
    expect(riskExportRows(noBd.rows)[0].downDays).toBe('No open breakdown')
  })
})

describe('signalGaps', () => {
  it('names every empty signal in one sentence and states meter coverage', () => {
    const g = signalGaps({ tyres: 11260, withTread: 0, withPressure: 0, withRisk: 0, fleet: 1622, withKm: 497, withBudget: 0 })
    expect(g.note).toBe('Not recorded yet: tread depth, tyre pressure, risk level and monthly tyre budget. Wear predictions, pressure predictions, failure risk scores and budget forecasts are not shown, because they would only be default values.')
    expect(g.meter).toMatchObject({ fleet: 1622, withKm: 497, pct: 31 })
    expect(g.meter.note).toMatch(/^497 of 1,622 assets have a current odometer reading/)
    expect(g.allRecorded).toBe(false)
  })
  it('calls a thinly filled column too few to predict from', () => {
    const g = signalGaps({ tyres: 1000, withTread: 12, withPressure: 900, withRisk: 0, fleet: 10, withKm: 10, withBudget: 0 })
    expect(g.items.find((i) => i.key === 'tread').state).toBe('sparse')
    expect(g.note).toMatch(/Tread depth is recorded on only 12 of 1,000 tyres, too few to predict from\./)
    expect(g.note).toMatch(/Tyre pressure is recorded on 900 of 1,000 tyres, but this page does not use it yet\./)
  })
  it('says could not be checked for a failed count, never none recorded', () => {
    const g = signalGaps({ tyres: 100, withTread: null, withPressure: 0, withRisk: 0, fleet: null, withKm: null, withBudget: null })
    expect(g.items.find((i) => i.key === 'tread').state).toBe('unchecked')
    expect(g.note).toMatch(/Could not be checked: tread depth and monthly tyre budget\./)
    expect(g.meter.pct).toBeNull()
    expect(g.meter.note).toBe('Meter coverage could not be checked.')
  })
})

describe('historyDemandRows', () => {
  it('maps the forecast months and is empty without a forecast', () => {
    expect(historyDemandRows(null)).toEqual([])
    expect(historyDemandRows({ forecastMonths: ['2026-12'], forecastLabels: ['Dec 26'], totals: { forecast: [140] } }))
      .toEqual([{ key: '2026-12', label: 'Dec 26', count: 140 }])
  })
})

describe('the page stays on recorded signals', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/pages/PredictiveMaintenance.jsx'), 'utf8').replace(/\r/g, '')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  it('reads no tread, pressure, risk level or budget column', () => {
    for (const col of ['tread_depth', 'pressure_reading', 'risk_level', 'monthly_tyre_budget', 'cost_per_tyre']) {
      expect(code.includes(col), `page reads ${col}`).toBe(false)
    }
  })
  it('judges tyres through the shared running-life service and caps no export', () => {
    expect(code.includes('getTyreRunningLife')).toBe(true)
    expect(code.includes('PDF_ROW_CAP')).toBe(false)
    expect(/exportRows\([^)]*\)\.slice\(/.test(code)).toBe(false)
  })
  it('has no em or en dashes in its strings', () => {
    expect(/[–—]/.test(src)).toBe(false)
  })
})
