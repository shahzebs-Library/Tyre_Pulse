import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement as el } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { JOB_CARD_PRIORITIES } from '../lib/jobCard'
import {
  RFR_STATUSES, RFR_PRIORITIES, RFR_FAULT_CATEGORIES, RFR_TARGET_HOURS,
  RFR_STATUS_META, EMPTY_RFR_FILTERS,
  normalizeRfrStatus, canonRfrPriority, rfrStatusLabel, rfrStatusMeta,
  isOpenRfr, isTerminalRfrStatus,
  nextRfrStatuses, canTransitionRfr,
  rfrAgeHours, rfrAgeDays, hoursToAcknowledge, hoursToConvert,
  targetHoursFor, isRfrOverdue,
  parseRfrNo, rfrPeriod, dayKey, monthKey,
  filterRfrs, filterJobCardRfrs,
  summarizeRfrs, rfrConversionFunnel, byRfrGroup, timeToConvertBands,
  rfrMonthlyTrend, jobCardRfrView, summarizeJobCardRfrs,
  rfrExportRows, jobCardRfrExportRows, rfrFindings,
} from '../lib/repairRequests'

// One fixed clock for every case. The engine takes `now` explicitly precisely
// so a test and a render read the same number.
const NOW = Date.parse('2026-08-24T12:00:00.000Z')

const req = (over = {}) => ({
  id: over.id || 'r1',
  rfr_no: 'GC/RFR/0948/1225',
  asset_no: 'TM514',
  site: 'NHC',
  country: 'KSA',
  status: 'submitted',
  priority: 'Medium',
  fault_category: 'Hydraulics',
  description: 'Drum will not turn',
  reported_by_name: 'A. Khan',
  reported_at: '2026-08-24T08:00:00.000Z',
  ...over,
})

describe('vocabulary', () => {
  it('keeps RFR priorities a SUBSET of the job-card priorities', () => {
    // The mirror rule. A converted request carries its priority onto the card,
    // so a priority the card cannot express would be lost at exactly the moment
    // it matters (or rejected by the work_orders CHECK).
    for (const p of RFR_PRIORITIES) {
      expect(JOB_CARD_PRIORITIES).toContain(p)
    }
    expect(RFR_PRIORITIES.length).toBeGreaterThan(0)
  })

  it('gives every status a label and presentation metadata', () => {
    for (const s of RFR_STATUSES) {
      expect(RFR_STATUS_META[s]).toBeTruthy()
      expect(typeof RFR_STATUS_META[s].label).toBe('string')
      expect(RFR_STATUS_META[s].label.length).toBeGreaterThan(0)
    }
  })

  it('offers a target for every priority', () => {
    for (const p of RFR_PRIORITIES) {
      expect(Number.isFinite(RFR_TARGET_HOURS[p])).toBe(true)
    }
  })

  it('carries fault categories a concrete fleet actually uses', () => {
    expect(RFR_FAULT_CATEGORIES).toContain('Hydraulics')
    expect(RFR_FAULT_CATEGORIES).toContain('Drum / Mixer')
    expect(RFR_FAULT_CATEGORIES).toContain('Pump')
  })
})

describe('normalisation', () => {
  it('folds legacy and synonym tokens onto the canonical five', () => {
    expect(normalizeRfrStatus('SUBMITTED')).toBe('submitted')
    expect(normalizeRfrStatus('Under Review')).toBe('acknowledged')
    expect(normalizeRfrStatus('job card created')).toBe('converted')
    expect(normalizeRfrStatus('Declined')).toBe('rejected')
    expect(normalizeRfrStatus('canceled')).toBe('cancelled')
  })

  it('returns empty rather than guessing at an unknown status', () => {
    expect(normalizeRfrStatus('banana')).toBe('')
    expect(normalizeRfrStatus(null)).toBe('')
    expect(rfrStatusLabel('banana')).toBe('Not recorded')
    expect(rfrStatusMeta('banana')).toBeNull()
  })

  it('treats an unrecognised status as OPEN, never as done', () => {
    // A request nobody can classify is still a request somebody made. Hiding it
    // from the open queue is how it stops being answered.
    expect(isOpenRfr('banana')).toBe(true)
    expect(isOpenRfr('')).toBe(true)
    expect(isOpenRfr('submitted')).toBe(true)
    expect(isOpenRfr('acknowledged')).toBe(true)
    expect(isOpenRfr('converted')).toBe(false)
    expect(isTerminalRfrStatus('rejected')).toBe(true)
  })

  it('returns null for an unset priority instead of defaulting to Medium', () => {
    // Defaulting an unset priority into the busiest bucket would flatter every
    // response figure that keys off the target hours.
    expect(canonRfrPriority('')).toBeNull()
    expect(canonRfrPriority(null)).toBeNull()
    expect(canonRfrPriority('nonsense')).toBeNull()
    expect(canonRfrPriority('critical')).toBe('Critical')
    expect(canonRfrPriority('URGENT')).toBe('Critical')
    expect(canonRfrPriority('routine')).toBe('Low')
  })
})

