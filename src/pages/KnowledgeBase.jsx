import { useState, useEffect, useCallback, useRef } from 'react'
import {
  BookOpen, Upload, Search, Trash2, Tag, Globe, Truck,
  FileText, AlertCircle, CheckCircle, Clock, RefreshCw,
  ChevronDown, X, Plus, Loader,
} from 'lucide-react'
import { supabase } from '../lib/supabase' // retained solely for reindexMissingEmbeddings(supabase)
import * as knowledgeDocuments from '../lib/api/knowledgeDocuments'
import { useAuth } from '../contexts/AuthContext'
import { generateEmbedding, reindexMissingEmbeddings } from '../lib/embeddingService'
import PageHeader from '../components/ui/PageHeader'

// ── Constants ─────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: 'sop',        label: 'SOP / Procedure',   color: 'text-blue-400',   bg: 'bg-blue-400/10'   },
  { value: 'manual',     label: 'Technical Manual',  color: 'text-purple-400', bg: 'bg-purple-400/10' },
  { value: 'policy',     label: 'Policy',            color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  { value: 'inspection', label: 'Inspection Report', color: 'text-green-400',  bg: 'bg-green-400/10'  },
  { value: 'rca',        label: 'RCA / Failure',     color: 'text-red-400',    bg: 'bg-red-400/10'    },
  { value: 'vendor',     label: 'Vendor Data',       color: 'text-orange-400', bg: 'bg-orange-400/10' },
  { value: 'other',      label: 'Other',             color: 'text-gray-400',   bg: 'bg-gray-400/10'   },
]

const CHUNK_SIZE = 1500  // chars per chunk (safe for embedding model)
const CHUNK_OVERLAP = 200

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDocTypeMeta(type) {
  return DOC_TYPES.find(d => d.value === type) ?? DOC_TYPES[DOC_TYPES.length - 1]
}

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = []
  let i = 0
  while (i < text.length) {
    chunks.push(text.slice(i, i + size))
    i += size - overlap
  }
  return chunks
}

async function readTextFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────

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
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-400/10 text-green-400 text-xs font-medium"><CheckCircle className="w-3 h-3" />Indexed</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-400/10 text-yellow-400 text-xs font-medium"><Clock className="w-3 h-3" />Pending</span>
}

