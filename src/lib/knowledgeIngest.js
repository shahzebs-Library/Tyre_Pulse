/**
 * knowledgeIngest - pure parsing + chunking for knowledge-base uploads.
 * No I/O: the file readers live in src/lib/api/knowledgeIngestion.js.
 *
 * Pipeline (ONE pipeline, the V98 one): a document is stored as a parent row
 * (chunk_of NULL, lifecycle columns, chunk_count = n) plus n chunk rows
 * (chunk_of = parent id, chunk_index 1..n, page_from/page_to). Chunks are
 * inserted WITHOUT an embedding; the embed-worker cron embeds them.
 *
 * Page numbers are kept per chunk so an AI answer can cite "p.3". Formats with
 * no page concept (plain text, DOCX) carry page null - never a guessed page.
 */

export const CHUNK_MAX_CHARS = 1500
export const CHUNK_OVERLAP = 200
/** Parent rows hold a preview, not the whole body (chunks hold the body). */
export const PARENT_PREVIEW_CHARS = 1500
/** Hard ceiling on chunks per upload; protects the worker and the insert. */
export const MAX_CHUNKS_PER_DOCUMENT = 2000

export const KB_ACCEPT = '.pdf,.docx,.txt,.md,.csv,.json,.log'

/** Clean extracted text: unify newlines, strip control chars, tidy spaces. */
export function normalizeText(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** File kind from name / MIME: 'pdf' | 'docx' | 'text' | null (unsupported). */
export function fileKind(file) {
  const name = String(file?.name || '').toLowerCase()
  const type = String(file?.type || '').toLowerCase()
  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf'
  if (name.endsWith('.docx') || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (/\.(txt|md|csv|json|log)$/.test(name) || type.startsWith('text/') || type === 'application/json') return 'text'
  if (name.endsWith('.doc')) return null // legacy binary Word: not parseable in the browser
  return null
}

const decodeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&')

/**
 * word/document.xml -> plain text. One paragraph per <w:p>, tabs and breaks
 * kept, everything else (formatting, fields, drawings) dropped.
 */
export function docxXmlToText(xml) {
  const src = String(xml ?? '')
  const body = src.includes('<w:body') ? src.slice(src.indexOf('<w:body')) : src
  const paras = body.split(/<\/w:p>/)
  const out = []
  for (const p of paras) {
    let line = ''
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g
    let m
    while ((m = re.exec(p)) !== null) {
      if (m[1] !== undefined) line += decodeXml(m[1])
      else if (m[0].startsWith('<w:tab')) line += '\t'
      else line += '\n'
    }
    if (line.trim()) out.push(line)
  }
  return normalizeText(out.join('\n\n'))
}

/**
 * Positioned PDF text items -> [{ page, text }]. Lines are rebuilt per page
 * (same y = same line, left to right) and a visual gap between lines larger
 * than ~1.6x the typical line step starts a new paragraph.
 * @param {Array<{page:number, x:number, y:number, str:string}>} items
 */
export function pdfItemsToPages(items) {
  const list = Array.isArray(items) ? items : []
  const pages = [...new Set(list.map((i) => i.page || 1))].sort((a, b) => a - b)
  return pages.map((page) => {
    const byY = new Map()
    for (const it of list) {
      if ((it.page || 1) !== page) continue
      const key = Math.round(Number(it.y) || 0)
      if (!byY.has(key)) byY.set(key, [])
      byY.get(key).push(it)
    }
    const ys = [...byY.keys()].sort((a, b) => b - a)
    const steps = []
    for (let i = 1; i < ys.length; i += 1) steps.push(ys[i - 1] - ys[i])
    const sorted = steps.slice().sort((a, b) => a - b)
    const typical = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
    const parts = []
    ys.forEach((y, i) => {
      const line = byY.get(y).sort((a, b) => a.x - b.x).map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim()
      if (!line) return
      if (i > 0 && typical > 0 && ys[i - 1] - y > typical * 1.6) parts.push('\n\n')
      else if (parts.length) parts.push('\n')
      parts.push(line)
    })
    return { page, text: normalizeText(parts.join('')) }
  }).filter((p) => p.text)
}

/** Split a too-long string into windows of <= max, preferring whitespace breaks. */
function hardSplit(str, max, tail) {
  const out = []
  let start = 0
  while (start < str.length) {
    let end = Math.min(str.length, start + max)
    if (end < str.length) {
      const ws = str.lastIndexOf(' ', end)
      const nl = str.lastIndexOf('\n', end)
      const cut = Math.max(ws, nl)
      if (cut > start + Math.floor(max * 0.6)) end = cut
    }
    out.push(str.slice(start, end).trim())
    if (end >= str.length) break
    const next = Math.max(start + 1, end - tail)
    start = next
  }
  return out.filter(Boolean)
}

const pageOf = (p) => (Number.isFinite(Number(p)) && Number(p) >= 1 ? Number(p) : null)

/**
 * Chunk page-tagged text with overlap, keeping page numbers.
 *
 * @param {Array<{page:number|null, text:string}>|string} pages  a string is one page-less document
 * @param {{maxChars?:number, overlap?:number}} [opts]
 * @returns {Array<{index:number, content:string, pageFrom:number|null, pageTo:number|null}>}
 *   index is 1-based. Every content is <= maxChars. Consecutive chunks share up
 *   to `overlap` trailing characters so a sentence across a boundary survives.
 */
export function chunkPages(pages, { maxChars = CHUNK_MAX_CHARS, overlap = CHUNK_OVERLAP } = {}) {
  const max = Math.max(50, Math.floor(maxChars))
  const tail = Math.max(0, Math.min(Math.floor(overlap), Math.floor(max / 2)))
  const src = typeof pages === 'string' ? [{ page: null, text: pages }] : (Array.isArray(pages) ? pages : [])

  // Paragraph stream, each tagged with its page. A paragraph longer than max
  // is first broken on its line breaks so we do not cut mid-sentence needlessly.
  const paras = []
  for (const p of src) {
    const page = pageOf(p?.page)
    for (const block of normalizeText(p?.text).split(/\n{2,}/)) {
      const b = block.trim()
      if (!b) continue
      if (b.length > max && b.includes('\n')) {
        for (const line of b.split('\n')) if (line.trim()) paras.push({ text: line.trim(), page })
      } else paras.push({ text: b, page })
    }
  }

  const chunks = []
  let cur = { text: '', pages: [], fresh: false }
  const span = (list) => {
    const nums = list.filter((n) => n != null)
    return nums.length ? [Math.min(...nums), Math.max(...nums)] : [null, null]
  }
  const push = (content, pagesList) => {
    const [from, to] = span(pagesList)
    chunks.push({ content, pageFrom: from, pageTo: to })
  }
  const flush = () => {
    if (!cur.fresh || !cur.text) return
    push(cur.text, cur.pages)
    const carry = tail > 0 ? cur.text.slice(-tail).trim() : ''
    const lastPage = cur.pages.length ? cur.pages[cur.pages.length - 1] : null
    cur = { text: carry, pages: carry ? [lastPage] : [], fresh: false }
  }

  for (const para of paras) {
    if (para.text.length > max) {
      flush()
      const windows = hardSplit(para.text, max, tail)
      windows.forEach((w) => push(w, [para.page]))
      const last = windows[windows.length - 1] || ''
      const carry = tail > 0 ? last.slice(-tail).trim() : ''
      cur = { text: carry, pages: carry ? [para.page] : [], fresh: false }
      continue
    }
    const joined = cur.text ? `${cur.text}\n\n${para.text}` : para.text
    if (joined.length <= max) {
      cur.text = joined
      cur.pages.push(para.page)
      cur.fresh = true
    } else {
      flush()
      const rejoined = cur.text ? `${cur.text}\n\n${para.text}` : para.text
      if (rejoined.length <= max) {
        cur.text = rejoined
        cur.pages.push(para.page)
      } else {
        // Keep as much of the carried tail as still fits, so the overlap is
        // not silently dropped next to a long paragraph.
        const room = max - para.text.length - 2
        const carry = room > 0 && cur.text ? cur.text.slice(-room).trim() : ''
        cur = carry
          ? { text: `${carry}\n\n${para.text}`, pages: [...cur.pages.slice(-1), para.page], fresh: false }
          : { text: para.text, pages: [para.page], fresh: false }
      }
      cur.fresh = true
    }
  }
  flush()
  return chunks.map((c, i) => ({ index: i + 1, ...c }))
}

/** Join page texts into one body (for previews / page-less storage). */
export function pagesToText(pages) {
  if (typeof pages === 'string') return normalizeText(pages)
  return normalizeText((Array.isArray(pages) ? pages : []).map((p) => p?.text || '').join('\n\n'))
}

const clean = (v) => {
  const s = v == null ? '' : String(v).trim()
  return s || null
}

/**
 * Build the rows to insert. The parent carries the lifecycle (always born a
 * draft - the server forces it too) and a preview; each chunk carries text,
 * position and pages, with no embedding (queued for embed-worker).
 *
 * @param {object} meta  { title, doc_type, site, asset_no, country, tags[], version,
 *   document_ref, effective_from, review_due, expires_at, supersedes_id,
 *   source_filename, source_mime }
 * @param {Array} chunks  output of chunkPages
 * @returns {{ parent: object, chunks: object[] }}  chunk rows lack chunk_of (set after the parent insert)
 */
export function buildIngestRows(meta = {}, chunks = []) {
  const title = clean(meta.title)
  if (!title) throw new Error('A document title is required.')
  const list = Array.isArray(chunks) ? chunks : []
  if (!list.length) throw new Error('The document has no readable text.')
  if (list.length > MAX_CHUNKS_PER_DOCUMENT) {
    throw new Error(`The document is too large (${list.length} chunks, limit ${MAX_CHUNKS_PER_DOCUMENT}). Split it into parts.`)
  }
  const tags = (Array.isArray(meta.tags) ? meta.tags : []).map((t) => String(t).trim()).filter(Boolean)
  const version = Number(meta.version)
  const shared = {
    doc_type: clean(meta.doc_type) || 'other',
    site: clean(meta.site),
    asset_no: clean(meta.asset_no),
    country: clean(meta.country),
    tags,
  }
  const body = list.map((c) => c.content).join('\n\n')
  const pagesSeen = list.flatMap((c) => [c.pageFrom, c.pageTo]).filter((n) => n != null)
  const parent = {
    ...shared,
    title,
    content: body.length > PARENT_PREVIEW_CHARS ? `${body.slice(0, PARENT_PREVIEW_CHARS)}...` : body,
    status: 'draft',
    version: Number.isFinite(version) && version >= 1 ? Math.floor(version) : 1,
    document_ref: clean(meta.document_ref),
    effective_from: clean(meta.effective_from),
    review_due: clean(meta.review_due),
    expires_at: clean(meta.expires_at),
    supersedes_id: clean(meta.supersedes_id),
    source_filename: clean(meta.source_filename),
    source_mime: clean(meta.source_mime),
    chunk_count: list.length,
    chunk_index: 0,
    page_from: pagesSeen.length ? Math.min(...pagesSeen) : null,
    page_to: pagesSeen.length ? Math.max(...pagesSeen) : null,
    embedding: null,
  }
  const rows = list.map((c) => ({
    ...shared,
    title: `${title} (part ${c.index})`,
    content: c.content,
    chunk_index: c.index,
    page_from: c.pageFrom,
    page_to: c.pageTo,
    chunk_count: 0,
    embedding: null,
  }))
  return { parent, chunks: rows }
}

/**
 * Embedding health for the page banner. embed-worker runs every 10 minutes, so
 * a chunk still un-embedded after `staleMinutes` means embeddings are not being
 * produced (OPENAI_API_KEY not configured, or the worker is failing).
 * @returns {{ state: 'ok'|'queued'|'stalled'|'empty', pending:number, stale:number }}
 */
export function embeddingHealth(rows = [], now = Date.now(), staleMinutes = 30) {
  const chunks = (Array.isArray(rows) ? rows : []).filter((r) => !(Number(r?.chunk_count) > 0))
  if (!chunks.length) return { state: 'empty', pending: 0, stale: 0 }
  let pending = 0
  let stale = 0
  for (const r of chunks) {
    if (r?.embedding) continue
    pending += 1
    const t = Date.parse(r?.created_at)
    if (Number.isFinite(t) && now - t > staleMinutes * 60_000) stale += 1
  }
  if (!pending) return { state: 'ok', pending, stale }
  return { state: stale > 0 ? 'stalled' : 'queued', pending, stale }
}
