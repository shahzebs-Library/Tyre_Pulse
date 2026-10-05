/**
 * knowledgeBaseView - pure shaping for the Knowledge Base page (/knowledge-base)
 * in the owner's "Knowledge Base Reports" mockup layout. No I/O; `now` is
 * injected. Builds on knowledgeBaseAnalytics (chunking, labels, KPI basics).
 *
 * The `knowledge_documents` table stores CHUNKS ("Manual (2/5)"). The mockup is
 * document-centred, so chunks are grouped back into source documents here.
 *
 * Honesty rules:
 *  - "Coverage" is the share of a document's chunks that carry an embedding
 *    (indexed for AI retrieval). It is measured, not estimated.
 *  - Citations, report templates and generated reports have no source table:
 *    they are null ("Not recorded"), never 0.
 *  - A trend is returned only when the previous 30-day window holds at least
 *    one document to compare against.
 */
import { baseTitle, docTypeLabel, DOC_TYPE_VALUES } from './knowledgeBaseAnalytics'

const DAY_MS = 86_400_000
const PART = /\((\d+)\/(\d+)\)\s*$/
const text = (v) => (v == null ? '' : String(v).trim())
const ts = (v) => {
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/** Part number of a chunk title ("Name (2/5)" -> 2), or 1. */
export function chunkPart(title) {
  const m = PART.exec(text(title))
  return m ? Number(m[1]) : 1
}

/** Index status of a grouped document from its indexed / chunk counts. */
export function indexStatus(indexed, chunks) {
  if (!chunks) return 'pending'
  if (indexed >= chunks) return 'indexed'
  return indexed > 0 ? 'partial' : 'pending'
}

export const INDEX_STATUS_META = Object.freeze({
  indexed: { label: 'Indexed', tone: 'good' },
  partial: { label: 'Partly indexed', tone: 'warn' },
  pending: { label: 'Pending', tone: 'muted' },
})

/**
 * Group chunk rows into source documents (key = type + base title). Each
 * document keeps its chunks in part order so the first part opens first.
 */
export function groupDocuments(chunks = []) {
  const map = new Map()
  for (const c of Array.isArray(chunks) ? chunks : []) {
    const type = DOC_TYPE_VALUES.includes(c?.doc_type) ? c.doc_type : 'other'
    const title = baseTitle(c?.title)
    const key = `${type}|${title}`
    let d = map.get(key)
    if (!d) {
      d = { key, title, docType: type, typeLabel: docTypeLabel(type), sites: new Set(), assets: new Set(), tags: new Set(), chunks: [], indexed: 0, addedAt: null, updatedAt: null }
      map.set(key, d)
    }
    d.chunks.push(c)
    if (c?.embedding) d.indexed += 1
    if (text(c?.site)) d.sites.add(text(c.site))
    if (text(c?.asset_no)) d.assets.add(text(c.asset_no))
    for (const t of Array.isArray(c?.tags) ? c.tags : []) if (text(t)) d.tags.add(text(t))
    const added = ts(c?.created_at)
    const updated = ts(c?.updated_at) ?? added
    if (added != null && (d.addedAt == null || added < d.addedAt)) d.addedAt = added
    if (updated != null && (d.updatedAt == null || updated > d.updatedAt)) d.updatedAt = updated
  }
  return [...map.values()].map((d) => {
    const chunkList = d.chunks.slice().sort((a, b) => chunkPart(a?.title) - chunkPart(b?.title))
    const n = chunkList.length
    return {
      key: d.key,
      title: d.title,
      docType: d.docType,
      typeLabel: d.typeLabel,
      site: d.sites.size === 1 ? [...d.sites][0] : (d.sites.size > 1 ? 'Several sites' : ''),
      assetNo: [...d.assets].join(', '),
      tags: [...d.tags].sort((a, b) => a.localeCompare(b)),
      chunks: chunkList,
      chunkCount: n,
      indexed: d.indexed,
      coveragePct: n ? Math.round((d.indexed / n) * 100) : null,
      status: indexStatus(d.indexed, n),
      addedAt: d.addedAt,
      updatedAt: d.updatedAt,
    }
  })
}

/** Collections list: "All" first, then every document type with its count. */
export function collections(docs = []) {
  const list = Array.isArray(docs) ? docs : []
  const counts = Object.fromEntries(DOC_TYPE_VALUES.map((t) => [t, 0]))
  for (const d of list) counts[d.docType] = (counts[d.docType] || 0) + 1
  return [
    { key: 'all', label: 'All collections', count: list.length },
    ...DOC_TYPE_VALUES.map((t) => ({ key: t, label: docTypeLabel(t), count: counts[t] })),
  ]
}

/**
 * Headline tiles. `docTrend` compares documents first added in the last 30
 * days with the 30 days before; null when the earlier window is empty.
 */
export function kbHeadline(docs = [], now) {
  const list = Array.isArray(docs) ? docs : []
  const chunks = list.reduce((s, d) => s + d.chunkCount, 0)
  const indexed = list.reduce((s, d) => s + d.indexed, 0)
  let recent = null
  let prior = null
  if (Number.isFinite(now)) {
    recent = 0; prior = 0
    for (const d of list) {
      if (d.addedAt == null) continue
      const age = now - d.addedAt
      if (age >= 0 && age < 30 * DAY_MS) recent += 1
      else if (age >= 30 * DAY_MS && age < 60 * DAY_MS) prior += 1
    }
  }
  return {
    documents: list.length,
    chunks,
    indexed,
    pending: chunks - indexed,
    coveragePct: chunks ? Math.round((indexed / chunks) * 1000) / 10 : null,
    addedLast30: recent,
    docTrend: prior ? Math.round(((recent - prior) / prior) * 100) : null,
    citations: null,
    reportTemplates: null,
    generatedReports: null,
  }
}

export const DOC_SORTS = Object.freeze([
  { key: 'updated', label: 'Recently updated' },
  { key: 'title', label: 'Title A to Z' },
  { key: 'coverage', label: 'Lowest coverage' },
  { key: 'chunks', label: 'Most chunks' },
])

/** Filter grouped documents by type, site, index status and search text. */
export function filterDocuments(docs = [], { type = 'all', site = 'all', status = 'all', search = '' } = {}) {
  const q = text(search).toLowerCase()
  return (Array.isArray(docs) ? docs : []).filter((d) => {
    if (type !== 'all' && d.docType !== type) return false
    if (site === 'global' && d.site) return false
    if (site !== 'all' && site !== 'global' && d.site !== site) return false
    if (status !== 'all' && d.status !== status) return false
    if (q) {
      const hay = `${d.title} ${d.typeLabel} ${d.site} ${d.assetNo} ${d.tags.join(' ')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Sort grouped documents (stable copy). */
export function sortDocuments(docs = [], sort = 'updated') {
  const list = (Array.isArray(docs) ? docs : []).slice()
  const byTitle = (a, b) => a.title.localeCompare(b.title)
  if (sort === 'title') return list.sort(byTitle)
  if (sort === 'coverage') return list.sort((a, b) => (a.coveragePct ?? -1) - (b.coveragePct ?? -1) || byTitle(a, b))
  if (sort === 'chunks') return list.sort((a, b) => b.chunkCount - a.chunkCount || byTitle(a, b))
  return list.sort((a, b) => (b.updatedAt ?? -Infinity) - (a.updatedAt ?? -Infinity) || byTitle(a, b))
}

/** Documents first added per month for the last `months` months (oldest first). */
export function monthlyAdded(docs = [], now, months = 6) {
  if (!Number.isFinite(now)) return []
  const ref = new Date(now)
  const out = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - i, 1))
    out.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }), count: 0 })
  }
  const index = new Map(out.map((b) => [b.key, b]))
  for (const doc of Array.isArray(docs) ? docs : []) {
    if (doc.addedAt == null) continue
    const d = new Date(doc.addedAt)
    const b = index.get(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
    if (b) b.count += 1
  }
  return out
}

/** Governance checklist for a document, each line from a real field. */
export function governance(doc) {
  if (!doc) return []
  return [
    { key: 'ai', label: doc.status === 'indexed' ? 'Indexed for AI retrieval' : 'Not fully indexed for AI retrieval', ok: doc.status === 'indexed' },
    { key: 'scope', label: doc.site ? `Site scope: ${doc.site}` : 'Scope: all sites', ok: true },
    { key: 'asset', label: doc.assetNo ? `Linked to asset ${doc.assetNo}` : 'Not linked to an asset', ok: !!doc.assetNo },
    { key: 'tags', label: doc.tags.length ? `${doc.tags.length} tag${doc.tags.length === 1 ? '' : 's'} for retrieval` : 'No tags recorded', ok: doc.tags.length > 0 },
  ]
}
