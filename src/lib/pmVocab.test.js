import { describe, it, expect } from 'vitest'
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  canonAssetCategory,
  toDbAssetCategory,
  PM_PRIORITIES,
  PM_PRIORITY_META,
  toDbPriority,
  PM_OUTCOMES,
  PM_OUTCOME_META,
  toDbOutcome,
  METER_SOURCES,
  METER_SOURCE_LABELS,
  toDbMeterSource,
  meterUnit,
} from './pmVocab'

// Characters banned from report/UI strings (em/en dash, arrows, curly quotes, middle dot).
const BANNED = /[—–→←‘’“”·]/

describe('pmVocab constants', () => {
  it('exposes the exact category / priority / outcome / meter token sets', () => {
    expect(ASSET_CATEGORIES).toEqual(['vehicle', 'generator', 'plant', 'machinery', 'equipment', 'other'])
    expect(PM_PRIORITIES).toEqual(['low', 'medium', 'high', 'critical'])
    expect(PM_OUTCOMES).toEqual(['completed', 'partial', 'deferred', 'failed'])
    expect(METER_SOURCES).toEqual(['odometer', 'engine_hours', 'none'])
  })
  it('has a label for every token and no banned punctuation', () => {
    for (const t of ASSET_CATEGORIES) expect(ASSET_CATEGORY_LABELS[t]).toBeTruthy()
    for (const t of PM_PRIORITIES) expect(PM_PRIORITY_META[t].label).toBeTruthy()
    for (const t of PM_OUTCOMES) expect(PM_OUTCOME_META[t].label).toBeTruthy()
    for (const t of METER_SOURCES) expect(METER_SOURCE_LABELS[t]).toBeTruthy()
    const strings = [
      ...Object.values(ASSET_CATEGORY_LABELS),
      ...Object.values(PM_PRIORITY_META).map((m) => m.label),
      ...Object.values(PM_OUTCOME_META).map((m) => m.label),
      ...Object.values(METER_SOURCE_LABELS),
    ]
    for (const s of strings) expect(BANNED.test(s)).toBe(false)
  })
})

describe('canonAssetCategory / toDbAssetCategory', () => {
  it('round-trips every token', () => {
    for (const t of ASSET_CATEGORIES) {
      expect(canonAssetCategory(t)).toBe(t)
      expect(toDbAssetCategory(t)).toBe(t)
    }
  })
  it('folds label and mixed case / whitespace to the token', () => {
    expect(canonAssetCategory('Vehicle')).toBe('vehicle')
    expect(canonAssetCategory('  GENERATOR ')).toBe('generator')
    expect(canonAssetCategory('Machinery')).toBe('machinery')
    expect(toDbAssetCategory('Equipment')).toBe('equipment')
  })
  it('returns null for empty / unknown', () => {
    expect(canonAssetCategory('')).toBeNull()
    expect(canonAssetCategory(null)).toBeNull()
    expect(canonAssetCategory('spaceship')).toBeNull()
    expect(toDbAssetCategory(undefined)).toBeNull()
  })
})

describe('toDbPriority', () => {
  it('round-trips tokens and folds labels', () => {
    expect(toDbPriority('low')).toBe('low')
    expect(toDbPriority('Critical')).toBe('critical')
    expect(toDbPriority(' HIGH ')).toBe('high')
  })
  it('defaults to medium for empty / unknown', () => {
    expect(toDbPriority('')).toBe('medium')
    expect(toDbPriority(null)).toBe('medium')
    expect(toDbPriority('urgent')).toBe('medium')
  })
})

describe('toDbOutcome', () => {
  it('round-trips tokens and folds labels', () => {
    expect(toDbOutcome('partial')).toBe('partial')
    expect(toDbOutcome('Deferred')).toBe('deferred')
    expect(toDbOutcome(' FAILED ')).toBe('failed')
  })
  it('defaults to completed for empty / unknown', () => {
    expect(toDbOutcome('')).toBe('completed')
    expect(toDbOutcome(null)).toBe('completed')
    expect(toDbOutcome('cancelled')).toBe('completed')
  })
})

describe('toDbMeterSource / meterUnit', () => {
  it('round-trips tokens and folds labels', () => {
    expect(toDbMeterSource('odometer')).toBe('odometer')
    expect(toDbMeterSource('engine_hours')).toBe('engine_hours')
    expect(toDbMeterSource('Odometer (km)')).toBe('odometer')
    expect(toDbMeterSource('Engine hours')).toBe('engine_hours')
    expect(toDbMeterSource('No meter')).toBe('none')
  })
  it('defaults to none for empty / unknown', () => {
    expect(toDbMeterSource('')).toBe('none')
    expect(toDbMeterSource(null)).toBe('none')
    expect(toDbMeterSource('gps')).toBe('none')
  })
  it('maps a source to its unit', () => {
    expect(meterUnit('odometer')).toBe('km')
    expect(meterUnit('engine_hours')).toBe('h')
    expect(meterUnit('none')).toBe('')
    expect(meterUnit('Odometer (km)')).toBe('km')
    expect(meterUnit('')).toBe('')
  })
})
