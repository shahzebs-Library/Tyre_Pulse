import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  confidenceBand,
  needsReview,
  summariseScans,
  byType,
  byBand,
} from '../lib/ocrScanner'

describe('toFiniteNumber', () => {
  it('parses plain numbers', () => {
    expect(toFiniteNumber(0.85)).toBe(0.85)
    expect(toFiniteNumber(0)).toBe(0)
  })
  it('parses numeric strings and strips units', () => {
    expect(toFiniteNumber('0.9')).toBe(0.9)
    expect(toFiniteNumber('92%')).toBe(92)
  })
  it('returns null for empty / null / non-numeric', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('confidenceBand', () => {
  it('returns high at and above 0.90', () => {
    expect(confidenceBand({ confidence: 0.9 })).toBe('high')
    expect(confidenceBand({ confidence: 0.99 })).toBe('high')
    expect(confidenceBand({ confidence: 1 })).toBe('high')
  })
  it('returns medium in [0.70, 0.90)', () => {
    expect(confidenceBand({ confidence: 0.7 })).toBe('medium')
    expect(confidenceBand({ confidence: 0.89 })).toBe('medium')
  })
  it('returns low in (0, 0.70)', () => {
    expect(confidenceBand({ confidence: 0.01 })).toBe('low')
    expect(confidenceBand({ confidence: 0.69 })).toBe('low')
  })
  it('returns unknown for null / absent / zero / non-numeric', () => {
    expect(confidenceBand({ confidence: null })).toBe('unknown')
    expect(confidenceBand({})).toBe('unknown')
    expect(confidenceBand({ confidence: 0 })).toBe('unknown')
    expect(confidenceBand({ confidence: 'n/a' })).toBe('unknown')
  })
  it('reads numeric strings', () => {
    expect(confidenceBand({ confidence: '0.95' })).toBe('high')
  })
})

describe('needsReview', () => {
  it('is true for needs_review / pending status regardless of confidence', () => {
    expect(needsReview({ review_status: 'needs_review', confidence: 0.99 })).toBe(true)
    expect(needsReview({ review_status: 'pending', confidence: 0.99 })).toBe(true)
    expect(needsReview({ review_status: 'PENDING' })).toBe(true)
  })
  it('is true when confidence is present and below 0.7', () => {
    expect(needsReview({ review_status: 'auto_extracted', confidence: 0.5 })).toBe(true)
    expect(needsReview({ review_status: 'confirmed', confidence: 0.69 })).toBe(true)
  })
  it('is false for high-confidence confirmed rows', () => {
    expect(needsReview({ review_status: 'confirmed', confidence: 0.95 })).toBe(false)
    expect(needsReview({ review_status: 'auto_extracted', confidence: 0.7 })).toBe(false)
  })
  it('is false when confidence is null and status is not a review state', () => {
    expect(needsReview({ review_status: 'confirmed', confidence: null })).toBe(false)
    expect(needsReview({ review_status: 'rejected' })).toBe(false)
  })
})

describe('summariseScans', () => {
  const rows = [
    { review_status: 'confirmed', confidence: 0.95 },
    { review_status: 'confirmed', confidence: 0.8 },
    { review_status: 'auto_extracted', confidence: 0.5 }, // needs review (low conf)
    { review_status: 'needs_review', confidence: 0.99 },  // needs review (status)
    { review_status: 'pending', confidence: null },       // needs review (status)
    { review_status: 'rejected', confidence: 0.2 },
  ]
  it('counts totals and each status', () => {
    const s = summariseScans(rows)
    expect(s.totalScans).toBe(6)
    expect(s.confirmedCount).toBe(2)
    expect(s.rejectedCount).toBe(1)
    expect(s.autoExtractedCount).toBe(1)
  })
  it('counts the needs-review queue across status and low confidence', () => {
    // rows 3 (0.5) + 4 (needs_review) + 5 (pending) + 6 (0.2, below threshold) = 4
    expect(summariseScans(rows).needsReviewCount).toBe(4)
  })
  it('averages only present confidences', () => {
    const s = summariseScans(rows)
    // (0.95 + 0.8 + 0.5 + 0.99 + 0.2) / 5 = 0.688
    expect(s.avgConfidence).toBeCloseTo(0.688, 5)
  })
  it('returns null avg when no confidences present', () => {
    expect(summariseScans([{ review_status: 'pending' }]).avgConfidence).toBeNull()
  })
  it('handles empty / non-array input', () => {
    const s = summariseScans([])
    expect(s.totalScans).toBe(0)
    expect(s.avgConfidence).toBeNull()
    expect(summariseScans(null).totalScans).toBe(0)
  })
})

describe('byType', () => {
  const rows = [
    { scan_type: 'tyre_sidewall', review_status: 'confirmed' },
    { scan_type: 'tyre_sidewall', review_status: 'pending' },
    { scan_type: 'dot_code', review_status: 'confirmed' },
    { scan_type: 'dot_code', review_status: 'confirmed' },
    { scan_type: 'vin', review_status: 'rejected' },
  ]
  it('counts per type with confirmed sub-count, sorted by count desc', () => {
    const out = byType(rows)
    expect(out[0]).toEqual({ scan_type: 'dot_code', count: 2, confirmed: 2 })
    expect(out[1]).toEqual({ scan_type: 'tyre_sidewall', count: 2, confirmed: 1 })
    expect(out[2]).toEqual({ scan_type: 'vin', count: 1, confirmed: 0 })
  })
  it('breaks count ties alphabetically', () => {
    const out = byType(rows)
    expect(out[0].scan_type).toBe('dot_code')
    expect(out[1].scan_type).toBe('tyre_sidewall')
  })
  it('falls back to "other" for missing type', () => {
    const out = byType([{ review_status: 'pending' }, { scan_type: '', review_status: 'pending' }])
    expect(out).toEqual([{ scan_type: 'other', count: 2, confirmed: 0 }])
  })
  it('handles empty input', () => {
    expect(byType([])).toEqual([])
  })
})

describe('byBand', () => {
  it('counts each confidence band and always returns all keys', () => {
    const out = byBand([
      { confidence: 0.95 },
      { confidence: 0.9 },
      { confidence: 0.75 },
      { confidence: 0.3 },
      { confidence: null },
      {},
    ])
    expect(out).toEqual({ high: 2, medium: 1, low: 1, unknown: 2 })
  })
  it('returns zeros for empty input', () => {
    expect(byBand([])).toEqual({ high: 0, medium: 0, low: 0, unknown: 0 })
  })
})
