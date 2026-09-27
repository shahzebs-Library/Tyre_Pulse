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
  AlertTriangle, Search, X, FileSpreadsheet, FileText, Plus, Pencil,
  Trash2, ListChecks, Layers, BarChart3, Eye, Image as ImageIcon, XCircle,
  RefreshCw, ThumbsUp, Hourglass,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listOcrScans, createOcrScan, updateOcrScan, deleteOcrScan,
} from '../lib/api/ocrScanner'
import {
  summariseScans, byType, byBand, confidenceBand,
} from '../lib/ocrScanner'
import {
  reviewQueue as buildReviewQueue, filterScans, reviewPerformance, scanExportRows,
  fmtConfidence, extractedSummary, confidencePct,
} from '../lib/ocrScannerAnalytics'
import { compareValues } from '../lib/consoleTable'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { safeHref } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

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
  pending: { cls: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]' },
  auto_extracted: { cls: 'bg-sky-900/30 text-sky-300 border-sky-800/50' },
  needs_review: { cls: 'bg-amber-900/30 text-amber-300 border-amber-800/50' },
  confirmed: { cls: 'bg-green-900/30 text-green-300 border-green-800/50' },
  rejected: { cls: 'bg-red-900/30 text-red-300 border-red-800/50' },
}

const fmtConf = fmtConfidence
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

