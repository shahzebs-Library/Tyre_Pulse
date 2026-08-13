/**
 * TRIPWIRE: the "due soon" thresholds are implemented TWICE - here in JS
 * (bandFor) and in SQL (V526 get_tyre_running_life, p_due_only, which lets the
 * Inspections page ask the server for only the 465 KSA rows it keeps instead of
 * pulling all 3,595). Two copies of one rule drift silently, and the drift is
 * invisible: the page would simply stop flagging tyres it used to flag.
 *
 * If a test here fails, the number was changed in JS. Change
 * MIGRATIONS_V526_RUNNING_LIFE_FILTERS.sql in the SAME edit and re-apply it.
 */
import { describe, it, expect } from 'vitest'
import {
  DUE_SOON_KM, DUE_SOON_HOURS, LIFE_USED_DUE_PCT, bandFor, isDueRow,
  measureFor, measureNote, isHoursUnit, vehicleTypesIn, filterRows, filterDescription, coverage,
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
