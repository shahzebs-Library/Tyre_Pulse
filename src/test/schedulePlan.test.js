import { describe, it, expect } from 'vitest'
import {
  PLAN_STATES, PLAN_STATE_META, planState, planTone,
  summarizeAdherence, adherenceBy,
  PLAN_COLUMNS, normalizePlanRow, parsePlanDate, parsePlanTime,
  resolvePerson, buildPlanRef, parsePlanRows, planTemplateRows,
  DEFAULT_GRACE_DAYS, DEFAULT_PLAN_TIME,
} from '../lib/schedulePlan'

/**
 * THE MIRROR CASE TABLE.
 *
 * Every case here is also executed against SQL `inspection_plan_state()` (see
 * the migration's verification block). If the two stop agreeing, a plan reads
 * one way on the board and another in an export, so this table is the contract.
 */
const MIRROR_CASES = [
  // [scheduled_date, grace_days, status, matched_status, today, expected]
  ['2026-09-10', 2, 'Scheduled', 'Done', '2026-09-21', 'Done'],
  ['2026-09-10', 2, 'Scheduled', 'In Progress', '2026-09-21', 'Started'],
  ['2026-09-10', 2, 'Scheduled', null, '2026-09-21', 'Missed'],
  ['2026-09-21', 2, 'Scheduled', null, '2026-09-21', 'Due'],
  // Grace extends the window AFTER the planned date, never before it, so a
  // plan dated in the future stays Upcoming however wide its grace.
  ['2026-09-23', 2, 'Scheduled', null, '2026-09-21', 'Upcoming'],
  ['2026-09-23', 10, 'Scheduled', null, '2026-09-21', 'Upcoming'],
  ['2026-09-10', 2, 'Cancelled', null, '2026-09-21', 'Cancelled'],
  ['2026-09-10', 2, 'Cancelled', 'Done', '2026-09-21', 'Cancelled'],
  // grace is what separates "late but acceptable" from missed
  ['2026-09-19', 2, 'Scheduled', null, '2026-09-21', 'Due'],
  ['2026-09-18', 2, 'Scheduled', null, '2026-09-21', 'Missed'],
  ['2026-09-18', 5, 'Scheduled', null, '2026-09-21', 'Due'],
  ['2026-09-20', 0, 'Scheduled', null, '2026-09-21', 'Missed'],
]

describe('planState - the SQL mirror', () => {
  it.each(MIRROR_CASES)(
    'plan %s grace=%s status=%s matched=%s on %s reads %s',
    (scheduled_date, grace_days, status, matched_status, today, expected) => {
      expect(planState({ scheduled_date, grace_days, status, matched_status }, today)).toBe(expected)
    },
  )

  it('treats a null grace as the default rather than a zero-day window', () => {
    // Number(null) is 0 and 0 is finite, so a naive read makes this Missed.
    expect(planState({ scheduled_date: '2026-09-20', grace_days: null, status: 'Scheduled', matched_status: null }, '2026-09-21')).toBe('Due')
    expect(planState({ scheduled_date: '2026-09-20', grace_days: undefined, status: 'Scheduled', matched_status: null }, '2026-09-21')).toBe('Due')
  })

  it('lets a finished inspection outrank one still in progress', () => {
    const base = { scheduled_date: '2026-09-10', grace_days: 2, status: 'Scheduled' }
    expect(planState({ ...base, matched_status: 'Done' }, '2026-09-21')).toBe('Done')
    expect(planState({ ...base, matched_status: 'In Progress' }, '2026-09-21')).toBe('Started')
  })

  it('never invents a state for junk input', () => {
    expect(planState(null, '2026-09-21')).toBe('Upcoming')
    expect(planState({ scheduled_date: '2026-09-10' }, null)).toBe('Upcoming')
  })

  it('gives every state a tone and a plain-English hint', () => {
    for (const state of PLAN_STATES) {
      expect(PLAN_STATE_META[state].label).toBeTruthy()
      expect(PLAN_STATE_META[state].hint).toBeTruthy()
      expect(planTone(state)).toBeTruthy()
    }
    expect(planTone('nonsense')).toBe('quiet')
  })
})

