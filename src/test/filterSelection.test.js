import { describe, it, expect } from 'vitest'
import {
  isSelectionActive, selectionMatches, selectionValues, toggleSelection,
  selectionLabel, normVehicleType,
} from '../lib/filterSelection'

describe('isSelectionActive', () => {
  it('treats the sentinel, blank and an EMPTY array as no narrowing', () => {
    // The empty array is the load-bearing case: unticking the last chip must
    // show everything again, not empty the table with no way back.
    expect(isSelectionActive('all')).toBe(false)
    expect(isSelectionActive('')).toBe(false)
    expect(isSelectionActive(null)).toBe(false)
    expect(isSelectionActive([])).toBe(false)
    expect(isSelectionActive(['all'])).toBe(false)
  })
  it('is active for one value or several', () => {
    expect(isSelectionActive('NHC')).toBe(true)
    expect(isSelectionActive(['NHC'])).toBe(true)
    expect(isSelectionActive(['NHC', 'JED'])).toBe(true)
  })
})

describe('selectionMatches', () => {
  it('passes everything when the selection is not narrowing', () => {
    expect(selectionMatches('all', 'NHC')).toBe(true)
    expect(selectionMatches([], 'NHC')).toBe(true)
    // Even a row with no value at all: nothing is being asked of it.
    expect(selectionMatches([], '')).toBe(true)
  })
  it('matches ANY of several chosen values', () => {
    const sel = ['CENTRAL', 'WESTERN']
    expect(selectionMatches(sel, 'CENTRAL')).toBe(true)
    expect(selectionMatches(sel, 'WESTERN')).toBe(true)
    expect(selectionMatches(sel, 'EASTERN')).toBe(false)
  })
  it('EXCLUDES a row with no value while a selection is active', () => {
    // An untyped machine is not known to be a mixer, exactly as an unplaced
    // site is not known to be in a region. Including it would be a fabrication.
    expect(selectionMatches(['TR-MIXER'], '')).toBe(false)
    expect(selectionMatches(['TR-MIXER'], null)).toBe(false)
    expect(selectionMatches(['CENTRAL'], undefined)).toBe(false)
  })
  it('folds both sides through the supplied normaliser', () => {
    expect(selectionMatches(['tr-mixer '], 'TR-MIXER', normVehicleType)).toBe(true)
    // Without the normaliser the same pair is a miss - which is why every
    // caller passes one for vehicle type.
    expect(selectionMatches(['tr-mixer '], 'TR-MIXER')).toBe(false)
  })
})

describe('selectionValues and toggleSelection', () => {
  it('reads a selection as a clean array', () => {
    expect(selectionValues('all')).toEqual([])
    expect(selectionValues('NHC')).toEqual(['NHC'])
    expect(selectionValues(['NHC', '', 'all', 'JED'])).toEqual(['NHC', 'JED'])
  })
  it('ticks and unticks, always returning an array', () => {
    // Starting from the sentinel must produce a real selection on the first
    // click, or the control would need to special-case its own initial state.
    expect(toggleSelection('all', 'NHC')).toEqual(['NHC'])
    expect(toggleSelection(['NHC'], 'JED')).toEqual(['NHC', 'JED'])
    expect(toggleSelection(['NHC', 'JED'], 'NHC')).toEqual(['JED'])
    expect(toggleSelection(['NHC'], 'NHC')).toEqual([])
  })
})

describe('selectionLabel', () => {
  it('says nothing when nothing is narrowed', () => {
    expect(selectionLabel('all')).toBe('')
    expect(selectionLabel([])).toBe('')
  })
  it('names every chosen value, and counts the tail past the cap', () => {
    // A report header naming one of three chosen types is a false statement
    // that outlives the screen it came from.
    expect(selectionLabel(['CENTRAL', 'WESTERN'])).toBe('CENTRAL, WESTERN')
    expect(selectionLabel(['a', 'b', 'c', 'd', 'e', 'f'], { max: 3 })).toBe('a, b, c and 3 more')
  })
})

describe('normVehicleType', () => {
  it('folds case and padding so one machine class is one option', () => {
    expect(normVehicleType(' tr-mixer ')).toBe('TR-MIXER')
    expect(normVehicleType('TR-MIXER')).toBe('TR-MIXER')
  })
  it('keeps blank blank, so "not recorded" stays distinguishable', () => {
    expect(normVehicleType(null)).toBe('')
    expect(normVehicleType('   ')).toBe('')
  })
})
