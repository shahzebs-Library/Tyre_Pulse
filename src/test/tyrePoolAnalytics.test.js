import { describe, it, expect } from 'vitest'
import {
  managerSummary, filterEntries, reasonMix, filterCandidates, candidateValue,
  entryExportRows, candidateExportRows, reasonLabel, ENTRY_EXPORT_COLS, CANDIDATE_EXPORT_COLS,
} from '../lib/tyrePoolAnalytics'

const entries = [
  { id: 1, tyre_serial: 'S1', status: 'available', pool_location: 'Dubai', reason: 'hot_spare' },
  { id: 2, tyre_serial: 'S2', status: 'deployed', pool_location: 'Dubai', reason: 'hot_spare', assigned_to: 'TM517' },
  { id: 3, tyre_serial: 'S3', status: 'available', pool_location: '', reason: 'buffer_stock', notes: 'eastern depot' },
  { id: 4, tyre_serial: 'S4', status: 'maintenance', pool_location: 'Riyadh', reason: 'buffer_stock' },
]

describe('tyrePoolAnalytics', () => {
  it('summarises the whole pool and recommends replenishment only with a known fleet size', () => {
    const s = managerSummary(entries, 40)
    expect(s).toMatchObject({ total: 4, available: 2, deployed: 1, maintenance: 1, utilisationPct: 25, activeVehicles: 40 })
    expect(s.replen).toMatchObject({ recommended: 16, gap: 14, status: 'critical' })
    expect(s.locations).toEqual([{ location: 'Dubai', count: 1 }, { location: 'Unassigned', count: 1 }])
    expect(managerSummary(entries, null).replen).toBeNull()
  })

  it('reports utilisation as N/A for an empty pool', () => {
    expect(managerSummary([], 10).utilisationPct).toBeNull()
  })

  it('filters entries by status, location, reason and search', () => {
    expect(filterEntries(entries, { status: 'available' }).map((e) => e.id)).toEqual([1, 3])
    expect(filterEntries(entries, { location: 'Unassigned' }).map((e) => e.id)).toEqual([3])
    expect(filterEntries(entries, { reason: 'buffer_stock' }).map((e) => e.id)).toEqual([3, 4])
    expect(filterEntries(entries, { search: 'tm517' }).map((e) => e.id)).toEqual([2])
    expect(filterEntries(entries, { search: 'eastern' }).map((e) => e.id)).toEqual([3])
  })

  it('counts reasons with readable labels', () => {
    expect(reasonMix(entries)).toEqual([{ label: 'Hot Spare', count: 2 }, { label: 'Buffer Stock', count: 2 }])
    expect(reasonLabel(null)).toBe('N/A')
  })

  it('filters candidates and values them honestly', () => {
    const pool = [
      { id: 1, serial_no: 'A', brand: 'Bridgestone', size: '315/80R22.5', site: 'NHC', cost_per_tyre: 900 },
      { id: 2, serial_no: 'B', brand: 'Michelin', size: '315/80R22.5', site: 'JED', cost_per_tyre: null },
    ]
    expect(filterCandidates(pool, { brand: 'Michelin' }).map((r) => r.id)).toEqual([2])
    expect(filterCandidates(pool, { search: 'nhc' }).map((r) => r.id)).toEqual([1])
    expect(candidateValue(pool)).toEqual({ priced: 1, unpriced: 1, value: 900 })
    expect(candidateValue(pool, { money: false }).value).toBeNull()
    expect(candidateValue([pool[1]]).value).toBeNull()
    const out = candidateExportRows(pool, { money: false })
    expect(Object.keys(out[0])).toEqual(CANDIDATE_EXPORT_COLS)
    expect(out[0].cost).toBe('N/A')
  })

  it('shapes entry exports', () => {
    const out = entryExportRows(entries)
    expect(Object.keys(out[0])).toEqual(ENTRY_EXPORT_COLS)
    expect(out[2].pool_location).toBe('Unassigned')
    expect(out[0].assigned_to).toBe('N/A')
    expect(out[1].status).toBe('Deployed')
  })
})
