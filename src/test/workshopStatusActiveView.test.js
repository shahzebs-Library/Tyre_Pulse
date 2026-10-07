import { describe, it, expect } from 'vitest'
import {
  daysDown, freshness, filterRecords, sortRecords, summarize, emptyFilters, activeFilterCount,
  vocabOptions, responsibleOptions, lastUpdate, fmtDay, fmtDateTime, localDay, UNASSIGNED, FRESHNESS,
} from '../lib/workshopStatus/activeView'

// 07 Oct 2026, 10:00 local time.
const NOW = new Date(2026, 9, 7, 10, 0, 0)
const todayIso = new Date(2026, 9, 7, 8, 30).toISOString()
const yesterdayIso = new Date(2026, 9, 6, 15, 0).toISOString()

const R = [
  { id: 'a', asset_no: 'TM100', reg_no: '1234 ABC', site: 'NHC', complaint: 'Brake noise', ooc_since: '2026-10-01', current_stage: 'Waiting for Parts', delay_reason: 'MR Pending', parts_status: 'MR Raised', responsible_user_id: 'u1', responsible_name: 'Ahmed Khan', last_manual_update_at: todayIso, expected_release_date: '2026-10-07', country: 'KSA' },
  { id: 'b', asset_no: 'TM200', site: 'Diriyah', complaint: 'Engine', ooc_since: '2026-09-20', current_stage: 'Repair in Progress', last_manual_update_at: yesterdayIso, country: 'KSA' },
  { id: 'c', asset_no: 'TM300', site: 'NHC', complaint: 'Hydraulic leak', excel_down_days: 4, country: 'UAE' },
  { id: 'd', asset_no: 'TM400', site: 'NHC', complaint: 'Unknown', country: 'KSA' },
]

describe('daysDown', () => {
  it('counts whole calendar days from ooc_since', () => {
    expect(daysDown(R[0], NOW)).toBe(6)
    expect(daysDown(R[1], NOW)).toBe(17)
  })
  it('is 0 for a vehicle down since today, a real measurement', () => {
    expect(daysDown({ ooc_since: '2026-10-07' }, NOW)).toBe(0)
  })
  it('falls back to the Excel down days when there is no date', () => {
    expect(daysDown(R[2], NOW)).toBe(4)
  })
  it('is null (never 0) when unknown or future', () => {
    expect(daysDown(R[3], NOW)).toBeNull()
    expect(daysDown({ ooc_since: '2026-10-09' }, NOW)).toBeNull()
    expect(daysDown({ excel_down_days: '' }, NOW)).toBeNull()
    expect(daysDown({ excel_down_days: 'abc' }, NOW)).toBeNull()
  })
})

describe('freshness', () => {
  it('reads a manual update today as today', () => expect(freshness(R[0], NOW)).toBe(FRESHNESS.TODAY))
  it('reads an older manual update as stale', () => expect(freshness(R[1], NOW)).toBe(FRESHNESS.STALE))
  it('ignores Excel refreshes: never updated by a person', () => {
    expect(freshness({ excel_updated_at: todayIso }, NOW)).toBe(FRESHNESS.NEVER)
  })
})

