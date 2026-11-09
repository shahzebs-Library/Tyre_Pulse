import { describe, it, expect } from 'vitest'
import {
  periodWindows, shiftYear, quarterStart, yearStart, isLeapYear, parseDay, pctChange,
  shapeConsumptionV2, consumptionV2Sheets, windowLabel, EVENT_ROWS,
} from '../lib/tyreConsumptionPeriods'

describe('period windows (mirror of get_tyre_consumption_v2)', () => {
  it('QTD and YTD anchor on the period end', () => {
    const w = periodWindows('2026-08-01', '2026-10-31')
    expect(w.qtd).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(w.ytd).toEqual({ from: '2026-01-01', to: '2026-10-31' })
    expect(w.selected_prev).toEqual({ from: '2025-08-01', to: '2025-10-31' })
    expect(w.qtd_prev).toEqual({ from: '2025-10-01', to: '2025-10-31' })
    expect(w.ytd_prev).toEqual({ from: '2025-01-01', to: '2025-10-31' })
  })

  it('on 1 January the year and quarter windows are that single day', () => {
    const w = periodWindows('2026-01-01', '2026-01-01')
    expect(w.ytd).toEqual({ from: '2026-01-01', to: '2026-01-01' })
    expect(w.qtd).toEqual({ from: '2026-01-01', to: '2026-01-01' })
    expect(w.ytd_prev).toEqual({ from: '2025-01-01', to: '2025-01-01' })
  })

  it('a period spanning the year start keeps its own start while YTD restarts', () => {
    const w = periodWindows('2025-12-15', '2026-01-10')
    expect(w.ytd.from).toBe('2026-01-01')
    expect(w.selected_prev).toEqual({ from: '2024-12-15', to: '2025-01-10' })
  })

  it('29 February becomes 28 February one year back (Postgres semantics)', () => {
    expect(shiftYear('2028-02-29')).toBe('2027-02-28')
    expect(shiftYear('2028-03-01')).toBe('2027-03-01')
    const w = periodWindows('2028-02-01', '2028-02-29')
    expect(w.selected_prev).toEqual({ from: '2027-02-01', to: '2027-02-28' })
    expect(w.ytd_prev).toEqual({ from: '2027-01-01', to: '2027-02-28' })
  })

  it('quarter starts for every quarter', () => {
    expect(quarterStart('2026-03-31')).toBe('2026-01-01')
    expect(quarterStart('2026-04-01')).toBe('2026-04-01')
    expect(quarterStart('2026-09-30')).toBe('2026-07-01')
    expect(quarterStart('2026-12-31')).toBe('2026-10-01')
    expect(yearStart('2026-07-04')).toBe('2026-01-01')
  })

  it('leap years and invalid dates', () => {
    expect(isLeapYear(2028)).toBe(true)
    expect(isLeapYear(2100)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
    expect(parseDay('2027-02-29')).toBeNull()
    expect(periodWindows('2026-10-31', '2026-08-01')).toBeNull()
    expect(periodWindows('bad', '2026-08-01')).toBeNull()
  })

  it('labels a window in plain words', () => {
    expect(windowLabel({ from: '2026-01-01', to: '2026-10-31' })).toBe('1 Jan 2026 to 31 Oct 2026')
    expect(windowLabel(null)).toBe('Period not known')
  })
})

describe('pctChange keeps unknown apart from zero', () => {
  it('null when previous is 0 or missing, never a fake 0%', () => {
    expect(pctChange(10, 0)).toBeNull()
    expect(pctChange(10, null)).toBeNull()
    expect(pctChange(null, 5)).toBeNull()
    expect(pctChange(245, 4385)).toBe(-94.4)
    expect(pctChange(5, 5)).toBe(0)
  })
})

describe('shapeConsumptionV2', () => {
  const block = (o) => ({ from: '2026-08-01', to: '2026-10-31', installations: 0, physical_consumed: 0, ...o })
  const payload = {
    ok: true, from: '2026-08-01', to: '2026-10-31',
    periods: {
      selected: block({ installations: 245, physical_consumed: 208, new_fitments: 200, duplicate_entries: 0 }),
      selected_prev: block({ from: '2025-08-01', to: '2025-10-31', installations: 4373, physical_consumed: 4145 }),
      qtd: block({ from: '2026-10-01', installations: 22, physical_consumed: 13 }),
      qtd_prev: block({ from: '2025-10-01', to: '2025-10-31', installations: 1639, physical_consumed: 1527 }),
      ytd: block({ from: '2026-01-01', installations: 2295, physical_consumed: 2117 }),
      ytd_prev: block({ from: '2025-01-01', to: '2025-10-31', installations: 0, physical_consumed: null }),
    },
    breakdowns: {
      site: [{ k: 'NHC', resolved: true, installations: 121, physical_new: 100, reused: 20, removed: 534 },
             { k: 'Not recorded', resolved: false, installations: 4, physical_new: 4, reused: 0, removed: 0 }],
      supplier: [{ k: 'Not recorded', resolved: false, installations: 245, physical_new: 200, reused: 37, removed: 1188 }],
    },
    undated_fitments: 169, undated_scrapped: 135, supplier_recorded: 0,
  }

  it('builds the three cards with last-year change, never a fabricated change', () => {
    const s = shapeConsumptionV2(payload)
    expect(s.ok).toBe(true)
    const sel = s.cards.find((c) => c.key === 'selected')
    expect(sel.physical).toBe(208)
    expect(sel.installations).toBe(245)
    expect(sel.physicalChangePct).toBe(-95)
    const ytd = s.cards.find((c) => c.key === 'ytd')
    expect(ytd.installationsChangePct).toBeNull() // last year 0
    expect(ytd.prevPhysical).toBeNull() // unknown stays unknown
  })

  it('event rows follow the declared order and missing counts read null', () => {
    const s = shapeConsumptionV2(payload)
    expect(s.eventRows.map((r) => r.key)).toEqual(EVENT_ROWS.map((r) => r.key))
    expect(s.eventRows.find((r) => r.key === 'retreaded').selected).toBeNull()
  })

  it('breakdown shares and the supplier gap', () => {
    const s = shapeConsumptionV2(payload)
    expect(s.breakdowns.site[0].sharePct).toBe(96.8)
    expect(s.breakdowns.site[1].resolved).toBe(false)
    expect(s.breakdowns.brand).toEqual([])
    expect(s.supplierMissing).toBe(true)
  })

  it('errors pass the reason through', () => {
    expect(shapeConsumptionV2({ ok: false, reason: 'forbidden' })).toEqual({ ok: false, reason: 'forbidden' })
    expect(shapeConsumptionV2(null).ok).toBe(false)
  })

  it('export sheets: one counts sheet plus one per breakdown, N/A for unknown', () => {
    const sheets = consumptionV2Sheets(shapeConsumptionV2(payload))
    expect(sheets.map((x) => x.name)).toEqual([
      'Counts by period', 'By site', 'By brand', 'By size', 'By supplier', 'By vehicle type',
    ])
    const ytdPrevPhys = sheets[0].rows.find((r) => r.label === 'Physical tyres consumed').ytd_prev
    expect(ytdPrevPhys).toBe('N/A')
    expect(sheets[0].headers[1]).toContain('1 Aug 2026 to 31 Oct 2026')
  })
})
