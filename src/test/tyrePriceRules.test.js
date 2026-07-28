import { describe, it, expect } from 'vitest'
import {
  isTyreRepair, isTyreWarranty, unitPrice, sourceRank, comparableStrength, SOURCE_ORDER,
} from '../lib/tyrePriceRules'

// Every description below is a real row from the live expense grid, or a real
// price from it. A change that breaks one of these breaks something that
// actually happened.

describe('a repair is not a tyre purchase', () => {
  it('catches the real Egypt repair lines', () => {
    // 35 lines, EGP 155,504, currently sitting in the tyre bucket.
    expect(isTyreRepair('Repair TIRE 315/80R22.5,')).toBe(true)
    expect(isTyreRepair('Repair TIRE 385/65/R22.5')).toBe(true)
  })

  it('catches the other ways a repair is written', () => {
    expect(isTyreRepair('PUNCTURE REPAIR')).toBe(true)
    expect(isTyreRepair('TYRE PATCHING')).toBe(true)
    expect(isTyreRepair('VULCANIZING SERVICE')).toBe(true)
    expect(isTyreRepair('VULCANISING')).toBe(true)
    expect(isTyreRepair('RETREAD 12R22.5')).toBe(true)
  })

  it('leaves a real tyre alone', () => {
    expect(isTyreRepair('TYRE 315/80 R22.5 PIRELLI')).toBe(false)
    expect(isTyreRepair('TIRE 10-16.5TL (BOBCAT TIRE)')).toBe(false)
    expect(isTyreRepair('315/80 R22.5 20PR ROADX')).toBe(false)
  })

  it('matches whole words only', () => {
    // The 'Shell RIMula matched rim' lesson: a substring test would fire on
    // anything containing these letters.
    expect(isTyreRepair('PREPAIRED COMPOUND')).toBe(false)
    expect(isTyreRepair('DISPATCHED TYRE')).toBe(false)
  })

  it('is safe on nothing', () => {
    expect(isTyreRepair(null)).toBe(false)
    expect(isTyreRepair('')).toBe(false)
    expect(isTyreRepair(undefined)).toBe(false)
  })
})

describe('a warranty replacement costs nothing', () => {
  it('catches how a free replacement is written', () => {
    expect(isTyreWarranty('TYRE REPLACED UNDER WARRANTY')).toBe(true)
    expect(isTyreWarranty('TYRE FREE OF CHARGE')).toBe(true)
    expect(isTyreWarranty('REPLACEMENT CLAIM 315/80')).toBe(true)
    expect(isTyreWarranty('TYRE FOC')).toBe(true)
  })

  it('leaves a bought tyre alone', () => {
    expect(isTyreWarranty('TYRE 315/80 R22.5')).toBe(false)
    expect(isTyreWarranty('Repair TIRE 315/80R22.5,')).toBe(false)
  })

  it('is safe on nothing', () => {
    expect(isTyreWarranty(null)).toBe(false)
    expect(isTyreWarranty('')).toBe(false)
  })
})

describe('unitPrice - the whole V327 bug in one function', () => {
  it('divides by quantity', () => {
    // The real UAE case: a line of 4 tyres at 2,858.84 is 714.71 each, not
    // 2,858.84 each. V327 wrote the line total and overstated it 3.1x.
    expect(unitPrice(2858.84, 4)).toBe(714.71)
  })

  it('handles a single-tyre line unchanged', () => {
    expect(unitPrice(885.83, 1)).toBe(885.83)
  })

  it('handles the biggest real line', () => {
    // Up to 20 tyres have been billed on one line.
    expect(unitPrice(14000, 20)).toBe(700)
  })

  it('is null when the quantity is unknown, never the line total', () => {
    // Returning the line total here is exactly how the old bug produced a
    // per-tyre price 5x too high.
    expect(unitPrice(2858.84, null)).toBeNull()
    expect(unitPrice(2858.84, 0)).toBeNull()
    expect(unitPrice(2858.84, undefined)).toBeNull()
    expect(unitPrice(2858.84, 'abc')).toBeNull()
  })

  it('is null for a zero or negative value', () => {
    expect(unitPrice(0, 4)).toBeNull()
    expect(unitPrice(-100, 4)).toBeNull()
  })
})

describe('source order', () => {
  it('puts warranty above a measured price', () => {
    // If a tyre was replaced free, what an equivalent tyre costs is not what
    // this one cost.
    expect(sourceRank('warranty')).toBeLessThan(sourceRank('own_jobcard'))
  })

  it('prefers the tyre\'s own purchase over a comparison', () => {
    expect(sourceRank('own_jobcard')).toBeLessThan(sourceRank('comparable'))
  })

  it('sorts an unknown source last rather than first', () => {
    expect(sourceRank('something_else')).toBe(SOURCE_ORDER.length)
  })
})

describe('comparableStrength says what the estimate rests on', () => {
  it('calls a single sample what it is', () => {
    // A median of one is a copy of one row, not an average, and the reviewer
    // has to be able to see that.
    expect(comparableStrength(1).key).toBe('single')
  })

  it('separates a thin comparison from a solid one', () => {
    expect(comparableStrength(3).key).toBe('thin')
    expect(comparableStrength(90).key).toBe('solid')
    expect(comparableStrength(90).label).toContain('90')
  })

  it('reports no comparison rather than a strength of zero', () => {
    expect(comparableStrength(0).key).toBe('none')
    expect(comparableStrength(null).key).toBe('none')
    expect(comparableStrength(undefined).key).toBe('none')
  })
})
