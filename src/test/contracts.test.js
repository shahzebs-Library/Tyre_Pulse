import { describe, it, expect } from 'vitest'
import {
  contractStatus,
  summarizeContracts,
  daysUntilEnd,
  EXPIRING_SOON_DAYS,
} from '../lib/contracts'

// Fixed reference clock so every assertion is deterministic.
const NOW = Date.UTC(2026, 6, 12, 12, 0, 0) // 2026-07-12T12:00:00Z
const daysFromNow = (n) => new Date(NOW + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

describe('contractStatus', () => {
  it('returns unknown for non-objects', () => {
    expect(contractStatus(null, NOW)).toBe('unknown')
    expect(contractStatus(undefined, NOW)).toBe('unknown')
    expect(contractStatus('x', NOW)).toBe('unknown')
  })

  it('respects explicit cancelled / pending status', () => {
    expect(contractStatus({ status: 'cancelled', end_date: daysFromNow(365) }, NOW)).toBe('cancelled')
    expect(contractStatus({ status: 'pending', end_date: daysFromNow(365) }, NOW)).toBe('pending')
  })

  it('derives expired when the end date is in the past', () => {
    expect(contractStatus({ status: 'active', end_date: daysFromNow(-1) }, NOW)).toBe('expired')
    expect(contractStatus({ status: 'active', end_date: daysFromNow(-100) }, NOW)).toBe('expired')
  })

  it('derives expiring-soon within the threshold window', () => {
    expect(contractStatus({ end_date: daysFromNow(10) }, NOW)).toBe('expiring-soon')
    expect(contractStatus({ end_date: daysFromNow(EXPIRING_SOON_DAYS) }, NOW)).toBe('expiring-soon')
  })

  it('derives active beyond the threshold window', () => {
    expect(contractStatus({ end_date: daysFromNow(EXPIRING_SOON_DAYS + 5) }, NOW)).toBe('active')
    expect(contractStatus({ end_date: daysFromNow(365) }, NOW)).toBe('active')
  })

  it('a contract stays active on its final day', () => {
    expect(contractStatus({ end_date: daysFromNow(0) }, NOW)).toBe('expiring-soon')
  })

  it('honours a custom expiring-soon window', () => {
    expect(contractStatus({ end_date: daysFromNow(20) }, NOW, { expiringSoonDays: 10 })).toBe('active')
    expect(contractStatus({ end_date: daysFromNow(5) }, NOW, { expiringSoonDays: 10 })).toBe('expiring-soon')
  })

  it('falls back to stored status when no end date is present', () => {
    expect(contractStatus({ status: 'active' }, NOW)).toBe('active')
    expect(contractStatus({ status: 'expired' }, NOW)).toBe('expired')
    expect(contractStatus({}, NOW)).toBe('active')
  })
})

describe('daysUntilEnd', () => {
  it('returns null without a parseable end date', () => {
    expect(daysUntilEnd({}, NOW)).toBeNull()
    expect(daysUntilEnd({ end_date: 'not-a-date' }, NOW)).toBeNull()
  })
  it('is positive for future and negative for past', () => {
    expect(daysUntilEnd({ end_date: daysFromNow(30) }, NOW)).toBe(30)
    expect(daysUntilEnd({ end_date: daysFromNow(-5) }, NOW)).toBeLessThan(0)
  })
})

describe('summarizeContracts', () => {
  const rows = [
    { id: '1', status: 'active', end_date: daysFromNow(365), value: 100000 },
    { id: '2', status: 'active', end_date: daysFromNow(30), value: 50000 }, // expiring-soon
    { id: '3', status: 'active', end_date: daysFromNow(5), value: 20000 },  // expiring-soon
    { id: '4', status: 'active', end_date: daysFromNow(-10), value: 999 },  // expired
    { id: '5', status: 'cancelled', end_date: daysFromNow(200), value: 777 },
    { id: '6', status: 'pending', end_date: daysFromNow(400), value: 10000 },
  ]

  it('handles empty / invalid input', () => {
    const s = summarizeContracts([], NOW)
    expect(s.total).toBe(0)
    expect(s.totalValue).toBe(0)
    expect(s.expiringSoon).toEqual([])
    expect(summarizeContracts(null, NOW).total).toBe(0)
  })

  it('counts each lifecycle band', () => {
    const s = summarizeContracts(rows, NOW)
    expect(s.total).toBe(6)
    expect(s.active).toBe(1)
    expect(s.expiringSoonCount).toBe(2)
    expect(s.expired).toBe(1)
    expect(s.counts.cancelled).toBe(1)
    expect(s.counts.pending).toBe(1)
  })

  it('totals value only for live (active/expiring/pending) contracts', () => {
    const s = summarizeContracts(rows, NOW)
    // 100000 + 50000 + 20000 + 10000 (pending) — excludes expired 999 and cancelled 777
    expect(s.totalValue).toBe(180000)
  })

  it('lists expiring-soon contracts soonest-first with daysRemaining', () => {
    const s = summarizeContracts(rows, NOW)
    expect(s.expiringSoon.map((c) => c.id)).toEqual(['3', '2'])
    expect(s.expiringSoon[0].daysRemaining).toBe(5)
    expect(s.expiringSoon[1].daysRemaining).toBe(30)
  })

  it('ignores non-numeric values in the total', () => {
    const s = summarizeContracts(
      [{ status: 'active', end_date: daysFromNow(365), value: 'abc' }, { status: 'active', end_date: daysFromNow(365), value: 500 }],
      NOW,
    )
    expect(s.totalValue).toBe(500)
  })
})
