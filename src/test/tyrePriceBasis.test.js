import { describe, it, expect } from 'vitest'
import { priceBasisNote } from '../lib/api/tyrePriceBackfill'

/**
 * Cost per km is only as sound as its price input. Measured on the live fleet:
 * of 11,132 tyres, 6,832 carry a price - but 2,989 of those were filled by the
 * backfill engine from a COMPARABLE tyre, so only 3,843 (34.5%) rest on a price
 * anyone actually paid. Nothing on screen said so, which lets an estimate read
 * as a measurement.
 *
 * These pin that the qualification appears when it is warranted and stays
 * silent when it is not - a note that fires on a clean fleet is noise, and a
 * note that fires on unknown data is a claim we cannot support.
 */
describe('priceBasisNote', () => {
  it('states the estimated share and what it means for cost per km', () => {
    const note = priceBasisNote({ total: 11132, priced: 6832, estimated: 2989, real: 3843 })
    expect(note).toContain('6,832')
    expect(note).toContain('2,989')
    // it must name the consequence, not just the counts
    expect(note).toMatch(/indicative/i)
    // and the tyres with no price at all are part of the honest picture
    expect(note).toContain('4,300')
  })

  it('says nothing when every price is real', () => {
    expect(priceBasisNote({ total: 100, priced: 100, estimated: 0, real: 100 })).toBe('')
  })

  it('says nothing when the basis could not be read', () => {
    // null counts mean "we could not look" - that must never render as
    // "none are estimated"
    expect(priceBasisNote({ total: null, priced: null, estimated: null, real: null })).toBe('')
    expect(priceBasisNote(null)).toBe('')
    expect(priceBasisNote({ priced: 500, estimated: null })).toBe('')
  })

  it('says nothing when no tyre is priced at all', () => {
    expect(priceBasisNote({ total: 900, priced: 0, estimated: 0, real: 0 })).toBe('')
  })
})
