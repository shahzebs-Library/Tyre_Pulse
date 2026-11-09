import { describe, it, expect, vi } from 'vitest'
import {
  accountDay, parseInstant, CATEGORY_META, CATEGORY_GROUPS, ENTRY_CATEGORIES, REASON_CATEGORIES, categoryLabel,
} from '../lib/workforceTimeAccounting'

const NOW = '2026-11-09T12:00:00Z'
const R = (d, hm) => `${d}T${hm}:00+03:00` // Riyadh, fixed +03:00, no DST
const e = (from, to, over = {}) => ({ category: 'productive', started_at: from, ended_at: to, ...over })
const D = '2026-11-01'

describe('catalogue', () => {
  it('every entry category belongs to a known group; not_recorded is synthetic', () => {
    for (const c of ENTRY_CATEGORIES) expect(CATEGORY_GROUPS).toContain(CATEGORY_META[c].group)
    expect(ENTRY_CATEGORIES).not.toContain('not_recorded')
    expect(CATEGORY_META.not_recorded.group).toBe('not_recorded')
    expect(ENTRY_CATEGORIES).toEqual(expect.arrayContaining(['travel', 'waiting_stock', 'waiting_equipment', 'vehicle_unavailable', 'safety_hold', 'blocked', 'unassigned']))
    expect(ENTRY_CATEGORIES).not.toContain('idle')
    expect(REASON_CATEGORIES.every(c => ENTRY_CATEGORIES.includes(c))).toBe(true)
    expect(categoryLabel('waiting_stock')).toBe('Waiting for stock')
    expect(categoryLabel('mystery')).toBe('mystery')
  })
})

describe('parseInstant', () => {
  it('requires an explicit offset; same instant in different offsets is equal', () => {
    expect(parseInstant('2026-11-01T08:00:00')).toBeNull()
    expect(parseInstant('2026-11-01')).toBeNull()
    expect(parseInstant(null)).toBeNull()
    expect(parseInstant('2026-11-01T08:00:00+03:00')).toBe(parseInstant('2026-11-01T05:00:00Z'))
    expect(parseInstant('2026-11-01T08:00+03:00')).toBe(parseInstant('2026-11-01T05:00:00.000Z'))
  })
})

