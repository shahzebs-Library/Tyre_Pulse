/**
 * KnowledgeBase (route /knowledge-base) - RAG document ingestion for AI
 * context retrieval over the `knowledge_documents` corpus. Upload a document,
 * it is chunked and each chunk is embedded; retrieval then searches the
 * chunks. KPI strip (chunks vs source documents, index coverage), per-type
 * breakdown, search + type / site / index filters, a sortable EnterpriseTable
 * register, Excel/PDF export, a detail drawer hosting the document approval
 * workflow, and loading / empty / error states. Derived figures live in the
 * pure `src/lib/knowledgeBaseAnalytics.js` engine.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  BookOpen, Upload, Search, Trash2, Tag, Globe, Truck,
  FileText, AlertCircle, CheckCircle, Clock, RefreshCw,
  X, Plus, Loader, Lock, FileSpreadsheet, Layers, Percent, Filter,
} from 'lucide-react'
import { supabase } from '../lib/supabase' // retained solely for reindexMissingEmbeddings(supabase)
import { toUserMessage } from '../lib/safeError'
import * as knowledgeDocuments from '../lib/api/knowledgeDocuments'
import { useAuth } from '../contexts/AuthContext'
import { generateEmbedding, reindexMissingEmbeddings } from '../lib/embeddingService'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { formatDate } from '../lib/formatters'
import {
  chunkText, filterDocs, hasKbFilters, kbSiteOptions, kbKpis, kbByType, kbTopTags,
  kbExportRows, baseTitle, docTypeLabel, KB_EXPORT_COLS, KB_EXPORT_HEADERS, kbTruncationNotice,
} from '../lib/knowledgeBaseAnalytics'
import { colorAt, withAlpha } from '../lib/reportColors'
import { compareValues } from '../lib/consoleTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'

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

const sortBy = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

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

export default function KnowledgeBase() {
  const { profile } = useAuth()
  const [docs, setDocs] = useState(null)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterSite, setFilterSite] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [notice, setNotice] = useState(null)
  const [truncatedNotice, setTruncatedNotice] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  // Per-document detail surface (approval sign-off host).
  const [viewDoc, setViewDoc] = useState(null)
  // Approval-engine gate: locks delete for the open document while its
  // workflow is active (pending/in_review/returned) or locked (approved).
  const [wfLocked, setWfLocked] = useState(false)

  const canWrite = ['Admin', 'Manager'].includes(profile?.role)

  const fetchDocs = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const rows = await knowledgeDocuments.listKnowledgeDocuments()
      setDocs(Array.isArray(rows) ? rows : [])
      // Captured here, not read off `docs`: a later local delete filters the
      // array and would drop the hidden `truncated` flag with it.
      setTruncatedNotice(kbTruncationNotice(rows))
      setNow(Date.now())
      setUpdatedAt(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load knowledge base documents.'))
      setDocs([])
      setTruncatedNotice(null)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  // Reset the approval lock whenever a different document (or none) is opened in
  // the detail drawer; EntityApprovalPanel re-reports the true state via onStateChange.
  useEffect(() => { setWfLocked(false) }, [viewDoc?.id])

  // A failed read is not an empty library: figures read N/A, never zero.
  const known = docs !== null && !error
  const all = useMemo(() => docs || [], [docs])
  const sites = useMemo(() => kbSiteOptions(all), [all])
  const libraryKpi = useMemo(() => kbKpis(all, now), [all, now])
  const filters = { type: filterType, site: filterSite, status: filterStatus, search }
  const hasFilters = hasKbFilters(filters)
  const filtered = useMemo(
    () => filterDocs(all, { type: filterType, site: filterSite, status: filterStatus, search }),
    [all, filterType, filterSite, filterStatus, search],
  )
  const kpi = useMemo(() => kbKpis(filtered, now), [filtered, now])
  const byType = useMemo(() => kbByType(filtered), [filtered])
  const topTags = useMemo(() => kbTopTags(filtered, 12), [filtered])
  const maxType = byType.reduce((m, t) => Math.max(m, t.chunks), 0)

  const isLocked = (id) => viewDoc?.id === id && wfLocked

  const requestDelete = (doc) => {
    // Block deletion of a document whose approval workflow is active/locked.
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
      setDocs(prev => (prev || []).filter(d => d.id !== id))
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
      const out = kbExportRows(filtered)
      if (kind === 'excel') await exportToExcel(out, KB_EXPORT_COLS, KB_EXPORT_HEADERS, exportName)
      else await exportToPdf(out, KB_EXPORT_COLS.map((k, i) => ({ key: k, header: KB_EXPORT_HEADERS[i] })), 'Knowledge Base', exportName, 'landscape')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const clearFilters = () => { setSearch(''); setFilterType('all'); setFilterSite('all'); setFilterStatus('all') }

  const columns = [
    {
      id: 'title', header: 'Title', accessorFn: (d) => d.title || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 280,
      cell: ({ row: { original: doc } }) => (
        <div>
          <button
            type="button"
            onClick={() => setViewDoc(doc)}
            className="text-left text-[var(--text-primary)] font-medium leading-tight hover:text-green-400 underline-offset-2 hover:underline min-h-[32px]"
          >
            {doc.title || 'Untitled'}
          </button>
          {doc.asset_no && (
            <p className="text-[var(--text-muted)] text-xs mt-0.5 flex items-center gap-1">
              <Truck className="w-3 h-3" aria-hidden="true" />{doc.asset_no}
            </p>
          )}
        </div>
      ),
    },
    { id: 'type', header: 'Type', accessorFn: (d) => docTypeLabel(d.doc_type), sortingFn: sortBy, size: 150, cell: ({ row: { original: d } }) => <DocTypeBadge type={d.doc_type} /> },
    {
      id: 'site', header: 'Site', accessorFn: (d) => d.site || 'All sites', sortingFn: sortBy, size: 130,
      cell: ({ getValue }) => <span className="text-[var(--text-secondary)] text-xs flex items-center gap-1"><Globe className="w-3 h-3" aria-hidden="true" />{getValue()}</span>,
    },
    {
      id: 'tags', header: 'Tags', accessorFn: (d) => (d.tags || []).join(', '), enableSorting: false, size: 200,
      cell: ({ row: { original: doc } }) => (
        <div className="flex flex-wrap gap-1">
          {(doc.tags ?? []).slice(0, 3).map(tag => (
            <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-secondary)] text-xs">
              <Tag className="w-2.5 h-2.5" aria-hidden="true" />{tag}
            </span>
          ))}
          {(doc.tags ?? []).length > 3 && <span className="text-[var(--text-muted)] text-xs">+{doc.tags.length - 3}</span>}
          {(doc.tags ?? []).length === 0 && <span className="text-[var(--text-muted)] text-xs">None</span>}
        </div>
      ),
    },
    { id: 'status', header: 'AI index', accessorFn: (d) => (d.embedding ? 'Indexed' : 'Pending'), sortingFn: sortBy, size: 110, cell: ({ row: { original: d } }) => <EmbedStatusBadge hasEmbedding={!!d.embedding} /> },
    {
      id: 'added', header: 'Added', accessorFn: (d) => d.created_at || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 120,
      cell: ({ getValue }) => <span className="text-[var(--text-muted)] text-xs">{getValue() ? formatDate(getValue(), 'All', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}</span>,
    },
    ...(canWrite ? [{
      id: 'actions', header: '', enableSorting: false, size: 64, meta: { export: false },
      cell: ({ row: { original: doc } }) => (
        <button
          type="button"
          onClick={() => requestDelete(doc)}
          disabled={isLocked(doc.id)}
          className="inline-flex items-center justify-center w-11 h-11 rounded-lg hover:bg-red-400/10 text-[var(--text-dim)] hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label={isLocked(doc.id) ? `Locked, ${doc.title || 'document'} is in approval` : `Delete ${doc.title || 'document'}`}
          title={isLocked(doc.id) ? 'Locked, in approval' : 'Delete document'}
        >
          {isLocked(doc.id) ? <Lock className="w-4 h-4" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
        </button>
      ),
    }] : []),
  ]

  const kpis = [
    { label: 'Source documents', value: kpi.documents, sub: `${kpi.chunks} chunk${kpi.chunks === 1 ? '' : 's'}`, icon: FileText, tone: 'text-blue-400' },
    { label: 'Indexed (AI ready)', value: kpi.indexed, icon: CheckCircle, tone: 'text-green-400' },
    { label: 'Pending embedding', value: kpi.pending, icon: Clock, tone: kpi.pending > 0 ? 'text-yellow-400' : 'text-[var(--text-muted)]' },
    { label: 'Index coverage', value: kpi.coveragePct == null ? 'N/A' : `${kpi.coveragePct}%`, icon: Percent, tone: 'text-sky-400' },
    { label: 'Document types', value: kpi.types, sub: `${kpi.tags} distinct tag${kpi.tags === 1 ? '' : 's'}`, icon: Layers, tone: 'text-violet-400' },
    { label: 'Added last 30 days', value: kpi.addedLast30 ?? 'N/A', sub: `${kpi.assetLinked} linked to an asset`, icon: Upload, tone: 'text-[var(--text-primary)]' },
  ]
  const unavailable = 'Unavailable: the knowledge base could not be read.'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Knowledge Base"
        subtitle="RAG document ingestion for AI context retrieval"
        icon={BookOpen}
        onRefresh={fetchDocs}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => runExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!known || !filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => runExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!known || !filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            {canWrite && known && libraryKpi.pending > 0 && (
              <button type="button" onClick={handleReindex} disabled={reindexing} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
                <RefreshCw className={`w-4 h-4 ${reindexing ? 'animate-spin' : ''}`} aria-hidden="true" />
                Re-index {libraryKpi.pending} pending
              </button>
            )}
            {canWrite && (
              <button type="button" onClick={() => setModalOpen(true)} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
                <Plus className="w-4 h-4" aria-hidden="true" /> Add document
              </button>
            )}
          </div>
        }
      />

      {error && (
        <div role="alert" className="card border border-red-800/50 flex flex-wrap items-start gap-3">
          <AlertCircle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0"><p className="text-red-300 font-medium">Could not load the knowledge base.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button type="button" onClick={fetchDocs} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {truncatedNotice && (
        <div role="status" className="card border border-amber-700/50 flex items-start gap-3 text-sm">
          <AlertCircle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[var(--text-secondary)]">{truncatedNotice}</p>
        </div>
      )}
      {actionError && <p role="alert" className="card text-sm text-red-300">{actionError}</p>}
      {notice && (
        <div role="status" className={`flex items-center gap-2 text-sm rounded-xl px-4 py-3 border ${notice.tone === 'good' ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'}`}>
          {notice.tone === 'good' ? <CheckCircle className="w-4 h-4" aria-hidden="true" /> : <AlertCircle className="w-4 h-4" aria-hidden="true" />}{notice.text}
          <button type="button" onClick={() => setNotice(null)} className="ml-auto inline-flex items-center justify-center w-11 h-11 rounded-lg hover:bg-[var(--input-bg)]" aria-label="Dismiss message"><X className="w-4 h-4" aria-hidden="true" /></button>
        </div>
      )}

      {/* KPI strip (follows the filters) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{known ? k.value : 'N/A'}</p>
              {k.sub && known ? <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.sub}</p> : null}
            </div>
          )
        })}
      </div>

      {/* Type coverage + top tags */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Chunks by document type</h2>
          {docs === null ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-7 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : !known ? (
            <p className="text-sm text-[var(--text-muted)]">{unavailable}</p>
          ) : kpi.chunks === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{hasFilters ? 'No documents match these filters.' : 'No documents yet.'}</p>
          ) : (
            <ul className="space-y-2">
              {byType.filter((t) => t.chunks > 0).map((t, i) => (
                <li key={t.type}>
                  <button
                    type="button"
                    aria-pressed={filterType === t.type}
                    onClick={() => setFilterType(filterType === t.type ? 'all' : t.type)}
                    className="w-full text-left rounded-lg px-1 py-1 min-h-[44px] hover:bg-[var(--input-bg)] focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)]"
                  >
                    <span className="flex items-center justify-between text-xs mb-1">
                      <span className="text-[var(--text-secondary)]">{t.label}</span>
                      <span className="text-[var(--text-primary)] font-semibold tabular-nums">{t.chunks} <span className="text-[var(--text-muted)] font-normal">({t.indexed} indexed)</span></span>
                    </span>
                    <span className="block h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                      <span className="block h-full rounded-full" style={{ backgroundColor: withAlpha(colorAt(i), 0.85), width: `${maxType ? (t.chunks / maxType) * 100 : 0}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><Tag size={14} aria-hidden="true" /> Most used tags</h2>
          {docs === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : !known ? (
            <p className="text-sm text-[var(--text-muted)]">{unavailable}</p>
          ) : topTags.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No tags recorded in this view. Tags make documents easier for retrieval to find.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {topTags.map(({ tag, count }) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSearch(tag)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 min-h-[44px] rounded-lg bg-[var(--surface-3)] text-[var(--text-secondary)] text-xs hover:bg-[var(--input-bg)] focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)]"
                  aria-label={`Search for tag ${tag}, used ${count} time${count === 1 ? '' : 's'}`}
                >
                  <Tag className="w-3 h-3" aria-hidden="true" />{tag}<span className="text-[var(--text-muted)]">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px] relative">
            <label htmlFor="kb-search" className="sr-only">Search documents</label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="kb-search" type="search" className="input pl-9 w-full min-h-[44px]" placeholder="Search by title, type, site, asset, tag" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={filterType} onChange={e => setFilterType(e.target.value)} aria-label="Document type">
            <option value="all">All types</option>
            {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={filterSite} onChange={e => setFilterSite(e.target.value)} aria-label="Site">
            <option value="all">All sites</option>
            <option value="global">Global (no site)</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input min-h-[44px]" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label="AI index status">
            <option value="all">Any index status</option>
            <option value="indexed">Indexed</option>
            <option value="pending">Pending</option>
          </select>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{known ? `${filtered.length} of ${all.length} chunks` : 'N/A'}</span>
        </div>
      </div>

      {/* Register */}
      <div className="card overflow-hidden !p-0">
        {known && filtered.length === 0 ? (
          <div className="text-center py-16 px-4 text-[var(--text-muted)]">
            {all.length === 0 ? (
              <>
                <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-40" aria-hidden="true" />
                <p className="font-medium text-[var(--text-secondary)]">No documents yet</p>
                <p className="text-sm mt-1">Upload SOPs, manuals and policies to enable AI knowledge retrieval.</p>
                {canWrite && <button type="button" onClick={() => setModalOpen(true)} className="btn-primary text-sm inline-flex items-center gap-1.5 mt-3 min-h-[44px]"><Plus size={14} aria-hidden="true" /> Add the first document</button>}
              </>
            ) : (
              <>
                <Filter className="w-8 h-8 mx-auto mb-3 opacity-50" aria-hidden="true" />
                <p className="font-medium text-[var(--text-secondary)]">No documents match your filters</p>
                <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 mt-3 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>
              </>
            )}
          </div>
        ) : (
          <EnterpriseTable
            columns={columns}
            data={filtered}
            getRowId={(d) => String(d.id)}
            loading={docs === null}
            error={error || null}
            onRetry={fetchDocs}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="No documents to show."
          />
        )}
      </div>

      {/* Document detail drawer: approval sign-off + gated destructive control */}
      {viewDoc && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={() => setViewDoc(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="kb-drawer-title"
            className="tp-drawer-panel w-full max-w-lg h-full bg-[var(--surface-1)] border-l border-[var(--border-bright)] shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Escape') setViewDoc(null) }}
          >
            <div className="flex items-start justify-between gap-3 p-5 border-b border-[var(--border-dim)]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 id="kb-drawer-title" className="text-[var(--text-primary)] font-semibold truncate">{viewDoc.title}</h2>
                  <DocTypeBadge type={viewDoc.doc_type} />
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
                  <span className="flex items-center gap-1"><Globe className="w-3 h-3" aria-hidden="true" />{viewDoc.site || 'All sites'}</span>
                  {viewDoc.asset_no && <span className="flex items-center gap-1"><Truck className="w-3 h-3" aria-hidden="true" />{viewDoc.asset_no}</span>}
                  <EmbedStatusBadge hasEmbedding={!!viewDoc.embedding} />
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">Part of: {baseTitle(viewDoc.title)}</p>
              </div>
              <button type="button" autoFocus onClick={() => setViewDoc(null)} className="inline-flex items-center justify-center w-11 h-11 rounded-lg hover:bg-[var(--surface-2)] transition-colors flex-shrink-0" aria-label="Close document details">
                <X className="w-5 h-5 text-[var(--text-secondary)]" aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-y-auto p-5 flex flex-col gap-5 flex-1">
              {(viewDoc.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(viewDoc.tags ?? []).map(tag => (
                    <span key={tag} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-secondary)] text-xs">
                      <Tag className="w-2.5 h-2.5" aria-hidden="true" />{tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Approval & Workflow Engine */}
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

            {canWrite && (
              <div className="p-5 border-t border-[var(--border-dim)] flex items-center justify-between gap-3">
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
            )}
          </div>
        </div>
      )}

      {/* Delete confirm */}
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
          onSuccess={(chunks) => {
            setModalOpen(false)
            setNotice({ tone: 'good', text: `Uploaded and indexed ${chunks} chunk${chunks !== 1 ? 's' : ''} successfully.` })
            fetchDocs()
          }}
        />
      )}
    </div>
  )
}