describe('summarizeAdherence', () => {
  const rows = [
    { plan_state: 'Done', days_late: 0 },
    { plan_state: 'Done', days_late: 2 },
    { plan_state: 'Missed', days_late: 9 },
    { plan_state: 'Due', days_late: 0 },
    { plan_state: 'Upcoming', days_late: 0 },
    { plan_state: 'Cancelled', days_late: 0 },
  ]

  it('judges only plans whose window has closed', () => {
    const summary = summarizeAdherence(rows)
    expect(summary.planned).toBe(6)
    expect(summary.judged).toBe(3) // 2 done + 1 missed; upcoming/due/cancelled excluded
    expect(summary.adherence).toBe(67)
    expect(summary.openWork).toBe(1)
  })

  it('counts on-time separately from done', () => {
    expect(summarizeAdherence(rows).onTime).toBe(1)
  })

  it('returns null adherence, never zero, when nothing has come due', () => {
    const summary = summarizeAdherence([{ plan_state: 'Upcoming' }, { plan_state: 'Cancelled' }])
    // A fresh plan is not 0% adherence - it has not been judged yet.
    expect(summary.adherence).toBeNull()
    expect(summary.judged).toBe(0)
  })

  it('survives junk', () => {
    expect(summarizeAdherence(null).planned).toBe(0)
    expect(summarizeAdherence([{ plan_state: 'Nonsense' }]).planned).toBe(0)
  })
})

describe('adherenceBy', () => {
  const rows = [
    { site: 'NHC', plan_state: 'Missed' },
    { site: 'NHC', plan_state: 'Done' },
    { site: 'RUMAH', plan_state: 'Missed' },
    { site: 'RUMAH', plan_state: 'Missed' },
    { site: '', plan_state: 'Done' },
  ]

  it('ranks the worst offender first', () => {
    const groups = adherenceBy(rows, 'site')
    expect(groups[0].name).toBe('RUMAH')
    expect(groups[0].Missed).toBe(2)
    expect(groups[0].adherence).toBe(0)
  })

  it('labels a blank dimension instead of dropping the row', () => {
    const groups = adherenceBy(rows, 'site')
    expect(groups.map(g => g.name)).toContain('Not set')
    expect(groups.reduce((sum, g) => sum + g.planned, 0)).toBe(rows.length)
  })
})

describe('parsePlanDate - day first', () => {
  it('reads an ambiguous date DAY-first, not month-first', () => {
    // The bug this guards: new Date('07-09-2026') files 7 September as 9 July.
    expect(parsePlanDate('07-09-2026')).toBe('2026-09-07')
    expect(parsePlanDate('07/09/2026')).toBe('2026-09-07')
    expect(parsePlanDate('25-12-2026')).toBe('2026-12-25')
  })

  it('still reads an explicit ISO date correctly', () => {
    expect(parsePlanDate('2026-09-07')).toBe('2026-09-07')
  })

  it('reads a month name and a 2-digit year pivoted on 2000', () => {
    expect(parsePlanDate('07-Sep-2026')).toBe('2026-09-07')
    expect(parsePlanDate('07-09-26')).toBe('2026-09-07')
  })

  it('reads an Excel serial number', () => {
    // 46272 is 2026-09-07 on the 1899-12-30 epoch Excel uses (46275 is the 10th).
    expect(parsePlanDate(46272)).toBe('2026-09-07')
  })

  it('refuses an impossible or unreadable date rather than guessing', () => {
    expect(parsePlanDate('32-01-2026')).toBeNull()
    expect(parsePlanDate('2026-02-30')).toBeNull()
    expect(parsePlanDate('next tuesday')).toBeNull()
    expect(parsePlanDate('')).toBeNull()
    expect(parsePlanDate(null)).toBeNull()
  })
})

