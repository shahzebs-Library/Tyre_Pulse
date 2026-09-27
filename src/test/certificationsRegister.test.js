import { describe, it, expect } from 'vitest'
import {
  enrichCertifications, filterCertifications, sortCertifications, certExportRows,
  certTypeOf, CERT_EXPORT_COLUMNS,
} from '../lib/certificationsAnalytics'

const NOW = Date.parse('2026-06-01T00:00:00Z')
const ROWS = [
  { id: 1, subject_type: 'driver', subject_name: 'Ali', cert_type: 'HGV licence', expiry_date: '2026-06-10', issuer: 'MOI', created_at: '2026-01-01' },
  { id: 2, subject_type: 'vehicle', subject_name: 'TM-42', cert_type: '', expiry_date: '2025-12-01', created_at: '2026-02-01' },
  { id: 3, subject_type: 'driver', subject_name: 'Bilal', cert_type: 'ADR permit', expiry_date: '2027-01-01', created_at: '2026-03-01' },
  { id: 4, subject_type: 'site', subject_name: 'Yard', cert_type: 'Fire', expiry_date: null, created_at: '2026-04-01' },
]

describe('certifications register engine', () => {
  const enriched = enrichCertifications(ROWS, NOW)

  it('buckets a blank type as Unspecified', () => {
    expect(certTypeOf(ROWS[1])).toBe('Unspecified')
  })

  it('filters by status, subject, type, expiry bounds and text', () => {
    expect(filterCertifications(enriched, { subject: 'driver' }).map((r) => r.id)).toEqual([1, 3])
    expect(filterCertifications(enriched, { type: 'Unspecified' }).map((r) => r.id)).toEqual([2])
    expect(filterCertifications(enriched, { status: 'expired' }).map((r) => r.id)).toEqual([2])
    expect(filterCertifications(enriched, { expiryFrom: '2026-01-01', expiryTo: '2026-12-31' }).map((r) => r.id)).toEqual([1])
    expect(filterCertifications(enriched, { query: 'moi' }).map((r) => r.id)).toEqual([1])
  })

  it('never lets a row with no expiry pass an expiry bound', () => {
    expect(filterCertifications(enriched, { expiryFrom: '2000-01-01' }).map((r) => r.id)).not.toContain(4)
  })

  it('orders by the chosen sort without mutating the input', () => {
    const before = enriched.map((r) => r.id)
    expect(sortCertifications(enriched, 'subject', NOW).map((r) => r.subject_name)).toEqual(['Ali', 'Bilal', 'TM-42', 'Yard'])
    expect(sortCertifications(enriched, 'recent', NOW)[0].id).toBe(4)
    expect(enriched.map((r) => r.id)).toEqual(before)
  })

  it('exports every column, with unknown days left blank', () => {
    const out = certExportRows(enriched)
    expect(Object.keys(out[0])).toEqual(CERT_EXPORT_COLUMNS.map((c) => c.key))
    expect(out.find((r) => r.subject_name === 'Yard').days).toBe('')
  })
})
