import { describe, it, expect } from 'vitest'
import {
  positionKey, wheelKey, daysBetween, shapeTyreRecord, indexFitments,
  flagsFromDueRows, flagsFromInspections, flagsFromActions, parseActionKey,
  mergeFlags, resolveFlag, trackTyreChanges, trackingSummary, filterTracking,
  trackingScopeLabel, trackingBySite, TRACK_STATE_META,
} from '../lib/tyreChangeTracking'

const NOW = new Date('2026-08-12T00:00:00Z')

/** A due (overdue) running-life row: remainingKm 0 is what bandFor reads. */
const dueRow = (over = {}) => ({
  serial: 'S-OLD', asset: 'TM100', position: 'LHF1', country: 'KSA', site: 'JED',
  brand: 'Pirelli', size: '315/80R22.5', fittedOn: '2026-01-10',
  remainingKm: 0, lifeUsedPct: 130, unit: 'km', ...over,
})

const fitment = (over = {}) => ({
  asset_no: 'TM100', serial_no: 'S-OLD', position: 'LHF1', country: 'KSA',
  issue_date: '2026-01-10', removal_date: null, status: 'Active', ...over,
})

describe('positionKey', () => {
  it('folds the two stored vocabularies onto one comparable key', () => {
    // The ERP writes LHF1; free text arrives spaced and lower case.
    expect(positionKey('LHF1')).toBe(positionKey(' lhf1 '))
    expect(positionKey('LHR1-O')).toBe(positionKey('lh r1-o'))
  })
  it('keeps an unparseable token instead of coercing it to a wheel', () => {
    expect(positionKey('BOGIE BACK LEFT')).toBe('BOGIEBACKLEFT')
    expect(positionKey('')).toBe('')
    expect(positionKey(null)).toBe('')
  })
})

describe('wheelKey', () => {
  it('is country-scoped, because one asset code exists in more than one country', () => {
    expect(wheelKey('KSA', 'TM100', 'LHF1')).not.toBe(wheelKey('UAE', 'TM100', 'LHF1'))
  })
})

describe('daysBetween', () => {
  it('counts whole days and returns null when a date is missing', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30)
    expect(daysBetween('', '2026-01-31')).toBeNull()
    expect(daysBetween('2026-01-01', null)).toBeNull()
  })
})

describe('shapeTyreRecord', () => {
  it('reads the position and serial from either stored column', () => {
    const r = shapeTyreRecord({ asset_no: 'A1', tyre_position: 'RHF1', tyre_serial: 'X9', issue_date: '2026-02-01T00:00:00Z' })
    expect(r.position).toBe('RHF1')
    expect(r.serial).toBe('X9')
    expect(r.fittedOn).toBe('2026-02-01')
  })
  it('marks a removed tyre using the shared removal test', () => {
    expect(shapeTyreRecord({ removal_date: '2026-03-01' }).removed).toBe(true)
    expect(shapeTyreRecord({ status: 'Scrapped' }).removed).toBe(true)
    expect(shapeTyreRecord({ status: 'Active' }).removed).toBe(false)
  })
})

describe('flag sources stay distinguishable', () => {
  it('reads system flags from the due list and marks them system-raised', () => {
    const flags = flagsFromDueRows([dueRow(), dueRow({ remainingKm: 50000, lifeUsedPct: 20 })])
    expect(flags).toHaveLength(1) // the healthy row is not a flag
    expect(flags[0].source).toBe('system')
    expect(flags[0].kind).toBe('Past expected life')
    // No flag date is invented for a "due as of now" feed.
    expect(flags[0].flaggedOn).toBe('')
    expect(flags[0].fittedOn).toBe('2026-01-10')
  })

  it('reads user flags from inspection damage, dated by the inspection', () => {
    const flags = flagsFromInspections([{
      asset_no: 'TM100', country: 'KSA', site: 'JED', inspection_date: '2026-06-01',
      tyre_conditions: { LHF1: 'Damage', RHF1: 'Good' },
    }])
    expect(flags).toHaveLength(1)
    expect(flags[0].source).toBe('user')
    expect(flags[0].position).toBe('LHF1')
    expect(flags[0].flaggedOn).toBe('2026-06-01')
  })

  it('parses corrective-action keys back to position, serial and source', () => {
    expect(parseActionKey('damage:LHF1')).toMatchObject({ source: 'user', position: 'LHF1' })
    expect(parseActionKey('overdue:LHR1-O:S-OLD')).toMatchObject({ source: 'system', position: 'LHR1-O', serial: 'S-OLD' })
    expect(parseActionKey('duesoon:RHF1:')).toMatchObject({ source: 'system', kind: 'Due soon' })
    // An unrelated corrective action must never be read as a tyre flag.
    expect(parseActionKey('something-else')).toBeNull()
    expect(parseActionKey('')).toBeNull()
  })

  it('dates a system flag from the corrective action that recorded it', () => {
    const flags = flagsFromActions([
      { asset_no: 'TM100', country: 'KSA', source_detail: 'overdue:LHF1:S-OLD', created_at: '2026-05-01T09:00:00Z', title: 'Tyre past life' },
      { asset_no: 'TM100', country: 'KSA', source_detail: null },
    ])
    expect(flags).toHaveLength(1)
    expect(flags[0].flaggedOn).toBe('2026-05-01')
    expect(flags[0].source).toBe('system')
  })
})