describe('parsePlanTime', () => {
  it('defaults a blank time and reads an Excel fraction', () => {
    expect(parsePlanTime('')).toBe(DEFAULT_PLAN_TIME)
    expect(parsePlanTime(0.5)).toBe('12:00')
    expect(parsePlanTime('7:30')).toBe('07:30')
  })

  it('refuses an impossible time', () => {
    expect(parsePlanTime('25:00')).toBeNull()
    expect(parsePlanTime('breakfast')).toBeNull()
  })
})

describe('normalizePlanRow', () => {
  it('accepts the spellings a real sheet uses', () => {
    const mapped = normalizePlanRow({
      'Asset No': 'TM514', 'Inspection Date': '25-09-2026', Inspector: 'SAQUIB',
      Crew: 'A', Location: 'NHC', Remarks: 'steer axle',
    })
    expect(mapped.asset_no).toBe('TM514')
    expect(mapped.scheduled_date).toBe('25-09-2026')
    expect(mapped.assigned_name).toBe('SAQUIB')
    expect(mapped.team).toBe('A')
    expect(mapped.site).toBe('NHC')
    expect(mapped.notes).toBe('steer axle')
  })

  it('ignores columns it does not know instead of failing', () => {
    expect(normalizePlanRow({ 'Some Other Column': 'x' })).toEqual({})
  })
})

describe('resolvePerson', () => {
  const people = [
    { id: 'a', full_name: 'SALMAN AHMED', username: '10001' },
    { id: 'b', full_name: 'SAQUIB', username: '10002' },
    { id: 'c', full_name: 'SAQUIB', username: '10003' },
  ]

  it('matches a unique name', () => {
    expect(resolvePerson('salman ahmed', people).person.id).toBe('a')
  })

  it('falls back to username', () => {
    expect(resolvePerson('10003', people).person.id).toBe('c')
  })

  it('refuses to guess between two people with the same name', () => {
    const result = resolvePerson('SAQUIB', people)
    expect(result.person).toBeNull()
    expect(result.reason).toBe('ambiguous')
  })

  it('reports an unknown name', () => {
    expect(resolvePerson('nobody', people).reason).toBe('unknown')
  })
})

