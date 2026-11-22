import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ results: {} }))
vi.mock('../lib/api/_client', () => {
  const builder = (table) => {
    const b = {
      select: () => b, eq: () => b, or: () => b,
      then: (res, rej) => Promise.resolve(h.results[table] ?? { count: 0, error: null }).then(res, rej),
    }
    return b
  }
  return {
    supabase: { from: (t) => builder(t) },
    applyCountry: (q) => q,
    ServiceError: class extends Error {},
    fetchAllPages: async () => ({ data: [], error: null }),
    isNotProvisioned: (e) => e?.code === '42P01',
  }
})

import {
  missingRequiredFields, missingFieldsMessage, summarizeLinkedRecords, countLinkedRecords,
  linkedCountsForVehicles, groupBulkDelete,
} from '../lib/api/fleetMasterData'

const labels = { asset_no: 'Asset No', country: 'Country' }

describe('Fleet Master required fields', () => {
  it('names every blank required field, whitespace counts as blank', () => {
    expect(missingRequiredFields({ asset_no: '  ', country: '' }, labels)).toEqual(['Asset No', 'Country'])
    expect(missingRequiredFields({ asset_no: 'TK-1', country: '' }, labels)).toEqual(['Country'])
    expect(missingRequiredFields({ asset_no: 'TK-1', country: 'KSA' }, labels)).toEqual([])
  })
  it('builds one short line, empty when nothing is missing', () => {
    expect(missingFieldsMessage(['Asset No', 'Country'])).toBe('Fill in: Asset No, Country')
    expect(missingFieldsMessage([])).toBe('')
  })
})

describe('Fleet Master delete decision', () => {
  it('allows a permanent delete only when every table was checked and is empty', () => {
    const all0 = { inspections: 0, tyre_records: 0, work_orders: 0, accidents: 0 }
    expect(summarizeLinkedRecords(all0).state).toBe('none')
  })
  it('reports history with counts and plural wording', () => {
    const r = summarizeLinkedRecords({ inspections: 1, tyre_records: 12, work_orders: 0, accidents: 0 })
    expect(r.state).toBe('history')
    expect(r.total).toBe(13)
    expect(r.text).toBe('1 inspection, 12 tyre records')
  })
  it('treats an unreadable table as unknown, never as zero', () => {
    expect(summarizeLinkedRecords({ inspections: 0, tyre_records: null, work_orders: 0, accidents: 0 }).state).toBe('unknown')
    expect(summarizeLinkedRecords({}).state).toBe('unknown')
  })
  it('history found elsewhere still wins over an unreadable table', () => {
    expect(summarizeLinkedRecords({ inspections: null, work_orders: 2 }).state).toBe('history')
  })
})

describe('countLinkedRecords', () => {
  it('counts each table; a missing table is 0, any other error is null', async () => {
    h.results = {
      inspections: { count: 3, error: null },
      tyre_records: { count: null, error: { code: '42501' } },
      work_orders: { count: 0, error: null },
      accidents: { count: null, error: { code: '42P01' } },
    }
    const c = await countLinkedRecords({ assetNo: 'TM514', country: 'KSA' })
    expect(c).toEqual({ inspections: 3, tyre_records: null, work_orders: 0, accidents: 0 })
  })
  it('returns all-unknown for a blank asset number', async () => {
    const c = await countLinkedRecords({ assetNo: ' ' })
    expect(Object.values(c).every(v => v === null)).toBe(true)
  })
})

describe('Fleet Master bulk delete grouping', () => {
  const vehicles = [
    { id: 'a', asset_no: 'TM1', country: 'KSA' },
    { id: 'b', asset_no: 'TM2', country: 'KSA' },
    { id: 'c', asset_no: 'TM3', country: 'UAE' },
  ]
  const readable = {
    inspections: [{ asset_no: 'tm1 ', country: 'KSA' }, { asset_no: 'TM3', country: 'KSA' }],
    tyre_records: [{ asset_no: 'TM2', country: null }],
    work_orders: [],
    accidents: [],
  }
  it('matches asset number case-insensitively and by country, null-country rows count everywhere', () => {
    const c = linkedCountsForVehicles(vehicles, readable)
    expect(c.a).toEqual({ inspections: 1, tyre_records: 0, work_orders: 0, accidents: 0 })
    expect(c.b.tyre_records).toBe(1)
    // TM3 in KSA is another machine: the UAE vehicle has no history.
    expect(c.c).toEqual({ inspections: 0, tyre_records: 0, work_orders: 0, accidents: 0 })
  })
  it('splits into clean / history / unknown', () => {
    const g = groupBulkDelete(vehicles, linkedCountsForVehicles(vehicles, readable))
    expect(g.clean.map(v => v.id)).toEqual(['c'])
    expect(g.history.map(v => v.id)).toEqual(['a', 'b'])
    expect(g.unknown).toEqual([])
  })
  it('an unreadable table clears nobody: vehicles without history found become unknown', () => {
    const g = groupBulkDelete(vehicles, linkedCountsForVehicles(vehicles, { ...readable, accidents: null }))
    expect(g.clean).toEqual([])
    expect(g.history.map(v => v.id)).toEqual(['a', 'b'])
    expect(g.unknown.map(v => v.id)).toEqual(['c'])
  })
  it('a vehicle with no counts at all is unknown, never clean', () => {
    expect(groupBulkDelete([{ id: 'x', asset_no: 'Z' }], {}).unknown).toHaveLength(1)
  })
})

describe('Fleet Master locale entries', () => {
  it('every new key exists in en and ar', async () => {
    const en = (await import('../locales/en/fleetmaster.json')).default
    const ar = (await import('../locales/ar/fleetmaster.json')).default
    const keys = ['form.fillIn', 'delete.hasHistory', 'delete.markInactive', 'bulkDelete.groupClean',
      'bulkDelete.groupHistory', 'bulkDelete.groupUnknown', 'bulkDelete.deleteClean', 'bulkDelete.markInactive',
      'insights.utilFleetWide', 'history.tyre_records_many']
    const get = (o, k) => k.split('.').reduce((x, p) => x?.[p], o)
    for (const k of keys) {
      expect(typeof get(en, k)).toBe('string')
      expect(typeof get(ar, k)).toBe('string')
    }
  })
})
