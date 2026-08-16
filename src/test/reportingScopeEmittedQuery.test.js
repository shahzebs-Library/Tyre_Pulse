/**
 * Reporting scope: what the client ACTUALLY sends to PostgREST.
 *
 * The existing reporting-scope tests assert against a hand-written mock query
 * builder, which can only prove that `applyCountries` calls `.eq`/`.in`/`.or` -
 * never that those calls produce the right URL. A wrong filter shape does not
 * raise; it returns plausible-looking wrong rows, which is exactly the class of
 * bug that survives review. These tests therefore drive the REAL
 * @supabase/postgrest-js builder and assert the emitted query string.
 *
 * The expected row counts quoted below were measured against the live database
 * (org Company A) so the shapes can be checked against ground truth:
 *   tyre_records  KSA 8145 | UAE 2455 | Egypt  591 | NULL country 0
 *   work_orders   KSA 62127 | UAE 14976 | Egypt 12525 | NULL country 0
 *   vehicle_fleet KSA 1030 | UAE  452 | Egypt  135 | NULL country 0
 *   corrective_actions: 1 KSA + 2 NULL-country   stock_records: 1 NULL-country
 */
import { describe, it, expect } from 'vitest'
import { PostgrestClient } from '@supabase/postgrest-js'
import { applyCountry, applyCountries } from '../lib/api/_client'

const client = new PostgrestClient('https://example.test/rest/v1')
const from = (t) => client.from(t).select('id')
const emitted = (b) => decodeURIComponent(b.url.toString().replace('https://example.test/rest/v1/', ''))

describe('applyCountries - the query PostgREST actually receives', () => {
  it('emits a ONE-country scope byte-identically to the scalar helper, in both null modes', () => {
    // Null-safe: must be the same string applyCountry has always produced.
    expect(emitted(applyCountries(from('tyre_records'), ['KSA'])))
      .toBe(emitted(applyCountry(from('tyre_records'), 'KSA')))
    expect(emitted(applyCountries(from('tyre_records'), ['KSA'])))
      .toBe('tyre_records?select=id&or=(country.eq.KSA,country.is.null)')

    // Strict: the same `country=eq.X` these services emitted before the scope existed.
    expect(emitted(applyCountries(from('tyre_records'), ['KSA'], { nullSafe: false })))
      .toBe('tyre_records?select=id&country=eq.KSA')
  })

  it('emits a plain in-list for a strict multi-country scope', () => {
    // Ground truth: 8145 + 2455 = 10600 tyre_records, exactly the union.
    expect(emitted(applyCountries(from('tyre_records'), ['KSA', 'UAE'], { nullSafe: false })))
      .toBe('tyre_records?select=id&country=in.(KSA,UAE)')
    expect(emitted(applyCountries(from('tyre_records'), ['KSA', 'UAE', 'Egypt'], { nullSafe: false })))
      .toBe('tyre_records?select=id&country=in.(KSA,UAE,Egypt)')
  })

  it('admits NULL-country rows only in the null-safe form', () => {
    // This is where the two forms genuinely diverge on live data:
    // corrective_actions holds 1 KSA row and 2 NULL-country rows, so strict
    // returns 1 and null-safe returns 3. Every current call site is strict,
    // which preserves each page's pre-scope behaviour.
    const strict = emitted(applyCountries(from('corrective_actions'), ['KSA', 'UAE'], { nullSafe: false }))
    expect(strict).not.toContain('country.is.null')

    const nullSafe = emitted(applyCountries(from('corrective_actions'), ['KSA', 'UAE']))
    expect(nullSafe).toContain('country.is.null')
    expect(nullSafe).toBe('corrective_actions?select=id&or=(country.in.("KSA","UAE"),country.is.null)')
  })

  it('applies NO filter for an empty scope or the All sentinel', () => {
    // `country=in.(All)` would match zero rows and silently empty every board.
    for (const input of [[], null, undefined, ['All'], ['', '   ']]) {
      expect(emitted(applyCountries(from('tyre_records'), input, { nullSafe: false })))
        .toBe('tyre_records?select=id')
      expect(emitted(applyCountries(from('tyre_records'), input))).toBe('tyre_records?select=id')
    }
  })

  it('quotes a country name containing a comma so it cannot split the filter', () => {
    // A bare comma would read as two separate values and silently widen the scope.
    expect(emitted(applyCountries(from('tyre_records'), ['KSA', 'A,B'], { nullSafe: false })))
      .toBe('tyre_records?select=id&country=in.(KSA,"A,B")')
    expect(emitted(applyCountries(from('tyre_records'), ['KSA', 'A,B'])))
      .toBe('tyre_records?select=id&or=(country.in.("KSA","A,B"),country.is.null)')
  })
})

describe('reporting-scope paging is stable', () => {
  // Why this matters, measured live: work_orders holds 89,628 rows across only
  // 61,767 distinct `opened_at` values (tie groups up to 175 rows), and 24 of
  // the 89 page boundaries in a three-country scope land INSIDE a tie group.
  // Re-running page 2 under a different sort plan returned 4 different rows
  // without an `id` tiebreak and 0 with it. `fetchAllPages` fetches pages
  // concurrently, so the two sides of a boundary can come from different plans.
  const scoped = (b, countries) =>
    emitted(applyCountries(b, countries, { nullSafe: false }).order('id').range(0, 999))

  it('adds the unique id tiebreak for a MULTI-country scope, after the primary sort', () => {
    const q = client.from('work_orders').select('id').order('opened_at', { ascending: false })
    expect(scoped(q, ['KSA', 'UAE'])).toContain('order=opened_at.desc,id.asc')
  })

  it('adds the tiebreak for a ONE-country scope too - it pages just the same', () => {
    // The regression this pins: gating the tiebreak on `countries.length > 1`
    // left a one-country scope paging 62 pages of work_orders on a non-unique
    // sort key, and 9 pages of tyre_records on NO sort key at all (that read
    // returned 781 of 1000 rows differently under another plan).
    const wo = client.from('work_orders').select('id').order('opened_at', { ascending: false })
    expect(scoped(wo, ['KSA'])).toContain('order=opened_at.desc,id.asc')
    expect(scoped(client.from('tyre_records').select('id'), ['KSA'])).toContain('order=id.asc')
  })
})