describe('accountDay', () => {
  it('classifies minutes per category and group over a Riyadh shift', () => {
    const r = accountDay({
      now: NOW,
      shiftStart: R(D, '07:00'), shiftEnd: R(D, '16:00'),
      entries: [
        e(R(D, '07:00'), R(D, '09:00')),
        e(R(D, '09:00'), R(D, '09:30'), { category: 'travel' }),
        e(R(D, '09:30'), R(D, '10:30'), { category: 'waiting_stock' }),
        e(R(D, '10:30'), R(D, '11:00'), { category: 'break' }),
        e(R(D, '11:00'), R(D, '12:00'), { category: 'safety_hold' }),
        e(R(D, '12:00'), R(D, '13:00'), { category: 'unassigned' }),
      ],
    })
    expect(r.minutes.productive).toBe(120)
    expect(r.minutes.travel).toBe(30)
    expect(r.minutes.waiting_stock).toBe(60)
    expect(r.minutes.safety_hold).toBe(60)
    expect(r.minutes.unassigned).toBe(60)
    expect(r.groups).toEqual({ work: 120, support: 30, waiting: 180, break: 30, not_recorded: 180 })
    expect(r.shift_minutes).toBe(540)
    expect(r.recorded_minutes).toBe(360)
    expect(r.not_recorded_minutes).toBe(180)
    expect(r.coverage_pct).toBeCloseTo(66.67, 2)
    expect(r.overlaps).toEqual([])
  })

  it('missing data is not_recorded, never idle; no shift means unknown (null), not zero', () => {
    const empty = accountDay({ now: NOW, shiftStart: R(D, '07:00'), shiftEnd: R(D, '15:00'), entries: [] })
    expect(empty.minutes.not_recorded).toBe(480)
    expect(empty.minutes.unassigned).toBe(0)
    expect(empty).not.toHaveProperty('idle_minutes')
    expect(empty.warnings.find(w => w.type === 'not_recorded').message).toMatch(/not idle/)
    const noShift = accountDay({ now: NOW, entries: [e(R(D, '07:00'), R(D, '08:00'))] })
    expect(noShift.not_recorded_minutes).toBeNull()
    expect(noShift.groups.not_recorded).toBeNull()
    expect(noShift.coverage_pct).toBeNull()
    expect(noShift.recorded_minutes).toBe(60)
  })

  it('clips overlaps: earliest start keeps the shared minutes, nothing double counted', () => {
    const r = accountDay({
      now: NOW, shiftStart: R(D, '08:00'), shiftEnd: R(D, '12:00'),
      entries: [
        e(R(D, '08:00'), R(D, '10:00'), { id: 'a' }),
        e(R(D, '09:30'), R(D, '11:00'), { id: 'b', category: 'coordination' }),
        e(R(D, '08:30'), R(D, '09:00'), { id: 'c', category: 'break' }), // fully inside a
      ],
    })
    expect(r.minutes.productive).toBe(120)
    expect(r.minutes.coordination).toBe(60)
    expect(r.minutes.break).toBe(0)
    expect(r.recorded_minutes).toBe(180)
    expect(r.not_recorded_minutes).toBe(60)
    expect(r.overlap_minutes).toBe(60)
    expect(r.overlaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'b', with_id: 'a', minutes: 30 }),
      expect.objectContaining({ id: 'c', with_id: 'a', minutes: 30 }),
    ]))
    expect(r.warnings.filter(w => w.type === 'overlap')).toHaveLength(2)
  })

  it('back-to-back entries do not overlap; the same instant in another offset does', () => {
    const r = accountDay({ now: NOW, entries: [e(R(D, '08:00'), R(D, '09:00')), e(R(D, '09:00'), R(D, '10:00'))] })
    expect(r.overlaps).toEqual([])
    expect(r.recorded_minutes).toBe(120)
    const z = accountDay({ now: NOW, entries: [e(R(D, '08:00'), R(D, '09:00')), e(`${D}T05:00:00Z`, `${D}T06:00:00Z`)] })
    expect(z.recorded_minutes).toBe(60)
    expect(z.overlap_minutes).toBe(60)
  })

  it('duplicate rows (same id) are counted once', () => {
    const row = e(R(D, '08:00'), R(D, '09:00'), { id: 'x' })
    const r = accountDay({ now: NOW, entries: [row, { ...row }] })
    expect(r.recorded_minutes).toBe(60)
    expect(r.warnings.some(w => w.type === 'duplicate_entry')).toBe(true)
    expect(r.overlaps).toEqual([])
  })

  it('impossible and ambiguous intervals are excluded and reported', () => {
    const r = accountDay({
      now: NOW,
      entries: [
        e(R(D, '10:00'), R(D, '10:00')),
        e(R(D, '11:00'), R(D, '10:00')),
        e(R(D, '01:00'), R('2026-11-01', '17:30')),
        e('2026-11-01T08:00:00', '2026-11-01T09:00:00'),
        e('2026-11-09T12:00:00Z', '2026-11-09T13:00:00Z'),
        e(R(D, '12:00'), R(D, '13:00'), { category: 'idle' }),
        null,
      ],
    })
    const types = r.warnings.map(w => w.type)
    expect(types.filter(t => t === 'invalid_interval')).toHaveLength(3)
    expect(types).toEqual(expect.arrayContaining(['too_long', 'future', 'unknown_category', 'invalid_entry']))
    expect(r.recorded_minutes).toBe(0)
    expect(r.excluded_entries).toBe(7)
  })

  it('accepts an interval exactly 16h long and within the 5 minute future tolerance', () => {
    const r = accountDay({ now: '2026-11-02T00:00:00Z', entries: [e(`${D}T07:00:00Z`, `${D}T23:00:00Z`), e('2026-11-01T23:30:00Z', '2026-11-02T00:04:00Z', { category: 'reporting' })] })
    expect(r.recorded_minutes).toBe(16 * 60 + 34)
    expect(r.excluded_entries).toBe(0)
  })

  it('handles a night shift that crosses midnight (Riyadh)', () => {
    const r = accountDay({
      now: NOW, shiftStart: R(D, '22:00'), shiftEnd: R('2026-11-02', '06:00'),
      entries: [
        e(R(D, '22:00'), R('2026-11-02', '01:00')),
        e(R('2026-11-02', '01:00'), R('2026-11-02', '01:30'), { category: 'break' }),
        e(R('2026-11-02', '05:00'), R('2026-11-02', '07:00'), { category: 'reporting' }),
      ],
    })
    expect(r.shift_minutes).toBe(480)
    expect(r.recorded_minutes).toBe(330)
    expect(r.recorded_in_shift_minutes).toBe(270)
    expect(r.outside_shift_minutes).toBe(60)
    expect(r.not_recorded_minutes).toBe(210)
  })

  it('Riyadh offset has no DST: a summer and a winter shift are both exactly 9h', () => {
    for (const d of ['2026-03-29', '2026-10-25']) {
      const r = accountDay({ now: NOW, shiftStart: R(d, '07:00'), shiftEnd: R(d, '16:00'), entries: [] })
      expect(r.shift_minutes).toBe(540)
    }
  })

  it('reports an invalid shift instead of inventing coverage', () => {
    const r = accountDay({ now: NOW, shiftStart: R(D, '16:00'), shiftEnd: R(D, '07:00'), entries: [e(R(D, '08:00'), R(D, '09:00'))] })
    expect(r.shift_minutes).toBeNull()
    expect(r.not_recorded_minutes).toBeNull()
    expect(r.warnings.some(w => w.type === 'invalid_shift')).toBe(true)
    const local = accountDay({ now: NOW, shiftStart: '2026-11-01T07:00:00', shiftEnd: R(D, '16:00') })
    expect(local.shift_minutes).toBeNull()
    const long = accountDay({ now: NOW, shiftStart: R(D, '07:00'), shiftEnd: R('2026-11-02', '08:00') })
    expect(long.shift_minutes).toBeNull()
  })

  it('splits assigned (linked) work from unlinked work and reconciles against assignment progress', () => {
    const entries = [
      e(R(D, '08:00'), R(D, '10:00'), { assignment_id: 'A1' }),
      e(R(D, '10:00'), R(D, '10:30'), { assignment_id: 'A1', category: 'waiting_equipment' }),
      e(R(D, '10:30'), R(D, '11:30')),
    ]
    const ok = accountDay({ now: NOW, entries, assignmentsActiveMinutes: 110 })
    expect(ok.assignment_linked_minutes).toBe(150)
    expect(ok.assignment_active_work_minutes).toBe(120)
    expect(ok.unlinked_active_work_minutes).toBe(60)
    expect(ok.assignment_variance_minutes).toBe(10)
    expect(ok.warnings.some(w => w.type === 'assignment_time_mismatch')).toBe(false)
    const off = accountDay({ now: NOW, entries, assignmentsActiveMinutes: 200 })
    expect(off.assignment_variance_minutes).toBe(-80)
    expect(off.warnings.some(w => w.type === 'assignment_time_mismatch')).toBe(true)
    expect(accountDay({ now: NOW, entries }).assignment_variance_minutes).toBeNull()
    expect(accountDay({ now: NOW, entries, assignmentsActiveMinutes: -1 }).warnings.some(w => w.type === 'invalid_assignment_minutes')).toBe(true)
  })

  it('flags blocked time without a reason but still counts it', () => {
    const r = accountDay({ now: NOW, entries: [e(R(D, '08:00'), R(D, '09:00'), { category: 'blocked' }), e(R(D, '09:00'), R(D, '10:00'), { category: 'blocked', blocked_reason: 'No jack' })] })
    expect(r.minutes.blocked).toBe(120)
    expect(r.warnings.filter(w => w.type === 'reason_missing')).toHaveLength(1)
  })

  it('is order independent', () => {
    const entries = [e(R(D, '09:30'), R(D, '11:00'), { id: 'b' }), e(R(D, '08:00'), R(D, '10:00'), { id: 'a' })]
    const a = accountDay({ now: NOW, entries })
    const b = accountDay({ now: NOW, entries: [...entries].reverse() })
    expect(a.minutes).toEqual(b.minutes)
    expect(a.overlap_minutes).toBe(30)
  })
})