describe('mergeFlags', () => {
  it('folds one wheel flagged by two sources into a single row, keeping the real date', () => {
    const merged = mergeFlags([
      flagsFromActions([{ asset_no: 'TM100', country: 'KSA', source_detail: 'overdue:LHF1:S-OLD', created_at: '2026-05-01' }]),
      flagsFromDueRows([dueRow()]),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].flaggedOn).toBe('2026-05-01')
    expect(merged[0].origins).toEqual(expect.arrayContaining(['Corrective action', 'Running life']))
  })

  it('does not merge the same code in two countries', () => {
    const merged = mergeFlags([flagsFromDueRows([dueRow(), dueRow({ country: 'UAE' })])])
    expect(merged).toHaveLength(2)
  })
})

describe('resolveFlag - the four states are never collapsed', () => {
  const flag = { asset: 'TM100', country: 'KSA', position: 'LHF1', serial: 'S-OLD', flaggedOn: '2026-05-01', fittedOn: '2026-01-10' }

  it('replaced: a different tyre went on the same wheel after the flag', () => {
    const idx = indexFitments([
      fitment({ removal_date: '2026-05-20' }),
      fitment({ serial_no: 'S-NEW', issue_date: '2026-05-21', brand: 'Michelin' }),
    ])
    const res = resolveFlag(flag, idx, { now: NOW })
    expect(res.state).toBe('replaced')
    expect(res.replacement).toMatchObject({ serial: 'S-NEW', brand: 'Michelin', fittedOn: '2026-05-21' })
    expect(res.daysToReplace).toBe(20)
    expect(res.daysFlagged).toBe(daysBetween('2026-05-01', '2026-08-12'))
  })

  it('still on the vehicle: same tyre, no removal, nothing newer fitted', () => {
    const res = resolveFlag(flag, indexFitments([fitment()]), { now: NOW })
    expect(res.state).toBe('on_vehicle')
    expect(res.replacement).toBeNull()
    expect(res.daysFlagged).toBe(103)
  })

  it('removed but nothing fitted: the position is empty, which is not "replaced"', () => {
    const res = resolveFlag(flag, indexFitments([fitment({ removal_date: '2026-06-02' })]), { now: NOW })
    expect(res.state).toBe('removed_not_replaced')
    expect(res.removedOn).toBe('2026-06-02')
    expect(res.replacement).toBeNull()
  })

  it('could not tell when no position was recorded - never reported as not replaced', () => {
    const res = resolveFlag({ ...flag, position: '' }, indexFitments([fitment()]), { now: NOW })
    expect(res.state).toBe('unknown')
    expect(res.reason).toMatch(/position/i)
  })

  it('could not tell when no fitment was ever uploaded for that wheel', () => {
    const res = resolveFlag(flag, indexFitments([]), { now: NOW })
    expect(res.state).toBe('unknown')
    expect(res.daysFlagged).toBe(103)
  })

  it('a fitment in another country can never count as the replacement', () => {
    const idx = indexFitments([
      fitment(),
      fitment({ country: 'UAE', serial_no: 'S-UAE', issue_date: '2026-06-01' }),
    ])
    expect(resolveFlag(flag, idx, { now: NOW }).state).toBe('on_vehicle')
  })

  it('still matches a fitment whose country was never recorded', () => {
    // The read is already country-scoped, so an untagged row belongs to it -
    // but a row tagged with ANOTHER country (tested above) stays refused.
    const idx = indexFitments([
      fitment(),
      fitment({ country: null, serial_no: 'S-NEW', issue_date: '2026-06-01' }),
    ])
    expect(resolveFlag(flag, idx, { now: NOW }).state).toBe('replaced')
  })

  it('matches across position spellings', () => {
    const idx = indexFitments([
      fitment({ position: ' lhf1 ' }),
      fitment({ position: 'LHF1', serial_no: 'S-NEW', issue_date: '2026-06-01' }),
    ])
    expect(resolveFlag(flag, idx, { now: NOW }).state).toBe('replaced')
  })

  it('an undated system flag is still tracked, from the tyre own fitment date, with no invented duration', () => {
    const undated = { ...flag, flaggedOn: '' }
    const idx = indexFitments([fitment(), fitment({ serial_no: 'S-NEW', issue_date: '2026-07-01' })])
    const res = resolveFlag(undated, idx, { now: NOW })
    expect(res.state).toBe('replaced')
    expect(res.daysFlagged).toBeNull()
  })
})

