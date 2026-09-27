/**
 * Dvir (route /dvir) — Driver Vehicle Inspection Reports.
 *
 * Log daily pre/post-trip vehicle inspections: which asset, who inspected it,
 * the date, whether defects were found, whether the vehicle is safe to operate,
 * and a status lifecycle (open -> resolved -> closed). Full CRUD with a defects
 * vs clean breakdown chart, KPI tiles, filters, search, Excel/PDF export, and
 * loading / empty / error states throughout.
 *
 * Runs on the new `dvir_reports` table (MIGRATIONS_V155). When the table is not
 * yet deployed the lister degrades to [] and the page surfaces a migration hint.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  ClipboardCheck, ClipboardList, CheckCircle2, AlertTriangle, Truck,
  Plus, Pencil, Trash2, Search, X, Filter, Save, Loader2,
  FileSpreadsheet, FileText, RefreshCw, Percent, Clock, Repeat, TrendingUp,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import { analyzeDvir, filterDvir, distinctValues } from '../lib/dvirAnalytics'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDvirReports, createDvirReport, updateDvirReport, deleteDvirReport,
  DVIR_INSPECTION_TYPES, DVIR_STATUS_VALUES,
} from '../lib/api/dvir'
import { DVIR_TYPE_META, DVIR_STATUS_META } from '../lib/dvir'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const TYPE_STYLES = {
  pre_trip: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  post_trip: 'bg-violet-900/40 text-violet-300 border border-violet-700/50',
}
const STATUS_STYLES = {
  open: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  resolved: 'bg-green-900/40 text-green-300 border border-green-700/50',
  closed: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10)
}
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

const EMPTY_FORM = {
  asset_no: '', driver_name: '', inspection_type: 'pre_trip', inspection_date: todayStr(),
  defects_found: false, defect_notes: '', safe_to_operate: true, site: '', status: 'open',
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
function DvirModal({ initial, activeCountry, onClose, onSaved }) {
  const editing = !!initial?.id
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    ...(initial || {}),
    inspection_date: initial?.inspection_date || todayStr(),
    defects_found: !!initial?.defects_found,
    safe_to_operate: initial?.safe_to_operate == null ? true : !!initial.safe_to_operate,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.asset_no.trim()) { setError('An asset number is required.'); return }
    setBusy(true)
    try {
      const payload = {
        asset_no: form.asset_no,
        driver_name: form.driver_name || null,
        inspection_type: form.inspection_type,
        inspection_date: form.inspection_date || null,
        defects_found: !!form.defects_found,
        defect_notes: form.defect_notes || null,
        safe_to_operate: !!form.safe_to_operate,
        site: form.site || null,
        status: form.status,
      }
      if (editing) {
        await updateDvirReport(initial.id, payload)
      } else {
        await createDvirReport({
          ...payload,
          country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
        })
      }
      onSaved?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the inspection report.'))
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, activeCountry, onSaved])

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      size="lg"
      title={(
        <span className="inline-flex items-center gap-2">
          <ClipboardCheck size={18} className="text-[var(--brand-bright)]" aria-hidden="true" />
          {editing ? 'Edit inspection report' : 'New inspection report'}
        </span>
      )}
    >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="dvir-asset_no">Asset number *</label>
              <input id="dvir-asset_no" className="input w-full" value={form.asset_no} maxLength={120}
                placeholder="e.g. TRK-1042"
                onChange={(e) => set('asset_no', e.target.value)} autoFocus />
            </div>
            <div>
              <label className="label" htmlFor="dvir-driver_name">Driver</label>
              <input id="dvir-driver_name" className="input w-full" value={form.driver_name} maxLength={160}
                placeholder="Inspecting driver"
                onChange={(e) => set('driver_name', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="dvir-inspection_type">Inspection type</label>
              <select id="dvir-inspection_type" className="input w-full" value={form.inspection_type} onChange={(e) => set('inspection_type', e.target.value)}>
                {DVIR_INSPECTION_TYPES.map((t) => <option key={t} value={t}>{DVIR_TYPE_META[t]?.label || t}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="dvir-inspection_date">Inspection date</label>
              <input id="dvir-inspection_date" type="date" className="input w-full" value={form.inspection_date || ''}
                onChange={(e) => set('inspection_date', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="dvir-site">Site</label>
              <input id="dvir-site" className="input w-full" value={form.site} maxLength={120}
                placeholder="Depot / branch"
                onChange={(e) => set('site', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="dvir-status">Status</label>
              <select id="dvir-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {DVIR_STATUS_VALUES.map((s) => <option key={s} value={s}>{DVIR_STATUS_META[s]?.label || s}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 pt-1">
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" checked={!!form.defects_found} onChange={(e) => set('defects_found', e.target.checked)} />
              Defects found
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" checked={!!form.safe_to_operate} onChange={(e) => set('safe_to_operate', e.target.checked)} />
              Safe to operate
            </label>
          </div>

          <div>
            <label className="label" htmlFor="dvir-defect_notes">Defect notes</label>
            <textarea id="dvir-defect_notes" className="input w-full min-h-[100px] resize-y" value={form.defect_notes} maxLength={4000}
              placeholder="Describe any defects found during the inspection…"
              onChange={(e) => set('defect_notes', e.target.value)} />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create report'}
            </button>
          </div>
        </form>
    </Modal>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function DeleteConfirm({ row, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async () => {
    setBusy(true); setError('')
    try { await deleteDvirReport(row.id); onConfirm?.() }
    catch (err) { setError(toUserMessage(err, 'Could not delete the report.')); setBusy(false) }
  }
  return (
    <Modal
      open
      onClose={busy ? undefined : onCancel}
      closeOnBackdrop={false}
      title="Delete inspection report?"
      size="sm"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-900/30 flex items-center justify-center shrink-0">
            <Trash2 size={18} className="text-red-400" />
          </div>
          <div>
            <p className="text-sm text-[var(--text-muted)]">
              Report for asset <span className="font-medium text-[var(--text-secondary)]">{row.asset_no}</span>
              {row.inspection_date ? ` on ${fmtDate(row.inspection_date)}` : ''} will be permanently removed.
            </p>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm" disabled={busy}>Cancel</button>
          <button type="button" onClick={go} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Dvir() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [defectFilter, setDefectFilter] = useState('all')
  const [safeFilter, setSafeFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')

  const [modal, setModal] = useState(null)       // { row } | { row: null } for create
  const [deleting, setDeleting] = useState(null)  // row

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listDvirReports({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load inspection reports.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null
  // A failed read is not "no reports": figures read N/A until a retry works.
  const unknown = loading || !!error

  const assetOptions = useMemo(() => distinctValues(rows || [], 'asset_no'), [rows])
  const siteOptions = useMemo(() => distinctValues(rows || [], 'site'), [rows])

  const filtered = useMemo(() => filterDvir(rows || [], {
    status: statusFilter, type: typeFilter, asset: assetFilter, site: siteFilter,
    defects: defectFilter, safe: safeFilter, from: fromDate, to: toDate, search,
  }), [rows, statusFilter, typeFilter, assetFilter, siteFilter, defectFilter, safeFilter, fromDate, toDate, search])

  const totalCount = (rows || []).length
  const view = useMemo(() => analyzeDvir(filtered), [filtered])
  const k = view.kpis
  const na = (v, fmt = (x) => x) => (unknown || v == null ? 'N/A' : fmt(v))

  const kpis = [
    { label: 'Reports', value: na(k.total), sub: `${k.distinctAssets} assets`, icon: ClipboardList, tone: 'text-[var(--text-primary)]' },
    { label: 'Defect rate', value: na(k.defectRate, (x) => `${x}%`), sub: `${k.withDefects} with defects`, icon: Percent, tone: 'text-red-400' },
    { label: 'Unsafe to operate', value: na(k.unsafe), sub: `${k.openUnsafe} still open`, icon: Truck, tone: k.unsafe > 0 ? 'text-amber-400' : 'text-green-400' },
    { label: 'Open', value: na(k.open), sub: k.oldestOpenDays == null ? 'no dated open report' : `oldest ${k.oldestOpenDays} days`, icon: Clock, tone: 'text-sky-400' },
    { label: 'Clean reports', value: na(k.clean), sub: 'no defects found', icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Repeat-defect assets', value: na(k.repeatDefectAssets), sub: '2 or more defect reports', icon: Repeat, tone: 'text-indigo-400' },
    { label: 'Pre-trip', value: na(k.preTrip), sub: 'inspections', icon: ClipboardCheck, tone: 'text-[var(--text-secondary)]' },
    { label: 'Post-trip', value: na(k.postTrip), sub: 'inspections', icon: ClipboardCheck, tone: 'text-[var(--text-secondary)]' },
  ]

  // Semantic defect colours (meaning-bearing, deliberately not palettized).
  const donutData = {
    labels: ['With defects', 'Clean'],
    datasets: [{ data: [k.withDefects, k.clean], backgroundColor: ['#ef4444', '#22c55e'], borderColor: 'var(--card-bg)', borderWidth: 2 }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '62%',
    plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-secondary)', boxWidth: 12 } } },
  }
  const trendData = {
    labels: view.trend.map((t) => t.label),
    datasets: [
      { label: 'Reports', data: view.trend.map((t) => t.total), backgroundColor: withAlpha(colorAt(0), 0.55), borderColor: colorAt(0), borderWidth: 1, borderRadius: 4 },
      { label: 'With defects', data: view.trend.map((t) => t.defects), backgroundColor: withAlpha(colorAt(3), 0.7), borderColor: colorAt(3), borderWidth: 1, borderRadius: 4 },
    ],
  }
  const trendOpts = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'top', labels: { color: 'var(--text-secondary)', boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
    },
  }
  const hasTrend = view.trend.some((t) => t.total > 0)

  const EXPORT_COLS = ['asset_no', 'driver_name', 'inspection_type', 'inspection_date', 'defects_found', 'safe_to_operate', 'site', 'status', 'defect_notes']
  const EXPORT_HEADERS = ['Asset', 'Driver', 'Type', 'Date', 'Defects', 'Safe to operate', 'Site', 'Status', 'Defect notes']
  const safeText = (v) => (v == null ? 'N/A' : v ? 'Yes' : 'No')
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '',
    driver_name: r.driver_name || '',
    inspection_type: DVIR_TYPE_META[r.inspection_type]?.label || r.inspection_type || '',
    inspection_date: fmtDate(r.inspection_date),
    defects_found: r.defects_found ? 'Yes' : 'No',
    safe_to_operate: safeText(r.safe_to_operate),
    site: r.site || '',
    status: DVIR_STATUS_META[r.status]?.label || r.status || '',
    defect_notes: r.defect_notes || '',
  }))
  const fileBase = reportFileName('DVIR Reports', activeCountry)

  const columns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 110,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'driver_name', header: 'Driver', accessorFn: (r) => r.driver_name || 'N/A', size: 150 },
    { id: 'inspection_type', header: 'Type', accessorFn: (r) => DVIR_TYPE_META[r.inspection_type]?.label || r.inspection_type || 'N/A', size: 110,
      cell: ({ row }) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${TYPE_STYLES[row.original.inspection_type] || ''}`}>{DVIR_TYPE_META[row.original.inspection_type]?.label || row.original.inspection_type || 'N/A'}</span> },
    { id: 'inspection_date', header: 'Date', accessorFn: (r) => r.inspection_date || '', size: 110, cell: ({ row }) => fmtDate(row.original.inspection_date) },
    { id: 'defects_found', header: 'Defects', accessorFn: (r) => (r.defects_found ? 'Defects' : 'Clean'), size: 110,
      cell: ({ row }) => (row.original.defects_found
        ? <span className="badge text-[11px] px-2 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/50 inline-flex items-center gap-1"><AlertTriangle size={11} aria-hidden="true" /> Defects</span>
        : <span className="badge text-[11px] px-2 py-0.5 rounded bg-green-900/40 text-green-300 border border-green-700/50 inline-flex items-center gap-1"><CheckCircle2 size={11} aria-hidden="true" /> Clean</span>) },
    { id: 'safe_to_operate', header: 'Safe', accessorFn: (r) => (r.safe_to_operate == null ? 'N/A' : r.safe_to_operate ? 'Safe' : 'Unsafe'), size: 100,
      cell: ({ row }) => (row.original.safe_to_operate == null ? <span className="text-[var(--text-muted)] text-xs">N/A</span>
        : row.original.safe_to_operate
          ? <span className="text-green-400 inline-flex items-center gap-1 text-xs"><CheckCircle2 size={13} aria-hidden="true" /> Safe</span>
          : <span className="text-red-400 inline-flex items-center gap-1 text-xs"><X size={13} aria-hidden="true" /> Unsafe</span>) },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 110 },
    { id: 'status', header: 'Status', accessorFn: (r) => DVIR_STATUS_META[r.status]?.label || r.status || 'N/A', size: 110,
      cell: ({ row }) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[row.original.status] || ''}`}>{DVIR_STATUS_META[row.original.status]?.label || row.original.status || 'N/A'}</span> },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); setModal({ row: row.original }) }} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)]" aria-label={`Edit report for ${row.original.asset_no || 'asset'}`}><Pencil size={15} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setDeleting(row.original) }} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400" aria-label={`Delete report for ${row.original.asset_no || 'asset'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [])

  const clearFilters = () => {
    setStatusFilter('all'); setTypeFilter('all'); setAssetFilter(''); setSiteFilter('')
    setDefectFilter('all'); setSafeFilter('all'); setFromDate(''); setToDate(''); setSearch('')
  }
  const hasFilters = statusFilter !== 'all' || typeFilter !== 'all' || assetFilter || siteFilter
    || defectFilter !== 'all' || safeFilter !== 'all' || fromDate || toDate || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="DVIR Reports"
        subtitle="Driver Vehicle Inspection Reports: daily pre/post-trip checks, defects found, and safe-to-operate status across the fleet."
        icon={ClipboardCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((key, i) => ({ key, header: EXPORT_HEADERS[i] })), 'DVIR Reports', fileBase, 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={() => setModal({ row: null })} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing}>
              <Plus size={15} aria-hidden="true" /> New report
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">DVIR reports are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V155_DVIR_REPORTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="card border border-red-800/50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div><p className="text-red-300 font-medium">Could not load inspection reports.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {/* KPI tiles (follow the active filters) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((t) => {
          const Icon = t.icon
          return (
            <div key={t.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{t.label}</p>
                <Icon size={16} className={t.tone} aria-hidden="true" />
              </div>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${t.tone}`}>{t.value}</p>
              {!unknown && t.sub && <p className="text-xs text-[var(--text-muted)] mt-1">{t.sub}</p>}
            </div>
          )
        })}
      </div>
      {!unknown && hasFilters && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">These figures cover the {filtered.length} of {totalCount} reports matching the current filters.</p>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Defects vs clean</h3>
          <div className="h-64" role="img" aria-label={`${k.withDefects} reports with defects, ${k.clean} clean`}>
            {error ? <EmptyChart empty="Not available until the reports load." />
              : filtered.length ? <Doughnut data={donutData} options={donutOpts} />
                : <EmptyChart loading={loading} empty={hasFilters ? 'No reports match these filters.' : 'No reports yet.'} />}
          </div>
        </div>
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 inline-flex items-center gap-2"><TrendingUp size={15} className="text-[var(--text-muted)]" aria-hidden="true" /> Reports and defects by month (last 12 months)</h3>
          <div className="h-64" role="img" aria-label={`Monthly reports: ${view.trend.map((t) => `${t.label} ${t.total} (${t.defects} with defects)`).join(', ')}`}>
            {error ? <EmptyChart empty="Not available until the reports load." />
              : hasTrend ? <Bar data={trendData} options={trendOpts} />
                : <EmptyChart loading={loading} empty="No dated reports in the last 12 months." />}
          </div>
        </div>
      </div>

      {/* Repeat-defect assets */}
      {!unknown && view.repeatAssets.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 inline-flex items-center gap-2"><Repeat size={15} className="text-indigo-400" aria-hidden="true" /> Assets with repeat defects</h3>
          <div className="flex flex-wrap gap-2">
            {view.repeatAssets.slice(0, 20).map((a) => (
              <button type="button" key={a.asset_no} onClick={() => setAssetFilter(a.asset_no)}
                className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 min-h-[44px] text-left hover:border-[var(--brand-bright)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)]"
                aria-label={`Filter to asset ${a.asset_no}, ${a.defects} defect reports`}>
                <p className="text-xs font-semibold text-[var(--text-primary)]">{a.asset_no}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{a.defects} defect reports</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full" aria-label="Search inspection reports" placeholder="Search asset, driver, site, notes..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {DVIR_STATUS_VALUES.map((v) => <option key={v} value={v}>{DVIR_STATUS_META[v]?.label || v}</option>)}
          </select>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Inspection type">
            <option value="all">All types</option>
            {DVIR_INSPECTION_TYPES.map((v) => <option key={v} value={v}>{DVIR_TYPE_META[v]?.label || v}</option>)}
          </select>
          <select className="input" value={defectFilter} onChange={(e) => setDefectFilter(e.target.value)} aria-label="Defects">
            <option value="all">Defects and clean</option>
            <option value="yes">With defects</option>
            <option value="no">Clean only</option>
          </select>
          <select className="input" value={safeFilter} onChange={(e) => setSafeFilter(e.target.value)} aria-label="Safe to operate">
            <option value="all">Safe and unsafe</option>
            <option value="yes">Safe to operate</option>
            <option value="no">Unsafe</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <label className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
            From <input type="date" className="input py-1" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
            To <input type="date" className="input py-1" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {totalCount}</span>
        </div>
      </div>

      {/* Register */}
      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={error || null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        viewKey="dvir-reports"
        initialPageSize={25}
        emptyMessage={totalCount === 0 ? 'No inspection reports yet. Log the first one to get started.' : 'No reports match these filters.'}
        emptyIcon={totalCount === 0 ? <ClipboardList size={22} className="opacity-60" aria-hidden="true" /> : <Filter size={22} className="opacity-60" aria-hidden="true" />}
        onRowClick={(r) => setModal({ row: r })}
      />

      {modal && (
        <DvirModal
          initial={modal.row}
          activeCountry={activeCountry}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          row={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => { setDeleting(null); load() }}
        />
      )}
    </div>
  )
}

function EmptyChart({ loading, empty = 'No data.' }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
      {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : empty}
    </div>
  )
}
