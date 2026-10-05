import { describe, it, expect } from 'vitest'
import {
  chunkPart, indexStatus, groupDocuments, collections, kbHeadline,
  filterDocuments, sortDocuments, monthlyAdded, governance,
} from '../lib/knowledgeBaseView'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const day = (n) => new Date(NOW - n * 86_400_000).toISOString()

const chunks = [
  { id: '2', title: 'Michelin Manual (2/2)', doc_type: 'manual', site: 'NHC', tags: ['tread'], embedding: true, created_at: day(5) },
  { id: '1', title: 'Michelin Manual (1/2)', doc_type: 'manual', site: 'NHC', tags: ['pressure'], embedding: null, created_at: day(6), updated_at: day(1) },
  { id: '3', title: 'Workshop SOP', doc_type: 'sop', site: null, tags: [], embedding: true, created_at: day(40) },
  { id: '4', title: 'Odd', doc_type: 'weird', asset_no: 'TM514', embedding: true, created_at: day(45) },
]

describe('knowledgeBaseView', () => {
  it('reads chunk parts and index status', () => {
    expect(chunkPart('Name (3/5)')).toBe(3)
    expect(chunkPart('Name')).toBe(1)
    expect(indexStatus(2, 2)).toBe('indexed')
    expect(indexStatus(1, 2)).toBe('partial')
    expect(indexStatus(0, 2)).toBe('pending')
    expect(indexStatus(0, 0)).toBe('pending')
  })

  it('groups chunks back into source documents in part order', () => {
    const docs = groupDocuments(chunks)
    expect(docs).toHaveLength(3)
    const m = docs.find((d) => d.title === 'Michelin Manual')
    expect(m.chunks.map((c) => c.id)).toEqual(['1', '2'])
    expect(m).toMatchObject({ chunkCount: 2, indexed: 1, coveragePct: 50, status: 'partial', site: 'NHC' })
    expect(m.tags).toEqual(['pressure', 'tread'])
    expect(m.updatedAt).toBe(Date.parse(day(1)))
    expect(docs.find((d) => d.title === 'Odd').docType).toBe('other')
    expect(groupDocuments(null)).toEqual([])
  })

  it('builds collections with an All row first', () => {
    const c = collections(groupDocuments(chunks))
    expect(c[0]).toEqual({ key: 'all', label: 'All collections', count: 3 })
    expect(c.find((x) => x.key === 'manual').count).toBe(1)
    expect(c.find((x) => x.key === 'rca').count).toBe(0)
  })

  it('reports headline figures with honest nulls', () => {
    const h = kbHeadline(groupDocuments(chunks), NOW)
    expect(h).toMatchObject({ documents: 3, chunks: 4, indexed: 3, pending: 1, coveragePct: 75, addedLast30: 1 })
    // 1 doc in the last 30 days vs 2 in the 30 before: -50%.
    expect(h.docTrend).toBe(-50)
    expect(h.citations).toBeNull()
    expect(h.reportTemplates).toBeNull()
    expect(h.generatedReports).toBeNull()
    const empty = kbHeadline([], NOW)
    expect(empty.coveragePct).toBeNull()
    expect(empty.docTrend).toBeNull()
  })

  it('filters and sorts grouped documents', () => {
    const docs = groupDocuments(chunks)
    expect(filterDocuments(docs, { type: 'sop' }).map((d) => d.title)).toEqual(['Workshop SOP'])
    expect(filterDocuments(docs, { site: 'global' })).toHaveLength(2)
    expect(filterDocuments(docs, { status: 'partial' })).toHaveLength(1)
    expect(filterDocuments(docs, { search: 'tm514' }).map((d) => d.title)).toEqual(['Odd'])
    expect(sortDocuments(docs, 'title').map((d) => d.title)).toEqual(['Michelin Manual', 'Odd', 'Workshop SOP'])
    expect(sortDocuments(docs, 'coverage')[0].title).toBe('Michelin Manual')
    expect(sortDocuments(docs, 'updated')[0].title).toBe('Michelin Manual')
  })

  it('counts documents added per month', () => {
    const m = monthlyAdded(groupDocuments(chunks), NOW, 3)
    expect(m.map((x) => x.key)).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(m.reduce((s, x) => s + x.count, 0)).toBe(3)
    expect(monthlyAdded([], NaN)).toEqual([])
  })

  it('builds a governance checklist from real fields', () => {
    const odd = groupDocuments(chunks).find((d) => d.title === 'Odd')
    const g = governance(odd)
    expect(g.find((x) => x.key === 'asset')).toMatchObject({ ok: true })
    expect(g.find((x) => x.key === 'tags')).toMatchObject({ ok: false, label: 'No tags recorded' })
    expect(governance(null)).toEqual([])
  })
})

describe('lineChartPoints / percentShares', () => {
  it('spreads points across the width and scales to the peak', async () => {
    const { lineChartPoints } = await import('../lib/knowledgeBaseView')
    const { points, max } = lineChartPoints([{ count: 0 }, { count: 5 }, { count: 10 }], { width: 120, height: 60, pad: 10 })
    expect(max).toBe(10)
    expect(points.map((p) => p.x)).toEqual([10, 60, 110])
    expect(points[0].y).toBe(50)
    expect(points[2].y).toBe(10)
  })
  it('keeps an all-zero series on the baseline and handles one point', async () => {
    const { lineChartPoints } = await import('../lib/knowledgeBaseView')
    expect(lineChartPoints([{ count: 0 }, { count: 0 }], { width: 100, height: 40, pad: 0 }).points.every((p) => p.y === 40)).toBe(true)
    expect(lineChartPoints([{ count: 3 }], { width: 100, height: 40, pad: 0 }).points[0].x).toBe(50)
    expect(lineChartPoints(null).points).toEqual([])
  })
  it('gives whole-percent shares and null on an empty total', async () => {
    const { percentShares } = await import('../lib/knowledgeBaseView')
    expect(percentShares([{ count: 1 }, { count: 3 }]).map((x) => x.pct)).toEqual([25, 75])
    expect(percentShares([{ count: 0 }]).map((x) => x.pct)).toEqual([null])
  })
})
