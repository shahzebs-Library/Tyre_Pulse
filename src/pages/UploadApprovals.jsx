/**
 * UploadApprovals (route /upload-approvals) - the approver's review desk for
 * everything waiting to reach the live tables.
 *
 * Two queues, one page:
 *   - Data Intake batches (`import_batches`), committed by the secure
 *     `import_commit_batch` RPC via `imports.approveBatch` + `imports.commitBatch`.
 *   - Legacy staged uploads (`pending_uploads`), decided by
 *     `approve_pending_upload` / `reject_pending_upload` via `decidePendingUpload`.
 * Neither decision path is changed here; this page only presents them.
 *
 * All counts, rates and filters come from the pure `uploadApprovalsAnalytics`
 * engine. A failed read renders an error with Retry, never an empty queue: "we
 * could not look" and "nothing is waiting" are opposite statements.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import * as imports from '../lib/api/imports'
import { decidePendingUpload } from '../lib/api/pendingUploadDecisions'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { toUserMessage } from '../lib/safeError'
import { fetchAllPages } from '../lib/fetchAll'
import {
  intakeRows, legacyRows, splitLegacy, approvalKpis, distinctValues, filterQueue,
  activeFilterCount, stagedColumns, intakePreviewColumns, searchStaged, validationTally, readyPct,
} from '../lib/uploadApprovalsAnalytics'
import {
  ClipboardCheck, CheckCircle, XCircle, Clock, FileSpreadsheet,
  Search, AlertTriangle, Pencil, Package, Save, Trash2, Wand2,
  Database, Eye, Loader, Inbox, History, RefreshCcw, X,
} from 'lucide-react'

const TYPE_ICON = { tyres: FileSpreadsheet, stock: Package }

const BTN = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg text-sm border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-bright)] disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_DANGER = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg text-sm border border-red-500/40 text-red-400 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY = 'btn-primary inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-bright)] disabled:opacity-50 disabled:cursor-not-allowed'
const SELECT = 'input text-sm min-h-[44px]'

const fmtWhen = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : 'N/A'
}
const fmtCount = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString() : 'N/A')

function Kpi({ icon: Icon, label, value, sub }) {
  return (
    <Card pad="tight">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
      </div>
      <p className="text-2xl font-bold text-[var(--text-primary)] mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </Card>
  )
}

function ErrorPanel({ message, onRetry }) {
  return (
    <Card tone="crit" role="alert" className="flex-wrap items-center justify-between gap-3" style={{ flexDirection: 'row' }}>
      <span className="flex items-center gap-2 text-sm text-[var(--text-primary)]"><AlertTriangle size={16} className="text-red-400" aria-hidden="true" /> {message}</span>
      {onRetry && <button type="button" onClick={onRetry} className={BTN}><RefreshCcw size={14} aria-hidden="true" /> Retry</button>}
    </Card>
  )
}

function EmptyPanel({ icon: Icon, title, description }) {
  return (
    <Card className="items-center gap-3 text-center" style={{ paddingTop: 'var(--space-10)', paddingBottom: 'var(--space-10)' }}>
      <Icon size={40} className="text-[var(--text-dim)]" aria-hidden="true" />
      <p className="text-[var(--text-secondary)] font-medium">{title}</p>
      <p className="text-[var(--text-muted)] text-sm">{description}</p>
    </Card>
  )
}

export default function UploadApprovals() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const isAdmin = profile?.role === 'Admin'

  const [pending, setPending]   = useState([])
  const [history, setHistory]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState('')
  const [acting, setActing]     = useState(null)
  const [error, setError]       = useState('')
  const [filters, setFilters]   = useState({ search: '', country: 'All', type: 'All' })
  const [previewing, setPreviewing] = useState(null) // pending row being previewed
  const [tab, setTab]           = useState('intake')

  // Canonical Data Intake (import_batches) approval queue.
  const [intake, setIntake]       = useState([])
  const [intakeLoading, setIntakeLoading] = useState(true)
  const [intakeError, setIntakeError] = useState('')

  const loadIntake = useCallback(async () => {
    setIntakeLoading(true)
    setIntakeError('')
    try {
      const rows = await imports.listForApproval({ limit: null })
      setIntake(rows ?? [])
    } catch (e) {
      console.error('[UploadApprovals] loadIntake failed:', e)
      setIntakeError(toUserMessage(e, t('uploadapprovals.intake.loadError')))
    } finally {
      setIntakeLoading(false)
    }
  }, [t])

  useEffect(() => { loadIntake() }, [loadIntake])

  const load = useCallback(async () => {
    const { data, error: err } = await fetchAllPages((from, to) => supabase
      .from('pending_uploads')
      .select('id, batch_id, uploaded_by, uploader_name, country, upload_type, target_table, file_name, row_count, rows, status, reviewed_at, review_note, created_at')
      .order('created_at', { ascending: false })
      .range(from, to))
    if (err) {
      // Surface to the console for debugging instead of silently rendering an empty list.
      console.error('[UploadApprovals] load failed:', err)
      setLoadError(toUserMessage(err, 'Something went wrong. Please try again.'))
      setLoading(false)
      return
    }
    setLoadError('')
    const split = splitLegacy(data ?? [])
    setPending(split.pending)
    setHistory(split.history)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Live-refresh when uploads are submitted/reviewed.
  useEffect(() => {
    if (!isAdmin) return
    const ch = supabase
      .channel('realtime:pending_uploads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_uploads' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [isAdmin, load])

  async function approve(p) {
    if (acting) return
    setActing(p.id); setError('')
    try {
      await decidePendingUpload(p.id, true)
      await load()
    } catch (err) {
      setError(toUserMessage(err, t('uploadapprovals.intake.unknownError')))
    } finally { setActing(null) }
  }

  async function reject(p) {
    if (acting) return
    const note = window.prompt(t('uploadapprovals.legacy.rejectPrompt', { file: p.file_name, count: p.row_count }), '')
    if (note === null) return
    setActing(p.id); setError('')
    try {
      await decidePendingUpload(p.id, false, note || null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Something went wrong. Please try again.'))
    } finally { setActing(null) }
  }

  // Permanently remove an approval point (the staged upload batch). RLS allows
  // delete for Admins only. Used to clear stale / abandoned / duplicate batches.
  async function remove(p) {
    if (acting) return
    if (!window.confirm(t('uploadapprovals.legacy.deleteConfirm', { file: p.file_name, count: (p.row_count || 0).toLocaleString() }))) return
    setActing(p.id); setError('')
    const { error: err } = await supabase.from('pending_uploads').delete().eq('id', p.id)
    setActing(null)
    if (err) { console.error('[UploadApprovals] delete failed:', err); setError(toUserMessage(err, 'Something went wrong. Please try again.')); return }
    setPreviewing(prev => (prev?.id === p.id ? null : prev))
    await load()
  }

  // ── Canonical Data Intake approvals (import_batches -> secure commit RPC) ──────
  const [intakePreview, setIntakePreview] = useState(null) // { batch, rows }

  async function approveIntake(b) {
    if (acting) return
    setActing(b.id); setError('')
    try {
      await imports.approveBatch(b.id)
      await imports.commitBatch(b.id) // server-side import_commit_batch - validated & idempotent
      await loadIntake()
    } catch (e) {
      console.error('[UploadApprovals] approveIntake failed:', e)
      setError(t('uploadapprovals.intake.commitFailed', { module: b.module, message: toUserMessage(e, t('uploadapprovals.intake.unknownError')) }))
    } finally { setActing(null) }
  }

  async function rejectIntake(b) {
    if (acting) return
    if (!window.confirm(t('uploadapprovals.intake.rejectConfirm', { module: b.module, count: (b.total_rows || 0).toLocaleString() }))) return
    setActing(b.id); setError('')
    try { await imports.rejectBatch(b.id); await loadIntake() }
    catch (e) { console.error('[UploadApprovals] rejectIntake failed:', e); setError(toUserMessage(e, t('uploadapprovals.intake.rejectFailed'))) }
    finally { setActing(null) }
  }

  async function viewIntake(b) {
    if (acting) return
    setActing(b.id); setError('')
    try { const rows = await imports.getBatchRows(b.id, null); setIntakePreview({ batch: b, rows: rows ?? [] }) }
    catch (e) { console.error('[UploadApprovals] viewIntake failed:', e); setError(toUserMessage(e, t('uploadapprovals.intake.viewFailed'))) }
    finally { setActing(null) }
  }

  const kpis = useMemo(() => approvalKpis({ intake, pending, history }), [intake, pending, history])
  // Upload type is a legacy-queue attribute; intake batches are never narrowed by it.
  const intakeView = useMemo(() => filterQueue(intakeRows(intake), { ...filters, type: 'All' }), [intake, filters])
  const legacyAll = tab === 'pending' ? pending : history
  const legacyView = useMemo(() => filterQueue(legacyRows(legacyAll), filters), [legacyAll, filters])
  const countryOptions = useMemo(
    () => distinctValues([...intake, ...pending, ...history], 'country'),
    [intake, pending, history],
  )
  const filterCount = activeFilterCount(filters)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const clearFilters = () => setFilters({ search: '', country: 'All', type: 'All' })

  const intakeColumns = useMemo(() => [
    { id: 'module', header: 'Import', accessorFn: (r) => r.moduleLabel, size: 200,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] capitalize">{row.original.module} {t('uploadapprovals.intake.moduleImport')}</p>
          {row.original.sheet && <p className="text-xs text-[var(--text-muted)] truncate">Sheet: {row.original.sheet}</p>}
        </div>
      ) },
    { id: 'total', header: 'Rows', accessorFn: (r) => r.total, size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCount(row.original.total)}</span> },
    { id: 'ready', header: 'Ready', accessorFn: (r) => r.ready, size: 110, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">{fmtCount(row.original.ready)}
          <span className="text-[var(--text-dim)]"> ({row.original.readyPct == null ? 'N/A' : `${row.original.readyPct}%`})</span>
        </span>
      ) },
    { id: 'warnings', header: 'Warnings', accessorFn: (r) => r.warnings, size: 100, meta: { align: 'right' } },
    { id: 'errors', header: 'Errors', accessorFn: (r) => r.errors, size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className={`tabular-nums ${row.original.errors > 0 ? 'text-red-400 font-semibold' : ''}`}>{fmtCount(row.original.errors)}</span> },
    { id: 'duplicates', header: 'Duplicates', accessorFn: (r) => r.duplicates, size: 100, meta: { align: 'right' } },
    { id: 'country', header: 'Country', accessorFn: (r) => r.country || 'N/A', size: 100 },
    { id: 'created_at', header: 'Submitted', accessorFn: (r) => r.created_at, size: 170,
      meta: { exportValue: (r) => fmtWhen(r.created_at) },
      cell: ({ row }) => <span className="text-xs text-[var(--text-muted)]">{fmtWhen(row.original.created_at)}</span> },
    { id: 'actions', header: 'Actions', enableSorting: false, size: 380, meta: { export: false },
      cell: ({ row }) => {
        const b = row.original
        const busy = acting === b.id
        return (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => viewIntake(b)} disabled={busy} className={BTN}>
              <Eye size={14} aria-hidden="true" /> {t('uploadapprovals.intake.buttons.rows')}
            </button>
            <button type="button" onClick={() => rejectIntake(b)} disabled={busy} className={BTN_DANGER}>
              <XCircle size={14} aria-hidden="true" /> {t('uploadapprovals.intake.buttons.reject')}
            </button>
            <button type="button" onClick={() => approveIntake(b)} disabled={busy || !b.committable}
              title={!b.committable ? t('uploadapprovals.intake.buttons.noReadyRows') : t('uploadapprovals.intake.buttons.approveTitle')}
              className={BTN_PRIMARY}>
              {busy ? <Loader size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle size={14} aria-hidden="true" />}
              {busy ? t('uploadapprovals.intake.buttons.committing') : t('uploadapprovals.intake.buttons.approveCommit')}
            </button>
          </div>
        )
      } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [acting, t])

  const legacyColumns = useMemo(() => [
    { id: 'file_name', header: 'File', accessorFn: (r) => r.file_name || '', size: 240,
      cell: ({ row }) => {
        const p = row.original
        const Icon = TYPE_ICON[p.type] || FileSpreadsheet
        return (
          <div className="flex items-start gap-2 min-w-0">
            <Icon size={16} className="text-[var(--text-muted)] mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">{p.file_name || t('uploadapprovals.legacy.untitledUpload')}</p>
              {p.status === 'rejected' && p.review_note && (
                <p className="text-xs text-red-400 mt-0.5 whitespace-normal">{t('uploadapprovals.legacy.rejectedNote', { note: p.review_note })}</p>
              )}
            </div>
          </div>
        )
      } },
    { id: 'type', header: 'Type', accessorFn: (r) => t(`uploadapprovals.types.${r.type}`), size: 120 },
    { id: 'rowCount', header: 'Rows', accessorFn: (r) => r.rowCount, size: 90, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCount(row.original.rowCount)}</span> },
    { id: 'uploader_name', header: 'Uploaded by', accessorFn: (r) => r.uploader_name || t('uploadapprovals.legacy.unknownUploader'), size: 150 },
    { id: 'country', header: 'Country', accessorFn: (r) => r.country || 'N/A', size: 100 },
    { id: 'created_at', header: 'Submitted', accessorFn: (r) => r.created_at, size: 170,
      meta: { exportValue: (r) => fmtWhen(r.created_at) },
      cell: ({ row }) => <span className="text-xs text-[var(--text-muted)]">{fmtWhen(row.original.created_at)}</span> },
    { id: 'status', header: 'Status', accessorFn: (r) => r.statusLabel, size: 130,
      cell: ({ row }) => {
        const s = row.original.status
        const tone = s === 'approved' ? 'bg-green-500/10 text-green-400 border-green-500/30'
          : s === 'rejected' ? 'bg-red-500/10 text-red-400 border-red-500/30'
            : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
        const Icon = s === 'approved' ? CheckCircle : s === 'rejected' ? XCircle : Clock
        return (
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border ${tone}`}>
            <Icon size={12} aria-hidden="true" /> {row.original.statusLabel}
          </span>
        )
      } },
    { id: 'actions', header: 'Actions', enableSorting: false, size: 380, meta: { export: false },
      cell: ({ row }) => {
        const p = row.original
        const busy = acting === p.id
        return (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setPreviewing(p)} className={BTN}>
              <Pencil size={14} aria-hidden="true" /> {p.status === 'pending' ? t('uploadapprovals.legacy.buttons.viewEdit') : t('uploadapprovals.legacy.buttons.view')}
            </button>
            {p.status === 'pending' && (
              <>
                <button type="button" onClick={() => reject(p)} disabled={busy} className={BTN_DANGER}>
                  <XCircle size={14} aria-hidden="true" /> {t('uploadapprovals.legacy.buttons.reject')}
                </button>
                <button type="button" onClick={() => approve(p)} disabled={busy} className={BTN_PRIMARY}>
                  <CheckCircle size={14} aria-hidden="true" /> {busy ? t('uploadapprovals.legacy.buttons.approving') : t('uploadapprovals.legacy.buttons.approve')}
                </button>
              </>
            )}
            <button type="button" onClick={() => remove(p)} disabled={busy}
              title={t('uploadapprovals.legacy.buttons.deleteTitle')}
              aria-label={`Delete upload batch ${p.file_name || ''}`.trim()}
              className={BTN_DANGER}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        )
      } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [acting, t])

  if (!isAdmin) {
    return (
      <div className="space-y-5">
        <PageHeader title={t('uploadapprovals.header.title')} subtitle={t('uploadapprovals.gate.subtitle')} icon={ClipboardCheck} />
        <EmptyPanel icon={AlertTriangle} title={t('uploadapprovals.gate.message')} description={t('uploadapprovals.gate.description')} />
      </div>
    )
  }

  const tabs = [
    ['intake', t('uploadapprovals.tabs.intake', { count: intake.length }), Database],
    ['pending', t('uploadapprovals.tabs.pending', { count: pending.length }), Inbox],
    ['history', t('uploadapprovals.tabs.history'), History],
  ]
  const kpiLoading = loading || intakeLoading
  const anyReadFailed = !!(loadError || intakeError)
  const kv = (v) => (kpiLoading ? '...' : v)

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('uploadapprovals.header.title')}
        subtitle={t('uploadapprovals.header.subtitle', {
          count: pending.length,
          noun: t(`uploadapprovals.header.batch${pending.length === 1 ? 'Singular' : 'Plural'}`),
          rowsCount: kpis.pendingRows.toLocaleString(),
        })}
        icon={ClipboardCheck}
        onRefresh={() => { load(); loadIntake() }}
        refreshing={kpiLoading}
      />

      {error && <ErrorPanel message={error} />}

      {/* KPI strip. A queue that could not be read shows N/A, never 0. */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3" aria-busy={kpiLoading}>
        <Kpi icon={Inbox} label="Awaiting review" value={kv(anyReadFailed ? 'N/A' : fmtCount(kpis.awaiting))} sub="Intake + legacy batches" />
        <Kpi icon={Database} label="Intake rows ready" value={kv(intakeError ? 'N/A' : fmtCount(kpis.intakeReady))}
          sub={intakeError ? 'Queue could not be read' : `${kpis.intakeReadyPct == null ? 'N/A' : `${kpis.intakeReadyPct}%`} of ${fmtCount(kpis.intakeRows)} staged`} />
        <Kpi icon={AlertTriangle} label="Intake rows in error" value={kv(intakeError ? 'N/A' : fmtCount(kpis.intakeErrors))} sub="Skipped on commit" />
        <Kpi icon={History} label="Legacy approval rate" value={kv(loadError ? 'N/A' : (kpis.approvalRate == null ? 'N/A' : `${kpis.approvalRate}%`))}
          sub={loadError ? 'History could not be read' : `${kpis.approved} approved, ${kpis.rejected} rejected`} />
      </div>

      {/* Tabs + filters */}
      <Card pad="tight" className="gap-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div role="tablist" aria-label="Approval queues" className="flex flex-wrap gap-1 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg p-1">
            {tabs.map(([k, label, Icon]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-bright)] ${tab === k ? 'bg-green-600 text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                <Icon size={14} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 rounded-lg px-3 min-h-[44px] w-72 max-w-full bg-[var(--input-bg)] border border-[var(--input-border)] focus-within:ring-2 focus-within:ring-[var(--border-bright)]">
            <Search size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
            <span className="sr-only">Search uploads</span>
            <input
              className="bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] outline-none flex-1 min-w-0"
              placeholder={t('uploadapprovals.search.placeholder')}
              value={filters.search} onChange={e => setFilter('search', e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span className="block">Country</span>
            <select className={SELECT} value={filters.country} onChange={(e) => setFilter('country', e.target.value)}>
              <option value="All">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {tab !== 'intake' && (
            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span className="block">Upload type</span>
              <select className={SELECT} value={filters.type} onChange={(e) => setFilter('type', e.target.value)}>
                <option value="All">All types</option>
                <option value="tyres">{t('uploadapprovals.types.tyres')}</option>
                <option value="stock">{t('uploadapprovals.types.stock')}</option>
              </select>
            </label>
          )}
          {(filterCount > 0 || filters.search) && (
            <button type="button" onClick={clearFilters} className={BTN}><X size={14} aria-hidden="true" /> Clear filters</button>
          )}
        </div>
      </Card>

      {tab === 'intake' ? (
        intakeError ? (
          <ErrorPanel message={intakeError} onRetry={loadIntake} />
        ) : !intakeLoading && intake.length === 0 ? (
          <EmptyPanel icon={Database} title={t('uploadapprovals.intake.empty.title')} description={t('uploadapprovals.intake.empty.description')} />
        ) : (
          <EnterpriseTable
            columns={intakeColumns}
            data={intakeView}
            getRowId={(r) => String(r.id)}
            loading={intakeLoading}
            enableGlobalFilter={false}
            initialPageSize={25}
            emptyMessage="No intake batches match the filters."
            exportFileName="Data Intake Approvals"
            reportMeta={{ title: 'Data Intake Approvals' }}
          />
        )
      ) : loadError ? (
        <ErrorPanel message={loadError} onRetry={() => { setLoading(true); load() }} />
      ) : !loading && legacyAll.length === 0 ? (
        <EmptyPanel
          icon={CheckCircle}
          title={tab === 'pending' ? t('uploadapprovals.legacy.empty.pendingTitle') : t('uploadapprovals.legacy.empty.historyTitle')}
          description={tab === 'pending' ? t('uploadapprovals.legacy.empty.pendingDescription') : t('uploadapprovals.legacy.empty.historyDescription')}
        />
      ) : (
        <EnterpriseTable
          key={tab}
          columns={legacyColumns}
          data={legacyView}
          getRowId={(r) => String(r.id)}
          loading={loading}
          enableGlobalFilter={false}
          initialPageSize={25}
          emptyMessage="No uploads match the filters."
          exportFileName={tab === 'pending' ? 'Legacy Uploads Pending' : 'Legacy Upload History'}
          reportMeta={{ title: tab === 'pending' ? 'Legacy Uploads Pending' : 'Legacy Upload History' }}
        />
      )}

      {/* Correction modal - view & edit the staged rows before approving */}
      {previewing && (
        <EditBatchModal
          batch={previewing}
          editable={previewing.status === 'pending'}
          onClose={() => setPreviewing(null)}
          onSaved={async () => { await load(); setPreviewing(null) }}
        />
      )}

      {/* Read-only staged-rows preview for a Data Intake batch */}
      {intakePreview && (
        <IntakeRowsModal data={intakePreview} onClose={() => setIntakePreview(null)} />
      )}
    </div>
  )
}

function IntakeRowsModal({ data, onClose }) {
  const { t } = useLanguage()
  const { batch, rows } = data
  const cols = useMemo(() => intakePreviewColumns(rows), [rows])
  const tally = useMemo(() => validationTally(rows), [rows])
  const columns = useMemo(() => [
    { id: 'row', header: t('uploadapprovals.intakeModal.columns.index'), accessorFn: (r) => r.source_row_no, size: 70, meta: { align: 'right' },
      cell: ({ row }) => <span className="text-[var(--text-muted)] tabular-nums">{row.original.source_row_no ?? 'N/A'}</span> },
    { id: 'status', header: t('uploadapprovals.intakeModal.columns.status'), accessorFn: (r) => r.validation_status, size: 140,
      meta: { filterVariant: 'select' },
      cell: ({ row }) => {
        const s = row.original.validation_status
        const tone = s === 'error' ? 'text-red-400' : s === 'warning' ? 'text-amber-300' : 'text-green-400'
        const Icon = s === 'error' ? XCircle : s === 'warning' ? AlertTriangle : CheckCircle
        return (
          <span className={`inline-flex items-center gap-1 font-medium ${tone}`}>
            <Icon size={12} aria-hidden="true" /> {s || 'N/A'}
            {row.original.dup_status && row.original.dup_status !== 'none' ? ` | ${row.original.dup_status}` : ''}
          </span>
        )
      } },
    ...cols.map((c) => ({
      id: `c_${c}`, header: c, accessorFn: (r) => (r.transformed_data?.[c] == null ? '' : String(r.transformed_data[c])), size: 140,
      cell: ({ row }) => {
        const v = row.original.transformed_data?.[c]
        return <span className="whitespace-nowrap text-[var(--text-secondary)]">{v == null ? 'N/A' : String(v)}</span>
      },
    })),
  ], [cols, t])

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`${batch.module} ${t('uploadapprovals.intakeModal.titleSuffix')} | ${(batch.total_rows || 0).toLocaleString()} ${t('uploadapprovals.intakeModal.rowsLabel')}`}
      subtitle={t('uploadapprovals.intakeModal.subtitle')}
    >
      <div className="flex flex-wrap gap-3 text-xs text-[var(--text-muted)] mb-3">
        <span>Ready: <b className="text-[var(--text-primary)]">{tally.ready.toLocaleString()}</b></span>
        <span>Warnings: <b className="text-[var(--text-primary)]">{tally.warning.toLocaleString()}</b></span>
        <span>Errors: <b className="text-[var(--text-primary)]">{tally.error.toLocaleString()}</b></span>
        <span>Ready share: <b className="text-[var(--text-primary)]">{readyPct(batch) == null ? 'N/A' : `${readyPct(batch)}%`}</b></span>
      </div>
      {rows.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm">{t('uploadapprovals.intakeModal.noRows')}</p>
      ) : (
        <EnterpriseTable
          columns={columns}
          data={rows}
          getRowId={(r, i) => String(r.id ?? i)}
          initialPageSize={50}
          searchPlaceholder={t('uploadapprovals.intakeModal.searchPlaceholder')}
          emptyMessage="No staged rows match."
          exportFileName={`Intake batch ${batch.module || ''}`.trim()}
          reportMeta={{ title: `Intake batch ${batch.module || ''}`.trim() }}
        />
      )}
    </Modal>
  )
}

