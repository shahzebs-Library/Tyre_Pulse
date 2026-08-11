import { describe, it, expect } from 'vitest'
import { costPerM3Reliable, fmtCostPerM3Guarded, MIN_M3_FOR_RATE } from '../lib/costPerM3'

/**
 * The live case this guard exists for: Western region held SAR 472,229 of cost
 * against 524 cubic metres, because almost none of its production has been
 * tagged to a region yet. Divided out that is SAR 901 per M3 beside a fleet
 * figure of 12 - a number that reads as a catastrophe and is entirely an
 * artifact of the missing denominator.
 */
describe('cost per M3 reliability guard', () => {
  it('withholds the rate when production is too small to divide by', () => {
    expect(costPerM3Reliable(524)).toBe(false)
    expect(fmtCostPerM3Guarded(901.2, 524, 'SAR')).toBe('Too little production to measure')
  })

  it('shows the rate once production can carry it', () => {
    expect(costPerM3Reliable(741936)).toBe(true)
    expect(fmtCostPerM3Guarded(12.06, 741936, 'SAR')).toBe('SAR 12.06/M3')
  })

  it('treats the threshold itself as measurable', () => {
    expect(costPerM3Reliable(MIN_M3_FOR_RATE)).toBe(true)
    expect(costPerM3Reliable(MIN_M3_FOR_RATE - 1)).toBe(false)
  })

  it('says N/A, not "too little", when there is no rate at all', () => {
    // No rate and no production are different statements, and only one of them
    // is about the denominator being thin.
    expect(fmtCostPerM3Guarded(null, 0, 'SAR')).toBe('N/A')
    expect(fmtCostPerM3Guarded(undefined, 999999, 'SAR')).toBe('N/A')
  })

  it('does not treat unknown production as measurable', () => {
    expect(costPerM3Reliable(null)).toBe(false)
    expect(costPerM3Reliable('not a number')).toBe(false)
  })
})