describe('transitions', () => {
  it('allows only the legal next states', () => {
    expect(nextRfrStatuses('submitted')).toEqual(['acknowledged', 'rejected', 'cancelled'])
    expect(nextRfrStatuses('acknowledged')).toEqual(['converted', 'rejected', 'cancelled'])
  })

  it('makes converted, rejected and cancelled terminal', () => {
    expect(nextRfrStatuses('converted')).toEqual([])
    expect(nextRfrStatuses('rejected')).toEqual([])
    expect(nextRfrStatuses('cancelled')).toEqual([])
    expect(canTransitionRfr('converted', 'submitted')).toBe(false)
    expect(canTransitionRfr('rejected', 'acknowledged')).toBe(false)
  })

  it('refuses to skip acknowledgement on the way to a job card', () => {
    expect(canTransitionRfr('submitted', 'converted')).toBe(false)
    expect(canTransitionRfr('submitted', 'acknowledged')).toBe(true)
    expect(canTransitionRfr('acknowledged', 'converted')).toBe(true)
  })

  it('treats an unrecognised current status as submitted so a row is never stranded', () => {
    expect(nextRfrStatuses('banana')).toEqual(['acknowledged', 'rejected', 'cancelled'])
  })

  it('refuses an unrecognised target', () => {
    expect(canTransitionRfr('submitted', 'banana')).toBe(false)
  })
})

describe('time: null, never zero', () => {
  it('reports an unknown age as null rather than zero hours', () => {
    // A zero would sort the least documented request as the freshest one on the
    // queue, which is the exact opposite of the truth.
    expect(rfrAgeHours(req({ reported_at: null }), NOW)).toBeNull()
    expect(rfrAgeDays(req({ reported_at: '' }), NOW)).toBeNull()
  })

  it('measures an open request to now and a converted one to its conversion', () => {
    expect(rfrAgeHours(req(), NOW)).toBe(4)
    const converted = req({
      status: 'converted',
      converted_at: '2026-08-24T10:00:00.000Z',
    })
    // Measured to conversion (2h), not to now (4h) - the wait stopped there.
    expect(rfrAgeHours(converted, NOW)).toBe(2)
  })

  it('reports a reversed pair as unmeasurable, never as a negative wait', () => {
    const bad = req({ reported_at: '2026-08-25T00:00:00.000Z' })
    expect(rfrAgeHours(bad, NOW)).toBeNull()
    expect(hoursToConvert(req({
      reported_at: '2026-08-24T10:00:00.000Z',
      converted_at: '2026-08-24T08:00:00.000Z',
    }))).toBeNull()
  })

  it('cannot measure time to acknowledge without an acknowledged_at', () => {
    // The schema carries no acknowledged_at today. Substituting updated_at would
    // be a guess dressed as a measurement: any later edit moves it.
    expect(hoursToAcknowledge(req({ updated_at: '2026-08-24T09:00:00.000Z' }))).toBeNull()
    expect(hoursToAcknowledge(req({ acknowledged_at: '2026-08-24T09:30:00.000Z' }))).toBe(1.5)
    // ... and reads it out of custom_data when it has not been promoted yet.
    expect(hoursToAcknowledge(req({
      custom_data: { acknowledged_at: '2026-08-24T11:00:00.000Z' },
    }))).toBe(3)
  })

  it('measures hours to convert only when both ends exist', () => {
    expect(hoursToConvert(req())).toBeNull()
    expect(hoursToConvert(req({ converted_at: '2026-08-24T14:00:00.000Z' }))).toBe(6)
  })
})

