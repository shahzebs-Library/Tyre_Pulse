/**
 * The breakdown register's arithmetic.
 *
 * The rules pinned here are the ones that decide whether the register can be
 * trusted to say a machine is down: a breakdown closes only when somebody
 * records the return, a missed promise is louder than a distant one, and an
 * unmeasurable average reads as N/A rather than zero.
 */
import { describe, it, expect } from 'vitest'
import {
  downDays, daysToReturn, isOverdue, severityOf, filterBreakdowns,
  breakdownSummary, severityBands, byGroup, repeatOffenders,
  breakdownFindings, breakdownExportRows, repairLabel,
  breakdownsByAsset, mergeBreakdowns, downtimeNote, disposalCandidatesFromBreakdowns,
  EMPTY_BREAKDOWN_FILTERS,
} from '../lib/assetBreakdowns'

const NOW = Date.UTC(2026, 7, 13) // 2026-08-13

const row = (o = {}) => ({
  id: o.id || Math.random().toString(36).slice(2),
  asset_no: 'TM422', site: 'DIRIYAH-G2', details: 'Engine noise',
  reported_on: '2026-08-01', breakdown_days: 12, expected_return: '2026-08-21',
  returned_to_service: false, returned_on: null, repair_location: 'Out', remark: '',
  ...o,
})

describe('downDays', () => {
  it('measures an open breakdown to today, not to the figure the sheet froze', () => {
    // the sheet said 12 days when it was taken; it is now the 13th
    expect(downDays(row({ reported_on: '2026-08-01', breakdown_days: 12 }), NOW)).toBe(12)
    expect(downDays(row({ reported_on: '2026-07-01', breakdown_days: 12 }), NOW)).toBe(43)
  })

  it('measures a closed breakdown between its own two dates', () => {
    expect(downDays(row({
      reported_on: '2026-08-01', returned_to_service: true, returned_on: '2026-08-05',
    }), NOW)).toBe(4)
  })

  it('falls back to the recorded day count when there is no start date', () => {
    expect(downDays(row({ reported_on: null, breakdown_days: 9 }), NOW)).toBe(9)
    expect(downDays(row({ reported_on: null, breakdown_days: null }), NOW)).toBeNull()
  })

  it('tolerates a missing row', () => {
    expect(downDays(null, NOW)).toBeNull()
  })
})

describe('the promised return date', () => {
  it('counts down, and goes negative once the promise is missed', () => {
    expect(daysToReturn(row({ expected_return: '2026-08-21' }), NOW)).toBe(8)
    expect(daysToReturn(row({ expected_return: '2026-08-01' }), NOW)).toBe(-12)
    expect(daysToReturn(row({ expected_return: null }), NOW)).toBeNull()
  })

  it('a date that slipped is overdue - never quietly treated as returned', () => {
    expect(isOverdue(row({ expected_return: '2026-08-01' }), NOW)).toBe(true)
    expect(isOverdue(row({ expected_return: '2026-08-21' }), NOW)).toBe(false)
  })

  it('a machine already back is not overdue however late it was', () => {
    expect(isOverdue(row({
      expected_return: '2026-01-01', returned_to_service: true, returned_on: '2026-08-01',
    }), NOW)).toBe(false)
  })
})

describe('severity', () => {
  it('bands by how long the machine has actually been down', () => {
    expect(severityOf(row({ reported_on: '2026-08-13' }), NOW)).toBe('low')
    expect(severityOf(row({ reported_on: '2026-08-10' }), NOW)).toBe('medium')
    expect(severityOf(row({ reported_on: '2026-08-01' }), NOW)).toBe('high')
    expect(severityOf(row({ reported_on: '2026-06-01' }), NOW)).toBe('critical')
  })

  it('a machine back in service has no severity at all', () => {
    expect(severityOf(row({ returned_to_service: true, returned_on: '2026-08-05' }), NOW)).toBeNull()
  })
})

