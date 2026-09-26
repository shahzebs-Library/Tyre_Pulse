import { describe, it, expect } from 'vitest'
import {
  disposalFilterOptions, countActiveFilters, mergeExportModel, uploadPreviewCounts,
  downtimeSortValue, stillActiveShare, findingDotClass,
} from '../lib/assetDisposalsAnalytics'

describe('assetDisposalsAnalytics', () => {
  it('builds sorted distinct filter options and drops blanks', () => {
    const o = disposalFilterOptions([
      { asset_type: 'MIXER', region: 'central', site: 'NHC' },
      { asset_type: 'PUMP', region: 'central', site: '' },
      { asset_type: 'MIXER', region: null, site: 'JED' },
    ])
    expect(o).toEqual({ assetTypes: ['MIXER', 'PUMP'], regions: ['central'], sites: ['JED', 'NHC'] })
    expect(disposalFilterOptions(null)).toEqual({ assetTypes: [], regions: [], sites: [] })
  })

  it('counts active filters, treating inRegister=all as inactive', () => {
    expect(countActiveFilters({ search: '', disposition: 'scrap', inRegister: 'all' })).toBe(1)
    expect(countActiveFilters({ search: 'tm', inRegister: 'no' })).toBe(2)
    expect(countActiveFilters({})).toBe(0)
  })

  it('zips reliability columns onto the register export without duplicating keys', () => {
    const base = { columns: ['asset', 'spend'], head: ['Asset', 'Spend'], rows: [{ asset: 'A', spend: 1 }, { asset: 'B', spend: 2 }] }
    const rel = { columns: ['asset', 'mtbf'], head: ['Asset R', 'MTBF'], rows: [{ asset: 'X', mtbf: 10 }, { mtbf: 20 }] }
    const m = mergeExportModel(base, rel)
    expect(m.columns).toEqual(['asset', 'spend', 'mtbf'])
    expect(m.head).toEqual(['Asset', 'Spend', 'MTBF'])
    expect(m.rows).toEqual([{ asset: 'A', spend: 1, mtbf: 10 }, { asset: 'B', spend: 2, mtbf: 20 }])
    expect(mergeExportModel(base, null)).toBe(base)
    expect(mergeExportModel(base, { columns: 'bad' })).toBe(base)
  })

  it('splits an upload into new and refreshed rows by asset code, case-insensitive', () => {
    expect(uploadPreviewCounts([{ asset_no: 'tm1' }, { asset_no: 'TM2' }, { asset_no: ' tm3 ' }], [{ asset_no: 'TM1' }, { asset_no: 'TM3' }]))
      .toEqual({ total: 3, added: 1, refreshed: 2 })
    expect(uploadPreviewCounts([], [])).toEqual({ total: 0, added: 0, refreshed: 0 })
  })

  it('never turns a missing breakdown into zero days down', () => {
    expect(downtimeSortValue(null)).toBeNull()
    expect(downtimeSortValue(undefined)).toBeNull()
    expect(downtimeSortValue({ open: 1, currentDays: 218 })).toBe(218)
    expect(downtimeSortValue({ open: 1, currentDays: null })).toBeNull()
    expect(downtimeSortValue({ open: 0, breakdowns: 3 })).toBe(0)
  })

  it('states the still-active share only when there is a list', () => {
    expect(stillActiveShare({ assets: 37, stillActive: 12 })).toBe(32.4)
    expect(stillActiveShare({ assets: 0, stillActive: 0 })).toBeNull()
    expect(stillActiveShare(null)).toBeNull()
    expect(stillActiveShare({ assets: 5, stillActive: null })).toBeNull()
  })

  it('maps finding tones to dot classes', () => {
    expect(findingDotClass('danger')).toBe('bg-red-400')
    expect(findingDotClass('warning')).toBe('bg-amber-400')
    expect(findingDotClass('info')).toBe('bg-sky-400')
    expect(findingDotClass('whatever')).toBe('bg-slate-400')
  })
})