describe('overdue', () => {
  it('uses the target for the row priority', () => {
    expect(targetHoursFor(req({ priority: 'Critical' }))).toBe(RFR_TARGET_HOURS.Critical)
    expect(targetHoursFor(req({ priority: 'Low' }))).toBe(RFR_TARGET_HOURS.Low)
    // An unset priority falls back to the documented default rather than to the
    // strictest or the loosest target.
    expect(targetHoursFor(req({ priority: null }))).toBe(24)
  })

  it('flags an open request past its target', () => {
    // 4h old, Critical target 4h -> not yet past it.
    expect(isRfrOverdue(req({ priority: 'Critical' }), NOW)).toBe(false)
    const older = req({ priority: 'Critical', reported_at: '2026-08-24T00:00:00.000Z' })
    expect(isRfrOverdue(older, NOW)).toBe(true)
  })

  it('never calls an unmeasurable request overdue', () => {
    const noDate = req({ priority: 'Critical', reported_at: null })
    expect(isRfrOverdue(noDate, NOW)).toBe(false)
  })

  it('never calls a resolved request overdue', () => {
    const done = req({
      status: 'converted',
      priority: 'Critical',
      reported_at: '2026-08-01T00:00:00.000Z',
      converted_at: '2026-08-20T00:00:00.000Z',
    })
    expect(isRfrOverdue(done, NOW)).toBe(false)
  })
})

describe('the RFR document number', () => {
  it('reads the live format', () => {
    expect(parseRfrNo('GC/RFR/0948/1225')).toEqual({
      entity: 'GC', seqText: '0948', seq: 948, month: 12, year: 2025, period: '2025-12',
    })
    expect(rfrPeriod('GC/RFR/0948/1225')).toBe('2025-12')
  })

  it('returns null on anything it cannot read, rather than bending it into a period', () => {
    expect(parseRfrNo('')).toBeNull()
    expect(parseRfrNo(null)).toBeNull()
    expect(parseRfrNo('RFR-948')).toBeNull()
    expect(parseRfrNo('GC/RFR/0948/1325')).toBeNull()   // month 13 does not exist
    expect(rfrPeriod('not a reference')).toBeNull()
  })

  it('formats day and month keys without shifting a date-only value', () => {
    expect(dayKey('2026-08-24')).toBe('2026-08-24')
    expect(dayKey('2026-08-24T23:30:00.000Z')).toBe('2026-08-24')
    expect(monthKey('2026-08-24')).toBe('2026-08')
    expect(dayKey(null)).toBeNull()
  })
})

