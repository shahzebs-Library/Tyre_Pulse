import { describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { chunkForPage, chunkPath, createChunkedDoc, planChunks, splitPdf } from '../lib/oemPdfChunks'

describe('planChunks', () => {
  it('covers every page exactly once', () => {
    expect(planChunks(886, 40)).toHaveLength(23)
    expect(planChunks(886, 40).at(-1)).toEqual({ from: 881, to: 886 })
    expect(planChunks(40, 40)).toEqual([{ from: 1, to: 40 }])
    expect(planChunks(0)).toEqual([])
  })
})

describe('chunkForPage and chunkPath', () => {
  const chunks = planChunks(100, 40)
  it('finds the pack for a page', () => {
    expect(chunkForPage(chunks, 1)).toEqual({ from: 1, to: 40 })
    expect(chunkForPage(chunks, 41)).toEqual({ from: 41, to: 80 })
    expect(chunkForPage(chunks, 100)).toEqual({ from: 81, to: 100 })
    expect(chunkForPage(chunks, 101)).toBeNull()
  })
  it('names pack files by page range', () => {
    expect(chunkPath('m1', { from: 41, to: 80 })).toBe('m1/pages-0041-0080.pdf')
  })
})

describe('createChunkedDoc', () => {
  it('opens only the pack that holds the page and maps the page number', async () => {
    const opened = []
    const openChunk = vi.fn(async (c) => {
      opened.push(c.from)
      return { getPage: async (n) => ({ pack: c.from, local: n }), destroy: vi.fn() }
    })
    const doc = createChunkedDoc({ numPages: 100, chunks: planChunks(100, 40), openChunk })
    expect(doc.numPages).toBe(100)
    expect(await doc.getPage(45)).toEqual({ pack: 41, local: 5 })
    expect(await doc.getPage(50)).toEqual({ pack: 41, local: 10 })
    expect(opened).toEqual([41])
    expect(await doc.getPage(1)).toEqual({ pack: 1, local: 1 })
    expect(openChunk).toHaveBeenCalledTimes(2)
    await expect(doc.getPage(200)).rejects.toThrow(/not in this manual/)
    doc.destroy()
    await expect(doc.getPage(1)).rejects.toThrow(/closed/)
  })
})

describe('splitPdf', () => {
  it('splits a real PDF into packs with the right page counts', async () => {
    const src = await PDFDocument.create()
    for (let i = 0; i < 5; i += 1) src.addPage([200, 200])
    const packs = await splitPdf(await src.save(), 2)
    expect(packs.map((p) => [p.from, p.to])).toEqual([[1, 2], [3, 4], [5, 5]])
    const counts = await Promise.all(packs.map(async (p) => (await PDFDocument.load(p.bytes)).getPageCount()))
    expect(counts).toEqual([2, 2, 1])
  })
})
