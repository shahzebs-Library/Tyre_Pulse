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
  FolderOpen, LayoutTemplate, ChevronRight, ExternalLink, Info,
  MoreVertical, Sparkles, Save, Quote, Database, ShieldCheck, Ban, GitBranch, CalendarClock,
} from 'lucide-react'
import { supabase } from '../lib/supabase' // retained solely for reindexMissingEmbeddings(supabase)
import { toUserMessage } from '../lib/safeError'
import * as knowledgeDocuments from '../lib/api/knowledgeDocuments'
import { useAuth } from '../contexts/AuthContext'
import { reindexMissingEmbeddings } from '../lib/embeddingService'
import { extractDocument, ingestDocument, approveKnowledgeDocument, withdrawKnowledgeDocument } from '../lib/api/knowledgeIngestion'
import { chunkPages, pagesToText, embeddingHealth, KB_ACCEPT } from '../lib/knowledgeIngest'
import {
  KB_STATUS_META, effectiveStatus, reviewState, reviewNote, canApprove, canWithdraw, canSupersede,
  nextVersion, validateLifecycleDates, lifecycleCounts, toDay,
} from '../lib/knowledgeLifecycle'
import Modal from '../components/ui/Modal'
import SideDrawer from '../components/ui/SideDrawer'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import {
  Card, CardState, KitTable, Tabs, MeterCell, Trend, fmtInt, fmtPct,
} from '../components/commandCenter/kit'
import { formatDate } from '../lib/formatters'
import {
  kbSiteOptions, kbByType, kbTopTags,
  kbExportRows, baseTitle, docTypeLabel, KB_EXPORT_COLS, KB_EXPORT_HEADERS, kbTruncationNotice,
} from '../lib/knowledgeBaseAnalytics'
import {
  groupDocuments, collections as buildCollections, kbHeadline, filterDocuments, sortDocuments,
  monthlyAdded, governance, DOC_SORTS, INDEX_STATUS_META, lineChartPoints, percentShares,
} from '../lib/knowledgeBaseView'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import './KnowledgeBase.css'
import TableNotInUse from '../components/ui/TableNotInUse'

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

