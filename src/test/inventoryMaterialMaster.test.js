import { describe, it, expect } from 'vitest'
import {
  classifyMaterial, filterCounts, applyMaterialFilter, oemPartNumber, manufacturerPartNumber, alternativeReferences,
  storeAvailability, crossLocationStock, inventoryKpis, auditCompletion, correctionsFor,
} from '../lib/inventory/materialMasterView'

const result = {
  canonical_id: 'c1', company_sku: 'GC-0001', description: 'Oil filter', category: 'Filters', status: 'active',
  references: [{ type: 'oem', value: 'OEM-1', status: 'active' }, { type: 'aftermarket', value: 'AM-9', manufacturer: 'Fleetguard', verified: true, status: 'active' }],
  variants: [
    { variant_id: 'v1', classification: 'genuine', status: 'active', part_number: 'MB-123', matched: true,
      availability: [{ site: 'NHC', available: 4, reserved: 1, in_transit: 0, damaged: 0, quarantined: 0 }] },
    { variant_id: 'v2', classification: 'aftermarket', status: 'active', manufacturer: 'Donaldson', part_number: 'P55',
      availability: [{ site: 'NHC', available: 2, reserved: 0, in_transit: 1, damaged: 0, quarantined: 0 }, { site: 'JED', available: 3 }] },
  ],
  availability_unassigned: [{ site: 'JED', available: 5, damaged: 1 }],
}

describe('material master view', () => {
  it('classifies and counts genuine / aftermarket / unverified', () => {
    expect(classifyMaterial(result)).toEqual({ genuine: true, aftermarket: true, unverified: false })
    const proposed = { ...result, canonical_id: 'c2', status: 'proposed', variants: [] }
    expect(filterCounts([result, proposed])).toEqual({ all: 2, genuine: 1, aftermarket: 1, unverified: 1 })
    expect(applyMaterialFilter([result, proposed], 'unverified').map((r) => r.canonical_id)).toEqual(['c2'])
    expect(applyMaterialFilter([result, proposed], 'all', 'Nope')).toEqual([])
  })

  it('reads identification numbers', () => {
    expect(oemPartNumber(result)).toBe('OEM-1')
    expect(oemPartNumber({ variants: [{ classification: 'oes', part_number: 'X1' }] })).toBe('X1')
    expect(manufacturerPartNumber(result)).toBe('MB-123')
    expect(manufacturerPartNumber({})).toBeNull()
    expect(alternativeReferences(result).map((r) => r.partNumber)).toEqual(['AM-9', 'P55'])
  })

  it('splits stock by store and keeps unclassified stock in Total only', () => {
    const s = storeAvailability(result)
    expect(s.rows).toEqual([
      { site: 'JED', genuine: 0, aftermarket: 3, other: 5, total: 8 },
      { site: 'NHC', genuine: 4, aftermarket: 2, other: 0, total: 6 },
    ])
    expect(s.totals).toEqual({ genuine: 4, aftermarket: 5, other: 5, total: 14 })
    const c = crossLocationStock(result)
    expect(c.totals).toMatchObject({ available: 14, reserved: 1, in_transit: 1, damaged: 1, total: 17 })
  })

  it('never fabricates KPI figures', () => {
    expect(inventoryKpis(null)).toEqual({ identified: null, unidentified: null, pendingCorrections: null, captures: null })
    expect(inventoryKpis({ status: 'not_provisioned' }).identified).toBeNull()
    expect(inventoryKpis({ status: 'ok', captures: 10, identified: 6, rejected: 1, pending_corrections: 2 }))
      .toEqual({ captures: 10, identified: 6, unidentified: 3, pendingCorrections: 2 })
  })

  it('audit completion ignores cancelled audits and is N/A with none', () => {
    expect(auditCompletion([]).pct).toBeNull()
    const r = auditCompletion([{ site: 'NHC', status: 'closed' }, { site: 'NHC', status: 'in_progress' }, { site: 'JED', status: 'cancelled' }])
    expect(r.pct).toBe(50)
    expect(r.sites).toEqual([{ site: 'NHC', done: 1, total: 2, pct: 50 }])
  })

  it('matches corrections to the material or its variants', () => {
    const rows = [{ id: 1, target_id: 'c1' }, { id: 2, target_id: 'v2' }, { id: 3, target_id: 'zz' }]
    expect(correctionsFor(result, rows).map((r) => r.id)).toEqual([1, 2])
  })
})
