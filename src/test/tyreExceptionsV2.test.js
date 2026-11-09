import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  EXCEPTION_KINDS, exceptionKey, kindOfKey, shapeCounts, countTotals, shapeRow, shapeRows,
  impactLabel, canReviewExceptions, rowReviewable, exportRows, EXPORT_COLUMNS, num,
} from '../lib/tyreExceptionsV2'

const SQL = readFileSync(resolve(__dirname, '../../supabase/migrations/20261110113000_tyre_exceptions_v2_reviews.sql'), 'utf8')

describe('exception kinds', () => {
  it('lists the 14 kinds the database emits, each with a rule and a group', () => {
    expect(EXCEPTION_KINDS).toHaveLength(14)
    for (const k of EXCEPTION_KINDS) {
      expect(k.rule.length).toBeGreaterThan(10)
      expect(['Identity', 'Readings', 'Cost']).toContain(k.group)
      // every kind the JS knows is accepted by the review writer and emitted by the SQL
      expect(SQL).toContain(`'${k.kind}'`)
    }
  })

  it('has no em or en dashes in user-facing text', () => {
    for (const k of EXCEPTION_KINDS) expect(`${k.label}${k.rule}`).not.toMatch(/[–—]/)
  })
})

describe('exceptionKey (mirror of the SQL)', () => {
  it('builds stable keys from ids or (country, serial), never from list positions', () => {
    expect(exceptionKey('overlapping_fitment', { id: 'a1' })).toBe('overlapping_fitment|a1')
    expect(exceptionKey('invalid_reading', { id: 'a1', reset: true })).toBe('invalid_reading|reset|a1')
    expect(exceptionKey('price_assigned_twice', { country: 'ksa ', serial: ' k507b403860' })).toBe('price_assigned_twice|KSA|K507B403860')
    expect(exceptionKey('uncertain_previous_tyre', { oldId: 'o', newId: 'n' })).toBe('uncertain_previous_tyre|o|n')
    expect(exceptionKey('rotation_not_closed', { country: 'KSA', asset: 'bh 024', serial: 'aay4425', fromPosition: 'LHF1' }))
      .toBe('rotation_not_closed|KSA|BH024|AAY4425|LHF1')
    expect(exceptionKey('duplicate_expense', { firstId: 'e1', copies: 2 })).toBe('duplicate_expense|e1|2')
  })

  it('is the same on every rerun for the same input', () => {
    const a = exceptionKey('duplicate_active', { country: 'UAE', serial: 'x123456' })
    const b = exceptionKey('duplicate_active', { country: 'UAE', serial: 'X123456' })
    expect(a).toBe(b)
  })

  it('matches the key shapes written in the SQL', () => {
    expect(SQL).toContain("'price_assigned_twice|' || upper(btrim(coalesce(p.country, ''))) || '|' || p.serial")
    expect(SQL).toContain("'uncertain_previous_tyre|' || p.old_id || '|' || p.new_id")
    expect(SQL).toContain("'invalid_reading|reset|' || r.id")
    expect(SQL).toContain("'rotation_not_closed|' || upper(btrim(coalesce(x->>'country', '')))")
  })

  it('kindOfKey reads the kind back and rejects anything else', () => {
    expect(kindOfKey('missing_site|abc')).toBe('missing_site')
    expect(kindOfKey('drop_table|x')).toBe('')
    expect(kindOfKey(null)).toBe('')
  })
})

