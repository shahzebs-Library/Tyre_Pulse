import { describe, it, expect } from 'vitest'
import { buildBulkPlan, bulkPayload, parseRackList, suggestChildType, canManageLocations, BULK_MAX_NODES } from '../lib/inventory/locationBulk'

const rows = [
  { id: 'wh', site: 'S1', code: 'WH1', location_type: 'warehouse' },
  { id: 'ra', site: 'S1', code: 'WH1-A', location_type: 'rack', parent_id: 'wh' },
  { id: 'other', site: 'S2', code: 'WH1-B', location_type: 'rack' },
]

describe('parseRackList', () => {
  it('reads lists, letter ranges and number ranges', () => {
    expect(parseRackList('A, B').codes).toEqual(['A', 'B'])
    expect(parseRackList('a-c').codes).toEqual(['A', 'B', 'C'])
    expect(parseRackList('01-03').codes).toEqual(['01', '02', '03'])
    expect(parseRackList('').codes).toEqual([])
  })
  it('refuses a backwards range and bad characters', () => {
    expect(parseRackList('C-A').error).toMatch(/range/)
    expect(parseRackList('A/B').error).toMatch(/rackCode/)
  })
})

describe('buildBulkPlan', () => {
  it('builds racks, shelves and bins parent before child with prefixed codes', () => {
    const p = buildBulkPlan({ site: 's1', parentId: 'wh', prefix: 'WH1', racks: 'B', shelves: 2, bins: 3 }, rows)
    expect(p.errors).toEqual([])
    expect(p.counts).toMatchObject({ rack: 1, shelf: 2, bin: 6, total: 9, new: 9, existing: 0 })
    expect(p.nodes.map((n) => n.code).slice(0, 3)).toEqual(['WH1-B', 'WH1-B-01', 'WH1-B-01-01'])
    expect(p.nodes[0]).toMatchObject({ parentRef: null, parentId: 'wh', location_type: 'rack', name: 'Rack WH1-B' })
    const shelf = p.nodes[1]
    expect(shelf.parentRef).toBe(p.nodes[0].ref)
    expect(p.nodes[2].parentRef).toBe(shelf.ref)
    // a code that exists at ANOTHER store is not a clash
    expect(p.nodes[0].existingId).toBe(null)
  })

  it('reuses a code that already exists at the store', () => {
    const p = buildBulkPlan({ site: 'S1', parentId: 'wh', prefix: 'WH1', racks: 'A', shelves: 1, bins: 0 }, rows)
    expect(p.nodes[0].existingId).toBe('ra')
    expect(p.counts).toMatchObject({ existing: 1, new: 1 })
  })

  it('creates shelves straight under a parent when no racks are given', () => {
    const p = buildBulkPlan({ site: 'S1', parentId: 'ra', prefix: 'WH1-A', shelves: 2, bins: 0, start: 0, pad: 1, sep: '.' }, rows)
    expect(p.nodes.map((n) => n.code)).toEqual(['WH1-A.0', 'WH1-A.1'])
    expect(p.nodes.every((n) => n.parentId === 'ra')).toBe(true)
  })

  it('never builds a plan without a store, a prefix or anything to create', () => {
    expect(buildBulkPlan({ racks: 'A', shelves: 1 }, rows).errors).toContain('inventory.locations.bulk.errors.site')
    expect(buildBulkPlan({ site: 'S1', shelves: 2 }, rows).errors).toContain('inventory.locations.bulk.errors.prefix')
    expect(buildBulkPlan({ site: 'S1', prefix: 'X', shelves: 0, bins: 0 }, rows).errors).toContain('inventory.locations.bulk.errors.nothing')
    expect(buildBulkPlan({ site: 'S2', parentId: 'wh', prefix: 'X', shelves: 1 }, rows).errors).toContain('inventory.locations.bulk.errors.parentSite')
    expect(buildBulkPlan({ site: 'S1', parentId: 'gone', prefix: 'X', shelves: 1 }, rows).errors).toContain('inventory.locations.bulk.errors.parent')
  })

  it('refuses a duplicate generated code and a plan over the limit', () => {
    expect(buildBulkPlan({ site: 'S1', prefix: 'X', racks: '1, 01', shelves: 0, bins: 0, sep: '' }, rows).errors).toEqual([])
    const dup = buildBulkPlan({ site: 'S1', prefix: 'X', racks: 'A', shelves: 11, bins: 0, sep: '', pad: 1 }, rows)
    // X A + 1..11: XA1 ... XA11; no clash. Force a clash: rack "A1" and shelf "A"+"1"
    expect(dup.errors).toEqual([])
    const clash = buildBulkPlan({ site: 'S1', prefix: '', racks: 'A1, A', shelves: 1, bins: 0, sep: '', pad: 1 }, rows)
    expect(clash.errors).toContain('inventory.locations.bulk.errors.duplicate')
    expect(clash.nodes).toEqual([])
    const big = buildBulkPlan({ site: 'S1', prefix: 'X', racks: '1-10', shelves: 10, bins: 10 }, rows)
    expect(big.errors).toContain('inventory.locations.bulk.errors.tooMany')
    expect(BULK_MAX_NODES).toBe(500)
  })

  it('maps to the server payload with upper site and parent refs only', () => {
    const p = buildBulkPlan({ site: 's1', prefix: 'Z', shelves: 1, bins: 1 }, rows)
    const body = bulkPayload({ country: 'KSA', site: 's1', parentId: '', nodes: p.nodes })
    expect(body).toMatchObject({ country: 'KSA', site: 'S1', parent_id: null })
    expect(body.nodes[1]).toEqual({ ref: 'n2', parent_ref: 'n1', code: 'Z-01-01', name: 'Bin Z-01-01', location_type: 'bin' })
  })
})

describe('helpers', () => {
  it('suggests the usual child type', () => {
    expect(suggestChildType('warehouse')).toBe('zone')
    expect(suggestChildType('rack')).toBe('shelf')
    expect(suggestChildType('shelf')).toBe('bin')
    expect(suggestChildType(undefined)).toBe('warehouse')
  })
  it('mirrors app_is_elevated for the write buttons', () => {
    expect(canManageLocations({ role: 'Manager' })).toBe(true)
    expect(canManageLocations({ role: 'Store Keeper' })).toBe(false)
    expect(canManageLocations({ role: 'Reporter', isSuperAdmin: true })).toBe(true)
  })
})