describe('filtering', () => {
  const rows = [
    req({ id: 'a', site: 'NHC', priority: 'Critical', status: 'submitted' }),
    req({ id: 'b', site: 'DIRIYAH-G1', priority: 'Low', status: 'converted', asset_no: 'MP093' }),
    req({ id: 'c', site: 'NHC', priority: 'Medium', status: 'rejected', fault_category: 'Brakes' }),
  ]

  it('returns everything when no filter is set', () => {
    expect(filterRfrs(rows, EMPTY_RFR_FILTERS)).toHaveLength(3)
    expect(filterRfrs(rows)).toHaveLength(3)
  })

  it('filters by status, priority, site, asset and fault', () => {
    expect(filterRfrs(rows, { status: 'converted' }).map((r) => r.id)).toEqual(['b'])
    expect(filterRfrs(rows, { priority: 'Critical' }).map((r) => r.id)).toEqual(['a'])
    expect(filterRfrs(rows, { site: 'NHC' }).map((r) => r.id)).toEqual(['a', 'c'])
    expect(filterRfrs(rows, { assetNo: 'mp 093' }).map((r) => r.id)).toEqual(['b'])
    expect(filterRfrs(rows, { faultCategory: 'Brakes' }).map((r) => r.id)).toEqual(['c'])
  })

  it('sweeps identity and free text with search', () => {
    expect(filterRfrs(rows, { search: 'drum' })).toHaveLength(3)
    expect(filterRfrs(rows, { search: 'MP093' }).map((r) => r.id)).toEqual(['b'])
    expect(filterRfrs(rows, { search: 'nothing here' })).toHaveLength(0)
  })

  it('EXCLUDES a row that cannot be placed in the date window rather than sweeping it in', () => {
    const undated = [...rows, req({ id: 'd', reported_at: null })]
    const out = filterRfrs(undated, { from: '2026-08-01', to: '2026-08-31' })
    expect(out.map((r) => r.id)).not.toContain('d')
    expect(out).toHaveLength(3)
  })

  it('filters the historical job-card view on the shared keys', () => {
    const cards = [
      { id: 1, rfr_no: 'GC/RFR/0001/1225', site: 'NHC', opened_at: '2026-08-10T00:00:00Z', asset_no: 'TM514' },
      { id: 2, rfr_no: 'GC/RFR/0002/1225', site: 'JED', opened_at: '2026-07-01T00:00:00Z', asset_no: 'MP093' },
    ]
    expect(filterJobCardRfrs(cards, { site: 'NHC' })).toHaveLength(1)
    expect(filterJobCardRfrs(cards, { from: '2026-08-01' })).toHaveLength(1)
    expect(filterJobCardRfrs(cards, { search: 'mp093' })).toHaveLength(1)
  })
})

describe('summary: an unmeasurable figure is null', () => {
  it('returns nulls, not zeros, over an empty set', () => {
    const s = summarizeRfrs([], NOW)
    expect(s.total).toBe(0)
    // A rate over nothing is not 0 percent.
    expect(s.conversionRate).toBeNull()
    expect(s.medianHoursToConvert).toBeNull()
    expect(s.medianHoursToAcknowledge).toBeNull()
    expect(s.medianOpenAgeHours).toBeNull()
    expect(s.longestHoursToConvert).toBeNull()
  })

  it('returns a null median when nothing in a populated set converted', () => {
    const s = summarizeRfrs([req(), req({ id: 'b' })], NOW)
    expect(s.total).toBe(2)
    expect(s.medianHoursToConvert).toBeNull()
    expect(s.convertMeasured).toBe(0)
    // The rate IS measurable here - two requests, none converted - so 0 is the
    // honest answer rather than a null.
    expect(s.conversionRate).toBe(0)
  })

  it('reports acknowledgement as unmeasured when no row records it', () => {
    const s = summarizeRfrs([req(), req({ id: 'b', status: 'acknowledged' })], NOW)
    expect(s.acknowledgeMeasured).toBe(0)
    expect(s.medianHoursToAcknowledge).toBeNull()
  })

  it('counts open, overdue and awaiting acknowledgement over the same rows', () => {
    const rows = [
      req({ id: 'a', priority: 'Critical', reported_at: '2026-08-24T00:00:00.000Z' }),
      req({ id: 'b', status: 'acknowledged' }),
      req({ id: 'c', status: 'converted', converted_at: '2026-08-24T09:00:00.000Z' }),
      req({ id: 'd', status: 'rejected' }),
    ]
    const s = summarizeRfrs(rows, NOW)
    expect(s.total).toBe(4)
    expect(s.open).toBe(2)
    expect(s.awaitingAcknowledgement).toBe(1)
    expect(s.overdue).toBe(1)
    expect(s.converted).toBe(1)
    expect(s.rejected).toBe(1)
    expect(s.conversionRate).toBe(25)
    expect(s.medianHoursToConvert).toBe(1)
  })

  it('states how many requests carry no raised date at all', () => {
    const s = summarizeRfrs([req(), req({ id: 'b', reported_at: null })], NOW)
    expect(s.withoutReportedAt).toBe(1)
  })
})