// Service wrapper: the pure module above does not touch _client, so mocking it here is isolated.
const rpc = vi.fn()
const inserts = []
let failAssignmentColumn = false
vi.mock('../lib/api/_client', async () => {
  const actual = await vi.importActual('../lib/api/_client')
  const builder = (table) => {
    const b = {
      _payload: null,
      select: () => b, eq: () => b, order: () => b, maybeSingle: () => b,
      insert: (p) => { b._payload = p; inserts.push({ table, p }); return b },
      single: () => b,
      then: (res) => {
        if (b._payload && 'assignment_id' in b._payload && failAssignmentColumn) return res({ data: null, error: { code: 'PGRST204', message: "Could not find the 'assignment_id' column" } })
        if (table === 'workforce_daily_reports') return res({ data: { id: 'r1', employee_id: 'u1', status: 'draft' }, error: null })
        return res({ data: b._payload || [], error: null })
      },
    }
    return b
  }
  return {
    ...actual,
    supabase: { from: builder, rpc: (...a) => rpc(...a), auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) } },
  }
})

describe('workforceDaily service', () => {
  it('correctDailyEntry validates inputs and calls the RPC with named args', async () => {
    const { correctDailyEntry } = await import('../lib/api/workforceDaily')
    await expect(correctDailyEntry('e1', {}, 'reason here', 'key-12345')).rejects.toThrow(/Nothing to correct/)
    await expect(correctDailyEntry('e1', { title: 'x' }, 'no', 'key-12345')).rejects.toThrow(/reason/)
    await expect(correctDailyEntry('e1', { title: 'x' }, 'valid reason', 'short')).rejects.toThrow(/idempotency/)
    rpc.mockResolvedValueOnce({ data: { ok: true, correction_id: 'c1' }, error: null })
    const out = await correctDailyEntry('e1', { title: 'x' }, '  valid reason ', ' key-12345 ')
    expect(out.correction_id).toBe('c1')
    expect(rpc).toHaveBeenCalledWith('workforce_correct_daily_entry', { p_entry_id: 'e1', p_patch: { title: 'x' }, p_reason: 'valid reason', p_idempotency_key: 'key-12345' })
  })

  it('addDailyEntry keeps waiting reasons and falls back when assignment_id is not installed', async () => {
    const { addDailyEntry, DAILY_ENTRY_CATEGORIES } = await import('../lib/api/workforceDaily')
    expect(DAILY_ENTRY_CATEGORIES).toContain('safety_hold')
    inserts.length = 0
    failAssignmentColumn = true
    await addDailyEntry('2026-11-01', { title: 'Wait', category: 'waiting_stock', blocked_reason: ' PO late ', started_at: 'a', ended_at: 'b', assignment_id: 'A1' })
    const entryInserts = inserts.filter(i => i.table === 'workforce_daily_entries')
    expect(entryInserts).toHaveLength(2)
    expect(entryInserts[0].p.assignment_id).toBe('A1')
    expect(entryInserts[1].p).not.toHaveProperty('assignment_id')
    expect(entryInserts[1].p.blocked_reason).toBe('PO late')
    failAssignmentColumn = false
  })
})