describe('filterRecords', () => {
  const ids = (rows) => rows.map((r) => r.id)
  it('returns everything for empty filters', () => {
    expect(ids(filterRecords(R, emptyFilters(), { now: NOW }))).toEqual(['a', 'b', 'c', 'd'])
  })
  it('searches asset, reg no, complaint and site', () => {
    expect(ids(filterRecords(R, { search: 'tm 200' }, { now: NOW }))).toEqual(['b'])
    expect(ids(filterRecords(R, { search: '1234abc' }, { now: NOW }))).toEqual(['a'])
    expect(ids(filterRecords(R, { search: 'hydraulic' }, { now: NOW }))).toEqual(['c'])
    expect(ids(filterRecords(R, { search: 'diriyah' }, { now: NOW }))).toEqual(['b'])
  })
  it('filters site, stage, delay reason, parts status, country', () => {
    expect(ids(filterRecords(R, { site: 'nhc' }, { now: NOW }))).toEqual(['a', 'c', 'd'])
    expect(ids(filterRecords(R, { stage: 'Repair in Progress' }, { now: NOW }))).toEqual(['b'])
    expect(ids(filterRecords(R, { delayReason: 'MR Pending' }, { now: NOW }))).toEqual(['a'])
    expect(ids(filterRecords(R, { partsStatus: 'MR Raised' }, { now: NOW }))).toEqual(['a'])
    expect(ids(filterRecords(R, { country: 'UAE' }, { now: NOW }))).toEqual(['c'])
  })
  it('filters responsible person and unassigned', () => {
    expect(ids(filterRecords(R, { responsible: 'u1' }, { now: NOW }))).toEqual(['a'])
    expect(ids(filterRecords(R, { responsible: UNASSIGNED }, { now: NOW }))).toEqual(['b', 'c', 'd'])
  })
  it('days-down thresholds exclude unmeasured vehicles', () => {
    expect(ids(filterRecords(R, { minDays: 3 }, { now: NOW }))).toEqual(['a', 'b', 'c'])
    expect(ids(filterRecords(R, { minDays: 7 }, { now: NOW }))).toEqual(['b'])
    expect(ids(filterRecords(R, { minDays: 14 }, { now: NOW }))).toEqual(['b'])
  })
  it('updated today / not updated today / expected release today', () => {
    expect(ids(filterRecords(R, { updated: 'today' }, { now: NOW }))).toEqual(['a'])
    expect(ids(filterRecords(R, { updated: 'not_today' }, { now: NOW }))).toEqual(['b', 'c', 'd'])
    expect(ids(filterRecords(R, { expectedToday: true }, { now: NOW }))).toEqual(['a'])
  })
  it('counts active filters', () => {
    expect(activeFilterCount(emptyFilters())).toBe(0)
    expect(activeFilterCount({ ...emptyFilters(), site: 'NHC', minDays: 7, expectedToday: true, search: 'x' })).toBe(3)
  })
})

describe('sortRecords', () => {
  it('sorts by days down desc with unknown last', () => {
    expect(sortRecords(R, { key: 'days', dir: 'desc' }, { now: NOW }).map((r) => r.id)).toEqual(['b', 'a', 'c', 'd'])
  })
  it('keeps unknown last in ascending order too', () => {
    expect(sortRecords(R, { key: 'days', dir: 'asc' }, { now: NOW }).map((r) => r.id)).toEqual(['c', 'a', 'b', 'd'])
  })
  it('sorts by asset and does not mutate the input', () => {
    const copy = [...R].reverse()
    const out = sortRecords(copy, { key: 'asset', dir: 'asc' }, { now: NOW })
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(copy[0].id).toBe('d')
  })
})

describe('summarize', () => {
  it('counts the KPI tiles', () => {
    expect(summarize(R, { now: NOW })).toEqual({
      total: 4, updatedToday: 1, notUpdatedToday: 3, neverUpdated: 2,
      over3: 3, over7: 1, over14: 1, unknownDays: 1, expectedToday: 1, unassigned: 3,
    })
  })
  it('handles empty input', () => {
    expect(summarize([], { now: NOW }).total).toBe(0)
  })
})

describe('options and formatting', () => {
  it('vocabulary options keep order and append unknown stored values', () => {
    expect(vocabOptions(['A', 'B'], [{ s: 'b' }, { s: 'Legacy' }], 's')).toEqual(['A', 'B', 'Legacy'])
  })
  it('responsible options list each person once', () => {
    expect(responsibleOptions(R)).toEqual([{ id: 'u1', name: 'Ahmed Khan' }])
  })
  it('last update reads the system-captured name', () => {
    expect(lastUpdate({ last_manual_update_at: todayIso, last_updated_by_name: ' Ahmed ', last_update_source: 'manual' }))
      .toEqual({ at: todayIso, by: 'Ahmed', source: 'manual' })
    expect(lastUpdate({}).by).toBeNull()
  })
  it('formats dates without dashes in the wrong places', () => {
    expect(fmtDay('2026-10-07')).toBe('07 Oct 2026')
    expect(fmtDateTime(new Date(2026, 9, 7, 9, 42).toISOString())).toBe('07 Oct 2026, 09:42')
    expect(fmtDay(null)).toBeNull()
    expect(localDay(NOW)).toBe('2026-10-07')
  })
})
