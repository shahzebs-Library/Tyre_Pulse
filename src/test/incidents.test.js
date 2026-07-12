import { describe, it, expect } from 'vitest'
import { summarizeIncidents, incidentAgeDays } from '../lib/incidents'

// Fixed reference clock so tests are deterministic.
const NOW = new Date('2026-07-12T00:00:00Z').getTime()

describe('summarizeIncidents', () => {
  it('counts by status and severity with an open-work total', () => {
    const rows = [
      { status: 'open', severity: 'critical' },
      { status: 'open', severity: 'low' },
      { status: 'investigating', severity: 'high' },
      { status: 'resolved', severity: 'medium' },
      { status: 'closed', severity: 'medium' },
    ]
    const s = summarizeIncidents(rows)
    expect(s.total).toBe(5)
    expect(s.byStatus).toMatchObject({ open: 2, investigating: 1, resolved: 1, closed: 1 })
    expect(s.bySeverity).toMatchObject({ low: 1, medium: 2, high: 1, critical: 1 })
    // open = open + investigating
    expect(s.open).toBe(3)
  })

  it('is null-safe and ignores unknown status/severity buckets', () => {
    const s = summarizeIncidents([{ status: 'bogus', severity: 'extreme' }, {}, null])
    expect(s.total).toBe(3)
    expect(s.open).toBe(0)
    expect(s.byStatus).toMatchObject({ open: 0, investigating: 0, resolved: 0, closed: 0 })
    expect(s.bySeverity).toMatchObject({ low: 0, medium: 0, high: 0, critical: 0 })
  })

  it('handles non-array input', () => {
    expect(summarizeIncidents(undefined).total).toBe(0)
    expect(summarizeIncidents(null).total).toBe(0)
  })
})

describe('incidentAgeDays', () => {
  it('measures whole-day age from incident_date', () => {
    expect(incidentAgeDays({ incident_date: '2026-07-02' }, NOW)).toBe(10)
    expect(incidentAgeDays({ incident_date: '2026-07-12' }, NOW)).toBe(0)
  })

  it('falls back to created_at when incident_date is absent', () => {
    expect(incidentAgeDays({ created_at: '2026-06-12T00:00:00Z' }, NOW)).toBe(30)
    // incident_date wins over created_at
    expect(incidentAgeDays({ incident_date: '2026-07-11', created_at: '2020-01-01' }, NOW)).toBe(1)
  })

  it('returns null with no usable date and clamps the future to 0', () => {
    expect(incidentAgeDays({}, NOW)).toBeNull()
    expect(incidentAgeDays({ incident_date: 'not-a-date' }, NOW)).toBeNull()
    expect(incidentAgeDays({ incident_date: '2030-01-01' }, NOW)).toBe(0)
  })
})
