import { describe, it, expect } from 'vitest'
import {
  chunkText, baseTitle, filterDocs, hasKbFilters, kbSiteOptions, kbKpis, kbByType, kbTopTags,
  kbExportRows, KB_FILTERS, docTypeLabel, CHUNK_SIZE, CHUNK_OVERLAP,
} from '../lib/knowledgeBaseAnalytics'

const NOW = Date.parse('2026-09-27T00:00:00Z')
const docs = [
  { id: 1, title: 'Pressure SOP (1/2)', doc_type: 'sop', site: 'NHC', tags: ['pressure', 'heavy'], embedding: true, created_at: '2026-09-20T00:00:00Z' },
  { id: 2, title: 'Pressure SOP (2/2)', doc_type: 'sop', site: 'NHC', tags: ['pressure'], embedding: null, created_at: '2026-09-20T00:00:00Z' },
  { id: 3, title: 'Vendor sheet', doc_type: 'vendor', site: null, asset_no: 'TM-1', tags: [], embedding: true, created_at: '2026-01-01T00:00:00Z' },
  { id: 4, title: 'Mystery', doc_type: 'unknown', site: 'JED', embedding: null },
]

describe('knowledgeBaseAnalytics', () => {
  it('chunks text with overlap and yields nothing for empty input', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText(null)).toEqual([])
    const s = 'x'.repeat(CHUNK_SIZE + 100)
    const chunks = chunkText(s)
    expect(chunks).toHaveLength(2)
    expect(chunks[1]).toHaveLength(100 + CHUNK_OVERLAP)
    expect(chunkText('abcdef', 4, 2)).toEqual(['abcd', 'cdef', 'ef'])
  })

  it('maps a chunk back to its source document', () => {
    expect(baseTitle('Pressure SOP (2/2)')).toBe('Pressure SOP')
    expect(baseTitle('Plain')).toBe('Plain')
    expect(baseTitle('')).toBe('Untitled')
    expect(docTypeLabel('nope')).toBe('Other')
  })

  it('filters by type, site (including global), index status and text', () => {
    expect(filterDocs(docs, { ...KB_FILTERS, type: 'sop' })).toHaveLength(2)
    expect(filterDocs(docs, { ...KB_FILTERS, site: 'global' }).map((d) => d.id)).toEqual([3])
    expect(filterDocs(docs, { ...KB_FILTERS, site: 'JED' }).map((d) => d.id)).toEqual([4])
    expect(filterDocs(docs, { ...KB_FILTERS, status: 'pending' }).map((d) => d.id)).toEqual([2, 4])
    expect(filterDocs(docs, { ...KB_FILTERS, search: 'heavy' }).map((d) => d.id)).toEqual([1])
    expect(filterDocs(docs, { ...KB_FILTERS, search: 'tm-1' }).map((d) => d.id)).toEqual([3])
    expect(hasKbFilters(KB_FILTERS)).toBe(false)
    expect(kbSiteOptions(docs)).toEqual(['JED', 'NHC'])
  })

  it('separates chunks from source documents and keeps coverage honest', () => {
    const k = kbKpis(docs, NOW)
    expect(k).toMatchObject({ chunks: 4, documents: 3, indexed: 2, pending: 2, coveragePct: 50, types: 3, tags: 2, addedLast30: 2, assetLinked: 1 })
    expect(kbKpis([], NOW).coveragePct).toBeNull()
    expect(kbKpis(docs, NaN).addedLast30).toBeNull()
  })

  it('breaks down by type, ranks tags and exports', () => {
    const t = kbByType(docs)
    expect(t.find((x) => x.type === 'sop')).toMatchObject({ chunks: 2, indexed: 1 })
    expect(t.find((x) => x.type === 'other').chunks).toBe(1)
    expect(kbTopTags(docs)).toEqual([{ tag: 'pressure', count: 2 }, { tag: 'heavy', count: 1 }])
    const out = kbExportRows(docs)
    expect(out[0]).toMatchObject({ document: 'Pressure SOP', doc_type: 'SOP / Procedure', status: 'Indexed', tags: 'pressure, heavy', created_at: '2026-09-20' })
    expect(out[2].site).toBe('All sites')
  })
})
