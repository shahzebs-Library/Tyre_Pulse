import { describe, expect, it } from 'vitest'
import {
  resolveSettingsTab, scheduleLabel, scheduleNextRun, scheduleRows, summarizeSchedules,
  filterSchedules, kpiTargetCoverage, thresholdRows, settingsOverview, parseRecipients,
} from '../lib/settingsAnalytics'

// 2026-09-26 is a Saturday. 05:00 UTC = 08:00 Riyadh.
const NOW = new Date('2026-09-26T05:00:00Z')
const base = { reportName: 'Fleet Summary', time: '06:00', dayOfWeek: 'Monday', dayOfMonth: 1, active: true }

describe('tabs', () => {
  it('falls back to the first tab for unknown values', () => {
    expect(resolveSettingsTab('security')).toBe('security')
    expect(resolveSettingsTab('nope')).toBe('general')
    expect(resolveSettingsTab(null)).toBe('general')
  })
})

describe('schedule cadence', () => {
  it('labels each frequency with ASCII only', () => {
    expect(scheduleLabel({ ...base, frequency: 'Daily' })).toBe('Daily at 06:00')
    expect(scheduleLabel({ ...base, frequency: 'Weekly' })).toBe('Weekly on Monday at 06:00')
    expect(scheduleLabel({ ...base, frequency: 'Monthly', dayOfMonth: 5 })).toBe('Monthly on day 5 at 06:00')
    expect(scheduleLabel(null)).toBe('N/A')
  })
  it('computes the next daily run in Riyadh time', () => {
    // 06:00 Riyadh already passed today (08:00 now) -> tomorrow 03:00 UTC.
    expect(scheduleNextRun({ ...base, frequency: 'Daily' }, NOW).toISOString()).toBe('2026-09-27T03:00:00.000Z')
    expect(scheduleNextRun({ ...base, frequency: 'Daily', time: '09:00' }, NOW).toISOString()).toBe('2026-09-26T06:00:00.000Z')
  })
  it('computes the next weekly and monthly run', () => {
    expect(scheduleNextRun({ ...base, frequency: 'Weekly' }, NOW).toISOString()).toBe('2026-09-28T03:00:00.000Z')
    expect(scheduleNextRun({ ...base, frequency: 'Weekly', dayOfWeek: 'Saturday' }, NOW).toISOString()).toBe('2026-10-03T03:00:00.000Z')
    expect(scheduleNextRun({ ...base, frequency: 'Monthly', dayOfMonth: 1 }, NOW).toISOString()).toBe('2026-10-01T03:00:00.000Z')
  })
  it('returns null for paused or unparseable schedules', () => {
    expect(scheduleNextRun({ ...base, frequency: 'Daily', active: false }, NOW)).toBeNull()
    expect(scheduleNextRun({ ...base, frequency: 'Daily', time: 'soon' }, NOW)).toBeNull()
  })
})

describe('schedule register', () => {
  const schedules = [
    { ...base, id: 1, frequency: 'Daily', recipients: 'a@x.com, b@x.com' },
    { ...base, id: 2, frequency: 'Weekly', recipients: 'A@x.com, not-an-email', reportName: 'KPI Report' },
    { ...base, id: 3, frequency: 'Monthly', recipients: '', active: false },
  ]
  const rows = scheduleRows(schedules, NOW)

  it('adds label, next run, recipient checks and status', () => {
    expect(rows[1].invalidRecipients).toEqual(['not-an-email'])
    expect(rows[2].status).toBe('Paused')
    expect(rows[2].nextRun).toBeNull()
    expect(parseRecipients(' a , ,b ')).toEqual(['a', 'b'])
  })
  it('summarises active/paused, distinct recipients and the soonest run', () => {
    const s = summarizeSchedules(rows)
    expect(s).toMatchObject({ total: 3, active: 2, paused: 1, recipients: 3, withInvalidRecipients: 1, withNoRecipients: 1 })
    expect(s.nextRun).toBe('2026-09-27T03:00:00.000Z')
    expect(s.byFrequency).toEqual({ Daily: 1, Weekly: 1, Monthly: 1 })
  })
  it('filters by status, frequency and text', () => {
    expect(filterSchedules(rows, { status: 'paused' }).map((r) => r.id)).toEqual([3])
    expect(filterSchedules(rows, { frequency: 'Weekly' }).map((r) => r.id)).toEqual([2])
    expect(filterSchedules(rows, { q: 'kpi' }).map((r) => r.id)).toEqual([2])
  })
})

describe('coverage and thresholds', () => {
  const fields = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]
  it('counts only real numeric targets; null input stays null', () => {
    expect(kpiTargetCoverage({ a: '12', b: '' }, fields)).toEqual({ set: 1, total: 2 })
    expect(kpiTargetCoverage(null, fields)).toEqual({ set: null, total: 2 })
  })
  it('renders thresholds with units and N/A for missing values', () => {
    const rows = thresholdRows({ highRiskPct: 25, critCostThresh: 50000, lowTreadMm: null }, { a: 3 }, fields)
    expect(rows.map((r) => r.value)).toEqual(['25%', '50,000', 'N/A', '3', 'N/A'])
    expect(rows.filter((r) => r.group === 'Extended')).toHaveLength(2)
  })
})

describe('settingsOverview', () => {
  it('never turns an unread input into zero', () => {
    const o = settingsOverview({ kpiFields: [{ key: 'a' }] })
    expect(o).toMatchObject({ schedulesActive: null, kpiTargetsSet: null, channelsOn: null, mfaEnabled: null, lastUpload: null, uploadsKnown: false })
  })
  it('summarises loaded inputs', () => {
    const o = settingsOverview({
      schedules: scheduleRows([{ ...base, id: 1, frequency: 'Daily', recipients: 'a@x.com' }], NOW),
      kpiTargets: { a: 1 }, kpiFields: [{ key: 'a' }], channelCount: 2, mfaEnabled: false,
      uploads: [{ uploaded_at: '2026-09-01T00:00:00Z' }, { uploaded_at: '2026-09-20T00:00:00Z' }],
    })
    expect(o).toMatchObject({ schedulesActive: 1, schedulesTotal: 1, kpiTargetsSet: 1, channelsOn: 2, mfaEnabled: false, lastUpload: '2026-09-20T00:00:00Z' })
  })
  it('reports no upload as null with uploadsKnown true', () => {
    expect(settingsOverview({ uploads: [] })).toMatchObject({ lastUpload: null, uploadsKnown: true })
  })
})
