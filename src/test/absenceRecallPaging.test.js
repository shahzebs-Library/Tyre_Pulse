import { describe, it, expect, vi, beforeEach } from 'vitest'

// Pins three behaviours with an in-memory PostgREST stand-in that, like the real
// server, caps EVERY response at 1,000 rows whatever `.limit()` asks for:
//   1. the Workshop Absence roster and attendance are paged past 1,000 rows with
//      a stable id tiebreak (no row dropped or repeated at a page boundary);
//   2. a check-in is bucketed on the SITE's local day, not the UTC day;
//   3. the Recall register is paged and follows the active country null-safely.
// Each assertion fails on the code before this branch (verified by running it
// against origin/main's versions of the files).

const CAP = 1000
const h = vi.hoisted(() => ({ db: {}, calls: [] }))

vi.mock('../lib/supabase', () => {
  const cmp = (a, b) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0)
  function from(table) {
    const st = { f: [], order: [], range: null, limit: null, or: [] }
    const b = {
      select: () => b,
      eq: (c, v) => { st.f.push((r) => String(r[c]) === String(v)); return b },
      gte: (c, v) => { st.f.push((r) => r[c] != null && String(r[c]) >= String(v)); return b },
      lte: (c, v) => { st.f.push((r) => r[c] != null && String(r[c]) <= String(v)); return b },
      lt: (c, v) => { st.f.push((r) => r[c] != null && String(r[c]) < String(v)); return b },
      or: (e) => {
        st.or.push(e)
        const parts = e.split(',').map((p) => { const [c, op, ...v] = p.split('.'); return [c, op, v.join('.')] })
        st.f.push((r) => parts.some(([c, op, v]) => (op === 'eq' ? String(r[c]) === v : op === 'is' ? r[c] == null : false)))
        return b
      },
      order: (c, o = {}) => { st.order.push([c, o.ascending !== false]); return b },
      range: (a, z) => { st.range = [a, z]; return b },
      limit: (n) => { st.limit = n; return b },
      then(ok, ko) {
        h.calls.push({ table, order: st.order.map((o) => o[0]), range: st.range, or: st.or })
        let out = (h.db[table] || []).filter((r) => st.f.every((f) => f(r)))
        out.sort((x, y) => { for (const [c, asc] of st.order) { const d = cmp(x[c], y[c]); if (d) return asc ? d : -d } return 0 })
        if (st.range) out = out.slice(st.range[0], st.range[1] + 1)
        if (st.limit != null) out = out.slice(0, st.limit)
        return Promise.resolve({ data: out.slice(0, CAP), error: null }).then(ok, ko)
      },
    }
    return b
  }
  return { supabase: { from } }
})

const { loadAbsenceData } = await import('../lib/api/workshopAbsence')
const { listRecalls } = await import('../lib/api/recalls')
const { summarizeAttendance } = await import('../lib/workshopAbsence')

beforeEach(() => { h.calls = []; h.db = {} })