function EditBatchModal({ batch, editable, onClose, onSaved }) {
  const { t } = useLanguage()
  const [rows, setRows]     = useState(() => (Array.isArray(batch.rows) ? batch.rows.map(r => ({ ...r })) : []))
  const [search, setSearch] = useState('')
  const [bulkCol, setBulkCol] = useState('')
  const [bulkVal, setBulkVal] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty]   = useState(false)
  const [err, setErr]       = useState('')

  const cols = useMemo(() => stagedColumns(rows), [rows])
  const visible = useMemo(() => searchStaged(rows, search, cols), [rows, search, cols])

  // Row edits go through the functional setter, so the column defs below do
  // not change on every keystroke (a re-created cell would drop input focus).
  const setCell = useCallback((idx, col, val) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [col]: val } : r)); setDirty(true)
  }, [])
  const deleteRow = useCallback((idx) => {
    setRows(prev => prev.filter((_, i) => i !== idx)); setDirty(true)
  }, [])
  function applyBulk() {
    if (!bulkCol) return
    setRows(prev => prev.map(r => ({ ...r, [bulkCol]: bulkVal }))); setDirty(true)
  }

  async function save() {
    setSaving(true); setErr('')
    const { error } = await supabase.from('pending_uploads')
      .update({ rows, row_count: rows.length })
      .eq('id', batch.id)
    setSaving(false)
    if (error) { setErr(toUserMessage(error, 'Something went wrong. Please try again.')); return }
    onSaved()
  }

  const columns = useMemo(() => [
    ...cols.map((c) => ({
      id: `c_${c}`, header: c, accessorFn: (x) => (x.r[c] == null ? '' : String(x.r[c])), size: 150,
      cell: ({ row }) => {
        const { r, idx } = row.original
        return editable ? (
          <input
            aria-label={`${c}, row ${idx + 1}`}
            className="bg-transparent text-[var(--text-primary)] px-1.5 min-h-[36px] rounded border border-transparent hover:border-[var(--input-border)] focus:border-[var(--border-bright)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-bright)] w-full min-w-[90px]"
            value={r[c] == null ? '' : String(r[c])}
            onChange={e => setCell(idx, c, e.target.value)}
          />
        ) : (
          <span className="text-[var(--text-secondary)] px-1.5 whitespace-nowrap">{r[c] == null ? 'N/A' : String(r[c])}</span>
        )
      },
    })),
    ...(editable ? [{
      id: 'remove', header: '', enableSorting: false, size: 60, meta: { export: false },
      cell: ({ row }) => (
        <button type="button" onClick={() => deleteRow(row.original.idx)}
          aria-label={`${t('uploadapprovals.editModal.removeRowTitle')} ${row.original.idx + 1}`}
          title={t('uploadapprovals.editModal.removeRowTitle')}
          className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
          <Trash2 size={14} aria-hidden="true" />
        </button>
      ),
    }] : []),
  ], [cols, editable, setCell, deleteRow, t])

  const footer = editable ? (
    <div className="flex flex-wrap items-center justify-between gap-2 w-full">
      <span className="text-xs text-[var(--text-muted)]" aria-live="polite">{dirty ? t('uploadapprovals.editModal.unsavedCorrections') : t('uploadapprovals.editModal.noChanges')}</span>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className={BTN}>{t('uploadapprovals.editModal.close')}</button>
        <button type="button" onClick={save} disabled={saving || !dirty} className={BTN_PRIMARY}>
          <Save size={14} aria-hidden="true" /> {saving ? t('uploadapprovals.editModal.saving') : t('uploadapprovals.editModal.saveCorrections')}
        </button>
      </div>
    </div>
  ) : undefined

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`${batch.file_name || t('uploadapprovals.editModal.defaultFileName')} | ${rows.length.toLocaleString()} ${t('uploadapprovals.editModal.rowsLabel')}`}
      subtitle={editable ? t('uploadapprovals.editModal.editableSubtitle') : t('uploadapprovals.editModal.readOnlySubtitle')}
      footer={footer}
    >
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="flex items-center gap-2 rounded-lg px-3 min-h-[44px] flex-1 min-w-[180px] bg-[var(--input-bg)] border border-[var(--input-border)] focus-within:ring-2 focus-within:ring-[var(--border-bright)]">
          <Search size={14} className="text-[var(--text-muted)]" aria-hidden="true" />
          <span className="sr-only">Search staged rows</span>
          <input className="bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] outline-none flex-1 min-w-0"
            placeholder={t('uploadapprovals.editModal.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
        </label>
        {editable && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] space-y-1">
              <span className="block">{t('uploadapprovals.editModal.fixWholeColumn')}</span>
              <select className={SELECT} value={bulkCol} onChange={e => setBulkCol(e.target.value)}>
                <option value="">{t('uploadapprovals.editModal.columnPlaceholder')}</option>
                {cols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] space-y-1">
              <span className="block">New value</span>
              <input className={`${SELECT} w-40`} placeholder={t('uploadapprovals.editModal.setValuePlaceholder')} value={bulkVal} onChange={e => setBulkVal(e.target.value)} />
            </label>
            <button type="button" onClick={applyBulk} disabled={!bulkCol} className={BTN}>
              <Wand2 size={14} aria-hidden="true" /> {t('uploadapprovals.editModal.applyToAll')}
            </button>
          </div>
        )}
      </div>

      {err && <p role="alert" className="text-red-400 text-sm mb-2">{err}</p>}

      {rows.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm">{t('uploadapprovals.editModal.noRows')}</p>
      ) : (
        // Sorting is off while editing: re-ordering rows under the cursor on
        // each keystroke would move the cell being typed into.
        <EnterpriseTable
          columns={columns}
          data={visible}
          getRowId={(x) => String(x.idx)}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableSorting={!editable}
          initialPageSize={50}
          emptyMessage="No staged rows match the search."
          exportFileName={`Staged upload ${batch.file_name || ''}`.trim()}
          reportMeta={{ title: `Staged upload ${batch.file_name || ''}`.trim() }}
        />
      )}
    </Modal>
  )
}
