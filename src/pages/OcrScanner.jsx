/**
 * OcrScanner (route /ocr-scanner) — CV Inspection / OCR Scanner. Captures
 * uploaded tyre-sidewall / document image records together with any text and
 * structured fields an OCR or computer-vision provider extracts, and drives the
 * human review workflow (confirm / correct / reject).
 *
 * The real OCR/CV extraction runs via an external provider that is NOT connected
 * yet. This page is honest about that: it is a records + review module. Rows are
 * created in a 'pending' state with no fabricated extraction; once a provider is
 * wired in, extraction fields and confidence auto-populate and rows flip to
 * 'auto_extracted' for a reviewer to confirm or correct.
 *
 * Runs on the new `ocr_scans` table (V197). Real data, KPI tiles, a lowest-
 * confidence-first review work queue, by-type and confidence-band breakdowns,
 * filters, search, create/edit modal, delete confirm, Excel/PDF export, and
 * loading/empty/error/not-provisioned states throughout. Pure roll-up logic
 * lives in `src/lib/ocrScanner.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ScanLine, FileScan, CheckCircle2, ClipboardCheck, Percent, Sparkles,
  AlertTriangle, Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil,
  Trash2, ListChecks, Layers, BarChart3, Eye, Image as ImageIcon, XCircle,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listOcrScans, createOcrScan, updateOcrScan, deleteOcrScan,
} from '../lib/api/ocrScanner'
import {
  summariseScans, byType, byBand, confidenceBand, needsReview,
} from '../lib/ocrScanner'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { safeHref } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'

const SCAN_TYPES = [
  { value: 'tyre_sidewall', label: 'Tyre sidewall' },
  { value: 'dot_code', label: 'DOT code' },
  { value: 'registration', label: 'Registration plate' },
  { value: 'odometer', label: 'Odometer' },
  { value: 'document', label: 'Document' },
  { value: 'vin', label: 'VIN' },
  { value: 'other', label: 'Other' },
]
const TYPE_LABEL = Object.fromEntries(SCAN_TYPES.map((t) => [t.value, t.label]))

const REVIEW_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'auto_extracted', label: 'Auto-extracted' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'rejected', label: 'Rejected' },
]
const STATUS_LABEL = Object.fromEntries(REVIEW_STATUSES.map((s) => [s.value, s.label]))

const EMPTY_FORM = {
  scan_type: 'tyre_sidewall', asset_no: '', image_url: '', extracted_text: '',
  extracted_fields: '', confidence: '', review_status: 'pending',
  corrected_value: '', reviewed_by: '', notes: '',
}

const BAND_META = {
  high: { label: 'High', cls: 'bg-green-900/30 text-green-300 border-green-800/50' },
  medium: { label: 'Medium', cls: 'bg-amber-900/30 text-amber-300 border-amber-800/50' },
  low: { label: 'Low', cls: 'bg-red-900/30 text-red-300 border-red-800/50' },
  unknown: { label: 'Not scored', cls: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]' },
}
const STATUS_META = {
  pending: { cls: 'bg-slate-700/40 text-slate-300 border-slate-600/50' },
  auto_extracted: { cls: 'bg-sky-900/30 text-sky-300 border-sky-800/50' },
  needs_review: { cls: 'bg-amber-900/30 text-amber-300 border-amber-800/50' },
  confirmed: { cls: 'bg-green-900/30 text-green-300 border-green-800/50' },
  rejected: { cls: 'bg-red-900/30 text-red-300 border-red-800/50' },
}

const fmtConf = (v) =>
  v == null || v === '' ? '—' : `${Math.round(Number(v) * 100)}%`

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function fieldsPreview(fields) {
  if (!fields || typeof fields !== 'object') return '—'
  const keys = Object.keys(fields)
  if (!keys.length) return '—'
  return keys.slice(0, 3).map((k) => `${k}: ${String(fields[k]).slice(0, 24)}`).join(' · ')
    + (keys.length > 3 ? ` +${keys.length - 3}` : '')
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

function BandBadge({ scan }) {
  const b = BAND_META[confidenceBand(scan)]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${b.cls}`}>
      {b.label} · {fmtConf(scan.confidence)}
    </span>
  )
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${meta.cls}`}>
      {STATUS_LABEL[status] || status || 'pending'}
    </span>
  )
}

export default function OcrScanner() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listOcrScans({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load OCR scans.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseScans(rows || []), [rows])
  const typeBreakdown = useMemo(() => byType(rows || []), [rows])
  const bandCounts = useMemo(() => byBand(rows || []), [rows])

  // Lowest-confidence-first review queue: rows that need a human pass, ordered
  // by confidence ascending (unknown treated as most urgent → surfaced first).
  const reviewQueue = useMemo(() => {
    const conf = (r) => (r.confidence == null || r.confidence === '' ? -1 : Number(r.confidence))
    return (rows || [])
      .filter((r) => needsReview(r))
      .sort((a, b) => conf(a) - conf(b))
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (typeFilter && r.scan_type !== typeFilter) return false
      if (statusFilter && r.review_status !== statusFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.scan_type || ''} ${r.extracted_text || ''} ${r.corrected_value || ''} ${r.reviewed_by || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, typeFilter, statusFilter, search])

  const bandTotal = bandCounts.high + bandCounts.medium + bandCounts.low + bandCounts.unknown

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total scans', value: summary.totalScans, icon: FileScan, tone: 'text-[var(--text-primary)]' },
    { label: 'Confirmed', value: summary.confirmedCount, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Needs review', value: summary.needsReviewCount, icon: ClipboardCheck, tone: 'text-amber-400' },
    { label: 'Avg confidence', value: summary.avgConfidence == null ? '—' : fmtConf(summary.avgConfidence), icon: Percent, tone: 'text-sky-400' },
    { label: 'Auto-extracted', value: summary.autoExtractedCount, icon: Sparkles, tone: 'text-violet-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['scan_type', 'asset_no', 'confidence_band', 'confidence_pct', 'review_status', 'corrected_value', 'reviewed_by', 'created_at']
  const EXPORT_HEADERS = ['Scan type', 'Asset', 'Confidence band', 'Confidence %', 'Review status', 'Corrected value', 'Reviewed by', 'Created']
  const exportRows = filtered.map((r) => ({
    scan_type: TYPE_LABEL[r.scan_type] || r.scan_type || '',
    asset_no: r.asset_no || '',
    confidence_band: BAND_META[confidenceBand(r)].label,
    confidence_pct: r.confidence == null || r.confidence === '' ? '' : Math.round(Number(r.confidence) * 100),
    review_status: STATUS_LABEL[r.review_status] || r.review_status || '',
    corrected_value: r.corrected_value || '',
    reviewed_by: r.reviewed_by || '',
    created_at: r.created_at ? new Date(r.created_at).toLocaleDateString() : '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      scan_type: r.scan_type || 'tyre_sidewall',
      asset_no: r.asset_no || '',
      image_url: r.image_url || '',
      extracted_text: r.extracted_text || '',
      extracted_fields: r.extracted_fields ? JSON.stringify(r.extracted_fields, null, 2) : '',
      confidence: r.confidence == null ? '' : r.confidence,
      review_status: r.review_status || 'pending',
      corrected_value: r.corrected_value || '',
      reviewed_by: r.reviewed_by || '',
      notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.scan_type) { setFormError('A scan type is required.'); return }
    if (form.confidence !== '' && form.confidence != null) {
      const c = Number(form.confidence)
      if (!Number.isFinite(c) || c < 0 || c > 1) {
        setFormError('Confidence must be a number between 0 and 1.'); return
      }
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        confidence: form.confidence === '' ? null : form.confidence,
        extracted_fields: form.extracted_fields?.trim() ? form.extracted_fields : null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateOcrScan(editing.id, payload)
      else await createOcrScan(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the scan.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const quickStatus = useCallback(async (r, review_status) => {
    try {
      await updateOcrScan(r.id, { review_status })
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not update the scan.'))
    }
  }, [load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteOcrScan(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the scan.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setTypeFilter(''); setStatusFilter(''); setSearch('') }
  const hasFilters = typeFilter || statusFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="CV Inspection / OCR Scanner"
        subtitle="Upload tyre-sidewall and document images, review the fields an OCR/CV provider extracts, and confirm or correct each reading — the audited bridge between camera capture and structured fleet data."
        icon={ScanLine}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'ocr_scans')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'CV Inspection / OCR Scans', 'ocr_scans', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New scan
            </button>
          </div>
        }
      />

      {/* Honest provider-status note */}
      <div className="card border border-sky-800/40 bg-sky-950/20 flex items-start gap-3">
        <Sparkles size={18} className="text-sky-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sky-200 font-medium">OCR/CV extraction provider not connected yet.</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            This module records scans and drives the human review workflow today. Connecting an OCR/CV
            provider auto-populates extracted text, fields, and a confidence score — flipping new scans
            to <span className="font-medium text-[var(--text-secondary)]">Auto-extracted</span> for a reviewer
            to confirm or correct. No extraction is fabricated: records created now stay in
            <span className="font-medium text-[var(--text-secondary)]"> Pending</span> until a provider or a
            reviewer fills them in.
          </p>
        </div>
      </div>

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">OCR scanning isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V197_OCR_SCANS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load OCR scans.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Review work queue + breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Review queue */}
        <div className="card lg:col-span-2 !p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--input-border)]">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <ListChecks size={15} className="text-amber-400" /> Review work queue
            </h3>
            <span className="text-xs text-[var(--text-muted)]">{reviewQueue.length} awaiting review · lowest confidence first</span>
          </div>
          {rows === null ? (
            <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : reviewQueue.length === 0 ? (
            <div className="px-4 py-10 text-center text-[var(--text-muted)] text-sm">
              <CheckCircle2 size={22} className="mx-auto mb-2 text-green-500/70" />
              Nothing awaiting review. New or low-confidence scans surface here.
            </div>
          ) : (
            <div className="divide-y divide-[var(--input-border)]/50 max-h-[320px] overflow-y-auto">
              {reviewQueue.slice(0, 30).map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--input-bg)]/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate">{r.asset_no || TYPE_LABEL[r.scan_type] || 'Scan'}</span>
                      <BandBadge scan={r} />
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">
                      {TYPE_LABEL[r.scan_type] || r.scan_type} · {r.extracted_text ? r.extracted_text.slice(0, 60) : 'No extraction yet'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => quickStatus(r, 'confirmed')} className="p-1.5 rounded hover:bg-green-900/30 text-[var(--text-muted)] hover:text-green-400" title="Confirm" aria-label="Confirm"><CheckCircle2 size={15} /></button>
                    <button onClick={() => quickStatus(r, 'rejected')} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" title="Reject" aria-label="Reject"><XCircle size={15} /></button>
                    <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Review / correct" aria-label="Review"><Eye size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Breakdowns */}
        <div className="card space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
              <Layers size={15} className="text-sky-400" /> By scan type
            </h3>
            {rows === null ? (
              <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
            ) : typeBreakdown.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No scans yet.</p>
            ) : (
              <div className="space-y-1.5">
                {typeBreakdown.slice(0, 7).map((t) => (
                  <div key={t.scan_type} className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--text-secondary)] w-28 truncate">{TYPE_LABEL[t.scan_type] || t.scan_type}</span>
                    <div className="flex-1 h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
                      <div className="h-full bg-sky-500/70" style={{ width: `${Math.round((t.count / summary.totalScans) * 100)}%` }} />
                    </div>
                    <span className="text-[var(--text-muted)] w-16 text-right tabular-nums">{t.count} · {t.confirmed}✓</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--input-border)] pt-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
              <BarChart3 size={15} className="text-violet-400" /> Confidence distribution
            </h3>
            {rows === null ? (
              <div className="h-10 bg-[var(--input-bg)] rounded animate-pulse" />
            ) : bandTotal === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No scans yet.</p>
            ) : (
              <>
                <div className="flex h-3 rounded-full overflow-hidden bg-[var(--input-bg)]">
                  {['high', 'medium', 'low', 'unknown'].map((b) => {
                    const w = (bandCounts[b] / bandTotal) * 100
                    if (!w) return null
                    const color = b === 'high' ? 'bg-green-500/80' : b === 'medium' ? 'bg-amber-500/80' : b === 'low' ? 'bg-red-500/80' : 'bg-slate-500/60'
                    return <div key={b} className={color} style={{ width: `${w}%` }} title={`${BAND_META[b].label}: ${bandCounts[b]}`} />
                  })}
                </div>
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  {['high', 'medium', 'low', 'unknown'].map((b) => (
                    <div key={b} className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--text-muted)]">{BAND_META[b].label}</span>
                      <span className="text-[var(--text-secondary)] font-medium tabular-nums">{bandCounts[b]}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, extracted text, corrected value, reviewer…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Scan type">
            <option value="">All types</option>
            {SCAN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Review status">
            <option value="">All statuses</option>
            {REVIEW_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalScans}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Scan type', 'Asset', 'Extracted', 'Confidence', 'Status', 'Image', 'Created', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No scans recorded yet — add your first scan.' : 'No scans match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)] whitespace-nowrap">{TYPE_LABEL[r.scan_type] || r.scan_type || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[240px]">
                      <div className="truncate">{r.corrected_value || r.extracted_text || fieldsPreview(r.extracted_fields)}</div>
                    </td>
                    <td className="px-4 py-2.5"><BandBadge scan={r} /></td>
                    <td className="px-4 py-2.5"><StatusBadge status={r.review_status} /></td>
                    <td className="px-4 py-2.5">
                      {safeHref(r.image_url)
                        ? <a href={safeHref(r.image_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 text-xs"><ImageIcon size={13} /> View</a>
                        : r.image_url
                          ? <span className="inline-flex items-center gap-1 text-[var(--text-muted)] text-xs"><ImageIcon size={13} /> View</span>
                          : <span className="text-[var(--text-muted)] text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Review / edit scan' : 'New scan record'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Scan type</label>
                  <select className="input w-full" value={form.scan_type} onChange={(e) => set('scan_type', e.target.value)}>
                    {SCAN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Asset number (optional)</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Image URL (optional)</label>
                <input className="input w-full" placeholder="https://…/sidewall.jpg" value={form.image_url} maxLength={2000} onChange={(e) => set('image_url', e.target.value)} />
              </div>
              <div>
                <label className="label">Extracted text (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y font-mono text-xs" placeholder="Populated by the OCR/CV provider once connected — or paste a manual reading." value={form.extracted_text} maxLength={20000} onChange={(e) => set('extracted_text', e.target.value)} />
              </div>
              <div>
                <label className="label">Extracted fields (JSON, optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y font-mono text-xs" placeholder='{ "brand": "Michelin", "size": "315/80R22.5", "dot": "..." }' value={form.extracted_fields} onChange={(e) => set('extracted_fields', e.target.value)} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Structured key/value pairs. Leave blank until a provider extracts them.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Confidence (0–1, optional)</label>
                  <input className="input w-full" type="number" step="0.01" min="0" max="1" placeholder="0.92" value={form.confidence} onChange={(e) => set('confidence', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Provider score. Blank = not yet scored.</p>
                </div>
                <div>
                  <label className="label">Review status</label>
                  <select className="input w-full" value={form.review_status} onChange={(e) => set('review_status', e.target.value)}>
                    {REVIEW_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Corrected value (optional)</label>
                  <input className="input w-full" placeholder="Human-verified final value" value={form.corrected_value} maxLength={2000} onChange={(e) => set('corrected_value', e.target.value)} />
                </div>
                <div>
                  <label className="label">Reviewed by (optional)</label>
                  <input className="input w-full" placeholder="Reviewer name" value={form.reviewed_by} maxLength={200} onChange={(e) => set('reviewed_by', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[60px] resize-y" placeholder="e.g. glare on sidewall, re-shoot recommended" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create scan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this scan?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {TYPE_LABEL[confirmDelete.scan_type] || confirmDelete.scan_type} · {confirmDelete.asset_no || 'no asset'} · {fmtConf(confirmDelete.confidence)}. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