describe('trackTyreChanges', () => {
  it('produces one row per wheel with its state, and counts honestly', () => {
    const { rows, summary } = trackTyreChanges({
      dueRows: [dueRow(), dueRow({ asset: 'TM200', serial: 'S-2', position: 'RHF1' })],
      inspections: [{ asset_no: 'TM300', country: 'KSA', site: 'RUH', inspection_date: '2026-04-01', tyre_conditions: { LHR1: 'Puncture' } }],
      actions: [],
      tyreRecords: [
        fitment(),
        fitment({ asset_no: 'TM200', serial_no: 'S-2', position: 'RHF1', removal_date: '2026-07-01' }),
        fitment({ asset_no: 'TM300', serial_no: 'S-3', position: 'LHR1', issue_date: '2026-01-01' }),
        fitment({ asset_no: 'TM300', serial_no: 'S-3B', position: 'LHR1', issue_date: '2026-04-10' }),
      ],
      now: NOW,
    })
    expect(rows).toHaveLength(3)
    expect(summary.total).toBe(3)
    expect(summary.onVehicle).toBe(1)
    expect(summary.removedNotReplaced).toBe(1)
    expect(summary.replaced).toBe(1)
    expect(summary.bySystem).toBe(2)
    expect(summary.byUser).toBe(1)
    expect(summary.assets).toBe(3)
    expect(summary.avgDaysToReplace).toBe(9)
    // Outstanding work sorts above finished work.
    expect(rows[0].state).not.toBe('replaced')
  })

  it('reports no average when nothing has been replaced - never zero days', () => {
    const s = trackingSummary([{ state: 'on_vehicle', source: 'system', asset: 'A' }])
    expect(s.avgDaysToReplace).toBeNull()
    expect(s.replaced).toBe(0)
  })
})

describe('filters, scope label and the site roll-up', () => {
  const rows = [
    { asset: 'TM100', serial: 'S-OLD', position: 'LHF1', site: 'JED', state: 'on_vehicle', source: 'system', kind: 'Past expected life', replacement: null },
    { asset: 'TM300', serial: 'S-3', position: 'LHR1', site: 'RUH', state: 'replaced', source: 'user', kind: 'Puncture', replacement: { serial: 'S-3B' } },
  ]
  it('filters by state, source and free text including the replacing serial', () => {
    expect(filterTracking(rows, { state: 'replaced' })).toHaveLength(1)
    expect(filterTracking(rows, { source: 'system' })).toHaveLength(1)
    expect(filterTracking(rows, { search: 's-3b' })).toHaveLength(1)
    expect(filterTracking(rows, { search: 'nothing-here' })).toHaveLength(0)
  })
  it('names the set an export covers', () => {
    const label = trackingScopeLabel({ country: 'KSA', asset: 'TM100', state: 'on_vehicle' })
    expect(label).toContain('KSA')
    expect(label).toContain('TM100')
    expect(label).toContain(TRACK_STATE_META.on_vehicle.label)
  })
  it('rolls up per site with a totals row, keeping siteless flags visible', () => {
    const { rows: bySite, totals } = trackingBySite([...rows, { ...rows[0], site: '' }])
    expect(bySite.map((r) => r.site)).toContain('No site')
    expect(totals.flagged).toBe(3)
    expect(totals.replaced).toBe(1)
    expect(totals.onVehicle).toBe(2)
  })
})
