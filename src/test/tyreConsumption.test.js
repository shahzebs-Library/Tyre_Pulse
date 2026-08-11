import { describe, it, expect } from 'vitest'
import {
  consumptionRates, basisNote, batchDateCheck, monthRows, monthTrend,
  dailySeries, breakdownRows, breakdownNote, fmtRate, fmtCount,
  shapeConsumption, daysBetween, toIsoDay, parseIsoDay, daysInMonth,
  GOOD_COVERAGE_PCT,
} from '../lib/tyreConsumption'

describe('date helpers', () => {
  it('formats a local day without the UTC rollback', () => {
    // At +03:00 toISOString() would report the previous day for a midnight date.
    expect(toIsoDay(new Date(2026, 7, 1))).toBe('2026-08-01')
  })
  it('parses YYYY-MM-DD as local, not UTC', () => {
    const d = parseIsoDay('2026-08-01')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7)
    expect(d.getDate()).toBe(1)
  })
  it('counts inclusive days and refuses a reversed range', () => {
    expect(daysBetween('2026-08-01', '2026-08-11')).toBe(11)
    expect(daysBetween('2026-08-11', '2026-08-01')).toBeNull()
    expect(daysBetween('nope', '2026-08-01')).toBeNull()
  })
  it('knows month lengths', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2026-08')).toBe(31)
    expect(daysInMonth('garbage')).toBeNull()
  })
})

describe('consumptionRates', () => {
  it('computes both bases from the real KSA August numbers', () => {
    // Measured live: 130 fitments, 1-11 August, 10 of 11 days recorded.
    const r = consumptionRates({ fitments: 130, calendarDays: 11, activeDays: 10 })
    expect(r.perCalendarDay).toBeCloseTo(11.82, 2)
    expect(r.perActiveDay).toBeCloseTo(13, 2)
    expect(r.coveragePct).toBeCloseTo(90.9, 1)
    expect(r.basisDiverges).toBe(false)
  })

  it('flags divergence on the real Egypt numbers', () => {
    // Measured live: 96 fitments over 91 days but only 27 recording days.
    const r = consumptionRates({ fitments: 96, calendarDays: 91, activeDays: 27 })
    expect(r.perCalendarDay).toBeCloseTo(1.05, 2)
    expect(r.perActiveDay).toBeCloseTo(3.56, 2)
    expect(r.coveragePct).toBeCloseTo(29.7, 1)
    expect(r.basisDiverges).toBe(true)
    expect(r.ratio).toBeGreaterThan(3)
  })

  it('returns NULL not zero when the period recorded nothing', () => {
    const r = consumptionRates({ fitments: 0, calendarDays: 30, activeDays: 0 })
    expect(r.perCalendarDay).toBeNull()
    expect(r.perActiveDay).toBeNull()
    // The distinction that matters: an unmeasured rate must never render as 0.
    expect(r.perCalendarDay).not.toBe(0)
  })

  it('returns null rates when the period length is unknown', () => {
    const r = consumptionRates({ fitments: 50, calendarDays: null, activeDays: null })
    expect(r.perCalendarDay).toBeNull()
    expect(r.perActiveDay).toBeNull()
    expect(r.coveragePct).toBeNull()
  })

  it('does not divide by a zero-length period', () => {
    const r = consumptionRates({ fitments: 5, calendarDays: 0, activeDays: 0 })
    expect(r.perCalendarDay).toBeNull()
    expect(Number.isFinite(r.perCalendarDay)).toBe(false)
  })
})

describe('basisNote', () => {
  it('states the calendar basis and calls quiet days real at high coverage', () => {
    const n = basisNote(consumptionRates({ fitments: 1027, calendarDays: 91, activeDays: 87 }))
    expect(n).toMatch(/per calendar day/)
    expect(n).toMatch(/real quiet days/)
  })
  it('warns the calendar rate is a lower bound at middling coverage', () => {
    // The real UAE numbers: 82.4% coverage, but the two bases still differ by
    // 21% (5.60 vs 6.80), so this must land in the caution band, not the
    // reassuring one. This case is why GOOD_COVERAGE_PCT is 85 and not 80.
    const r = consumptionRates({ fitments: 510, calendarDays: 91, activeDays: 75 })
    expect(r.basisDiverges).toBe(true)
    expect(basisNote(r)).toMatch(/lower bound/)
  })
  it('refuses to endorse either figure when recording is thin', () => {
    const n = basisNote(consumptionRates({ fitments: 96, calendarDays: 91, activeDays: 27 }))
    expect(n).toMatch(/understatement/)
    expect(n).toMatch(/overstatement/)
    expect(n).toMatch(/neither should be quoted/)
  })
  it('says no rate can be measured rather than reporting zero', () => {
    const n = basisNote(consumptionRates({ fitments: 0, calendarDays: 30, activeDays: 0 }))
    expect(n).toMatch(/no daily rate can be measured/)
    expect(n).toMatch(/not the same as a fleet that fitted no tyres/)
  })
})