function UploadModal({ onClose, onSuccess, sites, base = null }) {
  // `base` = the approved document this upload supersedes (new version flow).
  const [form, setForm] = useState(() => ({
    title: base?.title || '',
    doc_type: base?.docType || 'sop',
    site: base?.site && base.site !== 'Several sites' ? base.site : '',
    asset_no: base?.assetNo || '',
    tags: (base?.tags || []).join(', '),
    content: '',
    version: base ? String(nextVersion(base.lifecycle)) : '1',
    document_ref: base?.lifecycle?.document_ref || '',
    effective_from: '',
    review_due: '',
    expires_at: '',
  }))
  // Page-tagged text from a parsed file. null = the textarea is the source
  // (pasted or edited text has no page numbers).
  const [pages, setPages] = useState(null)
  const [fileInfo, setFileInfo] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [reading, setReading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)
  const source = pages ?? form.content
  const chunkCount = useMemo(() => chunkPages(source).length, [source])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleFile(f) {
    setError('')
    setReading(true)
    setProgress('Reading file')
    try {
      const out = await extractDocument(f)
      setPages(out.pages)
      setFileInfo({ name: f.name, type: f.type || out.kind, kind: out.kind, pageCount: out.pageCount })
      set('content', pagesToText(out.pages))
      if (!form.title) set('title', f.name.replace(/\.[^.]+$/, ''))
    } catch (err) {
      setPages(null)
      setFileInfo(null)
      setError(toUserMessage(err, 'Could not read this file. Upload a PDF, a Word .docx file or a text file.'))
    } finally {
      setReading(false)
      setProgress('')
    }
  }

  async function handleSubmit(e) {
    e?.preventDefault?.()
    if (!form.title.trim() || !String(form.content).trim()) {
      setError('Title and content are required.')
      return
    }
    const dateErr = validateLifecycleDates(form)
    if (dateErr) { setError(dateErr); return }
    setUploading(true)
    setError('')
    try {
      const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean)
      const res = await ingestDocument({
        title: form.title,
        doc_type: form.doc_type,
        site: form.site,
        asset_no: form.asset_no,
        tags,
        version: Number(form.version) || 1,
        document_ref: form.document_ref,
        effective_from: form.effective_from,
        review_due: form.review_due,
        expires_at: form.expires_at,
        supersedes_id: base?.documentId || null,
        source_filename: fileInfo?.name || null,
        source_mime: fileInfo?.type || null,
      }, source, { onProgress: (done, total) => setProgress(`Saving chunk ${done} of ${total}`) })
      onSuccess(res.chunks)
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
      title={base ? `New version of ${base.title}` : 'Add knowledge document'}
      subtitle={base
        ? 'Saved as a draft. When it is approved, the current version is marked superseded and stops being used by the AI.'
        : 'Saved as a draft. The AI uses it only after another approver signs it off.'}
      size="lg"
      footer={(
        <>
          <p className="text-[var(--text-muted)] text-xs mr-auto" aria-live="polite">{progress || (String(form.content).trim() ? `${chunkCount} chunk${chunkCount === 1 ? '' : 's'} will be queued for AI indexing` : '')}</p>
          <button type="button" onClick={close} className="btn-secondary text-sm min-h-[44px]" disabled={uploading}>Cancel</button>
          <button
            type="submit"
            form="kb-upload-form"
            disabled={uploading || reading || !form.title.trim() || !String(form.content).trim()}
            className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? <Loader className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
            {uploading ? 'Saving' : 'Save as draft'}
          </button>
        </>
      )}
    >
      <form id="kb-upload-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          ref={fileRef} id="kb-file-input" type="file" className="sr-only"
          accept={KB_ACCEPT}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
        <button
          type="button"
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          onClick={() => fileRef.current?.click()}
          disabled={reading || uploading}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${dragOver ? 'border-green-500' : 'border-[var(--border-bright)] hover:border-[var(--text-muted)]'}`}
        >
          {reading
            ? <Loader className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2 animate-spin" aria-hidden="true" />
            : <Upload className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2" aria-hidden="true" />}
          <span className="block text-[var(--text-secondary)] text-sm font-medium">{fileInfo ? fileInfo.name : 'Drop a file or choose one to upload'}</span>
          <span className="block text-[var(--text-muted)] text-xs mt-1">
            {fileInfo
              ? (fileInfo.pageCount ? `${fileInfo.pageCount} page${fileInfo.pageCount === 1 ? '' : 's'} read, page numbers kept for citations` : 'Text read (this format has no page numbers)')
              : 'PDF, Word .docx, .txt, .md, .csv or .json, or paste text below'}
          </span>
        </button>

        <div>
          <label htmlFor="kb-title" className="label">Title (required)</label>
          <input id="kb-title" required className="input w-full" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Tyre Pressure SOP: Heavy Fleet" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="kb-type" className="label">Document type</label>
            <select id="kb-type" className="input w-full" value={form.doc_type} onChange={e => set('doc_type', e.target.value)}>
              {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="kb-version" className="label">Version</label>
            <input id="kb-version" type="number" min="1" step="1" className="input w-full" value={form.version} onChange={e => set('version', e.target.value)} />
          </div>
          <div>
            <label htmlFor="kb-ref" className="label">Document reference</label>
            <input id="kb-ref" className="input w-full" value={form.document_ref} onChange={e => set('document_ref', e.target.value)} placeholder="e.g. SOP-TYR-004" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="kb-effective" className="label">Effective from</label>
            <input id="kb-effective" type="date" className="input w-full" value={form.effective_from} onChange={e => set('effective_from', e.target.value)} />
          </div>
          <div>
            <label htmlFor="kb-review" className="label">Review due</label>
            <input id="kb-review" type="date" className="input w-full" value={form.review_due} onChange={e => set('review_due', e.target.value)} />
          </div>
          <div>
            <label htmlFor="kb-expires" className="label">Expires on</label>
            <input id="kb-expires" type="date" className="input w-full" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
          </div>
        </div>
        <p className="text-[var(--text-muted)] text-xs -mt-2">Leave Effective from blank to start on the approval date. Review due raises a warning; Expires on stops the AI using it.</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="kb-site" className="label">Site (optional)</label>
            <select id="kb-site" className="input w-full" value={form.site} onChange={e => set('site', e.target.value)}>
              <option value="">All sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="kb-tags" className="label">Tags (comma separated)</label>
            <input id="kb-tags" className="input w-full" value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="inflation, pressure" />
          </div>
          <div>
            <label htmlFor="kb-asset" className="label">Asset no. (optional)</label>
            <input id="kb-asset" className="input w-full" value={form.asset_no} onChange={e => set('asset_no', e.target.value)} placeholder="e.g. RMX-042" />
          </div>
        </div>

        <div>
          <label htmlFor="kb-content" className="label">
            Content (required) <span className="text-[var(--text-muted)] normal-case font-normal">({String(form.content).length.toLocaleString()} characters, {chunkCount} chunk{chunkCount === 1 ? '' : 's'})</span>
          </label>
          <textarea
            id="kb-content"
            required
            className="input w-full font-mono text-xs"
            rows={8}
            value={form.content}
            onChange={e => { set('content', e.target.value); if (pages) setPages(null) }}
            placeholder="Paste document text here, or load from a file above"
          />
          {fileInfo?.pageCount && !pages && (
            <p className="text-amber-500 text-xs mt-1">You edited the text, so page numbers from the file are no longer kept. Reload the file to keep them.</p>
          )}
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

function WithdrawModal({ doc, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    if (!reason.trim()) { setError('A reason is required.'); return }
    setBusy(true)
    setError('')
    try {
      await withdrawKnowledgeDocument(doc.documentId, reason)
      onDone()
    } catch (err) {
      setError(toUserMessage(err, 'Could not withdraw the document.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose() }}
      title={`Withdraw ${doc.title}?`}
      subtitle="The AI stops using it immediately. The record and its history are kept."
      size="sm"
      footer={(
        <>
          <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-danger text-sm min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-60" onClick={submit} disabled={busy || !reason.trim()}>
            <Ban size={14} aria-hidden="true" /> {busy ? 'Withdrawing' : 'Withdraw'}
          </button>
        </>
      )}
    >
      <label htmlFor="kb-withdraw-reason" className="label">Reason (required)</label>
      <textarea id="kb-withdraw-reason" className="input w-full text-sm" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Procedure replaced by the 2027 manufacturer guidance" />
      {error && <p role="alert" className="text-red-400 text-sm mt-2">{error}</p>}
    </Modal>
  )
}

/** Lifecycle status pill (effective today). */
function LifecyclePill({ lifecycle, today }) {
  if (!lifecycle) return <span className="cc-na" title="Uploaded before document approval existed">Not recorded</span>
  const s = effectiveStatus(lifecycle, today)
  const meta = KB_STATUS_META[s]
  const rs = reviewState(lifecycle, today)
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span className={`cc-pill ${meta.tone}`} title={meta.hint}>{meta.label}</span>
      {(rs.state === 'overdue' || rs.state === 'due_soon') && <span className={`cc-pill ${rs.state === 'overdue' ? 'bad' : 'warn'}`} title="Periodic review date">{reviewNote(rs)}</span>}
    </span>
  )
}

/** Approve / withdraw / new-version controls with the reason when unavailable. */
function LifecycleActions({ doc, approver, canWrite, busy, installed, onApprove, onWithdraw, onNewVersion }) {
  if (!doc) return null
  if (!doc.lifecycle) {
    return <p className="kb-note"><Info size={13} aria-hidden="true" /> {installed === false ? 'Document approval is not installed yet.' : 'This document was uploaded before approval existed. Upload it again as a new document to put it under approval.'}</p>
  }
  const ap = canApprove(doc.lifecycle, approver)
  const wd = canWithdraw(doc.lifecycle, approver)
  const status = doc.lifecycle.status
  return (
    <div className="kb-detail-actions">
      {status === 'draft' && (
        <button type="button" className="cc-btn-primary" onClick={onApprove} disabled={!ap.ok || busy} title={ap.ok ? 'Approve: the AI starts using it from its effective date' : ap.reason}>
          <ShieldCheck size={15} aria-hidden="true" /> {busy ? 'Approving' : 'Approve'}
        </button>
      )}
      {wd.ok && (
        <button type="button" className="cc-btn-ghost" onClick={onWithdraw}><Ban size={15} aria-hidden="true" /> Withdraw</button>
      )}
      {canWrite && canSupersede(doc.lifecycle) && (
        <button type="button" className="cc-btn-ghost" onClick={onNewVersion}><GitBranch size={15} aria-hidden="true" /> Upload new version</button>
      )}
      {status === 'draft' && !ap.ok && <p className="kb-note"><Info size={13} aria-hidden="true" /> {ap.reason}</p>}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────

const TYPE_TONE = { sop: 't-blue', manual: 't-purple', policy: 't-amber', inspection: 't-green', rca: 't-red', vendor: 't-orange', other: 't-blue' }
const fmtDay = (v) => (v ? formatDate(v, 'All', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A')

/** KPI tile laid out as the mockup: label on top, value with trend, a sub line. */
function StatTile({ icon: Icon, tone, label, value, sub, trend, title, loading }) {
  return (
    <div className="cc-card kb-stat" title={title}>
      <span className={`kb-stat-icon ${tone}`}><Icon size={24} aria-hidden="true" /></span>
      <div className="kb-stat-body">
        <span className="kb-stat-label">{label}</span>
        <span className="kb-stat-row"><b>{loading ? '...' : value}</b><Trend value={trend} /></span>
        {sub && <span className="kb-stat-sub">{sub}</span>}
      </div>
    </div>
  )
}

/** Area line chart over monthly counts (inline SVG, theme tokens only). */
function LineTrend({ items, empty }) {
  const W = 320
  const H = 140
  const { points, max } = lineChartPoints(items, { width: W, height: H, pad: 14 })
  if (!points.length || max === 0) return <div className="cc-empty kb-chart-empty">{empty}</div>
  const line = points.map((p) => `${p.x},${p.y}`).join(' ')
  const area = `${points[0].x},${H - 14} ${line} ${points[points.length - 1].x},${H - 14}`
  return (
    <div className="kb-line">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Documents added per month, peak ${max}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="14" x2={W - 14} y1={14 + (H - 28) * f} y2={14 + (H - 28) * f} className="kb-grid-line" />)}
        <polygon points={area} className="kb-line-area" />
        <polyline points={line} className="kb-line-stroke" />
        {points.map((p) => <circle key={p.key} cx={p.x} cy={p.y} r="3.5" className="kb-line-dot"><title>{`${p.label}: ${p.count}`}</title></circle>)}
      </svg>
      <div className="kb-line-axis">{points.map((p) => <span key={p.key}>{p.label}</span>)}</div>
    </div>
  )
}

const BAR_COLORS = ['var(--cc-green)', 'var(--cc-blue)', 'var(--cc-purple, var(--cc-blue))', 'var(--cc-amber)', 'var(--cc-red)', 'var(--cc-orange, var(--cc-amber))']

/** Vertical column chart with a share label on each column. */
function ColumnBars({ items, empty }) {
  const shares = percentShares(items)
  const max = shares.reduce((m, x) => Math.max(m, x.count), 0)
  if (!shares.length || max === 0) return <div className="cc-empty kb-chart-empty">{empty}</div>
  return (
    <ul className="kb-cols" aria-label="Chunks by collection">
      {shares.slice(0, 6).map((x, i) => (
        <li key={x.key} title={`${x.label}: ${fmtInt(x.count)} chunks`}>
          <span className="kb-cols-pct">{x.pct == null ? 'N/A' : `${x.pct}%`}</span>
          <span className="kb-cols-track"><i style={{ height: `${Math.max(4, (x.count / max) * 100)}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} /></span>
          <span className="kb-cols-label">{x.label}</span>
        </li>
      ))}
    </ul>
  )
}

