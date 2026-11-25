/**
 * OEM manuals are stored as page packs: the PDF is split into files of
 * OEM_PDF_CHUNK_PAGES pages at import, and the viewer opens only the pack that
 * holds the page being looked at. A large book then never hits the storage
 * upload limit and is never downloaded whole to show one figure.
 *
 * createChunkedDoc returns an object with the small part of the pdf.js document
 * API the catalogue uses (numPages, getPage, destroy), so the figure viewer,
 * the review workspace and the re-extraction run work unchanged.
 */

export const OEM_PDF_CHUNK_PAGES = 40

/** Page ranges for a document of numPages pages: [{ from, to }] (1-based, inclusive). */
export function planChunks(numPages, size = OEM_PDF_CHUNK_PAGES) {
  const n = Math.max(0, Math.floor(Number(numPages) || 0))
  const step = Math.max(1, Math.floor(Number(size) || OEM_PDF_CHUNK_PAGES))
  const out = []
  for (let from = 1; from <= n; from += step) out.push({ from, to: Math.min(n, from + step - 1) })
  return out
}

/** The pack holding a page, or null. */
export function chunkForPage(chunks, page) {
  const p = Number(page)
  if (!Array.isArray(chunks) || !Number.isFinite(p)) return null
  return chunks.find((c) => p >= c.from && p <= c.to) || null
}

/** Storage file name for a pack. */
export function chunkPath(manualId, { from, to }) {
  const pad = (v) => String(v).padStart(4, '0')
  return `${manualId}/pages-${pad(from)}-${pad(to)}.pdf`
}

/**
 * Split PDF bytes into packs. pdf-lib is loaded only when a manual is imported.
 * Returns [{ from, to, bytes }].
 */
export async function splitPdf(bytes, size = OEM_PDF_CHUNK_PAGES) {
  const { PDFDocument } = await import('pdf-lib')
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const plan = planChunks(src.getPageCount(), size)
  const out = []
  for (const c of plan) {
    const part = await PDFDocument.create()
    const indices = []
    for (let i = c.from - 1; i <= c.to - 1; i += 1) indices.push(i)
    const pages = await part.copyPages(src, indices)
    pages.forEach((p) => part.addPage(p))
    out.push({ ...c, bytes: await part.save({ useObjectStreams: true }) })
  }
  return out
}

/**
 * A lazily loaded document over packs. openChunk(chunk) must resolve to a
 * pdf.js document for that pack; each pack is opened at most once.
 */
export function createChunkedDoc({ numPages, chunks, openChunk }) {
  const opened = new Map()
  let destroyed = false
  const load = (chunk) => {
    if (!opened.has(chunk.from)) opened.set(chunk.from, Promise.resolve().then(() => openChunk(chunk)))
    return opened.get(chunk.from)
  }
  return {
    numPages: Number(numPages) || (chunks.length ? chunks[chunks.length - 1].to : 0),
    async getPage(pageNo) {
      if (destroyed) throw new Error('This manual was closed.')
      const chunk = chunkForPage(chunks, pageNo)
      if (!chunk) throw new Error(`Page ${pageNo} is not in this manual.`)
      const doc = await load(chunk)
      return doc.getPage(Number(pageNo) - chunk.from + 1)
    },
    destroy() {
      destroyed = true
      for (const p of opened.values()) p.then((d) => d?.destroy?.()).catch(() => {})
      opened.clear()
    },
  }
}
