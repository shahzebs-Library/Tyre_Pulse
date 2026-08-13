/**
 * TRIPWIRE: the "due soon" thresholds are implemented TWICE - here in JS
 * (bandFor) and in SQL (V526 get_tyre_running_life, p_due_only, which lets the
 * Inspections page ask the server for only the 465 KSA rows it keeps instead of
 * pulling all 3,595). Two copies of one rule drift silently, and the drift is
 * invisible: the page would simply stop flagging tyres it used to flag.
 *
 * If a test here fails, the number was changed in JS. Change
 * MIGRATIONS_V526_RUNNING_LIFE_FILTERS.sql in the SAME edit and re-apply it.
 *
 * The SHAPE of the rule is mirrored too: V541 made the server's is_due the
 * UNION of the two budgets ("whichever runs out first"), matching measureFor
 * here. If that shape changes on one side, change MIGRATIONS_V541_RUNNING_LIFE_
 * DUE_EITHER_BUDGET.sql on the other, or the due-only fetch and the on-screen
 * badge start disagreeing about which tyres are due - silently.
 */
import { describe, it, expect } from 'vitest'
import {
  DUE_SOON_KM, DUE_SOON_HOURS, LIFE_USED_DUE_PCT, bandFor, isDueRow,
  measureFor, measureNote, isHoursUnit, vehicleTypesIn, filterRows, filterDescription, coverage,
  budgetsFor,
} from '../lib/tyreRunningLife'

describe('running-life due thresholds (mirrored by the V526 SQL)', () => {
  it('holds the exact figures the SQL carries', () => {
    expect(DUE_SOON_KM).toBe(10000)
    expect(DUE_SOON_HOURS).toBe(500)
    expect(LIFE_USED_DUE_PCT).toBe(90)
  })

  it('judges km rows the way p_due_only does', () => {
    expect(bandFor({ remainingKm: 0 })).toBe('overdue')
    expect(bandFor({ remainingKm: 9999 })).toBe('due-soon')
    expect(bandFor({ remainingKm: 10000, lifeUsedPct: 50 })).toBe('healthy')
    expect(bandFor({ remainingKm: 20000, lifeUsedPct: 90 })).toBe('due-soon')
    expect(bandFor({ remainingKm: 20000, lifeUsedPct: 89 })).toBe('mid-life')
  })

  it('judges an hours-only row on its hours target', () => {
    expect(bandFor({ remainingHours: 0 })).toBe('overdue')
    expect(bandFor({ remainingHours: 499 })).toBe('due-soon')
    expect(bandFor({ remainingHours: 500, hoursUsedPct: 10 })).toBe('healthy')
    expect(bandFor({ remainingHours: 900, hoursUsedPct: 90 })).toBe('due-soon')
  })

  it('never calls an unmeasurable row due', () => {
    expect(bandFor({})).toBe('unknown')
    expect(isDueRow({})).toBe(false)
    expect(isDueRow({ remainingKm: 0 })).toBe(true)
    expect(isDueRow({ remainingKm: 50000, lifeUsedPct: 10 })).toBe(false)
  })
})

/**
 * The meter a machine is MANAGED by decides its state - not whichever meter
 * happens to have a reading.
 *
 * Measured on the live KSA fleet before this was written: 815 tyres sit on
 * hour-measured assets (pumps, wheel loaders, skid loaders), 482 of them also
 * carry a km figure because those machines drive to site, and on 56 the two
 * dimensions disagreed about whether the tyre was near the end of its life. The
 * old rule read km first, so those 56 were judged against a distance nobody
 * manages them by.
 */
describe('the governing meter', () => {
  const pump = (o = {}) => ({
    unit: 'hours', vehicleType: 'PUMPS',
    remainingKm: 60000, lifeUsedPct: 25,   // plenty of distance left
    remainingHours: 100, hoursUsedPct: 98, // but nearly out of hours
    ...o,
  })

  it('judges an hour-measured asset on hours even when km looks healthy', () => {
    expect(bandFor(pump())).toBe('due-soon')
    expect(measureFor(pump()).dimension).toBe('hours')
    expect(measureFor(pump()).used).toBe(98)
  })

  it('judges a km-measured asset on km even when hours look healthy', () => {
    const mixer = { unit: 'km', remainingKm: 500, lifeUsedPct: 97, remainingHours: 9000, hoursUsedPct: 10 }
    expect(bandFor(mixer)).toBe('due-soon')
    expect(measureFor(mixer).dimension).toBe('km')
  })

  it('accepts the server spelling of the unit as well as the shaped one', () => {
    // shapeRow folds engine_hours -> hours; a raw RPC row still says
    // engine_hours, and testing only one spelling reads "no" for all plant
    expect(measureFor(pump({ unit: 'engine_hours' })).dimension).toBe('hours')
    expect(isHoursUnit('engine_hours')).toBe(true)
    expect(isHoursUnit('hours')).toBe(true)
    expect(isHoursUnit('km')).toBe(false)
  })

  it('falls back to the other meter only when its own has never been read, and says so', () => {
    const noHours = pump({ remainingHours: null, hoursUsedPct: null })
    expect(measureFor(noHours).dimension).toBe('km')
    expect(measureFor(noHours).onFallback).toBe(true)
    expect(measureNote(noHours)).toMatch(/no hour-meter reading/i)
    // and stays silent in the ordinary case
    expect(measureNote(pump())).toBe('')
  })

  it('is unknown when neither meter can measure it - never a guess', () => {
    const blind = { unit: 'km', remainingKm: null, lifeUsedPct: null, remainingHours: null, hoursUsedPct: null }
    expect(bandFor(blind)).toBe('unknown')
    expect(measureFor(blind).dimension).toBeNull()
    expect(measureNote(blind)).toBe('')
  })
})

