import { describe, it, expect } from 'vitest'
import {
  confidencePct, fmtConfidence, fieldsPreview, extractedSummary, reviewQueue,
  filterScans, reviewPerformance, scanExportRows,
} from '../lib/ocrScannerAnalytics'

const NOW = new Date('2026-09-10T00:00:00Z')
const rows = [
  { id: 1, scan_type: 'dot_code', review_status: 'pending', confidence: null, created_at: '2026-09-01T00:00:00Z', asset_no: 'TM1' },
  { id: 2, scan_type: 'vin', review_status: 'auto_extracted', confidence: 0.5, created_at: '2026-09-05T00:00:00Z', extracted_text: 'ABC' },
  { id: 3, scan_type: 'vin', review_status: 'confirmed', confidence: 0.95, corrected_value: 'XYZ', image_url: 'https://x/y.jpg' },
  { id: 4, scan_type: 'document', review_status: 'rejected', confidence: 0.8 },
]

describe('ocrScannerAnalytics', () => {
  it('never renders an unscored scan as 0%', () => {
    expect(confidencePct(rows[0])).toBeNull()
    expect(fmtConfidence(null)).toBe('Not scored')
    expect(fmtConfidence(0.925)).toBe('93%')
  })

  it('summarises extraction text', () => {
    expect(fieldsPreview(null)).toBe('N/A')
    expect(fieldsPreview({ a: 1, b: 2, c: 3, d: 4 })).toBe('a: 1 | b: 2 | c: 3 +1')
    expect(extractedSummary(rows[2])).toBe('XYZ')
  })

  it('orders the review queue unscored first then lowest confidence', () => {
    expect(reviewQueue(rows).map((r) => r.id)).toEqual([1, 2])
  })

  it('filters by band, status, review need and text', () => {
    expect(filterScans(rows, { band: 'high' }).map((r) => r.id)).toEqual([3])
    expect(filterScans(rows, { review: 'needs' }).map((r) => r.id)).toEqual([1, 2])
    expect(filterScans(rows, { q: 'abc' }).map((r) => r.id)).toEqual([2])
    expect(filterScans(rows, { type: 'vin', status: 'confirmed' })).toHaveLength(1)
  })

  it('measures review performance with honest nulls', () => {
    const p = reviewPerformance(rows, NOW)
    expect(p.acceptanceRate).toBe(50)
    expect(p.correctedCount).toBe(1)
    expect(p.oldestWaitingDays).toBe(9)
    expect(p.imageCoveragePct).toBe(25)
    expect(reviewPerformance([], NOW)).toMatchObject({ acceptanceRate: null, oldestWaitingDays: null, imageCoveragePct: null })
  })

  it('exports the whole set', () => {
    const out = scanExportRows(rows, { typeLabel: { vin: 'VIN' } })
    expect(out).toHaveLength(4)
    expect(out[0].confidence_pct).toBe('Not scored')
    expect(out[2]).toMatchObject({ scan_type: 'VIN', confidence_pct: 95 })
  })
})