function BandBadge({ scan }) {
  const b = BAND_META[confidenceBand(scan)]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${b.cls}`}>
      {b.label}{confidencePct(scan) == null ? '' : ` | ${fmtConf(scan.confidence)}`}
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
  const [bandFilter, setBandFilter] = useState('')
  const [reviewFilter, setReviewFilter] = useState('')

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
      // A failed read keeps whatever was loaded before (or stays unloaded):
      // it must never render as "no scans".
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else setError(toUserMessage(err, 'Could not load OCR scans.'))
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseScans(rows || []), [rows])
  const typeBreakdown = useMemo(() => byType(rows || []), [rows])
  const bandCounts = useMemo(() => byBand(rows || []), [rows])

  // Lowest-confidence-first review queue (unscored first, oldest first in a tie).
  const reviewQueue = useMemo(() => buildReviewQueue(rows || []), [rows])
  const perf = useMemo(() => reviewPerformance(rows || [], new Date()), [rows])

  const filtered = useMemo(
    () => filterScans(rows || [], { q: search, type: typeFilter, status: statusFilter, band: bandFilter, review: reviewFilter }),
    [rows, typeFilter, statusFilter, bandFilter, reviewFilter, search],
  )
  const unloaded = rows === null
  const failedFirstLoad = unloaded && !!error

  const bandTotal = bandCounts.high + bandCounts.medium + bandCounts.low + bandCounts.unknown

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total scans', value: summary.totalScans, icon: FileScan, tone: 'text-[var(--text-primary)]' },
    { label: 'Confirmed', value: summary.confirmedCount, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Needs review', value: summary.needsReviewCount, icon: ClipboardCheck, tone: 'text-amber-400' },
    { label: 'Avg confidence', value: summary.avgConfidence == null ? 'Not scored' : fmtConf(summary.avgConfidence), icon: Percent, tone: 'text-sky-400' },
    { label: 'Auto-extracted', value: summary.autoExtractedCount, icon: Sparkles, tone: 'text-violet-400' },
    { label: 'Acceptance rate', value: perf.acceptanceRate == null ? 'N/A' : `${perf.acceptanceRate}%`, icon: ThumbsUp, tone: 'text-green-400', hint: 'Confirmed against confirmed plus rejected' },
    { label: 'Oldest waiting', value: perf.oldestWaitingDays == null ? 'N/A' : `${perf.oldestWaitingDays} d`, icon: Hourglass, tone: perf.oldestWaitingDays > 7 ? 'text-red-400' : 'text-[var(--text-primary)]', hint: 'Age of the oldest scan in the review queue' },
  ]

  // ── Export (whole filtered set, never one page) ──────────────────────────
  const EXPORT_COLS = ['scan_type', 'asset_no', 'extracted', 'confidence_band', 'confidence_pct', 'review_status', 'corrected_value', 'reviewed_by', 'created_at']
  const EXPORT_HEADERS = ['Scan type', 'Asset', 'Extracted', 'Confidence band', 'Confidence %', 'Review status', 'Corrected value', 'Reviewed by', 'Created']
  const bandLabel = Object.fromEntries(Object.entries(BAND_META).map(([k, v]) => [k, v.label]))
  const exportRows = () => scanExportRows(filtered, { typeLabel: TYPE_LABEL, statusLabel: STATUS_LABEL, bandLabel })
  const exportName = () => reportFileName('OCR Scans', reportDateLabel())

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

  const clearFilters = () => { setTypeFilter(''); setStatusFilter(''); setSearch(''); setBandFilter(''); setReviewFilter('') }
  const hasFilters = typeFilter || statusFilter || search || bandFilter || reviewFilter

  const columns = useMemo(() => [
    {
      id: 'scan_type', header: 'Scan type', accessorFn: (r) => TYPE_LABEL[r.scan_type] || r.scan_type || undefined, size: 150,
      sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)] whitespace-nowrap">{getValue() ?? 'N/A'}</span>,
    },
    {
      id: 'asset_no', header: 'Asset', accessorFn: (r) => r.asset_no || undefined, size: 120, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="text-[var(--text-secondary)]">{getValue() ?? 'N/A'}</span>,
    },
    {
      id: 'extracted', header: 'Extracted', accessorFn: (r) => extractedSummary(r), size: 260, sortingFn: valueSort,
      cell: ({ getValue }) => <div className="truncate max-w-[260px] text-[var(--text-secondary)]" title={getValue()}>{getValue()}</div>,
    },
    {
      id: 'confidence', header: 'Confidence', accessorFn: (r) => confidencePct(r) ?? undefined, size: 150, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => <BandBadge scan={row.original} />,
      meta: { exportValue: (r) => fmtConf(r.confidence) },
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => STATUS_LABEL[r.review_status] || r.review_status || 'Pending', size: 140, sortingFn: valueSort,
      cell: ({ row }) => <StatusBadge status={row.original.review_status} />,
    },
    {
      id: 'image', header: 'Image', enableSorting: false, size: 90, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        const href = safeHref(r.image_url)
        if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 text-xs min-h-[44px]"><ImageIcon size={13} aria-hidden="true" /> View<span className="sr-only"> image for {r.asset_no || 'scan'}</span></a>
        if (r.image_url) return <span className="inline-flex items-center gap-1 text-[var(--text-muted)] text-xs" title="The stored image address is not a safe link"><ImageIcon size={13} aria-hidden="true" /> Unsafe link</span>
        return <span className="text-[var(--text-muted)] text-xs">N/A</span>
      },
    },
    {
      id: 'created_at', header: 'Created', accessorFn: (r) => r.created_at || undefined, size: 120, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(getValue())}</span>,
      meta: { exportValue: (r) => fmtDate(r.created_at) },
    },
    {
      id: 'actions', header: 'Actions', enableSorting: false, size: 120, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        const name = `${TYPE_LABEL[r.scan_type] || 'scan'}${r.asset_no ? ` ${r.asset_no}` : ''}`
        return (
          <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={() => openEdit(r)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit ${name}`}><Pencil size={14} aria-hidden="true" /></button>
            <button type="button" onClick={() => setConfirmDelete(r)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete ${name}`}><Trash2 size={14} aria-hidden="true" /></button>
          </div>
        )
      },
    },
  // openEdit only calls state setters, so the first render's copy stays correct.
  ], [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="CV Inspection / OCR Scanner"
        subtitle="Upload tyre-sidewall and document images, review the fields an OCR/CV provider extracts, and confirm or correct each reading: the audited bridge between camera capture and structured fleet data."
        icon={ScanLine}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => exportToExcel(exportRows(), EXPORT_COLS, EXPORT_HEADERS, exportName(), 'OCR Scans')} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => exportToPdf(exportRows(), EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'CV Inspection / OCR Scans', exportName(), 'landscape')} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm min-h-[44px] inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> New scan
            </button>
          </div>
        }
      />

      {/* Honest provider-status note */}
      <div className="card border border-sky-500/40 flex items-start gap-3">
        <Sparkles size={18} className="text-sky-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-[var(--text-primary)] font-medium">OCR/CV extraction provider not connected yet.</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            This module records scans and drives the human review workflow today. Connecting an OCR/CV
            provider auto-populates extracted text, fields, and a confidence score, flipping new scans
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
            <p className="text-amber-300 font-medium">OCR scanning is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V197_OCR_SCANS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1"><p className="text-red-300 font-medium">Couldn't load or update OCR scans.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card" title={k.hint}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              {unloaded && !error
                ? <div className="h-8 w-12 mt-1 bg-[var(--input-bg)] rounded animate-pulse" />
                : <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{unloaded ? 'N/A' : k.value}</p>}
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
          {failedFirstLoad ? (
            <div className="px-4 py-10 text-center text-[var(--text-muted)] text-sm" role="status">The review queue could not be loaded. Use Retry above.</div>
          ) : rows === null ? (
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
                      {TYPE_LABEL[r.scan_type] || r.scan_type} | {r.extracted_text ? r.extracted_text.slice(0, 60) : 'No extraction yet'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => quickStatus(r, 'confirmed')} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-green-900/30 text-[var(--text-muted)] hover:text-green-400" title="Confirm" aria-label={`Confirm ${r.asset_no || TYPE_LABEL[r.scan_type] || 'scan'}`}><CheckCircle2 size={15} aria-hidden="true" /></button>
                    <button type="button" onClick={() => quickStatus(r, 'rejected')} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" title="Reject" aria-label={`Reject ${r.asset_no || TYPE_LABEL[r.scan_type] || 'scan'}`}><XCircle size={15} aria-hidden="true" /></button>
                    <button type="button" onClick={() => openEdit(r)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Review / correct" aria-label={`Review ${r.asset_no || TYPE_LABEL[r.scan_type] || 'scan'}`}><Eye size={15} aria-hidden="true" /></button>
                  </div>
                </div>
              ))}
              {reviewQueue.length > 30 && (
                <div className="px-4 py-3 text-xs text-[var(--text-muted)] flex items-center justify-between gap-2">
                  <span>Showing the 30 most urgent of {reviewQueue.length} awaiting review.</span>
                  <button type="button" onClick={() => { clearFilters(); setReviewFilter('needs') }} className="btn-secondary text-xs min-h-[44px]">Open all in register</button>
                </div>
              )}
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
              failedFirstLoad ? <p className="text-xs text-[var(--text-muted)]">Not available.</p> : <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
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
                    <span className="text-[var(--text-muted)] w-24 text-right tabular-nums" title={`${t.count} scans, ${t.confirmed} confirmed`}>{t.count} ({t.confirmed} confirmed)</span>
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
              failedFirstLoad ? <p className="text-xs text-[var(--text-muted)]">Not available.</p> : <div className="h-10 bg-[var(--input-bg)] rounded animate-pulse" />
            ) : bandTotal === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No scans yet.</p>
            ) : (
              <>
                <div className="flex h-3 rounded-full overflow-hidden bg-[var(--input-bg)]">
                  {['high', 'medium', 'low', 'unknown'].map((b) => {
                    const w = (bandCounts[b] / bandTotal) * 100
                    if (!w) return null
                    const color = b === 'high' ? 'bg-green-500/80' : b === 'medium' ? 'bg-amber-500/80' : b === 'low' ? 'bg-red-500/80' : 'bg-[var(--text-muted)]'
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
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[220px]">
            <span className="sr-only">Search scans</span>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full min-h-[44px]" placeholder="Search asset, extracted text, corrected value, reviewer" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="input min-h-[44px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Scan type">
            <option value="">All types</option>
            {SCAN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Review status">
            <option value="">All statuses</option>
            {REVIEW_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Confidence band">
            <option value="">All confidence bands</option>
            {['high', 'medium', 'low', 'unknown'].map((b) => <option key={b} value={b}>{BAND_META[b].label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)} aria-label="Review queue">
            <option value="">Any review state</option>
            <option value="needs">Needs a review pass</option>
          </select>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{unloaded ? 'Not loaded' : `${filtered.length} of ${summary.totalScans}`}</span>
        </div>
      </div>

      {/* Register */}
      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={unloaded && !error}
        error={failedFirstLoad ? error : null}
        onRetry={load}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        initialPageSize={25}
        emptyMessage={(rows || []).length === 0 && !notProvisioned ? 'No scans recorded yet. Add your first scan.' : 'No scans match these filters.'}
      />

      {/* Create / Edit modal */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Review / edit scan' : 'New scan record'}
        size="lg"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="ocr-scan-form" className="btn-primary text-sm min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create scan'}
            </button>
          </div>
        )}
      >
            <form id="ocr-scan-form" onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="ocr-scan-type">Scan type</label>
                  <select id="ocr-scan-type" className="input w-full" value={form.scan_type} onChange={(e) => set('scan_type', e.target.value)}>
                    {SCAN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="ocr-asset">Asset number (optional)</label>
                  <input id="ocr-asset" className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="ocr-image">Image URL (optional)</label>
                <input id="ocr-image" className="input w-full" placeholder="https://example.com/sidewall.jpg" value={form.image_url} maxLength={2000} onChange={(e) => set('image_url', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="ocr-text">Extracted text (optional)</label>
                <textarea id="ocr-text" className="input w-full min-h-[70px] resize-y font-mono text-xs" placeholder="Populated by the OCR/CV provider once connected, or paste a manual reading." value={form.extracted_text} maxLength={20000} onChange={(e) => set('extracted_text', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="ocr-fields">Extracted fields (JSON, optional)</label>
                <textarea id="ocr-fields" className="input w-full min-h-[70px] resize-y font-mono text-xs" placeholder='{ "brand": "Michelin", "size": "315/80R22.5", "dot": "..." }' value={form.extracted_fields} onChange={(e) => set('extracted_fields', e.target.value)} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Structured key/value pairs. Leave blank until a provider extracts them.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="ocr-conf">Confidence (0 to 1, optional)</label>
                  <input id="ocr-conf" className="input w-full" type="number" step="0.01" min="0" max="1" placeholder="0.92" value={form.confidence} onChange={(e) => set('confidence', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Provider score. Blank = not yet scored.</p>
                </div>
                <div>
                  <label className="label" htmlFor="ocr-status">Review status</label>
                  <select id="ocr-status" className="input w-full" value={form.review_status} onChange={(e) => set('review_status', e.target.value)}>
                    {REVIEW_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="ocr-corrected">Corrected value (optional)</label>
                  <input id="ocr-corrected" className="input w-full" placeholder="Human-verified final value" value={form.corrected_value} maxLength={2000} onChange={(e) => set('corrected_value', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="ocr-reviewer">Reviewed by (optional)</label>
                  <input id="ocr-reviewer" className="input w-full" placeholder="Reviewer name" value={form.reviewed_by} maxLength={200} onChange={(e) => set('reviewed_by', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="ocr-notes">Notes (optional)</label>
                <textarea id="ocr-notes" className="input w-full min-h-[60px] resize-y" placeholder="e.g. glare on sidewall, re-shoot recommended" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

            </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => !deleting && setConfirmDelete(null)}
        title="Delete this scan?"
        size="sm"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {TYPE_LABEL[confirmDelete.scan_type] || confirmDelete.scan_type} | {confirmDelete.asset_no || 'no asset'} | {fmtConf(confirmDelete.confidence)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