describe('asset type', () => {
  const rows = [
    { vehicleType: 'TR-MIXER', serial: 'a', asset: 'TM1', site: '', brand: '', size: '', unit: 'km' },
    { vehicleType: 'PUMPS', serial: 'b', asset: 'MP1', site: '', brand: '', size: '', unit: 'hours' },
    { vehicleType: 'TR-MIXER', serial: 'c', asset: 'TM2', site: '', brand: '', size: '', unit: 'km' },
  ]

  it('offers only the types actually present, sorted', () => {
    expect(vehicleTypesIn(rows)).toEqual(['PUMPS', 'TR-MIXER'])
    expect(vehicleTypesIn([{ vehicleType: '' }, null])).toEqual([])
  })

  it('filters the table by type, case-insensitively', () => {
    expect(filterRows(rows, { vehicleType: 'TR-MIXER' }).map((r) => r.serial)).toEqual(['a', 'c'])
    expect(filterRows(rows, { vehicleType: 'tr-mixer' })).toHaveLength(2)
    expect(filterRows(rows, { vehicleType: 'all' })).toHaveLength(3)
  })

  it('names the type filter in the export caption, so a saved report says what it covers', () => {
    expect(filterDescription({ vehicleType: 'PUMPS' })).toContain('asset type: PUMPS')
    expect(filterDescription({})).toBe('All active tyres')
  })
})

describe('coverage counts plant as plant', () => {
  it('no longer reports an hour-measured tyre as a missing odometer reading', () => {
    // LATENT BUG: coverage() tested `unit === 'engine_hours'` while shapeRow
    // had already folded that to 'hours', so onHours could never increment and
    // every plant tyre was counted as a meter-reading backlog instead.
    const rows = [
      { unit: 'hours', kmRun: null, currentKm: null, kmAtFitment: 100 },
      { unit: 'km', kmRun: null, currentKm: null, kmAtFitment: 100 },
    ]
    const c = coverage(rows)
    expect(c.onHours).toBe(1)
    expect(c.noCurrentKm).toBe(1)
  })
})

/**
 * WHICHEVER BUDGET RUNS OUT FIRST.
 *
 * The owner sets TWO targets for a pump - 30,000 km and 5,000 hours - and both
 * are real. Measured live: all 719 KSA pump tyres carry both, and on 73 of them
 * the DISTANCE is the one further along. So neither meter may win by default:
 * reading km first missed 55 tyres spent on hours, reading hours first missed
 * the tyre spent on distance.
 */
describe('two budgets, whichever comes first', () => {
  const pump = (o = {}) => ({ unit: 'hours', vehicleType: 'PUMPS', ...o })

  it('a pump spent on HOURS is due even though its distance looks fine', () => {
    const r = pump({ remainingKm: 20000, lifeUsedPct: 30, remainingHours: 100, hoursUsedPct: 98 })
    expect(bandFor(r)).toBe('due-soon')
    expect(measureFor(r).dimension).toBe('hours')
    expect(measureNote(r)).toBe('') // its own meter decided; nothing surprising
  })

  it('a pump spent on DISTANCE is due even though its hours look fine', () => {
    // this is the case a strict hours-only rule silently missed
    const r = pump({ remainingKm: 0, lifeUsedPct: 100, remainingHours: 3000, hoursUsedPct: 40 })
    expect(bandFor(r)).toBe('overdue')
    expect(measureFor(r).dimension).toBe('km')
    expect(measureNote(r)).toMatch(/Distance budget runs out first/i)
    expect(measureNote(r)).toContain('100% used')
  })

  it('takes the worse of the two, never the average and never the kinder one', () => {
    const r = pump({ remainingKm: 500, lifeUsedPct: 95, remainingHours: 4000, hoursUsedPct: 20 })
    expect(bandFor(r)).toBe('due-soon')
    expect(measureFor(r).used).toBe(95)
  })

  it('a tie goes to the meter the machine is managed by, so the figure is the familiar one', () => {
    const r = pump({ remainingKm: 20000, lifeUsedPct: 30, remainingHours: 4000, hoursUsedPct: 30 })
    expect(measureFor(r).dimension).toBe('hours')
    expect(measureNote(r)).toBe('')
  })

  it('publishes both budgets so the screen can show what the owner set', () => {
    const r = pump({ remainingKm: 500, lifeUsedPct: 95, remainingHours: 4000, hoursUsedPct: 20 })
    const b = budgetsFor(r)
    expect(b.map((x) => x.label)).toEqual(['Distance', 'Engine hours'])
    expect(b.find((x) => x.leading).label).toBe('Distance')
    // a machine with only one budget has nothing to compare
    expect(budgetsFor({ unit: 'km', remainingKm: 100, lifeUsedPct: 50 })).toEqual([])
  })

  it('a mixer has no hours target at all, so nothing about it changes', () => {
    const mixer = { unit: 'km', remainingKm: 500, lifeUsedPct: 97, remainingHours: null, hoursUsedPct: null }
    expect(bandFor(mixer)).toBe('due-soon')
    expect(measureFor(mixer).dimension).toBe('km')
    expect(measureFor(mixer).both).toBe(false)
    expect(measureNote(mixer)).toBe('')
  })
})
