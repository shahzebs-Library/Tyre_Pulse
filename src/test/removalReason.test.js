import { describe, it, expect } from 'vitest'
import { isBrandNotReason, cleanRemovalReason, EXTRA_BRAND_REASONS } from '../lib/removalReason'
import { formatCurrency, formatCurrencyCompact, formatCurrencyK } from '../lib/formatters'

describe('isBrandNotReason', () => {
  it('flags the catalog brands found in UAE removal_reason', () => {
    for (const v of ['ROADX', 'FIREMAX', 'LONGMARCH', 'TRIANGLE', 'ALLROUND', 'BLACKHAWK', ' roadx ']) {
      expect(isBrandNotReason(v)).toBe(true)
    }
  })
  it('folds spacing and punctuation: ROCK HOLDER and VGLORY', () => {
    expect(EXTRA_BRAND_REASONS).toContain('vglory')
    expect(isBrandNotReason('ROCK HOLDER')).toBe(true)
    expect(isBrandNotReason('VGLORY')).toBe(true)
    expect(isBrandNotReason('V-GLORY')).toBe(true)
  })
  it('keeps genuine reasons', () => {
    for (const v of ['WORN OUT', 'PUNCTURE', 'BLAST/BURST', 'DAMAGED', 'SIDE WALL DAMAGE', 'RADIAL']) {
      expect(isBrandNotReason(v)).toBe(false)
    }
  })
  it('blank is not a brand', () => {
    expect(isBrandNotReason('')).toBe(false)
    expect(isBrandNotReason(null)).toBe(false)
  })
})

describe('cleanRemovalReason', () => {
  it('returns trimmed reason, null for blank or brand', () => {
    expect(cleanRemovalReason('  WORN OUT ')).toBe('WORN OUT')
    expect(cleanRemovalReason('ROADX')).toBeNull()
    expect(cleanRemovalReason('   ')).toBeNull()
    expect(cleanRemovalReason(undefined)).toBeNull()
  })
})

describe('currency formatters never invent a currency', () => {
  it('omitted currency renders a bare amount, not SAR', () => {
    expect(formatCurrency(1234.5)).toBe('1,234.50')
    expect(formatCurrencyCompact(2500)).toBe('2.5k')
    expect(formatCurrencyK(2500)).toBe('2.5k')
    expect(formatCurrency(10, null, 0)).toBe('10')
  })
  it('explicit currency is kept', () => {
    expect(formatCurrency(1234.5, 'AED')).toBe('AED 1,234.50')
    expect(formatCurrencyCompact(3_400_000, 'EGP')).toBe('EGP 3.40M')
    expect(formatCurrency('x', 'SAR')).toBe('-')
  })
})
