/**
 * knowledgeBaseAnalytics - pure presentation engine for the Knowledge Base
 * (/knowledge-base, the `knowledge_documents` RAG corpus). Owns chunking for
 * upload, filters, the KPI strip, the per-type breakdown and the export shape.
 * `now` is injected; no I/O.
 *
 * A long document is stored as several chunk rows titled "Name (2/5)". The KPI
 * strip reports both chunks (what retrieval searches) and source documents
 * (what a person uploaded), because counting chunks as documents overstates
 * the library.
 *
 * Honesty rule: index coverage over zero chunks is null (N/A), never 0% or 100%.
 */

export const CHUNK_SIZE = 1500 // chars per chunk (safe for the embedding model)
export const CHUNK_OVERLAP = 200

export const DOC_TYPE_VALUES = Object.freeze(['sop', 'manual', 'policy', 'inspection', 'rca', 'vendor', 'other'])
export const DOC_TYPE_LABEL = Object.freeze({
  sop: 'SOP / Procedure', manual: 'Technical Manual', policy: 'Policy', inspection: 'Inspection Report',
  rca: 'RCA / Failure', vendor: 'Vendor Data', other: 'Other',
})

const text = (v) => (v == null ? '' : String(v).trim())
const CHUNK_SUFFIX = /\s*\(\d+\/\d+\)\s*$/

/** Split text into overlapping chunks. Empty text yields no chunks. */
export function chunkText(input, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const s = input == null ? '' : String(input)
  const step = Math.max(1, size - overlap)
  const chunks = []
  for (let i = 0; i < s.length; i += step) chunks.push(s.slice(i, i + size))
  return chunks
}

/** The document a chunk belongs to ("Name (2/5)" -> "Name"). */
export function baseTitle(title) {
  return text(title).replace(CHUNK_SUFFIX, '') || 'Untitled'
}

export function docTypeLabel(t) {
  return DOC_TYPE_LABEL[t] || DOC_TYPE_LABEL.other
}

export const KB_FILTERS = Object.freeze({ type: 'all', site: 'all', status: 'all', search: '' })

export function hasKbFilters(f = KB_FILTERS) {
  return (f.type && f.type !== 'all') || (f.site && f.site !== 'all') || (f.status && f.status !== 'all') || !!text(f.search)
}

export function kbSiteOptions(docs = []) {
  return [...new Set((Array.isArray(docs) ? docs : []).map((d) => text(d?.site)).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** Filter by type, site (or "global" for docs with no site), index status and text. */
export function filterDocs(docs = [], f = KB_FILTERS) {
  const q = text(f.search).toLowerCase()
  return (Array.isArray(docs) ? docs : []).filter((d) => {
    if (f.type && f.type !== 'all' && d?.doc_type !== f.type) return false
    if (f.site === 'global' && text(d?.site)) return false
    if (f.site && f.site !== 'all' && f.site !== 'global' && text(d?.site) !== f.site) return false
    if (f.status === 'indexed' && !d?.embedding) return false
    if (f.status === 'pending' && d?.embedding) return false
    if (q) {
      const hay = `${d?.title || ''} ${d?.doc_type || ''} ${d?.site || ''} ${d?.asset_no || ''} ${(d?.tags || []).join(' ')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** KPI strip for a set of chunk rows at `now`. */
export function kbKpis(docs = [], now) {
  const list = Array.isArray(docs) ? docs : []
  const indexed = list.filter((d) => !!d?.embedding).length
  const sources = new Set(list.map((d) => `${d?.doc_type || ''}|${baseTitle(d?.title)}`))
  const types = new Set(list.map((d) => d?.doc_type).filter(Boolean))
  const tags = new Set(list.flatMap((d) => (Array.isArray(d?.tags) ? d.tags : [])).map((t) => text(t).toLowerCase()).filter(Boolean))
  const cutoff = Number.isFinite(now) ? now - 30 * 86_400_000 : null
  const recent = cutoff == null ? null : list.filter((d) => {
    const t = Date.parse(d?.created_at)
    return Number.isFinite(t) && t >= cutoff
  }).length
  return {
    chunks: list.length,
    documents: sources.size,
    indexed,
    pending: list.length - indexed,
    coveragePct: list.length ? Math.round((indexed / list.length) * 1000) / 10 : null,
    types: types.size,
    tags: tags.size,
    addedLast30: recent,
    assetLinked: list.filter((d) => text(d?.asset_no)).length,
  }
}

/** Chunks and indexed chunks per document type (canonical order, zero-filled). */
export function kbByType(docs = []) {
  const map = Object.fromEntries(DOC_TYPE_VALUES.map((t) => [t, { type: t, label: docTypeLabel(t), chunks: 0, indexed: 0 }]))
  for (const d of Array.isArray(docs) ? docs : []) {
    const t = map[d?.doc_type] ? d.doc_type : 'other'
    map[t].chunks += 1
    if (d?.embedding) map[t].indexed += 1
  }
  return DOC_TYPE_VALUES.map((t) => map[t])
}

/** Most used tags, most frequent first. */
export function kbTopTags(docs = [], limit = 12) {
  const counts = new Map()
  for (const d of Array.isArray(docs) ? docs : []) {
    for (const t of Array.isArray(d?.tags) ? d.tags : []) {
      const k = text(t)
      if (k) counts.set(k, (counts.get(k) || 0) + 1)
    }
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, Math.max(0, limit))
}

export const KB_EXPORT_COLS = ['title', 'document', 'doc_type', 'site', 'asset_no', 'tags', 'status', 'created_at']
export const KB_EXPORT_HEADERS = ['Title', 'Source document', 'Type', 'Site', 'Asset', 'Tags', 'AI index', 'Added']

export function kbExportRows(docs = []) {
  return (Array.isArray(docs) ? docs : []).map((d) => ({
    title: d?.title || '',
    document: baseTitle(d?.title),
    doc_type: docTypeLabel(d?.doc_type),
    site: text(d?.site) || 'All sites',
    asset_no: d?.asset_no || '',
    tags: (Array.isArray(d?.tags) ? d.tags : []).join(', '),
    status: d?.embedding ? 'Indexed' : 'Pending',
    created_at: text(d?.created_at).slice(0, 10),
  }))
}
