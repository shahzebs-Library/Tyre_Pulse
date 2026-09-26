import { describe, it, expect } from 'vitest'
import {
  summarizeCustomData, filterFieldStats, filterSynonyms, flattenForExport, pageCount, synonymIndex,
} from '../lib/customDataAnalytics'

const stats = [
  { field_key: 'Driver ID', record_count: '12' },
  { field_key: 'plant', record_count: 3 },
  { field_key: 'Remark 2', record_count: 5 },
]
const synonyms = [{ custom_name: 'driver id', maps_to: 'driver_name', use_count: 4 }, { custom_name: 'Plant', maps_to: 'site', use_count: 1 }]

describe('customDataAnalytics', () => {
  it('summarises without claiming field values are records', () => {
    const s = summarizeCustomData({ fieldStats: stats, synonyms, recordCount: 9 })
    expect(s.uniqueFields).toBe(3)
    expect(s.mappedFields).toBe(2)
    expect(s.unmappedFields).toBe(1)
    expect(s.fieldValues).toBe(20)
    expect(s.recordCount).toBe(9)
    expect(s.autoMapped).toBe(5)
    expect(summarizeCustomData({}).mappedShare).toBeNull()
    expect(summarizeCustomData({ fieldStats: stats }).recordCount).toBeNull()
  })

  it('filters by search and mapping state case-insensitively', () => {
    expect(filterFieldStats(stats, { mapping: 'mapped', synonyms }).map((f) => f.field_key)).toEqual(['Driver ID', 'plant'])
    expect(filterFieldStats(stats, { mapping: 'unmapped', synonyms }).map((f) => f.field_key)).toEqual(['Remark 2'])
    expect(filterFieldStats(stats, { search: 'REM' })).toHaveLength(1)
    expect(synonymIndex(synonyms).has('plant')).toBe(true)
  })

  it('filters synonyms on name and target', () => {
    expect(filterSynonyms(synonyms, 'site')).toHaveLength(1)
    expect(filterSynonyms(synonyms, '')).toHaveLength(2)
  })

  it('flattens every custom key into export columns', () => {
    const out = flattenForExport([
      { id: 1, asset_no: 'TM1', extra_fields: { a: 'x' } },
      { id: 2, asset_no: 'TM2', extra_fields: { b: 'y' } },
    ])
    expect(out.columns.slice(-2)).toEqual(['x_a', 'x_b'])
    expect(out.headers.slice(-2)).toEqual(['a', 'b'])
    expect(out.rows[1].x_a).toBe('')
    expect(out.rows[1].x_b).toBe('y')
  })

  it('counts pages', () => {
    expect(pageCount(41, 20)).toBe(3)
    expect(pageCount(0, 20)).toBe(0)
  })
})
