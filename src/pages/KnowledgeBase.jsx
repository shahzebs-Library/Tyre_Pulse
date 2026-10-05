/**
 * KnowledgeBase (route /knowledge-base) - the RAG knowledge library behind the
 * AI assistant, over the `knowledge_documents` corpus. Upload a document, it is
 * chunked and each chunk is embedded; retrieval then searches the chunks.
 *
 * Laid out to the owner's "Knowledge Base Reports" mockup on the Command Center
 * kit: KPI strip, collections, a document register (chunks grouped back into
 * source documents), a document detail panel, and a library report with
 * Excel/PDF export. The raw chunk register (open, approve, delete each chunk)
 * is kept as its own tab. Figures come from the pure
 * `src/lib/knowledgeBaseView.js` + `knowledgeBaseAnalytics.js` engines.
 *
 * Citations, knowledge-based report templates and AI-generated reports have no
 * source table yet: they read "Not recorded", never a number.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen, Upload, Search, Trash2, Tag, Globe, Truck,
  FileText, AlertCircle, CheckCircle, Clock, RefreshCw,
  X, Plus, Loader, Lock, FileSpreadsheet, Layers, Percent,
  FolderOpen, LayoutTemplate, FileBarChart, ChevronRight, ExternalLink, Info,
} from 'lucide-react'
import { supabase } from '../lib/supabase' // retained solely for reindexMissingEmbeddings(supabase)
import { toUserMessage } from '../lib/safeError'
import * as knowledgeDocuments from '../lib/api/knowledgeDocuments'
import { useAuth } from '../contexts/AuthContext'
import { generateEmbedding, reindexMissingEmbeddings } from '../lib/embeddingService'
import Modal from '../components/ui/Modal'
import SideDrawer from '../components/ui/SideDrawer'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import {
  Card, CardState, Kpi, KitTable, Tabs, MeterCell, fmtInt, fmtPct,
} from '../components/commandCenter/kit'
import { formatDate } from '../lib/formatters'
import {
  chunkText, kbSiteOptions, kbByType, kbTopTags,
  kbExportRows, baseTitle, docTypeLabel, KB_EXPORT_COLS, KB_EXPORT_HEADERS, kbTruncationNotice,
} from '../lib/knowledgeBaseAnalytics'
import {
  groupDocuments, collections as buildCollections, kbHeadline, filterDocuments, sortDocuments,
  monthlyAdded, governance, DOC_SORTS, INDEX_STATUS_META,
} from '../lib/knowledgeBaseView'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import './KnowledgeBase.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: 'sop',        color: 'text-blue-400',   bg: 'bg-blue-400/10'   },
  { value: 'manual',     color: 'text-purple-400', bg: 'bg-purple-400/10' },
  { value: 'policy',     color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  { value: 'inspection', color: 'text-green-400',  bg: 'bg-green-400/10'  },
  { value: 'rca',        color: 'text-red-400',    bg: 'bg-red-400/10'    },
  { value: 'vendor',     color: 'text-orange-400', bg: 'bg-orange-400/10' },
  { value: 'other',      color: 'text-[var(--text-secondary)]', bg: 'bg-[var(--input-bg)]' },
].map((d) => ({ ...d, label: docTypeLabel(d.value) }))


function getDocTypeMeta(type) {
  return DOC_TYPES.find(d => d.value === type) ?? DOC_TYPES[DOC_TYPES.length - 1]
}

async function readTextFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

// ── Sub-components ───────────────────────────────────────────────────────────

function DocTypeBadge({ type }) {
  const meta = getDocTypeMeta(type)
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.bg} ${meta.color}`}>
      {meta.label}
    </span>
  )
}

function EmbedStatusBadge({ hasEmbedding }) {
  return hasEmbedding
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-400/10 text-green-400 text-xs font-medium"><CheckCircle className="w-3 h-3" aria-hidden="true" />Indexed</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-400/10 text-yellow-400 text-xs font-medium"><Clock className="w-3 h-3" aria-hidden="true" />Pending</span>
}

function UploadModal({ onClose, onSuccess, sites }) {
  const [form, setForm] = useState({
    title: '', doc_type: 'sop', site: '', asset_no: '', tags: '', content: '',
  })
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)
  const chunkCount = chunkText(form.content).length

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleFile(f) {
    setFile(f)
    setError('')
    if (!form.title) set('title', f.name.replace(/\.[^.]+$/, ''))
    setProgress('Reading file')
    try {
      const text = await readTextFromFile(f)
      set('content', text)
      setProgress('')
    } catch {
      setError('Could not read file. Only plain text (.txt, .md, .csv, .json) files are supported in the browser. For a PDF, paste the text below.')
      setProgress('')
    }
  }

  async function handleSubmit(e) {
    e?.preventDefault?.()
    if (!form.title.trim() || !form.content.trim()) {
      setError('Title and content are required.')
      return
    }
    setUploading(true)
    setError('')
    try {
      const chunks = chunkText(form.content)
      const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean)

      for (let idx = 0; idx < chunks.length; idx++) {
        setProgress(`Embedding chunk ${idx + 1} of ${chunks.length}`)
        const chunkContent = chunks[idx]
        const embedding = await generateEmbedding(
          `${form.title}\n\n${chunkContent}`
        )

        await knowledgeDocuments.createKnowledgeDocument({
          title:     `${form.title}${chunks.length > 1 ? ` (${idx + 1}/${chunks.length})` : ''}`,
          content:   chunkContent,
          doc_type:  form.doc_type,
          site:      form.site || null,
          asset_no:  form.asset_no || null,
          tags,
          embedding,
        })
      }

      onSuccess(chunks.length)
    } catch (err) {
      setError(toUserMessage(err, 'Could not process the document. Try again.'))
    } finally {
      setUploading(false)
      setProgress('')
    }
  }

  const close = () => { if (!uploading) onClose() }

  return (
    <Modal
      open
      onClose={close}
      title="Add knowledge document"
      subtitle="Upload a document to the AI knowledge base"
      size="lg"
      footer={(
        <>
          <p className="text-[var(--text-muted)] text-xs mr-auto" aria-live="polite">{progress || (form.content ? `${chunkCount} chunk${chunkCount === 1 ? '' : 's'} will be embedded` : '')}</p>
          <button type="button" onClick={close} className="btn-secondary text-sm min-h-[44px]" disabled={uploading}>Cancel</button>
          <button
            type="submit"
            form="kb-upload-form"
            disabled={uploading || !form.title.trim() || !form.content.trim()}
            className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? <Loader className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
            {uploading ? 'Indexing' : 'Upload and index'}
          </button>
        </>
      )}
    >
      <form id="kb-upload-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          ref={fileRef} id="kb-file-input" type="file" className="sr-only"
          accept=".txt,.md,.csv,.json,.log"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
        <button
          type="button"
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${dragOver ? 'border-green-500' : 'border-[var(--border-bright)] hover:border-[var(--text-muted)]'}`}
        >
          <Upload className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2" aria-hidden="true" />
          <span className="block text-[var(--text-secondary)] text-sm font-medium">{file ? file.name : 'Drop a file or choose one to upload'}</span>
          <span className="block text-[var(--text-muted)] text-xs mt-1">.txt, .md, .csv or .json, or paste text below</span>
        </button>

        <div>
          <label htmlFor="kb-title" className="label">Title (required)</label>
          <input id="kb-title" required className="input w-full" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Tyre Pressure SOP: Heavy Fleet" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="kb-type" className="label">Document type</label>
            <select id="kb-type" className="input w-full" value={form.doc_type} onChange={e => set('doc_type', e.target.value)}>
              {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="kb-site" className="label">Site (optional)</label>
            <select id="kb-site" className="input w-full" value={form.site} onChange={e => set('site', e.target.value)}>
              <option value="">All sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="kb-tags" className="label">Tags (comma separated)</label>
            <input id="kb-tags" className="input w-full" value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="inflation, pressure, heavy-truck" />
          </div>
          <div>
            <label htmlFor="kb-asset" className="label">Asset no. (optional)</label>
            <input id="kb-asset" className="input w-full" value={form.asset_no} onChange={e => set('asset_no', e.target.value)} placeholder="e.g. RMX-042" />
          </div>
        </div>

        <div>
          <label htmlFor="kb-content" className="label">
            Content (required) <span className="text-[var(--text-muted)] normal-case font-normal">({form.content.length.toLocaleString()} characters, {chunkCount} chunk{chunkCount === 1 ? '' : 's'})</span>
          </label>
          <textarea
            id="kb-content"
            required
            className="input w-full font-mono text-xs"
            rows={8}
            value={form.content} onChange={e => set('content', e.target.value)}
            placeholder="Paste document text here, or load from a file above"
          />
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />{error}
          </div>
        )}
      </form>
    </Modal>
  )
}

// ── Main page ────────────────────────────────────────────────────────────

const TYPE_TONE = { sop: 't-blue', manual: 't-purple', policy: 't-amber', inspection: 't-green', rca: 't-red', vendor: 't-orange', other: 't-blue' }
const fmtDay = (v) => (v ? formatDate(v, 'All', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A')

function MiniBars({ items, color = 'var(--cc-green)', empty }) {
  const max = items.reduce((m, x) => Math.max(m, x.count), 0)
  if (!items.length || max === 0) return <div className="cc-empty">{empty}</div>
  return (
    <ul className="kb-bars">
      {items.map((x) => (
        <li key={x.key}>
          <span className="kb-bar-label">{x.label}</span>
          <span className="kb-bar-track"><i style={{ width: `${(x.count / max) * 100}%`, background: color }} /></span>
          <b>{fmtInt(x.count)}</b>
        </li>
      ))}
    </ul>
  )
}

export default function KnowledgeBase() {
  const { profile } = useAuth()
  const [docs, setDocs] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [search, setSearch] = useState('')
  const [collectionSearch, setCollectionSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterSite, setFilterSite] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [sort, setSort] = useState('updated')
  const [tab, setTab] = useState('documents')
  const [detailTab, setDetailTab] = useState('details')
  const [selectedKey, setSelectedKey] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [notice, setNotice] = useState(null)
  const [truncatedNotice, setTruncatedNotice] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  // Per-chunk detail surface (approval sign-off host).
  const [viewDoc, setViewDoc] = useState(null)
  // Approval-engine gate: locks delete for the open chunk while its workflow is
  // active (pending/in_review/returned) or locked (approved).
  const [wfLocked, setWfLocked] = useState(false)

  const canWrite = ['Admin', 'Manager'].includes(profile?.role)

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await knowledgeDocuments.listKnowledgeDocuments()
      setDocs(Array.isArray(rows) ? rows : [])
      // Captured here, not read off `docs`: a later local delete filters the
      // array and would drop the hidden `truncated` flag with it.
      setTruncatedNotice(kbTruncationNotice(rows))
      setNow(Date.now())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load knowledge base documents.'))
      setDocs(null)
      setTruncatedNotice(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDocs() }, [fetchDocs])
  useEffect(() => { setWfLocked(false) }, [viewDoc?.id])

  const chunks = useMemo(() => docs || [], [docs])
  const grouped = useMemo(() => groupDocuments(chunks), [chunks])
  const sites = useMemo(() => kbSiteOptions(chunks), [chunks])
  const head = useMemo(() => kbHeadline(grouped, now), [grouped, now])
  const cols = useMemo(() => buildCollections(grouped), [grouped])
  const hasFilters = filterType !== 'all' || filterSite !== 'all' || filterStatus !== 'all' || !!search.trim()
  const filteredDocs = useMemo(
    () => sortDocuments(filterDocuments(grouped, { type: filterType, site: filterSite, status: filterStatus, search }), sort),
    [grouped, filterType, filterSite, filterStatus, search, sort],
  )
  const filteredChunks = useMemo(() => filteredDocs.flatMap((d) => d.chunks), [filteredDocs])
  const selected = useMemo(
    () => grouped.find((d) => d.key === selectedKey) || filteredDocs[0] || null,
    [grouped, filteredDocs, selectedKey],
  )
  const byType = useMemo(() => kbByType(filteredChunks).filter((t) => t.chunks > 0).map((t) => ({ key: t.type, label: t.label, count: t.chunks })), [filteredChunks])
  const topTags = useMemo(() => kbTopTags(filteredChunks, 12), [filteredChunks])
  const months = useMemo(() => monthlyAdded(filteredDocs, now, 6), [filteredDocs, now])
  const shownCollections = cols.filter((c) => !collectionSearch.trim() || c.label.toLowerCase().includes(collectionSearch.trim().toLowerCase()))

  const isLocked = (id) => viewDoc?.id === id && wfLocked

  const requestDelete = (doc) => {
    if (isLocked(doc.id)) return
    setActionError('')
    setConfirmDelete(doc)
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    const id = confirmDelete.id
    if (isLocked(id)) { setConfirmDelete(null); return }
    setDeleting(true)
    try {
      await knowledgeDocuments.deleteKnowledgeDocument(id)
      setDocs((prev) => (prev || []).filter((d) => d.id !== id))
      if (viewDoc?.id === id) setViewDoc(null)
      setConfirmDelete(null)
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the document.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const handleReindex = async () => {
    setReindexing(true)
    setNotice(null)
    try {
      const result = await reindexMissingEmbeddings(supabase)
      setNotice({ tone: 'good', text: `Re-indexed ${result.indexed} document chunk${result.indexed !== 1 ? 's' : ''}.` })
      fetchDocs()
    } catch (e) {
      setNotice({ tone: 'bad', text: toUserMessage(e, 'Could not re-index the pending documents.') })
    } finally {
      setReindexing(false)
    }
  }

  const exportName = reportFileName('Knowledge Base')
  const runExport = async (kind) => {
    setActionError('')
    try {
      const out = kbExportRows(filteredChunks)
      if (kind === 'excel') await exportToExcel(out, KB_EXPORT_COLS, KB_EXPORT_HEADERS, exportName)
      else await exportToPdf(out, KB_EXPORT_COLS.map((k, i) => ({ key: k, header: KB_EXPORT_HEADERS[i] })), 'Knowledge Base', exportName, 'landscape')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const clearFilters = () => { setSearch(''); setFilterType('all'); setFilterSite('all'); setFilterStatus('all') }
  const selectDoc = (d) => { setSelectedKey(d.key); setDetailTab('details') }

  const loadState = { loading, data: docs, error, retry: fetchDocs }
  const known = docs !== null && !error
  const kv = (n) => (known ? n : null)

  const kpis = [
    { icon: BookOpen, tone: 't-green', value: kv(head.documents), label: 'Knowledge documents', trend: known ? head.docTrend : null, title: 'Source documents (chunks grouped by title). Trend compares documents added in the last 30 days with the 30 days before.' },
    { icon: Layers, tone: 't-blue', value: kv(head.indexed), label: `Indexed chunks, AI ready${known ? ` (of ${fmtInt(head.chunks)})` : ''}` },
    { icon: Percent, tone: 't-purple', display: known ? fmtPct(head.coveragePct) : 'N/A', label: 'Index coverage', title: 'Share of chunks that carry an embedding and can be retrieved by the AI' },
    { icon: LayoutTemplate, tone: 't-amber', display: 'N/A', label: 'Report templates', title: 'Not recorded: no knowledge-based report templates are stored yet' },
    { icon: FileBarChart, tone: 't-red', display: 'N/A', label: 'Generated reports', title: 'Not recorded: AI report generation from the knowledge base is not logged yet' },
  ]

  const docColumns = [
    {
      key: 'title', header: 'Document',
      cell: (d) => (
        <span className="kb-doc-cell">
          <span className={`kb-doc-icon ${TYPE_TONE[d.docType]}`}><FileText size={14} aria-hidden="true" /></span>
          <span className="kb-doc-title">{d.title}</span>
        </span>
      ),
    },
    { key: 'typeLabel', header: 'Collection' },
    { key: 'chunkCount', header: 'Chunks', numeric: true, cell: (d) => fmtInt(d.chunkCount) },
    { key: 'status', header: 'Index status', sortValue: (d) => INDEX_STATUS_META[d.status].label, cell: (d) => <span className={`cc-pill ${INDEX_STATUS_META[d.status].tone}`}>{INDEX_STATUS_META[d.status].label}</span> },
    { key: 'coveragePct', header: 'Coverage', cell: (d) => <MeterCell value={d.coveragePct} suffix="%" /> },
    { key: 'updatedAt', header: 'Updated', cell: (d) => fmtDay(d.updatedAt) },
  ]

  const chunkColumns = [
    {
      key: 'title', header: 'Chunk',
      cell: (c) => (
        <span>
          <button type="button" className="kb-link" onClick={(e) => { e.stopPropagation(); setViewDoc(c) }}>{c.title || 'Untitled'}</button>
          {c.asset_no && <span className="kb-sub"><Truck size={11} aria-hidden="true" /> {c.asset_no}</span>}
        </span>
      ),
    },
    { key: 'doc_type', header: 'Type', sortValue: (c) => docTypeLabel(c.doc_type), cell: (c) => docTypeLabel(c.doc_type) },
    { key: 'site', header: 'Site', cell: (c) => c.site || 'All sites' },
    { key: 'tags', header: 'Tags', sortable: false, cell: (c) => ((c.tags || []).length ? (c.tags || []).slice(0, 3).join(', ') + ((c.tags || []).length > 3 ? ` +${c.tags.length - 3}` : '') : <span className="cc-na">None</span>) },
    { key: 'embedding', header: 'AI index', sortValue: (c) => (c.embedding ? 1 : 0), cell: (c) => <span className={`cc-pill ${c.embedding ? 'good' : 'warn'}`}>{c.embedding ? 'Indexed' : 'Pending'}</span> },
    { key: 'created_at', header: 'Added', cell: (c) => fmtDay(c.created_at) },
    ...(canWrite ? [{
      key: 'actions', header: '', sortable: false,
      cell: (c) => (
        <button
          type="button"
          className="cc-icon-btn kb-danger"
          onClick={(e) => { e.stopPropagation(); requestDelete(c) }}
          disabled={isLocked(c.id)}
          aria-label={isLocked(c.id) ? `Locked, ${c.title || 'document'} is in approval` : `Delete ${c.title || 'document'}`}
          title={isLocked(c.id) ? 'Locked, in approval' : 'Delete chunk'}
        >
          {isLocked(c.id) ? <Lock size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
        </button>
      ),
    }] : []),
  ]

  const emptyLibrary = known && grouped.length === 0
    ? (
      <div>
        <BookOpen size={26} aria-hidden="true" />
        <p><b>No documents yet</b></p>
        <p>Upload SOPs, manuals and policies to enable AI knowledge retrieval.</p>
        {canWrite && <button type="button" className="cc-btn-primary" onClick={() => setModalOpen(true)}><Plus size={14} aria-hidden="true" /> Add the first document</button>}
      </div>
    )
    : null

  return (
    <div className="cc kb-page">
      <div className="kb-head">
        <div className="kb-head-copy">
          <nav className="kb-crumbs" aria-label="Breadcrumb">
            <Link to="/reports">Analytics and Reports</Link><ChevronRight size={12} aria-hidden="true" /><span aria-current="page">Knowledge Base</span>
          </nav>
          <div className="kb-title-row">
            <span className="kb-title-icon" aria-hidden="true"><BookOpen size={26} /></span>
            <div>
              <h1>Knowledge Base Reports</h1>
              <p>Turn fleet knowledge into answers. Search, explore and index approved documents for AI retrieval.</p>
            </div>
          </div>
        </div>
        <div className="kb-head-side">
          <label className="cc-search kb-global">
            <Search size={15} aria-hidden="true" />
            <input type="search" placeholder="Search documents, collections, topics" aria-label="Global knowledge search" value={search} onChange={(e) => { setSearch(e.target.value); setTab('documents') }} />
          </label>
          <div className="kb-head-actions">
            {canWrite && known && head.pending > 0 && (
              <button type="button" className="cc-btn-ghost" onClick={handleReindex} disabled={reindexing}>
                <RefreshCw size={15} className={reindexing ? 'animate-spin' : ''} aria-hidden="true" /> Re-index {fmtInt(head.pending)} pending
              </button>
            )}
            <button type="button" className="cc-btn-ghost" onClick={fetchDocs} disabled={loading} aria-label="Refresh"><RefreshCw size={15} aria-hidden="true" /></button>
            {canWrite && <button type="button" className="cc-btn-primary" onClick={() => setModalOpen(true)}><Plus size={15} aria-hidden="true" /> Add document</button>}
          </div>
        </div>
      </div>

      {truncatedNotice && <div className="cc-card kb-banner warn" role="status"><AlertCircle size={18} aria-hidden="true" /><p>{truncatedNotice}</p></div>}
      {actionError && (
        <div className="cc-card kb-banner bad" role="alert">
          <AlertCircle size={18} aria-hidden="true" /><p>{actionError}</p>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}
      {notice && (
        <div className={`cc-card kb-banner ${notice.tone === 'good' ? 'good' : 'bad'}`} role="status">
          {notice.tone === 'good' ? <CheckCircle size={18} aria-hidden="true" /> : <AlertCircle size={18} aria-hidden="true" />}<p>{notice.text}</p>
          <button type="button" className="cc-icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis kb-kpis">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading && docs === null} />)}
      </div>

      <Tabs
        label="Knowledge base views"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'documents', label: 'Documents', count: known ? grouped.length : null },
          { key: 'chunks', label: 'Chunk register', count: known ? chunks.length : null },
        ]}
      />

      {tab === 'chunks' ? (
        <Card
          title="Chunk register"
          sub="Every stored chunk. Open a chunk for its approval workflow; delete removes it from AI retrieval."
          action={(
            <div className="kb-head-actions">
              <button type="button" className="cc-btn-ghost" onClick={() => runExport('excel')} disabled={!known || !filteredChunks.length}><FileSpreadsheet size={15} aria-hidden="true" /> Excel</button>
              <button type="button" className="cc-btn-ghost" onClick={() => runExport('pdf')} disabled={!known || !filteredChunks.length}><FileText size={15} aria-hidden="true" /> PDF</button>
            </div>
          )}
        >
          <CardState state={loadState} empty={emptyLibrary}>
            <KitTable columns={chunkColumns} rows={filteredChunks} getRowId={(c) => String(c.id)} empty="No chunks match these filters." onRowClick={(c) => setViewDoc(c)} />
          </CardState>
        </Card>
      ) : (
        <div className="kb-grid">
          <div className="kb-col">
            <Card title="Knowledge Collections">
              <label className="cc-search kb-mini-search">
                <Search size={14} aria-hidden="true" />
                <input type="search" placeholder="Search collections" aria-label="Search collections" value={collectionSearch} onChange={(e) => setCollectionSearch(e.target.value)} />
              </label>
              <CardState state={loadState}>
                <ul className="kb-collections">
                  {shownCollections.map((c) => (
                    <li key={c.key}>
                      <button type="button" aria-pressed={filterType === c.key} onClick={() => setFilterType(c.key)}>
                        <span className={`kb-col-icon ${c.key === 'all' ? 't-blue' : TYPE_TONE[c.key]}`}><FolderOpen size={13} aria-hidden="true" /></span>
                        <span className="kb-col-label">{c.label}</span>
                        <b>{fmtInt(c.count)}</b>
                      </button>
                    </li>
                  ))}
                  {shownCollections.length === 0 && <li className="cc-empty">No collection matches.</li>}
                </ul>
              </CardState>
            </Card>

            <Card title="Most used tags">
              <CardState state={loadState} empty={known && topTags.length === 0 ? 'No tags recorded in this view. Tags help retrieval find documents.' : null}>
                <div className="kb-tags">
                  {topTags.map(({ tag, count }) => (
                    <button key={tag} type="button" onClick={() => setSearch(tag)} aria-label={`Search for tag ${tag}, used ${count} time${count === 1 ? '' : 's'}`}>
                      <Tag size={11} aria-hidden="true" />{tag}<span>{count}</span>
                    </button>
                  ))}
                </div>
              </CardState>
            </Card>

            <Card title="Report Templates">
              <div className="cc-empty">
                <div>
                  <LayoutTemplate size={22} aria-hidden="true" />
                  <p>No knowledge-based report templates are stored yet. Reports from fleet data are built in the Report Builder (administrators).</p>
                  {(profile?.role === 'Admin' || profile?.is_super_admin) && <Link className="cc-btn" to="/report-builder">Open Report Builder</Link>}
                </div>
              </div>
            </Card>
          </div>

          <div className="kb-col">
            <Card title="Knowledge Documents" className="kb-docs">
              <div className="cc-filters kb-filters">
                <select className="cc-select" aria-label="Collection" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                  {cols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <select className="cc-select" aria-label="Site" value={filterSite} onChange={(e) => setFilterSite(e.target.value)}>
                  <option value="all">All sites</option>
                  <option value="global">Global (no site)</option>
                  {sites.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="cc-select" aria-label="Index status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="all">Any index status</option>
                  {Object.entries(INDEX_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>
                <select className="cc-select" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                  {DOC_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div className="cc-filters kb-filters">
                <label className="cc-search">
                  <Search size={15} aria-hidden="true" />
                  <input type="search" placeholder="Search documents by title, collection, site, asset or tag" aria-label="Search documents" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
                {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" /> Clear</button>}
                <span className="kb-count" aria-live="polite">{known ? `${filteredDocs.length} of ${grouped.length} documents` : ''}</span>
              </div>
              <CardState state={loadState} empty={emptyLibrary}>
                <KitTable
                  columns={docColumns}
                  rows={filteredDocs}
                  getRowId={(d) => d.key}
                  empty={hasFilters ? 'No documents match these filters.' : 'No documents to show.'}
                  onRowClick={selectDoc}
                />
              </CardState>
            </Card>

            <Card
              title="Report Preview: Knowledge Library"
              sub={hasFilters ? 'Follows the filters above' : 'Whole library'}
              action={(
                <div className="kb-head-actions">
                  <button type="button" className="cc-btn-ghost" onClick={() => runExport('pdf')} disabled={!known || !filteredChunks.length}><FileText size={15} aria-hidden="true" /> Export PDF</button>
                  <button type="button" className="cc-btn-ghost" onClick={() => runExport('excel')} disabled={!known || !filteredChunks.length}><FileSpreadsheet size={15} aria-hidden="true" /> Export Excel</button>
                </div>
              )}
            >
              <CardState state={loadState} empty={emptyLibrary}>
                <div className="kb-report">
                  <div className="kb-report-tiles">
                    <div><span>Documents</span><b>{fmtInt(filteredDocs.length)}</b></div>
                    <div><span>Chunks</span><b>{fmtInt(filteredChunks.length)}</b></div>
                    <div><span>Indexed</span><b>{fmtInt(filteredChunks.filter((c) => c.embedding).length)}</b></div>
                    <div><span>Linked to an asset</span><b>{fmtInt(filteredDocs.filter((d) => d.assetNo).length)}</b></div>
                  </div>
                  <div className="kb-report-charts">
                    <div>
                      <h3>Documents added per month</h3>
                      <MiniBars items={months} empty="No documents added in the last 6 months." />
                    </div>
                    <div>
                      <h3>Chunks by collection</h3>
                      <MiniBars items={byType} color="var(--cc-blue)" empty="No chunks in this view." />
                    </div>
                  </div>
                  <p className="kb-note"><Info size={13} aria-hidden="true" /> AI-written reports from the knowledge base are not available yet. This preview is measured from the library itself.</p>
                </div>
              </CardState>
            </Card>
          </div>

          <div className="kb-col">
            <Card title="Document Details" className="kb-detail">
              <CardState state={loadState} empty={known && !selected ? 'Select a document to see its details.' : null}>
                {selected && (
                  <>
                    <div className="kb-detail-head">
                      <span className={`kb-doc-icon ${TYPE_TONE[selected.docType]}`}><FileText size={16} aria-hidden="true" /></span>
                      <h3>{selected.title}</h3>
                      <span className={`cc-pill ${INDEX_STATUS_META[selected.status].tone}`}>{INDEX_STATUS_META[selected.status].label}</span>
                    </div>
                    <Tabs
                      variant="line"
                      label="Document detail views"
                      value={detailTab}
                      onChange={setDetailTab}
                      tabs={[
                        { key: 'details', label: 'Details' },
                        { key: 'chunks', label: 'Chunks', count: selected.chunkCount },
                        { key: 'citations', label: 'Citations' },
                      ]}
                    />
                    {detailTab === 'details' && (
                      <dl className="kb-facts">
                        <div><dt>Title</dt><dd>{selected.title}</dd></div>
                        <div><dt>Collection</dt><dd>{selected.typeLabel}</dd></div>
                        <div><dt>Site</dt><dd>{selected.site || 'All sites'}</dd></div>
                        <div><dt>Asset</dt><dd>{selected.assetNo || <span className="cc-na">Not linked</span>}</dd></div>
                        <div><dt>Chunks</dt><dd>{fmtInt(selected.chunkCount)}</dd></div>
                        <div><dt>Indexed</dt><dd>{fmtInt(selected.indexed)}</dd></div>
                        <div><dt>Added</dt><dd>{fmtDay(selected.addedAt)}</dd></div>
                        <div><dt>Updated</dt><dd>{fmtDay(selected.updatedAt)}</dd></div>
                        <div><dt>Coverage</dt><dd><MeterCell value={selected.coveragePct} suffix="%" /></dd></div>
                        <div><dt>Tags</dt><dd>{selected.tags.length ? selected.tags.join(', ') : <span className="cc-na">None</span>}</dd></div>
                        <div><dt>Version / owner</dt><dd><span className="cc-na">Not recorded</span></dd></div>
                      </dl>
                    )}
                    {detailTab === 'chunks' && (
                      <ul className="kb-chunks">
                        {selected.chunks.map((c) => (
                          <li key={c.id}>
                            <button type="button" onClick={() => setViewDoc(c)}>
                              <span className="kb-chunk-title">{c.title || 'Untitled'}</span>
                              <span className={`cc-pill ${c.embedding ? 'good' : 'warn'}`}>{c.embedding ? 'Indexed' : 'Pending'}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {detailTab === 'citations' && (
                      <div className="cc-empty">Not recorded: AI answers do not log which document they cited yet, so citation counts and acceptance cannot be measured.</div>
                    )}
                    <h4 className="kb-gov-title">Governance</h4>
                    <ul className="kb-gov">
                      {governance(selected).map((g) => (
                        <li key={g.key} className={g.ok ? 'ok' : ''}>
                          {g.ok ? <CheckCircle size={15} aria-hidden="true" /> : <Clock size={15} aria-hidden="true" />}{g.label}
                        </li>
                      ))}
                    </ul>
                    <div className="kb-detail-actions">
                      <button type="button" className="cc-btn-primary" onClick={() => setViewDoc(selected.chunks[0])}><ExternalLink size={15} aria-hidden="true" /> Open document</button>
                      <button type="button" className="cc-btn-ghost" onClick={() => setDetailTab('chunks')}><Layers size={15} aria-hidden="true" /> View chunks ({fmtInt(selected.chunkCount)})</button>
                    </div>
                  </>
                )}
              </CardState>
            </Card>
          </div>
        </div>
      )}

      {/* Chunk detail drawer: approval sign-off + gated destructive control */}
      <SideDrawer
        open={!!viewDoc}
        onClose={() => setViewDoc(null)}
        size="md"
        closeLabel="Close document details"
        title={viewDoc ? (
          <span className="flex items-center gap-2 flex-wrap">
            <span className="truncate">{viewDoc.title}</span>
            <DocTypeBadge type={viewDoc.doc_type} />
          </span>
        ) : null}
        subtitle={viewDoc ? (
          <>
            <span className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1"><Globe className="w-3 h-3" aria-hidden="true" />{viewDoc.site || 'All sites'}</span>
              {viewDoc.asset_no && <span className="flex items-center gap-1"><Truck className="w-3 h-3" aria-hidden="true" />{viewDoc.asset_no}</span>}
              <EmbedStatusBadge hasEmbedding={!!viewDoc.embedding} />
            </span>
            <span className="block text-xs text-[var(--text-muted)] mt-1">Part of: {baseTitle(viewDoc.title)}</span>
          </>
        ) : null}
        footer={viewDoc && canWrite ? (
          <div className="flex items-center justify-between gap-3 w-full">
            {wfLocked
              ? <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><Lock className="w-3.5 h-3.5" aria-hidden="true" /> Locked, in approval</span>
              : <span className="text-xs text-[var(--text-muted)]">Removing a document also removes it from AI retrieval.</span>}
            <button
              type="button"
              onClick={() => requestDelete(viewDoc)}
              disabled={wfLocked}
              title={wfLocked ? 'Locked: document is in an approval workflow' : 'Delete document'}
              className="btn-danger text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" /> Delete
            </button>
          </div>
        ) : null}
      >
        {viewDoc && (
          <div className="flex flex-col gap-5">
            {(viewDoc.tags ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(viewDoc.tags ?? []).map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-secondary)] text-xs">
                    <Tag className="w-2.5 h-2.5" aria-hidden="true" />{tag}
                  </span>
                ))}
              </div>
            )}
            <EntityApprovalPanel
              entityType="document"
              entityId={viewDoc.id}
              entityLabel={viewDoc.title || viewDoc.doc_type || viewDoc.id}
              context={{
                doc_type: viewDoc.doc_type,
                asset_no: viewDoc.asset_no,
                tags: viewDoc.tags,
                site: viewDoc.site,
              }}
              onStateChange={({ isActive, isLocked: locked }) => setWfLocked(!!(isActive || locked))}
              title="Document Approval"
            />
          </div>
        )}
      </SideDrawer>

      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this document?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting' : 'Delete'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-[var(--text-muted)]">"{confirmDelete?.title}" will be removed from the knowledge base and from AI retrieval. This cannot be undone.</p>
      </Modal>

      {modalOpen && (
        <UploadModal
          sites={sites}
          onClose={() => setModalOpen(false)}
          onSuccess={(n) => {
            setModalOpen(false)
            setNotice({ tone: 'good', text: `Uploaded and indexed ${n} chunk${n !== 1 ? 's' : ''} successfully.` })
            fetchDocs()
          }}
        />
      )}
    </div>
  )
}
