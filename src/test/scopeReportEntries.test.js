/**
 * scopeReportEntries / scopeRefusedCountries - assembling a multi-country deep
 * report out of the per-country blocks the V544 `*_multi` aggregates return.
 *
 * The single rule these exist to keep: a multi-country report is N single-country
 * reports side by side, never one wider report. So the assembler NEVER combines
 * anything - it only routes each country's own payload to its own block. These
 * tests pin the ways that could quietly go wrong: a country losing its block, a
 * country picking up another country's figures, a missing part reading as zero,
 * and the scope's order being decided by whichever aggregate answered first.
 */
import { describe, it, expect } from 'vitest'
import { scopeReportEntries, scopeRefusedCountries } from '../lib/boardScope'

const block = (country, result) => ({ country, currency: null, result })

describe('scopeReportEntries', () => {
  it('gives every country in scope its own block, in scope order', () => {
    const entries = scopeReportEntries(['KSA', 'UAE', 'Egypt'], {
      snap: [block('UAE', { t: 2 }), block('Egypt', { t: 3 }), block('KSA', { t: 1 })],
    })
    // The payloads arrived in a different order than the scope; the report must
    // still read in the order the reader chose.
    expect(entries.map((e) => e.country)).toEqual(['KSA', 'UAE', 'Egypt'])
    expect(entries.map((e) => e.snap.t)).toEqual([1, 2, 3])
  })

  it('stamps each entry with that country own currency, never a shared one', () => {
    const entries = scopeReportEntries(['KSA', 'UAE', 'Egypt'], {})
    expect(entries.map((e) => e.currency)).toEqual(['SAR', 'AED', 'EGP'])
  })

  it('never lets one country payload land on another country', () => {
    const entries = scopeReportEntries(['KSA', 'UAE'], {
      snap: [block('KSA', { total: 1000 }), block('UAE', { total: 2000 })],
    })
    expect(entries[0].snap.total).toBe(1000)
    expect(entries[1].snap.total).toBe(2000)
  })

  it('matches a country case-insensitively so a spelling difference cannot blank a block', () => {
    const entries = scopeReportEntries(['KSA'], { snap: [block('ksa', { total: 7 })] })
    expect(entries[0].snap.total).toBe(7)
  })

  it('keeps a country whose part is missing, with that part null rather than zero', () => {
    // "This country reported nothing for this panel" and "this country was left
    // out of the report" are different statements. A zero here would read as a
    // measured absence of cost.
    const entries = scopeReportEntries(['KSA', 'UAE'], { snap: [block('KSA', { total: 5 })] })
    expect(entries).toHaveLength(2)
    expect(entries[1].country).toBe('UAE')
    expect(entries[1].snap).toBeNull()
  })

  it('assembles several aggregates into one entry per country', () => {
    const entries = scopeReportEntries(['KSA', 'UAE'], {
      snap: [block('KSA', { s: 1 }), block('UAE', { s: 2 })],
      overview: [block('KSA', { o: 1 })],
      variance: [block('UAE', { v: 2 })],
    })
    expect(entries[0]).toMatchObject({ country: 'KSA', snap: { s: 1 }, overview: { o: 1 }, variance: null })
    expect(entries[1]).toMatchObject({ country: 'UAE', snap: { s: 2 }, overview: null, variance: { v: 2 } })
  })

  it('reports on nothing when the scope is empty', () => {
    expect(scopeReportEntries([], { snap: [block('KSA', { s: 1 })] })).toEqual([])
    expect(scopeReportEntries(null, {})).toEqual([])
  })

  it('ignores a block for a country that is not in scope', () => {
    // The scope is the report. A payload naming a country the reader did not
    // select must not appear, even though the server was entitled to return it.
    const entries = scopeReportEntries(['KSA'], {
      snap: [block('KSA', { s: 1 }), block('Egypt', { s: 9 })],
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].country).toBe('KSA')
  })

  it('produces no combined figure of any kind', () => {
    const entries = scopeReportEntries(['KSA', 'UAE'], {
      snap: [block('KSA', { total: 1000 }), block('UAE', { total: 2000 })],
    })
    // Nothing on the assembled shape is a scope-level number: every value sits
    // inside a country, so no caller can reach an added total by accident.
    const keys = new Set(entries.flatMap((e) => Object.keys(e)))
    expect([...keys].sort()).toEqual(['country', 'currency', 'snap'])
  })
})

describe('scopeRefusedCountries', () => {
  it('folds the refusals of several payloads, de-duplicated', () => {
    expect(scopeRefusedCountries(
      { refused: ['UAE', 'Egypt'] },
      { refused: ['UAE'] },
      { refused: ['egypt'] },
    )).toEqual(['UAE', 'Egypt'])
  })

  it('is empty when nothing was refused, and survives a missing payload', () => {
    expect(scopeRefusedCountries({ refused: [] }, null, undefined, {})).toEqual([])
    expect(scopeRefusedCountries()).toEqual([])
  })
})
