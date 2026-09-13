import { describe, it, expect, vi, afterEach } from 'vitest'

// resolvePeriod has no I/O, but the module it lives in imports the real
// Supabase client at module scope - stub it out so importing the module
// never touches env vars or the network.
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({}) } }))

const { resolvePeriod } = await import('../lib/api/scheduledReports')

const ORIGINAL_TZ = process.env.TZ

function setClock(isoUtc, tz) {
  process.env.TZ = tz
  vi.useFakeTimers()
  vi.setSystemTime(new Date(isoUtc))
}

afterEach(() => {
  vi.useRealTimers()
  process.env.TZ = ORIGINAL_TZ
})

describe('resolvePeriod - "Yesterday" must never collide with today', () => {
  // Regression guard for the bug reported live: picking "Yesterday" returned
  // TODAY's date. Root cause was the old `iso()` helper converting through
  // toISOString() (UTC), so in any timezone west of UTC - during local
  // evening hours - "now"'s UTC calendar day was already tomorrow, and
  // subtracting one day landed back on today's own local date.
  it('west-of-UTC timezone, late evening: yesterday resolves to yesterday, not today', () => {
    // 2026-09-12 23:30 America/New_York local time (2026-09-13T03:30:00Z UTC).
    setClock('2026-09-13T03:30:00.000Z', 'America/New_York')
    const today = resolvePeriod('last_7')
    const yest = resolvePeriod('yesterday')

    expect(today.to).toBe('2026-09-12')
    expect(yest.from).toBe('2026-09-11')
    expect(yest.to).toBe('2026-09-11')
    // The failure mode being guarded against, stated explicitly.
    expect(yest.to).not.toBe(today.to)
    expect(yest.label).toContain('11')
  })

  it('east-of-UTC timezone (this app\'s own GCC region), early morning: still correct', () => {
    // 2026-09-13 01:00 Asia/Riyadh local time (2026-09-12T22:00:00Z UTC) -
    // the old UTC-day boundary would have shown "the day before yesterday".
    setClock('2026-09-12T22:00:00.000Z', 'Asia/Riyadh')
    const today = resolvePeriod('last_7')
    const yest = resolvePeriod('yesterday')

    expect(today.to).toBe('2026-09-13')
    expect(yest.from).toBe('2026-09-12')
    expect(yest.to).toBe('2026-09-12')
  })

  it('from and to are the same single day, and it is always one calendar day before today', () => {
    // 2026-09-13 15:00 Asia/Riyadh local time.
    setClock('2026-09-13T12:00:00.000Z', 'Asia/Riyadh')
    const yest = resolvePeriod('yesterday')
    expect(yest.from).toBe(yest.to)
    expect(yest.from).toBe('2026-09-12')
  })
})

describe('resolvePeriod - other windows still end on today, not tomorrow', () => {
  it('last_30 / mtd / ytd all resolve "to" to the local today', () => {
    setClock('2026-09-13T03:30:00.000Z', 'America/New_York') // local: 2026-09-12 23:30
    for (const p of ['last_7', 'last_30', 'last_90', 'mtd', 'ytd']) {
      expect(resolvePeriod(p).to).toBe('2026-09-12')
    }
  })
})