describe('filterBreakdowns', () => {
  const rows = [
    row({ id: 'a', asset_no: 'TM422', site: 'A', expected_return: '2026-08-01' }),        // overdue
    row({ id: 'b', asset_no: 'MP080', site: 'B', expected_return: '2026-08-30' }),        // open
    row({ id: 'c', asset_no: 'WL043', site: 'A', returned_to_service: true, returned_on: '2026-08-05' }),
  ]

  it('defaults to what is down NOW, not the whole history', () => {
    expect(filterBreakdowns(rows, EMPTY_BREAKDOWN_FILTERS, NOW).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('can show only the missed promises, only the returned, or everything', () => {
    expect(filterBreakdowns(rows, { state: 'overdue' }, NOW).map((r) => r.id)).toEqual(['a'])
    expect(filterBreakdowns(rows, { state: 'returned' }, NOW).map((r) => r.id)).toEqual(['c'])
    expect(filterBreakdowns(rows, { state: 'all' }, NOW)).toHaveLength(3)
  })

  it('filters by site and searches the fault text, not only the asset code', () => {
    expect(filterBreakdowns(rows, { site: 'A' }, NOW).map((r) => r.id)).toEqual(['a'])
    expect(filterBreakdowns(rows, { search: 'engine' }, NOW)).toHaveLength(2)
    expect(filterBreakdowns(rows, { search: 'mp080' }, NOW).map((r) => r.id)).toEqual(['b'])
  })

  it('tolerates junk', () => {
    expect(filterBreakdowns(null, null, NOW)).toEqual([])
    expect(filterBreakdowns([null], {}, NOW)).toEqual([])
  })
})

describe('breakdownSummary', () => {
  it('counts what is down and states an average only when it is measurable', () => {
    const s = breakdownSummary([
      row({ reported_on: '2026-08-11' }),
      row({ reported_on: '2026-08-03', asset_no: 'MP080' }),
    ], NOW)
    expect(s.open).toBe(2)
    expect(s.assets).toBe(2)
    expect(s.avgDownDays).toBe(6) // (2 + 10) / 2
    expect(s.worst).toBe(10)
  })

  it('reports N/A rather than zero when nothing is down', () => {
    // "no machines are down" and "machines are down for no time" are opposite
    // claims; a zero here would read as the second
    const s = breakdownSummary([row({ returned_to_service: true, returned_on: '2026-08-02' })], NOW)
    expect(s.open).toBe(0)
    expect(s.avgDownDays).toBeNull()
    expect(s.worst).toBeNull()
    expect(s.returned).toBe(1)
  })

  it('separates a supply hold-up from a workshop one', () => {
    const s = breakdownSummary([
      row({ remark: 'Waiting Spare Parts (China)' }),
      row({ remark: '', repair_location: 'Out' }),
    ], NOW)
    expect(s.waitingParts).toBe(1)
    expect(s.outsideWorkshop).toBe(2)
  })
})

describe('grouping and repeats', () => {
  it('groups open breakdowns and names a blank site honestly', () => {
    const g = byGroup([row({ site: 'A' }), row({ site: '' }), row({ site: 'A' })], 'site', NOW)
    expect(g[0]).toMatchObject({ key: 'A', count: 2 })
    expect(g.map((x) => x.key)).toContain('Not recorded')
  })

  it('a repeat needs more than one breakdown, and counts closed ones too', () => {
    const r = repeatOffenders([
      row({ asset_no: 'TM1' }),
      row({ asset_no: 'TM1', returned_to_service: true, returned_on: '2026-08-02' }),
      row({ asset_no: 'TM2' }),
    ], NOW)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ asset_no: 'TM1', breakdowns: 2, open: 1 })
  })
})

describe('breakdownFindings', () => {
  it('says nothing when nothing is down', () => {
    expect(breakdownFindings([], null, NOW)).toEqual([])
    expect(breakdownFindings([row({ returned_to_service: true, returned_on: '2026-08-01' })], null, NOW)).toEqual([])
  })

  it('leads with the missed promises and the machines stuck over a month', () => {
    const out = breakdownFindings([
      row({ asset_no: 'IP065', reported_on: '2026-01-01', expected_return: '2026-08-01' }),
    ], null, NOW)
    expect(out.some((f) => /past the date/i.test(f.text))).toBe(true)
    expect(out.some((f) => /over 30 days/i.test(f.text) && f.text.includes('IP065'))).toBe(true)
  })
})

describe('export + labels', () => {
  it('exports the same figures the table shows, with honest blanks', () => {
    const { columns, headers, rows: out } = breakdownExportRows([
      row({ site: '', expected_return: null, reported_on: '2026-08-01' }),
    ], NOW)
    expect(columns).toHaveLength(headers.length)
    expect(out[0].down_days).toBe(12)
    expect(out[0].site).toBe('Not recorded')
    expect(out[0].expected_return).toBe('N/A')
    expect(out[0].days_to_return).toBe('N/A')
    expect(out[0].state).toBe('Under repair')
  })

  it('marks a missed promise distinctly from a live repair', () => {
    const { rows: out } = breakdownExportRows([row({ expected_return: '2026-08-01' })], NOW)
    expect(out[0].state).toBe('Overdue')
  })

  it('turns the sheet In/Out token into words, and admits when it is absent', () => {
    expect(repairLabel('In')).toBe('In-house workshop')
    expect(repairLabel('out')).toBe('Outside workshop')
    expect(repairLabel('')).toBe('Not recorded')
    expect(repairLabel(null)).toBe('Not recorded')
  })
})

describe('severityBands', () => {
  it('counts only open breakdowns per band', () => {
    const b = severityBands([
      row({ reported_on: '2026-06-01' }),
      row({ reported_on: '2026-08-13' }),
      row({ reported_on: '2026-01-01', returned_to_service: true, returned_on: '2026-02-01' }),
    ], NOW)
    expect(b.find((x) => x.key === 'critical').count).toBe(1)
    expect(b.find((x) => x.key === 'low').count).toBe(1)
    expect(b.reduce((a, x) => a + x.count, 0)).toBe(2)
  })
})

/**
 * Downtime reaching the disposal committee.
 *
 * The committee decides whether a machine is worth keeping, and how long it has
 * been standing still is one of the strongest arguments either way - but only
 * if a machine we know nothing about is never presented as a machine that has
 * never stopped.
 */
describe('breakdownsByAsset', () => {
  it('rolls a machine up and lets the LONGEST open breakdown speak for it', () => {
    const idx = breakdownsByAsset([
      row({ asset_no: 'TM422', reported_on: '2026-08-10', details: 'Recent fault' }),
      row({ asset_no: 'TM422', reported_on: '2026-05-01', details: 'The long one' }),
      row({ asset_no: 'MP080', reported_on: '2026-07-01', returned_to_service: true, returned_on: '2026-07-11' }),
    ], NOW)
    const tm = idx.get('TM422')
    expect(tm.breakdowns).toBe(2)
    expect(tm.open).toBe(2)
    expect(tm.currentDays).toBe(104)          // 1 May to 13 Aug, not the recent one
    expect(tm.fault).toBe('The long one')
    // A machine that came back is still on record, but nothing is open on it.
    expect(idx.get('MP080').open).toBe(0)
    expect(idx.get('MP080').breakdowns).toBe(1)
  })

  it('matches the asset code the way every other register does', () => {
    const idx = breakdownsByAsset([row({ asset_no: ' tm422 ' })], NOW)
    expect(idx.has('TM422')).toBe(true)
  })
})

describe('mergeBreakdowns', () => {
  it('never turns "we were never told" into "it has never broken down"', () => {
    const out = mergeBreakdowns(
      [{ asset_no: 'TM422' }, { asset_no: 'BP014' }],
      [row({ asset_no: 'TM422', reported_on: '2026-08-01' })],
      NOW,
    )
    expect(out[0].breakdown.currentDays).toBe(12)
    expect(out[0].down).toBe(12)
    // The machine with no record is null, NOT zero days down - zero would sort
    // it as the healthiest machine in the fleet on a page about scrapping.
    expect(out[1].breakdown).toBeNull()
    expect(out[1].down).toBeNull()
  })

  it('leaves the rows untouched when nothing is on record at all', () => {
    const rows = [{ asset_no: 'TM422' }]
    expect(mergeBreakdowns(rows, [], NOW)).toBe(rows)
  })
})

describe('downtimeNote', () => {
  it('says how long, and says when a promise has already slipped', () => {
    expect(downtimeNote({ open: 1, currentDays: 1, overdue: false })).toBe('Down 1 day')
    expect(downtimeNote({ open: 1, currentDays: 218, overdue: true }))
      .toBe('Down 218 days, past its promised return')
  })

  it('is silent rather than inventing a sentence about a machine with no record', () => {
    expect(downtimeNote(null)).toBe('')
    expect(downtimeNote({ open: 0, breakdowns: 0 })).toBe('')
    expect(downtimeNote({ open: 0, breakdowns: 2 })).toBe('Back in service, 2 breakdowns on record')
  })
})

describe('disposalCandidatesFromBreakdowns', () => {
  const long = row({ asset_no: 'IP065', reported_on: '2026-01-07', details: 'Evaporator coil' })
  const short = row({ asset_no: 'TM666', reported_on: '2026-08-04' })
  const closed = row({ asset_no: 'MP080', reported_on: '2026-01-01', returned_to_service: true, returned_on: '2026-02-01' })

  it('proposes only machines that are down long AND not already on the list', () => {
    const out = disposalCandidatesFromBreakdowns([long, short, closed], [], { now: NOW })
    expect(out.map((c) => c.asset_no)).toEqual(['IP065'])
    expect(out[0].currentDays).toBe(218)
  })

  it('never proposes a machine the committee already has', () => {
    const out = disposalCandidatesFromBreakdowns([long], [{ asset_no: 'ip065' }], { now: NOW })
    expect(out).toEqual([])
  })

  it('is empty rather than noisy when nothing qualifies', () => {
    expect(disposalCandidatesFromBreakdowns([short, closed], [], { now: NOW })).toEqual([])
    expect(disposalCandidatesFromBreakdowns([], [], { now: NOW })).toEqual([])
  })
})
