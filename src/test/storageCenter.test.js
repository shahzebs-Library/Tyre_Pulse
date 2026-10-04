import { describe, it, expect } from 'vitest'
import {
  isEvidenceBucket, allowedTypesLabel, retentionLabel, monthKeys, growthSeries, buildRecommendations, bucketChipCounts, fileTitle, MB,
} from '../lib/storageCenter'

const NOW = new Date('2026-09-30T08:00:00Z')
const BUCKETS = [
  { id: 'tyre-photos', files: 14632, bytes: 3.19 * 1024 * MB, duplicate_files: 233, duplicate_bytes: 35.6 * MB },
  { id: 'import-files', files: 29, bytes: 49.5 * MB, duplicate_files: 12, duplicate_bytes: 22.5 * MB, older_60_files: 28, older_60_bytes: 49.4 * MB },
  { id: 'tenant-exports', files: 8, bytes: 20 * MB },
  { id: 'inspection-photos', files: 0, bytes: 0 },
]

describe('storage rules', () => {
  it('treats photo and fine buckets as evidence', () => {
    expect(isEvidenceBucket('tyre-photos')).toBe(true)
    expect(isEvidenceBucket('accident-photos')).toBe(true)
    expect(isEvidenceBucket('import-files')).toBe(false)
  })
  it('names retention honestly: exports are applied, other rules are only saved', () => {
    expect(retentionLabel('tenant-exports', [], 7)).toMatchObject({ text: 'Delete after 7 days', applied: true })
    expect(retentionLabel('import-files', [], 7)).toMatchObject({ text: 'Keep forever', applied: false })
    const r = retentionLabel('import-files', [{ bucket: 'import-files', older_than_days: 60, prefix: null }], 7)
    expect(r).toMatchObject({ text: 'Delete after 60 days', runs: 'Saved, not applied yet', applied: false })
  })
  it('allowed types read Any when there is no list', () => {
    expect(allowedTypesLabel(null)).toBe('Any')
    expect(allowedTypesLabel(['image/jpeg', 'image/png'])).toBe('jpeg, png')
  })
})

describe('growth', () => {
  it('builds month keys ending this month and labels estimates', () => {
    expect(monthKeys(NOW, 3)).toEqual(['2026-07', '2026-08', '2026-09'])
    const g = growthSeries([{ month: '2026-08', files: 10, bytes: 100 }, { month: '2026-09', files: 20, bytes: 200 }], NOW)
    expect(g.latest).toMatchObject({ key: '2026-09', bytes: 200 })
    expect(g.points.filter((p) => p.estimate)).toHaveLength(3)
    expect(g.yearPace).toBe(2400)
  })
  it('a month with no uploads is a measured zero (every file is counted), not a gap', () => {
    const g = growthSeries([], NOW)
    expect(g.latest).toMatchObject({ key: '2026-09', bytes: 0 })
    expect(g.yearPace).toBe(0)
  })
})

describe('recommendations and chips', () => {
  it('names copies, uncovered buckets, resizing and growth', () => {
    const recs = buildRecommendations({ buckets: BUCKETS, rules: [], tenantExportDays: 7, growth: growthSeries([{ month: '2026-09', files: 10, bytes: 2 * 1024 * MB }], NOW) })
    const keys = recs.map((r) => r.key)
    expect(keys).toEqual(['dupes', 'rules', 'resize', 'growth'])
    expect(recs[0].title).toContain('245 files')
    expect(recs[1].title).toBe('3 of 4 buckets have no retention rule')
  })
  it('recommends nothing for an empty store', () => {
    expect(buildRecommendations({})).toEqual([])
  })
  it('counts the filter chips', () => {
    expect(bucketChipCounts(BUCKETS, [], 7)).toEqual({ all: 4, used: 3, empty: 1, rule: 1 })
  })
  it('titles files by bucket', () => {
    expect(fileTitle('import-files', 'org/2026/a.xlsx')).toBe('Upload: a.xlsx')
    expect(fileTitle('tenant-exports', 'x/part-1.ndjson.gz')).toBe('Company export part (part-1.ndjson.gz)')
  })
})