const days = Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`)

describe('Workshop Absence loader pages past the 1,000-row cap', () => {
  it('returns every shift and attendance row exactly once across page boundaries', async () => {
    // 250 shifts share each shift_date: a page boundary falls INSIDE a tie, which
    // drops or repeats rows unless the order carries the id tiebreak.
    const shifts = []
    const attendance = []
    for (const d of days) {
      for (let p = 0; p < 250; p++) {
        const id = `s-${d}-${String(p).padStart(3, '0')}`
        shifts.push({ id, person_name: `P${p}`, shift_date: d, start_time: '08:00', site: 'NHC', status: 'Scheduled', country: 'KSA' })
        attendance.push({ id: `a-${d}-${String(p).padStart(3, '0')}`, user_id: `u${p}`, shift_id: id, check_in: `${d}T04:50:00Z`, site: 'NHC', country: 'KSA' })
      }
    }
    // Shuffle so the store order does not happen to match the requested order.
    shifts.reverse()
    h.db = { shifts, workshop_attendance: attendance, profiles: [] }

    const res = await loadAbsenceData({ from: '2026-11-01', to: '2026-11-10', country: 'KSA' })
    expect(res.shifts).toHaveLength(2500)
    expect(new Set(res.shifts.map((s) => s.id)).size).toBe(2500)
    expect(res.attendance).toHaveLength(2500)
    expect(new Set(res.attendance.map((a) => a.id)).size).toBe(2500)

    const shiftCalls = h.calls.filter((c) => c.table === 'shifts')
    expect(shiftCalls.every((c) => c.range && c.order.join() === 'shift_date,id')).toBe(true)
    expect(shiftCalls.every((c) => c.or[0] === 'country.eq.KSA,country.is.null')).toBe(true)
  })

  it('reads a check-in made just after local midnight that a UTC-day bound would miss', async () => {
    // 21:45Z on 31 Oct is 00:45 on 1 Nov in Riyadh: inside a window that starts 1 Nov.
    h.db = {
      shifts: [{ id: 's1', person_name: 'Early Omar', shift_date: '2026-11-01', start_time: '01:00', site: 'NHC', status: 'Scheduled', country: 'KSA' }],
      workshop_attendance: [{ id: 'a1', user_id: 'u1', shift_id: null, check_in: '2026-10-31T21:45:00Z', site: 'NHC', country: 'KSA' }],
      profiles: [{ id: 'u1', full_name: 'Early Omar' }],
    }
    const res = await loadAbsenceData({ from: '2026-11-01', to: '2026-11-01', country: 'KSA' })
    expect(res.attendance.map((a) => a.id)).toEqual(['a1'])
  })
})

describe('check-ins are bucketed on the site local day', () => {
  const NOW = new Date('2026-11-15T10:00:00Z')
  const shift = (id, person, date, start, country) => ({ id, person_name: person, shift_date: date, start_time: start, site: 'X', status: 'Scheduled', country })
  const att = (id, person, checkIn, country) => ({ id, person_name: person, shift_id: null, check_in: checkIn, country })

  it('KSA, UAE and Egypt check-ins straddling midnight UTC land on the local shift date', () => {
    const s = summarizeAttendance({
      now: NOW,
      from: '2026-11-01', to: '2026-11-15',
      shifts: [
        shift('k', 'Night Nadia', '2026-11-10', '02:00', 'KSA'),   // 22:30Z 9 Nov = 01:30 10 Nov Riyadh
        shift('u', 'Dubai Dan', '2026-11-10', '01:00', 'UAE'),     // 20:30Z 9 Nov = 00:30 10 Nov Dubai
        shift('e', 'Cairo Cam', '2026-11-10', '01:00', 'Egypt'),   // 22:40Z 9 Nov = 00:40 10 Nov Cairo (UTC+2)
      ],
      attendance: [
        att('a1', 'Night Nadia', '2026-11-09T22:30:00Z', 'KSA'),
        att('a2', 'Dubai Dan', '2026-11-09T20:30:00Z', 'UAE'),
        att('a3', 'Cairo Cam', '2026-11-09T22:40:00Z', 'Egypt'),
      ],
    })
    expect(s.absent).toBe(0)
    expect(s.present).toBe(3)
    expect(s.late).toBe(0)
  })

  it('the same UTC instant is late on a site whose clock is ahead', () => {
    // 05:20Z: 08:20 Riyadh (late for 08:00), 07:20 Cairo (on time).
    const s = summarizeAttendance({
      now: NOW,
      shifts: [shift('k', 'A', '2026-11-12', '08:00', 'KSA'), shift('e', 'B', '2026-11-12', '08:00', 'Egypt')],
      attendance: [
        { id: 'a', shift_id: 'k', check_in: '2026-11-12T05:20:00Z', country: 'KSA' },
        { id: 'b', shift_id: 'e', check_in: '2026-11-12T05:20:00Z', country: 'Egypt' },
      ],
    })
    expect(s.present).toBe(2)
    expect(s.late).toBe(1)
  })
})

describe('Recall register reads', () => {
  const recall = (i, country) => ({ id: `r${String(i).padStart(5, '0')}`, recall_number: `RCL-${i}`, country, created_at: '2026-10-01T08:00:00Z' })

  it('pages past 1,000 rows with an id tiebreak (no dup, no drop)', async () => {
    h.db = { recalls: Array.from({ length: 1500 }, (_, i) => recall(i, 'KSA')).reverse() }
    const rows = await listRecalls()
    expect(rows).toHaveLength(1500)
    expect(new Set(rows.map((r) => r.id)).size).toBe(1500)
    expect(h.calls.every((c) => c.order.join() === 'created_at,id' && c.range)).toBe(true)
  })

  it('All applies no country filter; a single country is null-safe', async () => {
    h.db = { recalls: [recall(1, 'KSA'), recall(2, 'UAE'), recall(3, 'Egypt'), recall(4, null)] }
    expect((await listRecalls({ country: 'All' })).map((r) => r.recall_number).sort()).toEqual(['RCL-1', 'RCL-2', 'RCL-3', 'RCL-4'])
    expect((await listRecalls()).length).toBe(4)
    expect((await listRecalls({ country: 'UAE' })).map((r) => r.recall_number).sort()).toEqual(['RCL-2', 'RCL-4'])
    expect((await listRecalls({ country: 'Egypt' })).map((r) => r.recall_number).sort()).toEqual(['RCL-3', 'RCL-4'])
  })
})
