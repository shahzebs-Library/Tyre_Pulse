import { describe, it, expect } from 'vitest'
import { buildBulkPlan, templateSpec, nextZoneNumber } from '../lib/inventory/locationBulk'
import { buildStoreLayout, binFacts, binStatus, statusCounts, containerSize, CONTAINER_SIZES } from '../lib/inventory/storeLayout3d'

describe('container and room templates', () => {
  it('creates a 20 ft container with left and right wall racks (codes NHC-C01-L-01-03)', () => {
    const spec = templateSpec('container', { site: 'NHC', rows: [], word: 'Container' })
    expect(spec.zoneCode).toBe('NHC-C01')
    expect(spec.zoneName).toBe('Container 01')
    const plan = buildBulkPlan({ site: 'NHC', ...spec }, [])
    expect(plan.errors).toEqual([])
    expect(plan.counts).toMatchObject({ zone: 1, rack: 2, shelf: 8, bin: 40 })
    expect(plan.nodes[0]).toMatchObject({ location_type: 'zone', code: 'NHC-C01', parentRef: null })
    expect(plan.nodes.map((n) => n.code)).toContain('NHC-C01-L-01-03')
    expect(plan.nodes.find((n) => n.code === 'NHC-C01-L').parentRef).toBe(plan.nodes[0].ref)
  })

  it('continues numbering and records 40 ft in the name', () => {
    const rows = [{ site: 'NHC', code: 'NHC-C01' }, { site: 'NHC', code: 'NHC-C02' }, { site: 'JED', code: 'JED-C09' }]
    expect(nextZoneNumber(rows, 'NHC', 'container')).toBe(3)
    expect(nextZoneNumber(rows, 'NHC', 'container', ['NHC-C03'])).toBe(4)
    const big = templateSpec('container', { site: 'NHC', rows, word: 'Container', size: '40ft' })
    expect(big.zoneName).toBe('Container 03 40ft')
    expect(containerSize(big.zoneName)).toBe('40ft')
    expect(containerSize('Container 03')).toBe('20ft')
  })

  it('creates a small room with racks A and B', () => {
    const spec = templateSpec('room', { site: 'NHC', rows: [], word: 'Room' })
    expect(spec.zoneCode).toBe('NHC-RM1')
    const plan = buildBulkPlan({ site: 'NHC', ...spec }, [])
    expect(plan.counts).toMatchObject({ zone: 1, rack: 2, shelf: 8, bin: 40 })
  })
})

describe('store 3D layout', () => {
  const spec = templateSpec('container', { site: 'NHC', rows: [], word: 'Container' })
  const plan = buildBulkPlan({ site: 'NHC', ...spec }, [])
  const rows = plan.nodes.map((n) => ({ id: n.ref, code: n.code, name: n.name, site: 'NHC', location_type: n.location_type, parent_id: n.parentRef || null }))
  const idOf = (code) => rows.find((r) => r.code === code).id

  it('is empty (honest) for a store with no locations', () => {
    expect(buildStoreLayout([], 'NHC').empty).toBe(true)
  })

  it('draws a 20 ft container with two wall racks and 40 bins coloured from real data', () => {
    const now = new Date('2026-11-22T10:00:00')
    const facts = binFacts(
      [{ id: 'b1', location_id: idOf('NHC-C01-L-01-01'), qty_on_hand: 3, reorder_point: 5, item_code: 'X' },
        { id: 'b2', location_id: idOf('NHC-C01-R-02-03'), qty_on_hand: 9 }],
      [{ location_id: idOf('NHC-C01-L-04-05'), captured_at: '2026-11-22T08:00:00' }],
      now,
    )
    const layout = buildStoreLayout(rows, 'NHC', facts)
    expect(layout.zones).toHaveLength(1)
    expect(layout.zones[0]).toMatchObject({ kind: 'container', size: '20ft', length: CONTAINER_SIZES['20ft'].length })
    expect(layout.zones[0].racks).toHaveLength(2)
    expect(layout.bins).toBe(40)
    expect(statusCounts(layout)).toEqual({ empty: 37, stock: 1, low: 1, counted: 1 })
    expect(binStatus(undefined)).toBe('empty')
  })
})