describe('shaping', () => {
  const counts = [
    { kind: 'overlapping_fitment', country: 'KSA', n: 313, open: 312, accepted: 1, rejected: 0, deferred: 0, protected: 0 },
    { kind: 'overlapping_fitment', country: 'UAE', n: 175, open: 175, accepted: 0, rejected: 0, deferred: 0, protected: 0 },
    { kind: 'uncertain_previous_tyre', country: 'UAE', n: 14, open: 14, protected: 14 },
    { kind: 'not_a_kind', country: 'KSA', n: 9 },
  ]

  it('sums per kind and keeps the country split', () => {
    const s = shapeCounts(counts)
    expect(s.overlapping_fitment.total).toBe(488)
    expect(s.overlapping_fitment.byCountry).toEqual({ KSA: 313, UAE: 175 })
    expect(s.uncertain_previous_tyre.protected).toBe(14)
    expect(s.price_missing.total).toBe(0)
    expect(s.not_a_kind).toBeUndefined()
    expect(countTotals(s)).toMatchObject({ total: 502, open: 501, accepted: 1, protected: 14 })
  })

  it('returns null, never zeros, when the counts could not be read', () => {
    expect(shapeCounts(null)).toBeNull()
    expect(countTotals(null)).toBeNull()
  })

  it('keeps unknown numbers as null (Number(null) is 0)', () => {
    expect(num(null)).toBeNull()
    expect(num('')).toBeNull()
    expect(num('12.5')).toBe(12.5)
    const r = shapeRow({ exception_key: 'missing_site|a', kind: 'missing_site', impact_km: null, impact_cost: null, status: 'bogus' })
    expect(r.impactKm).toBeNull()
    expect(r.impactCost).toBeNull()
    expect(r.status).toBe('open')
    expect(impactLabel(r)).toBe('N/A')
  })

  it('labels impact with the row\'s own currency, never blended', () => {
    const r = shapeRow({ exception_key: 'price_assigned_twice|KSA|K507B403860', kind: 'price_assigned_twice', impact_cost: 766, currency: 'SAR', protected: true })
    expect(impactLabel(r)).toBe('766 SAR')
    expect(r.protected).toBe(true)
    expect(impactLabel(shapeRow({ kind: 'overlapping_fitment', impact_km: 41250.4 }))).toBe('41,250 km')
  })

  it('shapeRows drops junk and exportRows keeps every column', () => {
    const rows = shapeRows([null, { exception_key: 'k|1', kind: 'invalid_serial', record_ids: ['1', '2'] }])
    expect(rows).toHaveLength(1)
    const [x] = exportRows(rows)
    for (const [col] of EXPORT_COLUMNS) expect(x).toHaveProperty(col)
    expect(x.records).toBe('1 2')
    expect(x.impactCost).toBe('')
  })
})

describe('review permission', () => {
  it('only an elevated role or a super admin may review', () => {
    expect(canReviewExceptions({ role: 'Manager' })).toBe(true)
    expect(canReviewExceptions({ role: 'Director' })).toBe(true)
    expect(canReviewExceptions({ role: 'Admin' })).toBe(true)
    expect(canReviewExceptions({ role: 'Tyre Man' })).toBe(false)
    expect(canReviewExceptions({ role: 'Reporter', isSuperAdmin: true })).toBe(true)
    expect(canReviewExceptions({})).toBe(false)
  })

  it('protected rows are never reviewable, even by a super admin', () => {
    const prot = shapeRow({ exception_key: 'uncertain_previous_tyre|a|b', kind: 'uncertain_previous_tyre', protected: true })
    const free = shapeRow({ exception_key: 'uncertain_previous_tyre|c|d', kind: 'uncertain_previous_tyre', protected: false })
    expect(rowReviewable(prot, { isSuperAdmin: true })).toBe(false)
    expect(rowReviewable(free, { role: 'Manager' })).toBe(true)
    expect(rowReviewable(free, { role: 'Tyre Man' })).toBe(false)
  })
})

describe('migration guarantees (static)', () => {
  it('only ever calls the rotation closer as a dry run', () => {
    const calls = SQL.match(/tyre_close_rotations\([^)]*\)/g) || []
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c).toMatch(/^tyre_close_rotations\(true\b/i)
  })

  it('protects K507B403860 and refuses reviews of protected exceptions', () => {
    expect(SQL).toContain("'K507B403860'")
    expect(SQL).toContain('This exception is protected and stays open until the owner authorises a change')
  })

  it('writes no business table: only the review tables and the reference snapshot', () => {
    const writes = [...SQL.matchAll(/insert into (public\.[a-z_]+)/g)].map((m) => m[1])
    expect(new Set(writes)).toEqual(new Set(['public.tyre_exception_refs', 'public.tyre_exception_reviews', 'public.tyre_exception_review_events']))
    expect(SQL).not.toMatch(/\bupdate public\.(tyre_records|parts_consumption)\b/)
  })

  it('new functions are revoked from anon and pin search_path', () => {
    for (const f of ['_tyre_exception_rows(text, text)', 'get_tyre_exceptions_v2(text, text, text, integer, integer)', 'set_tyre_exception_review(text, text, text, text, text)']) {
      expect(SQL).toContain(`revoke all on function public.${f} from public, anon;`)
    }
    expect((SQL.match(/set search_path = public/g) || []).length).toBeGreaterThanOrEqual(3)
  })
})