const PREVIEW_WINDOWS = [{ key: 3, label: 'Last 3 months' }, { key: 6, label: 'Last 6 months' }, { key: 12, label: 'Last 12 months' }]

export default function KnowledgeBase() {
  const { profile, user, isSuperAdmin } = useAuth()
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
  const [filterLifecycle, setFilterLifecycle] = useState('all')
  // null = unknown yet; false = the lifecycle migration is not installed.
  const [lifecycleInstalled, setLifecycleInstalled] = useState(null)
  const [versionBase, setVersionBase] = useState(null)
  const [withdrawDoc, setWithdrawDoc] = useState(null)
  const [approving, setApproving] = useState(false)
  const [sort, setSort] = useState('updated')
  const [tab, setTab] = useState('documents')
  const [previewMonths, setPreviewMonths] = useState(6)
  const [templateSearch, setTemplateSearch] = useState('')
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
  const approver = { role: profile?.role, isSuperAdmin: !!(isSuperAdmin || profile?.is_super_admin), userId: user?.id || profile?.id }
  const today = toDay(now)

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await knowledgeDocuments.listKnowledgeDocuments()
      setDocs(Array.isArray(rows) ? rows : [])
      // Captured here, not read off `docs`: a later local delete filters the
      // array and would drop the hidden `truncated` flag with it.
      setTruncatedNotice(kbTruncationNotice(rows))
      setLifecycleInstalled(rows?.lifecycle !== false)
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
  const hasFilters = filterType !== 'all' || filterSite !== 'all' || filterStatus !== 'all' || filterLifecycle !== 'all' || !!search.trim()
  const filteredDocs = useMemo(
    () => sortDocuments(
      filterDocuments(grouped, { type: filterType, site: filterSite, status: filterStatus, search })
        .filter((d) => filterLifecycle === 'all' || (d.lifecycle ? effectiveStatus(d.lifecycle, today) : 'none') === filterLifecycle),
      sort,
    ),
    [grouped, filterType, filterSite, filterStatus, filterLifecycle, search, sort, today],
  )
  const lifeCounts = useMemo(() => lifecycleCounts(grouped.map((d) => d.lifecycle).filter(Boolean), today), [grouped, today])
  const embedHealth = useMemo(() => embeddingHealth(chunks, now), [chunks, now])
  const filteredChunks = useMemo(() => filteredDocs.flatMap((d) => d.chunks), [filteredDocs])
  const selected = useMemo(
    () => grouped.find((d) => d.key === selectedKey) || filteredDocs[0] || null,
    [grouped, filteredDocs, selectedKey],
  )
  const byType = useMemo(() => kbByType(filteredChunks).filter((t) => t.chunks > 0).map((t) => ({ key: t.type, label: t.label, count: t.chunks })), [filteredChunks])
  const topTags = useMemo(() => kbTopTags(filteredChunks, 12), [filteredChunks])
  const months = useMemo(() => monthlyAdded(filteredDocs, now, previewMonths), [filteredDocs, now, previewMonths])
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

  const clearFilters = () => { setSearch(''); setFilterType('all'); setFilterSite('all'); setFilterStatus('all'); setFilterLifecycle('all') }

  const approveDoc = async (d) => {
    setActionError('')
    setApproving(true)
    try {
      await approveKnowledgeDocument(d.documentId)
      setNotice({ tone: 'good', text: `${d.title} approved. The AI can now cite it${d.lifecycle?.supersedes_id ? '; the previous version is marked superseded' : ''}.` })
      fetchDocs()
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not approve the document.'))
    } finally {
      setApproving(false)
    }
  }
  const selectDoc = (d) => { setSelectedKey(d.key); setDetailTab('details') }

  const loadState = { loading, data: docs, error, retry: fetchDocs }
  const known = docs !== null && !error

  const kpis = [
    { icon: BookOpen, tone: 't-green', label: 'Knowledge Documents', value: known ? fmtInt(head.documents) : 'N/A', trend: known ? head.docTrend : null, sub: 'Uploaded and searchable', title: 'Source documents (chunks grouped by title). Trend compares documents added in the last 30 days with the 30 days before.' },
    { icon: Layers, tone: 't-blue', label: 'Indexed Chunks', value: known ? fmtInt(head.indexed) : 'N/A', sub: known ? `AI ready for RAG, ${fmtPct(head.coveragePct)} of ${fmtInt(head.chunks)}` : 'AI ready for RAG', title: 'Chunks that carry an embedding and can be retrieved by the AI' },
    { icon: Quote, tone: 't-purple', label: 'Citation Coverage', value: 'N/A', sub: 'Not recorded: answers do not log citations', title: 'AI answers do not record which document they cited yet' },
    { icon: ShieldCheck, tone: 't-amber', label: 'Live for AI', value: known && lifecycleInstalled ? fmtInt(lifeCounts.live) : 'N/A', sub: known && lifecycleInstalled ? `${fmtInt(lifeCounts.draft)} draft awaiting approval` : 'Lifecycle not installed', title: 'Approved and in-date documents. Only these are returned to the AI.' },
    { icon: CalendarClock, tone: 't-red', label: 'Review due', value: known && lifecycleInstalled ? fmtInt(lifeCounts.reviewOverdue + lifeCounts.reviewSoon) : 'N/A', sub: known && lifecycleInstalled ? `${fmtInt(lifeCounts.reviewOverdue)} overdue, ${fmtInt(lifeCounts.reviewSoon)} within 30 days` : 'Lifecycle not installed', title: 'Approved documents whose periodic review date has passed or is within 30 days' },
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
    { key: 'lifecycle', header: 'Status', sortValue: (d) => (d.lifecycle ? KB_STATUS_META[effectiveStatus(d.lifecycle, today)].label : 'Not recorded'), cell: (d) => <LifecyclePill lifecycle={d.lifecycle} today={today} /> },
    { key: 'version', header: 'Version', sortValue: (d) => d.lifecycle?.version ?? 0, cell: (d) => (d.lifecycle?.version ? `v${d.lifecycle.version}` : <span className="cc-na">N/A</span>) },
    { key: 'status', header: 'AI index', sortValue: (d) => INDEX_STATUS_META[d.status].label, cell: (d) => <span className={`cc-pill ${INDEX_STATUS_META[d.status].tone}`}>{INDEX_STATUS_META[d.status].label}</span> },
    { key: 'coveragePct', header: 'Coverage', cell: (d) => <MeterCell value={d.coveragePct} suffix="%" /> },
    { key: 'updatedAt', header: 'Updated', cell: (d) => fmtDay(d.updatedAt) },
    {
      key: 'actions', header: '', sortable: false,
      cell: (d) => (
        <button type="button" className="cc-icon-btn" onClick={(e) => { e.stopPropagation(); setViewDoc(d.chunks[0]) }} aria-label={`Open ${d.title}`} title="Open document">
          <MoreVertical size={15} aria-hidden="true" />
        </button>
      ),
    },
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
      <TableNotInUse table="knowledge_documents" label="documents" hint="Documents appear once the first one is uploaded." />
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
          <span className="kb-global-label">Global Search</span>
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
            <button type="button" className="cc-btn-ghost" aria-pressed={tab === 'chunks'} onClick={() => setTab(tab === 'chunks' ? 'documents' : 'chunks')}>
              <Database size={15} aria-hidden="true" /> {tab === 'chunks' ? 'Back to documents' : `Chunk register${known ? ` (${fmtInt(chunks.length)})` : ''}`}
            </button>
            <button type="button" className="cc-btn-ghost" onClick={fetchDocs} disabled={loading} aria-label="Refresh"><RefreshCw size={15} aria-hidden="true" /></button>
            {canWrite && <button type="button" className="cc-btn-primary" onClick={() => { setVersionBase(null); setModalOpen(true) }} disabled={lifecycleInstalled === false} title={lifecycleInstalled === false ? 'Unavailable until the knowledge lifecycle migration is applied' : undefined}><Plus size={15} aria-hidden="true" /> Add document</button>}
          </div>
        </div>
      </div>

      {truncatedNotice && <div className="cc-card kb-banner warn" role="status"><AlertCircle size={18} aria-hidden="true" /><p>{truncatedNotice}</p></div>}
      {known && lifecycleInstalled === false && (
        <div className="cc-card kb-banner warn" role="status"><AlertCircle size={18} aria-hidden="true" /><p>Document approval, versions and review dates are not installed on the database yet. Uploading and approving documents is unavailable until the knowledge lifecycle migration is applied.</p></div>
      )}
      {known && embedHealth.state === 'stalled' && (
        <div className="cc-card kb-banner warn" role="status"><AlertCircle size={18} aria-hidden="true" /><p>Embeddings are not configured: {fmtInt(embedHealth.pending)} chunk{embedHealth.pending === 1 ? '' : 's'} still wait for AI indexing ({fmtInt(embedHealth.stale)} for over 30 minutes). The embedding service needs its API key on the server, so the AI cannot search these documents yet, even once approved.</p></div>
      )}
      {known && embedHealth.state === 'queued' && (
        <div className="cc-card kb-banner" role="status"><Clock size={18} aria-hidden="true" /><p>{fmtInt(embedHealth.pending)} chunk{embedHealth.pending === 1 ? ' is' : 's are'} queued for AI indexing. The indexer runs every 10 minutes.</p></div>
      )}
      {known && lifecycleInstalled && lifeCounts.reviewOverdue > 0 && (
        <div className="cc-card kb-banner warn" role="status"><CalendarClock size={18} aria-hidden="true" /><p>{fmtInt(lifeCounts.reviewOverdue)} approved document{lifeCounts.reviewOverdue === 1 ? ' is' : 's are'} past the review date. They are still used by the AI until they expire or are withdrawn; review them or upload a new version.</p>
          <button type="button" className="cc-btn-ghost" onClick={() => { setFilterLifecycle('approved'); setSort('updated'); setTab('documents') }}>Show approved</button></div>
      )}
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

      <div className="kb-kpis">
        {kpis.map((k) => <StatTile key={k.label} {...k} loading={loading && docs === null} />)}
      </div>

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

            <Card
              title="Report Templates"
              action={(profile?.role === 'Admin' || profile?.is_super_admin)
                ? <Link className="cc-btn-primary kb-new-tpl" to="/report-builder"><Plus size={14} aria-hidden="true" /> New Template</Link>
                : null}
            >
              <label className="cc-search kb-mini-search">
                <Search size={14} aria-hidden="true" />
                <input type="search" placeholder="Search templates" aria-label="Search templates" value={templateSearch} onChange={(e) => setTemplateSearch(e.target.value)} />
              </label>
              <div className="cc-empty kb-tpl-empty">
                <div>
                  <LayoutTemplate size={22} aria-hidden="true" />
                  <p><b>No knowledge-based templates yet</b></p>
                  <p>Templates built from approved documents are not stored yet. Fleet data reports are built in the Report Builder (administrators).</p>
                </div>
              </div>
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
          </div>

          <div className="kb-col">
            <Card
              title="Knowledge Documents"
              className="kb-docs"
              action={(
                <div className="cc-filters kb-filters kb-filters-head">
                  <select className="cc-select" aria-label="Collection" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                    {cols.map((c) => <option key={c.key} value={c.key}>{c.key === 'all' ? 'All Collections' : c.label}</option>)}
                  </select>
                  <select className="cc-select" aria-label="Site" value={filterSite} onChange={(e) => setFilterSite(e.target.value)}>
                    <option value="all">All Sites</option>
                    <option value="global">Global (no site)</option>
                    {sites.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select className="cc-select" aria-label="Document status" value={filterLifecycle} onChange={(e) => setFilterLifecycle(e.target.value)}>
                    <option value="all">Document Status</option>
                    {Object.entries(KB_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                    <option value="none">Not recorded</option>
                  </select>
                  <select className="cc-select" aria-label="Index status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    <option value="all">Index Status</option>
                    {Object.entries(INDEX_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                  </select>
                  <select className="cc-select" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                    {DOC_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
              )}
            >
              <div className="cc-filters kb-filters">
                <label className="cc-search">
                  <Search size={15} aria-hidden="true" />
                  <input type="search" placeholder="Search documents" aria-label="Search documents" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
                {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" /> Clear</button>}
                <span className="kb-count" aria-live="polite">{known ? `${filteredDocs.length} of ${grouped.length}` : ''}</span>
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
              title={<>Report Preview <span className="kb-dot" aria-hidden="true" /> Knowledge Library Report</>}
              action={(
                <div className="cc-filters kb-filters kb-filters-head">
                  <select className="cc-select" aria-label="Chart window" value={previewMonths} onChange={(e) => setPreviewMonths(Number(e.target.value))}>
                    {PREVIEW_WINDOWS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
                  </select>
                  <select className="cc-select" aria-label="Preview site" value={filterSite} onChange={(e) => setFilterSite(e.target.value)}>
                    <option value="all">All Sites</option>
                    <option value="global">Global (no site)</option>
                    {sites.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
            >
              <CardState state={loadState} empty={emptyLibrary}>
                <div className="kb-report">
                  <div className="kb-report-brand">
                    <span className="kb-report-logo"><span className="kb-report-mark" aria-hidden="true"><BookOpen size={16} /></span><span><b>TyrePulse</b><small>FLEET INTELLIGENCE</small></span></span>
                    <span className="kb-report-title"><small>Knowledge Base Report</small><b>Knowledge Library Summary</b><small>Based on documents in the knowledge base{hasFilters ? ', current filters' : ''}</small></span>
                    <span className="kb-report-date">{fmtDay(now)}</span>
                  </div>
                  <div className="kb-report-tiles">
                    <div><span className="kb-rt-icon t-blue"><FileText size={17} aria-hidden="true" /></span><span><small>Documents</small><b>{fmtInt(filteredDocs.length)}</b></span></div>
                    <div><span className="kb-rt-icon t-purple"><Layers size={17} aria-hidden="true" /></span><span><small>Chunks</small><b>{fmtInt(filteredChunks.length)}</b></span></div>
                    <div><span className="kb-rt-icon t-green"><CheckCircle size={17} aria-hidden="true" /></span><span><small>Indexed</small><b>{fmtInt(filteredChunks.filter((c) => c.embedding).length)}</b></span></div>
                    <div><span className="kb-rt-icon t-amber"><Truck size={17} aria-hidden="true" /></span><span><small>Linked to an asset</small><b>{fmtInt(filteredDocs.filter((d) => d.assetNo).length)}</b></span></div>
                  </div>
                  <div className="kb-report-charts">
                    <div className="kb-chart-box">
                      <h3>Documents added per month</h3>
                      <LineTrend items={months} empty={`No documents added in the last ${previewMonths} months.`} />
                    </div>
                    <div className="kb-chart-box">
                      <h3>Chunks by collection</h3>
                      <ColumnBars items={byType} empty="No chunks in this view." />
                    </div>
                  </div>
                </div>
              </CardState>
              <div className="kb-report-actions">
                <button type="button" className="cc-btn-primary" disabled title="Not available yet: AI report generation from the knowledge base is not built"><Sparkles size={15} aria-hidden="true" /> Generate Report (AI)</button>
                <button type="button" className="cc-btn-ghost" onClick={() => runExport('pdf')} disabled={!known || !filteredChunks.length}><FileText size={15} aria-hidden="true" /> Export PDF</button>
                <button type="button" className="cc-btn-ghost" onClick={() => runExport('excel')} disabled={!known || !filteredChunks.length}><FileSpreadsheet size={15} aria-hidden="true" /> Export Excel</button>
                <button type="button" className="cc-btn-ghost" disabled title="Not available yet: knowledge report templates are not stored"><Save size={15} aria-hidden="true" /> Save Template</button>
              </div>
              <p className="kb-note"><Info size={13} aria-hidden="true" /> AI-written reports and saved templates are not available yet. This preview is measured from the library itself.</p>
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
                        { key: 'insights', label: 'AI Insights' },
                        { key: 'citations', label: 'Citations' },
                        { key: 'chunks', label: 'Chunks' },
                      ]}
                    />
                    {detailTab === 'details' && (
                      <dl className="kb-facts">
                        <div><dt>Title</dt><dd>{selected.title}</dd></div>
                        <div><dt>Version</dt><dd>{selected.lifecycle?.version ? `v${selected.lifecycle.version}` : <span className="cc-na">Not recorded</span>}</dd></div>
                        <div><dt>Reference</dt><dd>{selected.lifecycle?.document_ref || <span className="cc-na">None</span>}</dd></div>
                        <div><dt>Document status</dt><dd><LifecyclePill lifecycle={selected.lifecycle} today={today} /></dd></div>
                        <div><dt>Effective from</dt><dd>{selected.lifecycle?.effective_from ? fmtDay(selected.lifecycle.effective_from) : <span className="cc-na">{selected.lifecycle ? 'On approval' : 'Not recorded'}</span>}</dd></div>
                        <div><dt>Review due</dt><dd>{selected.lifecycle?.review_due ? <>{fmtDay(selected.lifecycle.review_due)} {reviewNote(reviewState(selected.lifecycle, today)) && <span className="cc-pill warn">{reviewNote(reviewState(selected.lifecycle, today))}</span>}</> : <span className="cc-na">Not set</span>}</dd></div>
                        <div><dt>Expires</dt><dd>{selected.lifecycle?.expires_at ? fmtDay(selected.lifecycle.expires_at) : <span className="cc-na">No expiry</span>}</dd></div>
                        <div><dt>Approved</dt><dd>{selected.lifecycle?.approved_at ? <>{fmtDay(selected.lifecycle.approved_at)}{selected.lifecycle.approved_by && selected.lifecycle.approved_by === approver.userId ? ' (by you)' : ''}</> : <span className="cc-na">Not approved</span>}</dd></div>
                        {selected.lifecycle?.supersedes_id && <div><dt>Supersedes</dt><dd>{grouped.find((g) => g.documentId === selected.lifecycle.supersedes_id)?.title || <span className="cc-na">Earlier version</span>}</dd></div>}
                        {selected.lifecycle?.withdrawn_reason && <div><dt>Withdrawn because</dt><dd>{selected.lifecycle.withdrawn_reason}</dd></div>}
                        {selected.lifecycle?.source_filename && <div><dt>Source file</dt><dd>{selected.lifecycle.source_filename}</dd></div>}
                        <div><dt>Collection</dt><dd>{selected.typeLabel}</dd></div>
                        <div><dt>Site</dt><dd>{selected.site || 'All sites'}</dd></div>
                        <div><dt>Asset</dt><dd>{selected.assetNo || <span className="cc-na">Not linked</span>}</dd></div>
                        <div><dt>Chunks</dt><dd>{fmtInt(selected.chunkCount)}</dd></div>
                        <div><dt>Updated</dt><dd>{fmtDay(selected.updatedAt)}</dd></div>
                        <div><dt>Status</dt><dd><b>{INDEX_STATUS_META[selected.status].label}</b></dd></div>
                        <div><dt>Coverage</dt><dd><MeterCell value={selected.coveragePct} suffix="%" /></dd></div>
                        <div><dt>AI usage</dt><dd><span className="cc-na">Not recorded</span></dd></div>
                        <div><dt>Tags</dt><dd>{selected.tags.length ? selected.tags.join(', ') : <span className="cc-na">None</span>}</dd></div>
                      </dl>
                    )}
                    {detailTab === 'insights' && (
                      <div className="cc-empty">Not recorded: AI insights per document are not generated or stored yet.</div>
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
                    <LifecycleActions
                      doc={selected}
                      approver={approver}
                      canWrite={canWrite}
                      busy={approving}
                      installed={lifecycleInstalled}
                      onApprove={() => approveDoc(selected)}
                      onWithdraw={() => setWithdrawDoc(selected)}
                      onNewVersion={() => { setVersionBase(selected); setModalOpen(true) }}
                    />
                    <div className="kb-detail-actions">
                      <button type="button" className="cc-btn-primary" onClick={() => setViewDoc(selected.chunks[0])} disabled={!selected.chunks.length}><ExternalLink size={15} aria-hidden="true" /> Open Document</button>
                      <button type="button" className="cc-btn-ghost kb-outline" onClick={() => setDetailTab('citations')}><Quote size={15} aria-hidden="true" /> View Citations</button>
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
          base={versionBase}
          onClose={() => { setModalOpen(false); setVersionBase(null) }}
          onSuccess={(n) => {
            setModalOpen(false)
            setVersionBase(null)
            setNotice({ tone: 'good', text: `Saved as a draft with ${n} chunk${n !== 1 ? 's' : ''} queued for AI indexing. Another Admin, Manager or Director must approve it before the AI uses it.` })
            fetchDocs()
          }}
        />
      )}
      {withdrawDoc && (
        <WithdrawModal
          doc={withdrawDoc}
          onClose={() => setWithdrawDoc(null)}
          onDone={() => {
            setNotice({ tone: 'good', text: `${withdrawDoc.title} withdrawn. The AI no longer uses it.` })
            setWithdrawDoc(null)
            fetchDocs()
          }}
        />
      )}
    </div>
  )
}