function UploadModal({ onClose, onSuccess, sites }) {
  const [form, setForm] = useState({
    title: '', doc_type: 'sop', site: '', asset_no: '', tags: '', content: '',
  })
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const dropRef = useRef()

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleFile(f) {
    setFile(f)
    if (!form.title) set('title', f.name.replace(/\.[^.]+$/, ''))
    setProgress('Reading file...')
    try {
      const text = await readTextFromFile(f)
      set('content', text)
      setProgress('')
    } catch {
      setError('Could not read file. Only plain text / .txt / .md files are supported via browser. For PDF, paste the text below.')
      setProgress('')
    }
  }

  async function handleSubmit() {
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
        setProgress(`Embedding chunk ${idx + 1} / ${chunks.length}...`)
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
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
      setProgress('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-400/10 flex items-center justify-center">
              <Plus className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-white font-semibold">Add Knowledge Document</p>
              <p className="text-gray-400 text-xs mt-0.5">Upload a document to the AI knowledge base</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 flex flex-col gap-4">
          {/* File drop zone */}
          <div
            ref={dropRef}
            onDragOver={e => { e.preventDefault(); dropRef.current.classList.add('border-green-500') }}
            onDragLeave={() => dropRef.current.classList.remove('border-green-500')}
            onDrop={e => { e.preventDefault(); dropRef.current.classList.remove('border-green-500'); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            className="border-2 border-dashed border-gray-700 rounded-xl p-6 text-center cursor-pointer hover:border-gray-500 transition-colors"
            onClick={() => document.getElementById('kb-file-input').click()}
          >
            <input
              id="kb-file-input" type="file" className="hidden"
              accept=".txt,.md,.csv,.json,.log"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            <Upload className="w-8 h-8 text-gray-500 mx-auto mb-2" />
            <p className="text-gray-300 text-sm font-medium">{file ? file.name : 'Drop a file or click to browse'}</p>
            <p className="text-gray-500 text-xs mt-1">.txt · .md · .csv · .json - or paste text below</p>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Title *</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
              value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="e.g. Tyre Pressure SOP - Heavy Fleet"
            />
          </div>

          {/* Type + Site row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Document Type</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
                value={form.doc_type} onChange={e => set('doc_type', e.target.value)}
              >
                {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Site (optional)</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
                value={form.site} onChange={e => set('site', e.target.value)}
              >
                <option value="">All Sites</option>
                {sites.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Tags + Asset */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Tags (comma-separated)</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
                value={form.tags} onChange={e => set('tags', e.target.value)}
                placeholder="inflation, pressure, heavy-truck"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Asset No. (optional)</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-green-500 transition-colors"
                value={form.asset_no} onChange={e => set('asset_no', e.target.value)}
                placeholder="e.g. RMX-042"
              />
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
              Content * <span className="text-gray-500 normal-case font-normal">({form.content.length.toLocaleString()} chars · {chunkText(form.content).length} chunk{chunkText(form.content).length !== 1 ? 's' : ''})</span>
            </label>
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-green-500 transition-colors font-mono resize-none"
              rows={8}
              value={form.content} onChange={e => set('content', e.target.value)}
              placeholder="Paste document text here, or load from file above..."
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-800 flex items-center justify-between gap-3">
          <p className="text-gray-500 text-xs">{progress || (form.content ? `${chunkText(form.content).length} chunk(s) will be embedded` : '')}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm font-medium hover:bg-gray-700 transition-colors">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={uploading || !form.title.trim() || !form.content.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500 text-white text-sm font-semibold hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uploading ? <Loader className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Indexing...' : 'Upload & Index'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function KnowledgeBase() {
  const { profile } = useAuth()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterSite, setFilterSite] = useState('all')
  const [sites, setSites] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [reindexResult, setReindexResult] = useState(null)
  const [stats, setStats] = useState({ total: 0, indexed: 0, pending: 0 })

  const canWrite = ['Admin', 'Manager'].includes(profile?.role)

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await knowledgeDocuments.listKnowledgeDocuments()
      setDocs(rows)
      setStats({
        total: rows.length,
        indexed: rows.filter(d => d.embedding !== null).length,
        pending: rows.filter(d => d.embedding === null).length,
      })

      const uniqueSites = [...new Set(rows.map(d => d.site).filter(Boolean))].sort()
      setSites(uniqueSites)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this document from the knowledge base?')) return
    try {
      await knowledgeDocuments.deleteKnowledgeDocument(id)
    } catch (err) { setError(err.message); return }
    setDocs(prev => prev.filter(d => d.id !== id))
    setStats(prev => ({ ...prev, total: prev.total - 1 }))
  }

  const handleReindex = async () => {
    setReindexing(true)
    setReindexResult(null)
    try {
      const result = await reindexMissingEmbeddings(supabase)
      setReindexResult(`Re-indexed ${result.indexed} document${result.indexed !== 1 ? 's' : ''}.`)
      fetchDocs()
    } catch (e) {
      setReindexResult(`Error: ${e.message}`)
    } finally {
      setReindexing(false)
    }
  }

  const filtered = docs.filter(d => {
    if (filterType !== 'all' && d.doc_type !== filterType) return false
    if (filterSite !== 'all' && d.site !== filterSite) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        d.title?.toLowerCase().includes(q) ||
        d.doc_type?.toLowerCase().includes(q) ||
        d.site?.toLowerCase().includes(q) ||
        d.asset_no?.toLowerCase().includes(q) ||
        (d.tags ?? []).some(t => t.toLowerCase().includes(q))
      )
    }
    return true
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Knowledge Base"
        subtitle="RAG document ingestion for AI context retrieval"
        icon={BookOpen}
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Documents', value: stats.total, icon: FileText, color: 'text-blue-400', bg: 'bg-blue-400/10' },
          { label: 'Indexed (AI-Ready)', value: stats.indexed, icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-400/10' },
          { label: 'Pending Embedding', value: stats.pending, icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-52 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors"
            placeholder="Search by title, type, site, tag..."
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Type filter */}
        <div className="relative">
          <select
            className="appearance-none bg-gray-900 border border-gray-700 rounded-xl pl-3 pr-8 py-2.5 text-sm text-white focus:outline-none focus:border-green-500 transition-colors cursor-pointer"
            value={filterType} onChange={e => setFilterType(e.target.value)}
          >
            <option value="all">All Types</option>
            {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
        </div>

        {/* Site filter */}
        {sites.length > 0 && (
          <div className="relative">
            <select
              className="appearance-none bg-gray-900 border border-gray-700 rounded-xl pl-3 pr-8 py-2.5 text-sm text-white focus:outline-none focus:border-green-500 transition-colors cursor-pointer"
              value={filterSite} onChange={e => setFilterSite(e.target.value)}
            >
              <option value="all">All Sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
          </div>
        )}

        {/* Reindex pending */}
        {stats.pending > 0 && canWrite && (
          <button
            onClick={handleReindex}
            disabled={reindexing}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 text-sm font-medium hover:bg-yellow-400/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${reindexing ? 'animate-spin' : ''}`} />
            Re-index {stats.pending} pending
          </button>
        )}

        {/* Add document */}
        {canWrite && (
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-500 text-white text-sm font-semibold hover:bg-green-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Document
          </button>
        )}
      </div>

      {reindexResult && (
        <div className="flex items-center gap-2 text-green-400 text-sm bg-green-400/10 border border-green-400/20 rounded-xl px-4 py-3">
          <CheckCircle className="w-4 h-4" />{reindexResult}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4" />{error}
        </div>
      )}

      {/* Document list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <Loader className="w-6 h-6 animate-spin mr-3" />Loading knowledge base...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium text-gray-400">{docs.length === 0 ? 'No documents yet' : 'No documents match your filters'}</p>
          <p className="text-sm mt-1">{docs.length === 0 ? 'Upload SOPs, manuals, and policies to enable AI-powered knowledge retrieval.' : 'Try adjusting your search or filters.'}</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Title</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Site</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Tags</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Added</th>
                {canWrite && <th className="px-4 py-3 w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(doc => (
                <tr key={doc.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="text-white font-medium leading-tight">{doc.title}</p>
                    {doc.asset_no && (
                      <p className="text-gray-500 text-xs mt-0.5 flex items-center gap-1">
                        <Truck className="w-3 h-3" />{doc.asset_no}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3.5"><DocTypeBadge type={doc.doc_type} /></td>
                  <td className="px-4 py-3.5 hidden md:table-cell">
                    <span className="text-gray-400 text-xs flex items-center gap-1">
                      <Globe className="w-3 h-3" />{doc.site || 'All Sites'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {(doc.tags ?? []).slice(0, 3).map(tag => (
                        <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 text-xs">
                          <Tag className="w-2.5 h-2.5" />{tag}
                        </span>
                      ))}
                      {(doc.tags ?? []).length > 3 && (
                        <span className="text-gray-500 text-xs">+{doc.tags.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><EmbedStatusBadge hasEmbedding={!!doc.embedding} /></td>
                  <td className="px-4 py-3.5 text-gray-500 text-xs hidden md:table-cell">
                    {new Date(doc.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  {canWrite && (
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="p-1.5 rounded-lg hover:bg-red-400/10 text-gray-600 hover:text-red-400 transition-colors"
                        title="Delete document"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 border-t border-gray-800 text-gray-500 text-xs">
            {filtered.length} document{filtered.length !== 1 ? 's' : ''}{filtered.length !== docs.length ? ` (filtered from ${docs.length})` : ''}
          </div>
        </div>
      )}

      {modalOpen && (
        <UploadModal
          sites={sites}
          onClose={() => setModalOpen(false)}
          onSuccess={(chunks) => {
            setModalOpen(false)
            setReindexResult(`Uploaded and indexed ${chunks} chunk${chunks !== 1 ? 's' : ''} successfully.`)
            fetchDocs()
          }}
        />
      )}
    </div>
  )
}
