import { describe, it, expect } from 'vitest'
import {
  chunkPages, normalizeText, fileKind, docxXmlToText, pdfItemsToPages,
  buildIngestRows, embeddingHealth, pagesToText, MAX_CHUNKS_PER_DOCUMENT,
} from '../lib/knowledgeIngest'

const para = (n, len = 300) => `Paragraph ${n}. ` + 'x'.repeat(len)

describe('chunkPages', () => {
  it('keeps every chunk within maxChars and covers all text', () => {
    const pages = [{ page: 1, text: [para(1), para(2), para(3)].join('\n\n') }, { page: 2, text: [para(4), para(5)].join('\n\n') }]
    const out = chunkPages(pages, { maxChars: 700, overlap: 100 })
    expect(out.length).toBeGreaterThan(1)
    for (const c of out) expect(c.content.length).toBeLessThanOrEqual(700)
    for (const n of [1, 2, 3, 4, 5]) expect(out.some((c) => c.content.includes(`Paragraph ${n}.`))).toBe(true)
    expect(out.map((c) => c.index)).toEqual(out.map((_, i) => i + 1))
  })

  it('records the page span of each chunk', () => {
    const pages = [{ page: 3, text: 'Short rule A.' }, { page: 4, text: 'Short rule B.' }]
    const [only] = chunkPages(pages, { maxChars: 500, overlap: 50 })
    expect(only).toMatchObject({ pageFrom: 3, pageTo: 4 })
    const split = chunkPages([{ page: 1, text: para(1, 400) }, { page: 2, text: para(2, 400) }], { maxChars: 450, overlap: 40 })
    expect(split[0]).toMatchObject({ pageFrom: 1, pageTo: 1 })
    expect(split[split.length - 1].pageTo).toBe(2)
  })

  it('carries overlap so a boundary sentence appears in both chunks', () => {
    const out = chunkPages([{ page: 1, text: `${para(1, 300)}\n\nTAILMARK end of one.\n\n${para(2, 300)}` }], { maxChars: 360, overlap: 60 })
    expect(out.length).toBe(2)
    expect(out[0].content.endsWith('TAILMARK end of one.')).toBe(true)
    // the boundary sentence is carried into the next chunk, still within max
    expect(out[1].content.startsWith('TAILMARK') || out[1].content.includes('TAILMARK end of one.')).toBe(true)
    expect(out[1].content).toContain('Paragraph 2.')
    for (const c of out) expect(c.content.length).toBeLessThanOrEqual(360)
  })

  it('hard-splits an oversized paragraph on whitespace without exceeding max', () => {
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ')
    const out = chunkPages([{ page: 7, text: words }], { maxChars: 300, overlap: 40 })
    expect(out.length).toBeGreaterThan(5)
    for (const c of out) {
      expect(c.content.length).toBeLessThanOrEqual(300)
      expect(c.pageFrom).toBe(7)
    }
    expect(out[0].content.endsWith('word')).toBe(false)
  })

  it('accepts a plain string as a page-less document', () => {
    const out = chunkPages('Only text.')
    expect(out).toEqual([{ index: 1, content: 'Only text.', pageFrom: null, pageTo: null }])
    expect(chunkPages('   ')).toEqual([])
    expect(chunkPages(null)).toEqual([])
  })
})

describe('parsers', () => {
  it('normalizes whitespace and control characters', () => {
    expect(normalizeText('a\r\n\r\n\r\nb\u0000  c d')).toBe('a\n\nb c d')
  })

  it('detects supported file kinds', () => {
    expect(fileKind({ name: 'SOP.PDF' })).toBe('pdf')
    expect(fileKind({ name: 'manual.docx' })).toBe('docx')
    expect(fileKind({ name: 'notes.md' })).toBe('text')
    expect(fileKind({ name: 'old.doc' })).toBe(null)
    expect(fileKind({ name: 'img.png', type: 'image/png' })).toBe(null)
  })

  it('reads DOCX document.xml paragraphs, tabs and entities', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Pressure</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve"> 8.5 bar &amp; check</w:t></w:r></w:p><w:p><w:r><w:t>Line two</w:t></w:r></w:p></w:body></w:document>'
    expect(docxXmlToText(xml)).toBe('Pressure 8.5 bar & check\n\nLine two')
  })

  it('rebuilds PDF pages with line order and paragraph gaps', () => {
    const items = [
      { page: 1, x: 10, y: 700, str: 'Title' },
      { page: 1, x: 60, y: 700, str: 'line' },
      { page: 1, x: 10, y: 688, str: 'next' },
      { page: 1, x: 10, y: 676, str: 'third' },
      { page: 1, x: 10, y: 620, str: 'new para' },
      { page: 2, x: 10, y: 700, str: 'Page two' },
    ]
    const pages = pdfItemsToPages(items)
    expect(pages).toEqual([
      { page: 1, text: 'Title line\nnext\nthird\n\nnew para' },
      { page: 2, text: 'Page two' },
    ])
    expect(pagesToText(pages)).toBe('Title line\nnext\nthird\n\nnew para\n\nPage two')
  })
})

describe('buildIngestRows', () => {
  const chunks = [
    { index: 1, content: 'one', pageFrom: 1, pageTo: 1 },
    { index: 2, content: 'two', pageFrom: 2, pageTo: 3 },
  ]
  it('builds a draft container parent and page-tagged chunks with no embedding', () => {
    const { parent, chunks: rows } = buildIngestRows({ title: ' Pressure SOP ', doc_type: 'sop', tags: [' a ', ''], version: '2', supersedes_id: 'old' }, chunks)
    expect(parent).toMatchObject({ title: 'Pressure SOP', status: 'draft', version: 2, chunk_count: 2, page_from: 1, page_to: 3, supersedes_id: 'old', embedding: null, tags: ['a'] })
    expect(rows[1]).toMatchObject({ title: 'Pressure SOP (part 2)', content: 'two', chunk_index: 2, page_from: 2, page_to: 3, chunk_count: 0, embedding: null })
    expect(rows[0]).not.toHaveProperty('status')
  })
  it('refuses a missing title, empty text or an oversized document', () => {
    expect(() => buildIngestRows({ title: '' }, chunks)).toThrow(/title/)
    expect(() => buildIngestRows({ title: 'x' }, [])).toThrow(/no readable text/)
    const many = Array.from({ length: MAX_CHUNKS_PER_DOCUMENT + 1 }, (_, i) => ({ index: i + 1, content: 'c' }))
    expect(() => buildIngestRows({ title: 'x' }, many)).toThrow(/too large/)
  })
})

describe('embeddingHealth', () => {
  const now = Date.parse('2026-11-10T12:00:00Z')
  it('reports stalled when chunks wait longer than the worker cadence', () => {
    const rows = [
      { chunk_count: 3, created_at: '2026-11-01T00:00:00Z', embedding: null }, // container: ignored
      { created_at: '2026-11-10T10:00:00Z', embedding: null },
      { created_at: '2026-11-10T11:55:00Z', embedding: null },
      { created_at: '2026-11-10T09:00:00Z', embedding: true },
    ]
    expect(embeddingHealth(rows, now)).toEqual({ state: 'stalled', pending: 2, stale: 1 })
    expect(embeddingHealth([rows[2]], now).state).toBe('queued')
    expect(embeddingHealth([rows[3]], now).state).toBe('ok')
    expect(embeddingHealth([], now).state).toBe('empty')
  })
})