describe('analytics shapes', () => {
  it('draws a funnel that cannot widen in the middle', () => {
    // A converted request was necessarily acknowledged, even when nobody
    // stamped it, so the acknowledged stage counts converted rows too.
    const rows = [
      req({ id: 'a', status: 'submitted' }),
      req({ id: 'b', status: 'converted' }),
      req({ id: 'c', status: 'converted' }),
    ]
    const f = rfrConversionFunnel(rows)
    const by = Object.fromEntries(f.map((s) => [s.key, s.count]))
    expect(by.submitted).toBe(3)
    expect(by.acknowledged).toBe(2)
    expect(by.converted).toBe(2)
    expect(by.acknowledged).toBeGreaterThanOrEqual(by.converted)
    expect(by.submitted).toBeGreaterThanOrEqual(by.acknowledged)
  })

  it('reports an empty funnel as null percentages rather than zero', () => {
    const f = rfrConversionFunnel([])
    for (const step of f) expect(step.pct).toBeNull()
  })

  it('groups a blank value under Not recorded instead of dropping the row', () => {
    const g = byRfrGroup([req({ site: 'NHC' }), req({ id: 'b', site: '' })], 'site')
    const total = g.reduce((n, x) => n + x.count, 0)
    expect(total).toBe(2)
    expect(g.map((x) => x.label)).toContain('Not recorded')
  })

  it('keeps unconverted requests out of the time-to-convert distribution', () => {
    const rows = [
      req({ id: 'a', converted_at: '2026-08-24T10:00:00.000Z' }),  // 2h
      req({ id: 'b' }),                                             // never converted
    ]
    const { bands, unconverted } = timeToConvertBands(rows)
    expect(unconverted).toBe(1)
    expect(bands.reduce((n, b) => n + b.count, 0)).toBe(1)
    expect(bands.find((b) => b.key === 'lt4').count).toBe(1)
  })

  it('anchors the monthly trend to the newest month in the data, not the clock', () => {
    // A historical feed anchored to the clock renders as a run of empty months,
    // which reads as "the fleet stopped raising requests".
    const rows = [
      req({ id: 'a', reported_at: '2025-03-10T00:00:00.000Z' }),
      req({ id: 'b', reported_at: '2025-04-10T00:00:00.000Z', status: 'converted' }),
    ]
    const t = rfrMonthlyTrend(rows, { months: 3, now: NOW })
    expect(t.anchor).toBe('2025-04')
    expect(t.anchoredToData).toBe(true)
    expect(t.points.map((p) => p.month)).toEqual(['2025-02', '2025-03', '2025-04'])
    expect(t.points.find((p) => p.month === '2025-04').converted).toBe(1)
  })

  it('falls back to the supplied clock only when nothing carries a date', () => {
    const t = rfrMonthlyTrend([req({ reported_at: null, rfr_no: 'x' })], { months: 2, now: NOW })
    expect(t.anchoredToData).toBe(false)
    expect(t.anchor).toBe('2026-08')
  })

  it('rolls a month underflow back across a year boundary', () => {
    const t = rfrMonthlyTrend([req({ reported_at: '2026-01-15T00:00:00.000Z' })], { months: 3, now: NOW })
    expect(t.points.map((p) => p.month)).toEqual(['2025-11', '2025-12', '2026-01'])
  })
})

