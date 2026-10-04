import { describe, it, expect } from 'vitest'
import {
  fmtNum, pctOf, fmtPct, maskEmail, daysSince,
  groupStatus, surfaceLabel, peopleLabel, groupTitle, errorFacets, filterErrorGroups, dailySeries,
  alertGroup, alertTab, filterAlerts, alertTabCounts, noiseCheck, ruleSentence,
  moduleTable, recordsPerDay, stickiness, metricCertified,
  eventLabel, fmtDuration,
  batchStatus, batchStatusCounts, batchChangeLine, possibleRepeats, describeSchedule, jobState,
} from '../lib/monitorCenter'

const NOW = new Date('2026-09-30T08:00:00Z') // 11:00 Riyadh

describe('formatting', () => {
  it('keeps unknown as N/A, never 0', () => {
    expect(fmtNum(null)).toBe('N/A')
    expect(fmtNum(undefined)).toBe('N/A')
    expect(fmtNum('x')).toBe('N/A')
    expect(fmtNum(0)).toBe('0')
    expect(fmtNum(12345)).toBe('12,345')
  })
  it('percent is null when the whole is 0 or unknown', () => {
    expect(pctOf(886, 5772)).toBe(15)
    expect(pctOf(1, 0)).toBeNull()
    expect(pctOf(1, null)).toBeNull()
    expect(fmtPct(null)).toBe('N/A')
    expect(fmtPct(15)).toBe('15%')
  })
  it('masks email', () => {
    expect(maskEmail('ws123na@gmail.com')).toBe('w***@gmail.com')
    expect(maskEmail('nope')).toBeNull()
    expect(maskEmail('')).toBeNull()
  })
  it('daysSince is null for missing', () => {
    expect(daysSince(null)).toBeNull()
    expect(daysSince('2026-09-28T08:00:00Z', NOW.getTime())).toBe(2)
  })
})

describe('error center', () => {
  const groups = [
    { key: 'a', severity: 'critical', surfaces: ['android'], sample: 'Fatal crash', events: 5, staff: 0, customers: 0, last_seen: '2026-08-19' },
    { key: 'b', severity: 'error', surfaces: ['web'], sample: 'Cannot read x', events: 14, staff: 1, customers: 0, last_seen: '2026-08-15', urls: ['/tyres'] },
    { key: 'c', severity: 'info', surfaces: ['background'], sample: 'Retention purge', events: 72, staff: 0, customers: 0, last_seen: '2026-09-29' },
    { key: 'd', severity: 'warning', surfaces: ['background'], sample: 'Self healing', events: 3, staff: 0, customers: 2, last_seen: '2026-09-20', state: { status: 'resolved' } },
  ]
  it('derives a triage status: stored wins, info and background warnings are routine', () => {
    expect(groupStatus(groups[0])).toBe('for_review')
    expect(groupStatus(groups[2])).toBe('routine')
    expect(groupStatus(groups[3])).toBe('resolved')
  })
  it('labels surface and people', () => {
    expect(surfaceLabel(groups[0])).toBe('Android app')
    expect(surfaceLabel(groups[1])).toBe('Web app')
    expect(surfaceLabel(groups[2])).toBe('Background job')
    expect(peopleLabel(groups[0])).toEqual({ value: null, note: 'no user id' })
    expect(peopleLabel(groups[1])).toEqual({ value: 1, note: '1 staff' })
    expect(peopleLabel(groups[3]).note).toBe('2 customers')
  })
  it('trims long titles', () => {
    expect(groupTitle({ sample: 'x'.repeat(200) }).length).toBe(140)
    expect(groupTitle({})).toBe('Untitled error')
  })
  it('counts facets by group', () => {
    const f = errorFacets(groups)
    expect(f.status.for_review).toBe(2)
    expect(f.status.routine).toBe(1)
    expect(f.who).toEqual({ customers: 1, staff: 1, none: 2 })
  })
  it('filters and sorts', () => {
    expect(filterErrorGroups(groups, { status: 'for_review' }).map((g) => g.key)).toEqual(['a', 'b'])
    expect(filterErrorGroups(groups, { q: 'tyres' }).map((g) => g.key)).toEqual(['b'])
    expect(filterErrorGroups(groups, { who: 'none' }).map((g) => g.key).sort()).toEqual(['a', 'c'])
    expect(filterErrorGroups(groups, { sort: 'events' })[0].key).toBe('c')
    expect(filterErrorGroups(groups, { sort: 'severity' })[0].key).toBe('a')
  })
  it('zero-fills the daily series', () => {
    const s = dailySeries([{ day: '2026-09-30', total: 4, errors: 1 }], 3, NOW)
    expect(s.labels).toHaveLength(3)
    expect(s.total).toEqual([0, 0, 4])
    expect(s.errors).toEqual([0, 0, 1])
  })
})

