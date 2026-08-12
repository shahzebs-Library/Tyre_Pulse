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