describe('the historical job-card view', () => {
  const card = {
    id: 7,
    work_order_no: 'GCKR/JC/0948/0826',
    rfr_no: 'GC/RFR/0948/1225',
    asset_no: 'TM514',
    site: 'NHC',
    country: 'KSA',
    status: 'closed',
    priority: 'High',
    work_type: 'Repair',
    opened_at: '2026-08-10T06:00:00.000Z',
    custom_data: {
      raised_by: 'M.SALEH',
      raised_at: '06-01-2026 05:42',
      asset_description: 'TRANSIT MIXER',
    },
  }

  it('reads raised_by and raised_at out of custom_data through the job-card catalog', () => {
    const v = jobCardRfrView(card)
    expect(v.raised_by).toBe('M.SALEH')
    // Kept exactly as the ERP wrote it. NOT re-parsed into a date, so it can
    // never be silently mis-dated.
    expect(v.raised_at).toBe('06-01-2026 05:42')
    expect(v.asset_description).toBe('TRANSIT MIXER')
  })

  it('canonicalises the card status through the shared work-order vocabulary', () => {
    expect(jobCardRfrView(card).status).toBe('Completed')
  })

  it('derives the period from the reference itself', () => {
    const v = jobCardRfrView(card)
    expect(v.rfr_period).toBe('2025-12')
    expect(v.rfr_seq).toBe(948)
    expect(v.rfr_entity).toBe('GC')
  })

  it('reports distinct references beside the total so a double-carded request shows', () => {
    const rows = [jobCardRfrView(card), jobCardRfrView({ ...card, id: 8 })]
    const s = summarizeJobCardRfrs(rows)
    expect(s.total).toBe(2)
    expect(s.distinctRfrNumbers).toBe(1)
    expect(s.duplicateRfrNumbers).toBe(1)
    expect(s.raisedByCoveragePct).toBe(100)
  })

  it('reports coverage as null over an empty set, never as zero percent', () => {
    expect(summarizeJobCardRfrs([]).raisedByCoveragePct).toBeNull()
  })
})

describe('exports', () => {
  it('renders a blank as N/A and an unmeasurable duration as Not measurable', () => {
    const { columns, headers, rows } = rfrExportRows(
      [req({ reported_at: null, plate_no: '', priority: null })],
      NOW,
    )
    expect(columns).toHaveLength(headers.length)
    const r = rows[0]
    expect(r.plate_no).toBe('N/A')
    expect(r.priority).toBe('N/A')
    expect(r.age_hours).toBe('Not measurable')
    expect(r.hours_to_convert).toBe('Not measurable')
    // A zero here would read as an instant response.
    expect(r.age_hours).not.toBe(0)
  })

  it('carries no dash punctuation in any header', () => {
    for (const list of [rfrExportRows([], NOW).headers, jobCardRfrExportRows([]).headers]) {
      for (const h of list) expect(h).not.toMatch(/[‐-―]/)
    }
  })

  it('exports the historical view with its own columns', () => {
    const { columns, headers, rows } = jobCardRfrExportRows([
      jobCardRfrView({ id: 1, rfr_no: 'GC/RFR/0001/1225', work_order_no: 'JC1', custom_data: {} }),
    ])
    expect(columns).toHaveLength(headers.length)
    expect(rows[0].raised_by).toBe('N/A')
    expect(rows[0].rfr_period).toBe('2025-12')
  })
})

describe('findings', () => {
  it('says nothing when there is nothing to say', () => {
    const rows = [req({ status: 'converted', converted_at: '2026-08-24T09:00:00.000Z' })]
    expect(rfrFindings(rows, undefined, NOW)).toEqual([])
  })

  it('names an overdue backlog and an unmeasurable one separately', () => {
    const rows = [
      req({ id: 'a', priority: 'Critical', reported_at: '2026-08-20T00:00:00.000Z' }),
      req({ id: 'b', reported_at: null }),
    ]
    const out = rfrFindings(rows, undefined, NOW)
    const text = out.map((f) => f.text).join(' | ')
    expect(text).toMatch(/past the response target/)
    expect(text).toMatch(/not measurable/)
  })

  it('carries no dash punctuation in user-facing text', () => {
    const rows = [req({ id: 'a', priority: 'Critical', reported_at: '2026-08-20T00:00:00.000Z' })]
    for (const f of rfrFindings(rows, undefined, NOW)) {
      expect(f.text).not.toMatch(/[‐-―]/)
    }
  })
})

// ---------------------------------------------------------------------------
// Render guard
// ---------------------------------------------------------------------------

/**
 * WHY THIS EXISTS. `npm run build` cannot see this page until it is wired into
 * App.jsx, and Vite performs no undefined-variable analysis anyway, so a
 * dangling reference (the classic being a renamed lucide icon) ships past a
 * clean build. That exact defect took a whole page down twice in this codebase.
 * Mounting the real page and clicking every tab is the only thing that proves
 * the module graph loads and each tab renders.
 *
 * The CONTEXTS and the SERVICE are mocked; the real page, the real engine and
 * the real presentation components render.
 */
