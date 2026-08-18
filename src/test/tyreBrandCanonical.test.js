import { describe, it, expect } from 'vitest'
import { normalizeBrandToken } from '../lib/tyreLearning'

/**
 * `normalizeBrandToken()` and the database's `public.tyre_brand_canonical()` are a MIRROR
 * PAIR (V588/V589). Change one and you must change the other, or the brand column drifts
 * apart from the code that reads it.
 *
 * WHY THIS EXISTS. tyre_records.brand was split seven ways - two by case (Longmarch vs
 * LONGMARCH, 910 rows; Hankook vs HANKOOK, 60) and FIVE by tab padding from the master
 * file (TEGRYS, TRIANGLE, ERACLE, PIRELLI, INFINITY). That was not merely a filter
 * dropdown offering each brand twice: get_brand_size_cpk and report_tyre_summary GROUP BY
 * the raw brand, so cost-per-km and the best-value ranking that feeds procurement were
 * computed on split populations.
 *
 * THE ORDERING TRAP LIVES ON THE SQL SIDE AND THIS FILE CANNOT CATCH IT. The obvious
 * canonical form - btrim() then collapse whitespace - is WRONG in Postgres, because
 * `btrim()` with no second argument strips SPACES ONLY: on 'TRIANGLE\t' it leaves the tab,
 * the collapse turns it into a trailing space, and you get 'TRIANGLE ' - a NEW variant
 * that SPLITS the brand instead of merging it, since a clean 'TRIANGLE' already exists.
 *
 * JavaScript's String.trim() strips ALL whitespace including tabs, so the JS
 * implementation is order-insensitive and reversing it here changes nothing. That was
 * confirmed by mutation rather than assumed: swapping the JS order left all 26 cases
 * green. So do NOT read this file as a guard on the SQL ordering - the guard for that is
 * the assertion block inside MIGRATIONS_V588, which fails the migration itself if
 * tyre_brand_canonical('TRIANGLE'||chr(9)) is not 'TRIANGLE'.
 *
 * What this file DOES pin is the shared CONTRACT - the expected canonical output for every
 * shape the two implementations must agree on. Mutation-tested: dropping the blank-token
 * rejection fails 8 cases, dropping the uppercase fails 7.
 */

const CASES = [
  // [input, expected] - each verified against the live SQL function
  ['Longmarch', 'LONGMARCH'],
  ['LONGMARCH', 'LONGMARCH'],
  ['Hankook', 'HANKOOK'],
  // the tab-padded family: collapse-then-trim, NOT trim-then-collapse
  ['TRIANGLE\t', 'TRIANGLE'],
  ['TEGRYS\t', 'TEGRYS'],
  ['ERACLE\t', 'ERACLE'],
  ['PIRELLI\t', 'PIRELLI'],
  ['INFINITY\t', 'INFINITY'],
  ['TRIANGLE\t\t', 'TRIANGLE'],
  ['\tTRIANGLE', 'TRIANGLE'],
  ['TRIANGLE\r\n', 'TRIANGLE'],
  // internal whitespace collapses to a single space
  ['  hank   ook ', 'HANK OOK'],
  ['Rock Buster', 'ROCK BUSTER'],
  // blanks and the master file's placeholder tokens are NOT brands
  ['', null],
  ['   ', null],
  ['\t', null],
  ['NULL', null],
  ['null', null],
  [' n/a ', null],
  ['-', null],
  ['UNKNOWN', null],
  [null, null],
  [undefined, null],
  // a real brand that merely CONTAINS a placeholder token must survive
  ['NONE-BRAND', 'NONE-BRAND'],
]

describe('tyre brand canonical form mirrors the database', () => {
  it.each(CASES)('%j -> %j', (input, expected) => {
    expect(normalizeBrandToken(input)).toBe(expected)
  })

  it('is idempotent - normalising twice is the same as once', () => {
    // The trigger runs on every write, including a write of an already-normalised value.
    for (const [input] of CASES) {
      const once = normalizeBrandToken(input)
      expect(normalizeBrandToken(once)).toBe(once)
    }
  })

  it('never returns a value that still needs trimming or folding', () => {
    for (const [input] of CASES) {
      const out = normalizeBrandToken(input)
      if (out == null) continue
      expect(out).toBe(out.trim())
      expect(out).toBe(out.toUpperCase())
      expect(/[\t\r\n]/.test(out), `${JSON.stringify(out)} still holds a control char`).toBe(false)
      expect(/\s{2,}/.test(out), `${JSON.stringify(out)} still holds a double space`).toBe(false)
    }
  })
})