describe('alert center', () => {
  const items = [
    { key: '1', severity: 'critical', title: 'Crash', state: 'new' },
    { key: '2', severity: 'medium', title: 'Gap', recovered: true, state: 'acknowledged', owner_id: 'u1' },
    { key: '3', severity: 'low', title: 'Warn', state: 'snoozed' },
    { key: '4', severity: 'info', title: 'Info', state: 'resolved' },
  ]
  it('groups and tabs', () => {
    expect(alertGroup(items[0])).toBe('person')
    expect(alertGroup(items[1])).toBe('fixed')
    expect(alertGroup(items[2])).toBe('routine')
    expect(alertTab(items[1])).toBe('acknowledged')
    expect(alertTab({})).toBe('open')
  })
  it('open tab includes acknowledged; counts match', () => {
    expect(filterAlerts(items, { tab: 'open' }).map((a) => a.key)).toEqual(['1', '2'])
    expect(filterAlerts(items, { tab: 'open', owner: 'none' }).map((a) => a.key)).toEqual(['1'])
    expect(alertTabCounts(items)).toEqual({ open: 2, acknowledged: 1, snoozed: 1, resolved: 1 })
  })
  it('noise check and rule sentence', () => {
    expect(noiseCheck({ unresolved: 229, routine: 177 })).toEqual({ routine: 177, total: 229, pct: 77 })
    expect(noiseCheck({ unresolved: 0, routine: 0 })).toBeNull()
    const s = ruleSentence({ metric: 'failure rate', operator: 'gt', threshold: 5, notify_in_app: true, pending_checks: 3, renotify_minutes: 120, renotify_max: 2 })
    expect(s).toContain('If failure rate is above 5')
    expect(s).toContain('for 3 checks in a row')
    expect(s).toContain('remind every 2 h, at most 2 times')
    expect(s).not.toMatch(/[–—]/)
  })
})

describe('analytics', () => {
  it('builds the module table with change and share', () => {
    const daily = [
      { module: 'job_cards', day: '2026-09-30', n: 10 },
      { module: 'job_cards', day: '2026-09-20', n: 5 },
      { module: 'inspections', day: '2026-09-29', n: 5 },
    ]
    const { rows, totals } = moduleTable(daily, NOW)
    const jc = rows.find((r) => r.module === 'job_cards')
    expect(jc.today).toBe(10)
    expect(jc.last7).toBe(10)
    expect(jc.prev7).toBe(5)
    expect(jc.change).toBe(100)
    expect(rows.find((r) => r.module === 'inspections').change).toBe('new')
    expect(rows.find((r) => r.module === 'accidents').change).toBeNull()
    expect(totals.d30).toBe(20)
  })
  it('records per day finds the peak', () => {
    const r = recordsPerDay([{ day: '2026-09-29', n: 3 }, { day: '2026-09-29', n: 4 }], 3, NOW)
    expect(r.values).toEqual([0, 7, 0])
    expect(r.peak.value).toBe(7)
  })
  it('stickiness and certification', () => {
    expect(stickiness(77, 102)).toBe(75)
    expect(stickiness(1, 0)).toBeNull()
    expect(metricCertified({ status: 'draft', business_owner: 'x' })).toBe(false)
    expect(metricCertified({ business_owner: 'a', refresh_sla: 'daily', calc_ref: 'x', dashboards: ['d'] })).toBe(true)
  })
})

describe('notifications', () => {
  it('labels events and formats durations', () => {
    expect(eventLabel('inspection.approval_requested')).toBe('Inspection waiting for approval')
    expect(eventLabel('custom.thing')).toBe('custom thing')
    expect(fmtDuration(null)).toBe('N/A')
    expect(fmtDuration(45)).toBe('45 s')
    expect(fmtDuration(120)).toBe('2.0 min')
  })
})

describe('operations', () => {
  const b = [
    { id: '1', module: 'sco', country: 'KSA', import_status: 'committed', imported_rows: 672, created_at: '2026-08-08T09:00:00Z' },
    { id: '2', module: 'sco', country: 'KSA', import_status: 'committed', imported_rows: 672, created_at: '2026-08-09T09:24:00Z' },
    { id: '3', module: 'production', country: 'Egypt', import_status: 'failed', imported_rows: 0, created_at: '2026-08-15' },
    { id: '4', module: 'fleet', country: 'KSA', import_status: 'staged', imported_rows: 0, created_at: '2026-08-01' },
    { id: '5', module: 'fleet', country: 'UAE', import_status: 'weird', imported_rows: 0, created_at: '2026-08-01' },
  ]
  it('status and counts', () => {
    expect(batchStatus(b[4])).toBe('other')
    expect(batchStatusCounts(b)).toMatchObject({ all: 5, committed: 2, failed: 1, staged: 1, other: 1 })
  })
  it('change lines are plain English', () => {
    expect(batchChangeLine(b[0])).toBe('Added 672 sco rows.')
    expect(batchChangeLine(b[2])).toMatch(/nothing was saved/)
    expect(batchChangeLine(b[3])).toMatch(/never approved/)
  })
  it('flags the later of two same-size uploads as a possible repeat', () => {
    expect([...possibleRepeats(b)]).toEqual(['2'])
  })
  it('describes cron in Riyadh time', () => {
    expect(describeSchedule('* * * * *')).toBe('Every minute')
    expect(describeSchedule('*/15 * * * *')).toBe('Every 15 min')
    expect(describeSchedule('30 2 * * *')).toBe('Daily 05:30')
    expect(describeSchedule('0 5 * * 0')).toBe('Sunday 08:00')
    expect(describeSchedule('weird')).toBe('weird')
  })
  it('job state', () => {
    expect(jobState({ active: false }).label).toBe('Paused')
    expect(jobState({ active: true, stuck: true }).tone).toBe('danger')
    expect(jobState({ active: true, failed_nd: 2, fail_streak: 1 }).label).toBe('2 failed')
    expect(jobState({ active: true, missed_nd: 1, period_min: 1440 }).label).toBe('1 day missed')
    expect(jobState({ active: true }).label).toBe('OK')
  })
})