describe('batchDateCheck', () => {
  it('passes the real KSA August pattern: 1 upload day, 10 fitment dates', () => {
    const c = batchDateCheck({ upload_days: 1, fit_days: 10, same_day: 0 }, 130)
    expect(c.ok).toBe(true)
    expect(c.verdict).toBe('real')
    expect(c.note).toMatch(/real business dates/)
  })
  it('catches a batch load that stamped rows with their own upload day', () => {
    const c = batchDateCheck({ upload_days: 2, fit_days: 2, same_day: 180 }, 200)
    expect(c.ok).toBe(false)
    expect(c.verdict).toBe('clustered')
    expect(c.note).toMatch(/would describe when the file was loaded/)
  })
  it('catches dates that barely spread beyond the upload days', () => {
    const c = batchDateCheck({ upload_days: 2, fit_days: 3, same_day: 0 }, 300)
    expect(c.ok).toBe(false)
  })
  it('admits when it cannot check rather than guessing', () => {
    expect(batchDateCheck(null, 100).ok).toBeNull()
    expect(batchDateCheck({ upload_days: 1, fit_days: 5, same_day: 0 }, 0).verdict).toBe('unknown')
  })
})

describe('monthRows and monthTrend', () => {
  const by = [
    { m: '2026-06', n: 331, active_days: 30, cal_days: 30 },
    { m: '2026-07', n: 380, active_days: 31, cal_days: 31 },
    { m: '2026-08', n: 130, active_days: 10, cal_days: 11 },
  ]
  it('rates each month on its own elapsed days and marks the partial one', () => {
    const rows = monthRows(by)
    expect(rows[1].perCalendarDay).toBeCloseTo(12.26, 2)
    expect(rows[2].partial).toBe(true)   // 11 of 31 August days elapsed
    expect(rows[1].partial).toBe(false)
    // The partial month must still be rated on 11 days, not 31.
    expect(rows[2].perCalendarDay).toBeCloseTo(11.82, 2)
  })
  it('ignores the partial month so it cannot report a fake collapse', () => {
    const t = monthTrend(monthRows(by))
    expect(t.to).toBe('2026-07')       // not 2026-08
    expect(t.direction).toBe('up')
    expect(t.changePct).toBeGreaterThan(0)
  })
  it('declines a trend with fewer than two complete months', () => {
    const t = monthTrend(monthRows([{ m: '2026-08', n: 130, active_days: 10, cal_days: 11 }]))
    expect(t.direction).toBe('unknown')
    expect(t.changePct).toBeNull()
  })
  it('calls a small change flat rather than a direction', () => {
    const t = monthTrend(monthRows([
      { m: '2026-06', n: 300, active_days: 30, cal_days: 30 },
      { m: '2026-07', n: 310, active_days: 31, cal_days: 31 },
    ]))
    expect(t.direction).toBe('flat')
  })
})

describe('dailySeries', () => {
  it('zero-fills quiet days and marks which were recorded', () => {
    const s = dailySeries([{ d: '2026-08-01', n: 12 }, { d: '2026-08-03', n: 15 }], '2026-08-01', '2026-08-03')
    expect(s).toHaveLength(3)
    expect(s[1]).toEqual({ d: '2026-08-02', n: 0, recorded: false })
    expect(s[0].recorded).toBe(true)
  })
  it('returns nothing for a reversed or unparseable range', () => {
    expect(dailySeries([], '2026-08-11', '2026-08-01')).toEqual([])
    expect(dailySeries([], null, null)).toEqual([])
  })
  it('bounds the series so a huge window cannot blow up the chart', () => {
    expect(dailySeries([], '2000-01-01', '2026-01-01', { max: 50 })).toHaveLength(50)
  })
})

describe('breakdowns', () => {
  const rows = [
    { k: 'NHC', n: 54, assets: 40, resolved: true },
    { k: 'DIRIYAH-G1', n: 21, assets: 17, resolved: true },
    { k: 'Not linked to a site', n: 25, assets: 5, resolved: false },
  ]
  it('computes share and the resolved percentage', () => {
    const bd = breakdownRows(rows)
    expect(bd.total).toBe(100)
    expect(bd.rows[0].sharePct).toBe(54)
    expect(bd.resolvedPct).toBe(75)
  })
  it('states unattributed fitments instead of spreading them', () => {
    expect(breakdownNote(breakdownRows(rows), 'site')).toMatch(/25.0% of these fitments could not be attributed/)
  })
  it('stays silent when everything resolved', () => {
    const bd = breakdownRows([{ k: 'NHC', n: 10, assets: 4, resolved: true }])
    expect(breakdownNote(bd, 'site')).toBeNull()
  })
  it('handles an empty breakdown without dividing by zero', () => {
    const bd = breakdownRows([])
    expect(bd.total).toBe(0)
    expect(bd.resolvedPct).toBeNull()
    expect(breakdownNote(bd, 'site')).toBeNull()
  })
})