describe('parsePlanRows', () => {
  const assets = [
    { asset_no: 'TM514', site: 'NHC', vehicle_type: 'TR-MIXER' },
    { asset_no: 'BH007', site: 'RUMAH', vehicle_type: 'BUS' },
  ]
  const people = [{ id: 'p1', full_name: 'SALMAN AHMED', username: '10001' }]
  const today = '2026-09-21'
  const ctx = { assets, people, today }

  it('accepts a good row and fills the site from the fleet register', () => {
    const { rows, ready } = parsePlanRows(
      [{ 'Asset Code': 'tm514', 'Planned Date': '25-09-2026', 'Assign To': 'SALMAN AHMED' }], ctx,
    )
    expect(ready).toHaveLength(1)
    expect(rows[0].asset_no).toBe('TM514')
    expect(rows[0].scheduled_date).toBe('2026-09-25')
    expect(rows[0].site).toBe('NHC')
    expect(rows[0].assigned_to).toBe('p1')
    expect(rows[0].grace_days).toBe(DEFAULT_GRACE_DAYS)
    expect(rows[0].inspection_time).toBe(DEFAULT_PLAN_TIME)
  })

  it('blocks a vehicle that is not in the fleet register', () => {
    const { rows } = parsePlanRows([{ 'Asset Code': 'ZZ999', 'Planned Date': '25-09-2026' }], ctx)
    expect(rows[0].ready).toBe(false)
    expect(rows[0].problems.join(' ')).toContain('not in the fleet register')
  })

  it('blocks a past date so nobody plans work that cannot be done', () => {
    const { rows } = parsePlanRows([{ 'Asset Code': 'TM514', 'Planned Date': '01-01-2026' }], ctx)
    expect(rows[0].problems.join(' ')).toContain('in the past')
  })

  it('blocks the same vehicle planned twice on one date in one sheet', () => {
    const { rows } = parsePlanRows([
      { 'Asset Code': 'TM514', 'Planned Date': '25-09-2026' },
      { 'Asset Code': 'TM514', 'Planned Date': '25-09-2026' },
    ], ctx)
    expect(rows[0].ready).toBe(true)
    expect(rows[1].ready).toBe(false)
    expect(rows[1].problems.join(' ')).toContain('planned twice')
  })

  it('allows the same vehicle on two different dates', () => {
    const { ready } = parsePlanRows([
      { 'Asset Code': 'TM514', 'Planned Date': '25-09-2026' },
      { 'Asset Code': 'TM514', 'Planned Date': '26-09-2026' },
    ], ctx)
    expect(ready).toHaveLength(2)
  })

  it('reports an unknown assignee rather than silently dropping the name', () => {
    const { rows } = parsePlanRows(
      [{ 'Asset Code': 'TM514', 'Planned Date': '25-09-2026', 'Assign To': 'Ghost' }], ctx,
    )
    expect(rows[0].ready).toBe(false)
    expect(rows[0].problems.join(' ')).toContain('No account matches')
  })

  it('lets a row through unassigned, and counts how many', () => {
    // A plan with no name yet is legitimate - the crew is decided later.
    const { ready, summary } = parsePlanRows([{ 'Asset Code': 'TM514', 'Planned Date': '25-09-2026' }], ctx)
    expect(ready).toHaveLength(1)
    expect(summary.unassigned).toBe(1)
  })

  it('numbers rows the way the spreadsheet does, so an error points at the right line', () => {
    const { rows } = parsePlanRows([
      { 'Asset Code': 'TM514', 'Planned Date': '25-09-2026' },
      { 'Asset Code': '', 'Planned Date': '' },
    ], ctx)
    expect(rows[0].rowNumber).toBe(2)
    expect(rows[1].rowNumber).toBe(3)
  })

  it('reports a blocked count instead of dropping bad rows', () => {
    const { summary } = parsePlanRows([
      { 'Asset Code': 'TM514', 'Planned Date': '25-09-2026' },
      { 'Asset Code': 'NOPE', 'Planned Date': '25-09-2026' },
    ], ctx)
    expect(summary).toMatchObject({ total: 2, ready: 1, blocked: 1 })
  })

  it('rejects an out-of-range grace window', () => {
    const { rows } = parsePlanRows(
      [{ 'Asset Code': 'TM514', 'Planned Date': '25-09-2026', 'Grace Days': 99 }], ctx,
    )
    expect(rows[0].problems.join(' ')).toContain('Grace Days')
  })

  it('handles an empty upload without throwing', () => {
    expect(parsePlanRows([], ctx).summary).toMatchObject({ total: 0, ready: 0, blocked: 0 })
    expect(parsePlanRows(null, ctx).rows).toEqual([])
  })
})

describe('planTemplateRows', () => {
  it('emits exactly the declared headers so the download maps back on upload', () => {
    const [row] = planTemplateRows()
    expect(Object.keys(row)).toEqual(PLAN_COLUMNS.map(column => column.header))
  })

  it('round-trips: the template example parses cleanly', () => {
    const [row] = planTemplateRows({ asset_no: 'TM514', scheduled_date: '25-09-2026', assigned_name: 'SALMAN AHMED' })
    const { ready } = parsePlanRows([row], {
      assets: [{ asset_no: 'TM514', site: 'NHC' }],
      people: [{ id: 'p1', full_name: 'SALMAN AHMED' }],
      today: '2026-09-21',
    })
    expect(ready).toHaveLength(1)
  })
})

describe('buildPlanRef', () => {
  it('is stable, readable and carries the batch date', () => {
    expect(buildPlanRef(new Date(2026, 8, 21, 14, 5))).toBe('PLAN-20260921-1405')
    expect(buildPlanRef(new Date(2026, 8, 21, 14, 5), 'NHC')).toBe('PLAN-20260921-1405-NHC')
  })
})