const stub = {
  queue: { ok: true, reason: null, rows: [], truncated: false },
  cards: { ok: true, reason: null, rows: [], truncated: false },
}

vi.mock('react-chartjs-2', () => ({ Bar: () => null, Line: () => null, Doughnut: () => null }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { role: 'Manager' }, isSuperAdmin: false }),
}))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k, d) => d || k, language: 'en', dir: 'ltr' }),
}))
vi.mock('../lib/exportUtils', () => ({
  exportToExcel: () => {}, exportToPdf: () => {}, reportFileName: (...p) => p.join(' '),
}))
vi.mock('../lib/api/repairRequests', () => ({
  listRepairRequests: () => Promise.resolve(stub.queue),
  listRfrJobCards: () => Promise.resolve(stub.cards),
  countRfrCoverage: () => Promise.resolve({ withRfr: 2, allCards: 4, pct: 50 }),
  createRepairRequest: () => Promise.resolve({}),
  setRepairRequestStatus: () => Promise.resolve({}),
  convertToJobCard: () => Promise.resolve({ ok: true, row: {} }),
  nextRfrNo: () => Promise.resolve('GC/RFR/0949/1225'),
}))

const { default: RepairRequests } = await import('../pages/RepairRequests')

const mount = () => render(el(MemoryRouter, null, el(RepairRequests)))

describe('page renders', () => {
  afterEach(() => {
    cleanup()
    stub.queue = { ok: true, reason: null, rows: [], truncated: false }
    stub.cards = { ok: true, reason: null, rows: [], truncated: false }
  })

  it('mounts and renders every tab without crashing', async () => {
    stub.queue = {
      ok: true,
      reason: null,
      truncated: false,
      rows: [
        req({ id: 'a', rfr_no: 'GC/RFR/0948/1225', priority: 'Critical', reported_at: '2026-08-20T00:00:00.000Z' }),
        req({ id: 'b', rfr_no: 'GC/RFR/0949/1225', status: 'converted', converted_at: '2026-08-24T09:00:00.000Z', work_order_no: 'GCKR/JC/0948/0826' }),
      ],
    }
    stub.cards = {
      ok: true,
      reason: null,
      truncated: false,
      rows: [{
        id: 1, work_order_no: 'GCKR/JC/0948/0826', rfr_no: 'GC/RFR/0948/1225',
        asset_no: 'TM514', site: 'NHC', country: 'KSA', status: 'closed',
        priority: 'High', work_type: 'Repair', opened_at: '2026-08-10T06:00:00.000Z',
        custom_data: { raised_by: 'M.SALEH', raised_at: '06-01-2026 05:42' },
      }],
    }
    mount()

    // Tab 1
    expect(await screen.findByText('Open requests')).toBeTruthy()
    expect(screen.getByText('GC/RFR/0948/1225')).toBeTruthy()

    // Tab 2
    fireEvent.click(screen.getByText('RFR on job cards'))
    expect(await screen.findByText('Job cards with an RFR')).toBeTruthy()
    expect(screen.getByText('M.SALEH')).toBeTruthy()

    // Tab 3
    fireEvent.click(screen.getByText('Analytics'))
    expect(await screen.findByText('Conversion funnel')).toBeTruthy()
  })

  it('states that the register is not provisioned instead of showing an empty list', async () => {
    // An empty list reads as "no requests have been raised", which is a claim
    // about the fleet. "Not set up yet" is a claim about the workspace, and it
    // is the true one.
    stub.queue = { ok: false, reason: 'not_provisioned', rows: [], truncated: false }
    mount()
    expect(await screen.findByText(/not set up in this workspace yet/i)).toBeTruthy()
    expect(screen.queryByText('Open requests')).toBeNull()
  })

  it('reports time to acknowledge as Not recorded, never as zero', async () => {
    stub.queue = { ok: true, reason: null, truncated: false, rows: [req({ id: 'a' })] }
    mount()
    expect(await screen.findByText('Median time to acknowledge')).toBeTruthy()
    expect(screen.getByText('Not recorded')).toBeTruthy()
  })
})
