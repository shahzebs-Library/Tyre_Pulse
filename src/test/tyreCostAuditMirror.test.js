import { describe, expect, it } from 'vitest'
import { lineKind } from '../lib/tyreCostAudit'
import fixture from './fixtures/tyreCostLineKinds.json'

/**
 * The JS half of the line-kind mirror. The SQL half lives in
 * supabase/tests/tyre_cost_audit.test.mjs, which runs public.tyre_cost_line_kind()
 * (migration 20261112106000) over the SAME fixture. Both read
 * src/test/fixtures/tyreCostLineKinds.json; both must return the fixture kind for
 * every row, which is how JS lineKind and the SQL classifier are kept a faithful
 * mirror of each other. Add a case -> run `npm test -- tyreCostAuditMirror` AND
 * `node --test supabase/tests/tyre_cost_audit.test.mjs`.
 */
describe('lineKind mirrors SQL tyre_cost_line_kind over the shared fixture', () => {
  it('classifies every fixture line exactly as the fixture declares', () => {
    const wrong = fixture.cases
      .map((c) => ({ ...c, got: lineKind(c.description) }))
      .filter((c) => c.got !== c.kind)
    expect(wrong).toEqual([])
  })

  it('covers all nine line kinds (a shrunken fixture must not pass vacuously)', () => {
    const kinds = new Set(fixture.cases.map((c) => c.kind))
    for (const k of ['tyre', 'tube', 'flap', 'valve', 'service', 'repair', 'warranty', 'mixed', 'other']) {
      expect(kinds.has(k)).toBe(true)
    }
    expect(fixture.cases.length).toBeGreaterThanOrEqual(40)
  })
})