describe('formatters', () => {
  it('never prints a fabricated zero for an unknown rate', () => {
    expect(fmtRate(null)).toBe('Not measured')
    expect(fmtRate(11.818)).toBe('11.82/day')
    expect(fmtCount(null)).toBe('Not measured')
    expect(fmtCount(1130)).toBe('1,130')
  })
})

describe('shapeConsumption', () => {
  const payload = {
    ok: true, from: '2026-08-01', to: '2026-08-11', country: 'KSA',
    calendar_days: 11, fitments: 130, active_days: 10, assets: 101, undated: 184,
    batch_check: { upload_days: 1, fit_days: 10, same_day: 0 },
    by_day: [
      { d: '2026-08-01', n: 12 }, { d: '2026-08-02', n: 22 }, { d: '2026-08-03', n: 15 },
      { d: '2026-08-04', n: 8 }, { d: '2026-08-05', n: 4 }, { d: '2026-08-06', n: 10 },
      { d: '2026-08-07', n: 7 }, { d: '2026-08-08', n: 16 }, { d: '2026-08-09', n: 16 },
      { d: '2026-08-10', n: 20 },
    ],
    by_month: [{ m: '2026-08', n: 130, active_days: 10, cal_days: 11 }],
    by_site: [{ k: 'NHC', n: 54, assets: 40, resolved: true }],
    by_class: [{ k: 'TR-MIXER', n: 103, assets: 82, resolved: true }],
  }

  it('shapes the real August payload end to end', () => {
    const s = shapeConsumption(payload, { now: new Date(2026, 7, 11) })
    expect(s.ok).toBe(true)
    expect(s.fitments).toBe(130)
    expect(s.perCalendarDay).toBeCloseTo(11.82, 2)
    expect(s.perActiveDay).toBeCloseTo(13, 2)
    expect(s.batch.ok).toBe(true)
    expect(s.series).toHaveLength(11)
    expect(s.assets).toBe(101)
  })

  it('reports the undated rows so they never read as fewer fitments', () => {
    expect(shapeConsumption(payload, { now: new Date(2026, 7, 11) }).undated).toBe(184)
  })

  it('measures staleness from the last recorded day', () => {
    const s = shapeConsumption(payload, { now: new Date(2026, 7, 11) })
    expect(s.lastRecorded).toBe('2026-08-10')
    expect(s.staleDays).toBe(1)
  })

  it('passes an error payload through with its reason', () => {
    expect(shapeConsumption({ ok: false, reason: 'forbidden' })).toEqual({ ok: false, reason: 'forbidden' })
    expect(shapeConsumption(null).ok).toBe(false)
  })

  it('yields a null rate, not zero, for an empty but valid period', () => {
    const s = shapeConsumption({
      ok: true, from: '2026-08-01', to: '2026-08-11', calendar_days: 11,
      fitments: 0, active_days: 0, assets: 0, undated: 0,
      batch_check: { upload_days: 0, fit_days: 0, same_day: 0 },
      by_day: [], by_month: [], by_site: [], by_class: [],
    }, { now: new Date(2026, 7, 11) })
    expect(s.ok).toBe(true)
    expect(s.perCalendarDay).toBeNull()
    expect(s.lastRecorded).toBeNull()
    expect(s.basisNote).toMatch(/no daily rate can be measured/)
  })
})

describe('the invariant that matters', () => {
  it('never reports a rate of exactly 0 from an absence of data', () => {
    for (const cal of [0, 1, 30, 91]) {
      const r = consumptionRates({ fitments: 0, calendarDays: cal, activeDays: 0 })
      expect(r.perCalendarDay === 0).toBe(false)
      expect(r.perActiveDay === 0).toBe(false)
    }
  })
  it('keeps GOOD_COVERAGE_PCT as the divergence gate', () => {
    const just = consumptionRates({ fitments: 100, calendarDays: 100, activeDays: GOOD_COVERAGE_PCT })
    expect(just.basisDiverges).toBe(false)
    const below = consumptionRates({ fitments: 100, calendarDays: 100, activeDays: GOOD_COVERAGE_PCT - 1 })
    expect(below.basisDiverges).toBe(true)
  })
})
