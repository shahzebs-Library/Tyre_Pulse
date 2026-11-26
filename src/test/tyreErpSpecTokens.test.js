// The ERP wheel spellings the shared tyre map defines exist twice: erpSpecTokens() for the
// web matcher and the GENERATED block of tyre_layout_spec_erp_tokens() for the database.
// Both come from docs/document-specs/tyre-layouts.json; this pins them together.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ERP_SPEC_LAYOUTS, erpSpecTokens, erpSpecSlots } from '../lib/tyreLayoutSpec'
import { specTokenRows, renderBlock, MIGRATION } from '../../scripts/gen-tyre-erp-spec-tokens.mjs'

describe('shared tyre map ERP spellings', () => {
  it('the SQL rows are exactly the JS rows', () => {
    const js = ERP_SPEC_LAYOUTS.flatMap((k) => erpSpecTokens(k).map((t) => [k, t.slot, t.token, t.rank]))
    expect(specTokenRows()).toEqual(js)
    expect(js.length).toBeGreaterThan(40)
  })
  it('the migration carries the current generated block', () => {
    expect(readFileSync(MIGRATION, 'utf8')).toContain(renderBlock())
  })
  it('covers both pump layouts and nothing else today', () => {
    expect([...ERP_SPEC_LAYOUTS].sort()).toEqual(['Concrete pump', 'Concrete pump 4-axle'])
  })
  it('new codes and legacy aliases both name one wheel; a map code outranks an alias', () => {
    const P = 'Concrete pump'
    expect(erpSpecSlots(P, 'LHRCO')).toEqual(['R1Lo'])
    expect(erpSpecSlots(P, 'lhco')).toEqual(['R1Lo'])
    expect(erpSpecSlots(P, 'LHRRI')).toEqual(['R2Li'])
    expect(erpSpecSlots(P, 'LHR2-I')).toEqual(['R2Li'])
    expect(erpSpecSlots(P, 'LHR1-I')).toEqual(['F3L'])
    expect(erpSpecSlots(P, 'LHR1O')).toEqual(['F3L'])
    expect(erpSpecSlots(P, 'LHF3')).toEqual(['F3L'])
    expect(erpSpecSlots(P, 'LHR9')).toEqual([])
    expect(erpSpecSlots('Tri-mixer', 'LHCO')).toEqual([])
    for (const k of ERP_SPEC_LAYOUTS) {
      const seen = new Map()
      for (const t of erpSpecTokens(k)) {
        const id = `${t.token}#${t.rank}`
        expect(seen.get(id) ?? t.slot, `${k} ${t.token} names two wheels`).toBe(t.slot)
        seen.set(id, t.slot)
      }
    }
  })
})
