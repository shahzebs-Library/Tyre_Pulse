/**
 * DtcDiagnostics (route /dtc) - Workshop & Downtime module. Logs vehicle
 * diagnostic trouble codes (OBD-II / telematics faults) against fleet assets
 * with a severity + status lifecycle so workshops can triage engine/ABS/
 * emissions faults, plan downtime, and track resolution.
 *
 * Real data on `dtc_codes` (V160). The fault maths lives in the pure
 * `src/lib/dtcCodes.js` engine; the page model (filters, KPIs, recurrence
 * lookup, register rows) in `src/lib/dtcDiagnosticsAnalytics.js`. Every KPI,
 * chart and table follows the filter card, and says so.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  BarElement, CategoryScale, LinearScale,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  Cpu, AlertTriangle, Activity, Wrench, Plus, Pencil, Trash2, Search, X,
  Save, Loader2, FileSpreadsheet, FileText, Repeat, Layers, Hash, Clock,
  RefreshCw, Truck, CheckCircle2, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDtcCodes, createDtcCode, updateDtcCode, deleteDtcCode,
  DTC_SEVERITIES, DTC_STATUSES,
} from '../lib/api/dtcCodes'
import {
  buildDtcModel, filterDtcRows, dtcRegisterRows, systemOptions,
} from '../lib/dtcDiagnosticsAnalytics'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale)

// The service returns the newest N codes; say so when the window is full.
const READ_LIMIT = 500
const TICK = 'var(--text-muted)'
const GRID = 'var(--panel-2)'

const SEVERITY_META = {
  info: { label: 'Info', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50', color: '#0ea5e9' },
  warning: { label: 'Warning', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50', color: '#f59e0b' },
  critical: { label: 'Critical', cls: 'bg-red-900/40 text-red-300 border border-red-700/50', color: '#ef4444' },
}
const STATUS_META = {
  active: { label: 'Active', cls: 'bg-red-900/40 text-red-300 border border-red-700/50', color: '#ef4444' },
  acknowledged: { label: 'Acknowledged', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50', color: '#f59e0b' },
  cleared: { label: 'Cleared', cls: 'bg-green-900/40 text-green-300 border border-green-700/50', color: '#22c55e' },
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

const EMPTY_FORM = { asset_no: '', code: '', description: '', system: '', severity: 'warning', status: 'active', detected_at: '', site: '', notes: '' }

// ─── Create / edit modal ──────────────────────────────────────────────────────
function CodeModal({ open, initial, onClose, onSaved, country }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editing = Boolean(initial?.id)

  useEffect(() => {
    if (open) {
      setForm(initial?.id ? { ...EMPTY_FORM, ...initial, detected_at: initial.detected_at || '' } : EMPTY_FORM)
      setError('')
    }
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.asset_no.trim()) { setError('An asset number is required.'); return }
    setBusy(true)
    try {
      const payload = { ...form, detected_at: form.detected_at || null, country: country && country !== 'All' ? country : null }
      const row = editing ? await updateDtcCode(initial.id, payload) : await createDtcCode(payload)
      onSaved?.(row, editing)
      onClose?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the diagnostic code.'))
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, country, onSaved, onClose])

  if (!open) return null

  return (
    // Modal owns the backdrop, Escape, the focus trap, the scroll lock and the
    // viewport height cap, so the hand-rolled overlay, the stopPropagation
    // guard and `max-h-[90vh] overflow-y-auto` are all gone.
    //
    // The submit button stays INSIDE the form rather than moving to Modal's
    // `footer`: out there it would need a `form="..."` association to keep
    // submitting, which is a behaviour change, not a layout one.
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={(
        <span className="inline-flex items-center gap-2">
          <Cpu size={18} className="text-[var(--brand-bright)]" />
          {editing ? 'Edit diagnostic code' : 'Log diagnostic code'}
        </span>
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="dtc-asset">Asset number (required)</label>
            <input id="dtc-asset" className="input w-full" placeholder="e.g. TRK-014" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="dtc-code">Trouble code</label>
            <input id="dtc-code" className="input w-full font-mono" placeholder="e.g. P0301" value={form.code} maxLength={60} onChange={(e) => set('code', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="dtc-system">System</label>
            <input id="dtc-system" className="input w-full" placeholder="e.g. Engine, ABS, Emissions" value={form.system} maxLength={120} onChange={(e) => set('system', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="dtc-detected">Detected on</label>
            <input id="dtc-detected" type="date" className="input w-full" value={form.detected_at || ''} onChange={(e) => set('detected_at', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="dtc-severity">Severity</label>
            <select id="dtc-severity" className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
              {DTC_SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_META[s]?.label || s}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="dtc-status">Status</label>
            <select id="dtc-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {DTC_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="dtc-site">Site</label>
            <input id="dtc-site" className="input w-full" placeholder="Depot / workshop" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="dtc-description">Description</label>
          <input id="dtc-description" className="input w-full" placeholder="Fault description" value={form.description} maxLength={2000} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="dtc-notes">Notes</label>
          <textarea id="dtc-notes" className="input w-full min-h-[90px] resize-y" placeholder="Diagnosis notes, actions taken" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-sm min-h-[44px]">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {editing ? 'Save changes' : 'Log code'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function DeleteConfirm({ row, onCancel, onConfirm, busy }) {
  if (!row) return null
  return (
    // No form here, so the actions belong in Modal's pinned `footer`.
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title="Delete diagnostic code?"
      footer={(
        <>
          <button type="button" onClick={onCancel} className="btn-secondary text-sm min-h-[44px]">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </>
      )}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
        <p className="text-sm text-[var(--text-muted)]">
          {row.code ? <span className="font-mono">{row.code}</span> : 'This code'} on <span className="font-medium">{row.asset_no}</span> will be permanently removed.
        </p>
      </div>
    </Modal>
  )
}


function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
      {label}
      <select className="input min-h-[44px]" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  )
}

function ChartSlot({ loading, empty, emptyText, children }) {
  if (loading) return <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
  if (empty) return <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-4">{emptyText}</div>
  return children
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DtcDiagnostics() {
  const { activeCountry } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [systemFilter, setSystemFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listDtcCodes({ country: activeCountry, limit: READ_LIMIT })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load diagnostic codes.')); setRows((prev) => prev ?? []) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const now = useMemo(() => new Date(), [updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = useMemo(
    () => filterDtcRows(rows || [], { status: statusFilter, severity: severityFilter, asset: assetFilter, system: systemFilter, search }),
    [rows, statusFilter, severityFilter, assetFilter, systemFilter, search],
  )
  // Every figure below follows the filter card.
  const model = useMemo(() => buildDtcModel(filtered, now), [filtered, now])
  const { analysis, kpis, index } = model
  const summary = analysis.summary
  const registerRows = useMemo(() => dtcRegisterRows(filtered, index, now), [filtered, index, now])

  const assetOptions = useMemo(() => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(), [rows])
  const systems = useMemo(() => systemOptions(rows || []), [rows])
  const loadingFirst = rows === null
  const truncated = (rows?.length || 0) >= READ_LIMIT
  const hasFilters = statusFilter !== 'all' || severityFilter !== 'all' || assetFilter || systemFilter || search
  const clearFilters = () => { setStatusFilter('all'); setSeverityFilter('all'); setAssetFilter(''); setSystemFilter(''); setSearch('') }

  // ── Charts (severity / status colours are SEMANTIC; categories follow the theme) ──
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: TICK, boxWidth: 12 } } },
  }
  const severityData = {
    labels: ['Critical', 'Warning', 'Info'],
    datasets: [{
      data: [summary.bySeverity.critical, summary.bySeverity.warning, summary.bySeverity.info],
      backgroundColor: [SEVERITY_META.critical.color, SEVERITY_META.warning.color, SEVERITY_META.info.color],
      borderWidth: 0,
    }],
  }
  const statusData = {
    labels: ['Active', 'Acknowledged', 'Cleared'],
    datasets: [{
      data: [summary.byStatus.active, summary.byStatus.acknowledged, summary.byStatus.cleared],
      backgroundColor: [STATUS_META.active.color, STATUS_META.acknowledged.color, STATUS_META.cleared.color],
      borderWidth: 0,
    }],
  }
  const topRecurring = analysis.recurring.slice(0, 8)
  const recurringBarData = {
    labels: topRecurring.map((g) => `${g.code} on ${g.asset_no}`),
    datasets: [{ label: 'Occurrences', data: topRecurring.map((g) => g.occurrences), backgroundColor: topRecurring.map((_, i) => colorAt(i)), borderRadius: 4 }],
  }
  const bySystem = analysis.bySystem.slice(0, 10)
  const systemBarData = {
    labels: bySystem.map((g) => g.system || 'Unspecified'),
    datasets: [{ label: 'Codes', data: bySystem.map((g) => g.count), backgroundColor: categorical(bySystem.length), borderRadius: 4 }],
  }
  const barOpts = (horizontal = false) => ({
    responsive: true, maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: TICK, precision: 0 }, grid: { color: GRID } },
      y: { ticks: { color: TICK, precision: 0 }, grid: { color: GRID } },
    },
  })
  const ageing = analysis.ageing
  const dq = analysis.dataQuality
  const AGE_COLOUR = { 'over 90d': SEVERITY_META.critical.color, '31 to 90d': SEVERITY_META.warning.color, undated: withAlpha('#94a3b8', 0.8) }

  // ── Export (filtered register) ──
  const EXPORT_COLS = ['asset_no', 'code', 'system', 'description', 'severityLabel', 'severityRank', 'statusLabel', 'detected', 'openDays', 'recurrence', 'site']
  const EXPORT_HEADERS = ['Asset', 'Code', 'System', 'Description', 'Severity', 'Severity rank', 'Status', 'Detected', 'Days open', 'Recurrence', 'Site']
  const exportRows = registerRows.map((r) => ({
    ...r,
    asset_no: r.asset_no ?? '', code: r.code ?? '', system: r.system ?? '', description: r.description ?? '', site: r.site ?? '',
    detected: fmtDate(r.detected_at), openDays: r.openDays ?? 'N/A', recurrence: r.recurrence ?? 'N/A',
  }))
  const fileBase = reportFileName('DTC Diagnostics', reportDateLabel())
  const doExcel = async () => {
    try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase, 'Codes') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    try {
      await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'DTC Diagnostics', fileBase, 'landscape', '', truncated ? { subtitleNote: `Newest ${READ_LIMIT} codes only` } : {})
    } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const upsertRow = useCallback((row, wasEditing) => {
    if (!row) return
    setRows((prev) => {
      const list = prev || []
      if (wasEditing) return list.map((r) => (r.id === row.id ? { ...r, ...row } : r))
      return [row, ...list]
    })
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!toDelete) return
    setDeleteBusy(true)
    try {
      await deleteDtcCode(toDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== toDelete.id))
      setToDelete(null)
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the code.'))
    } finally {
      setDeleteBusy(false)
    }
  }, [toDelete])

  const openEdit = useCallback((r) => { setEditing(r); setModalOpen(true) }, [])

  // ── Columns ──
  const burdenColumns = useMemo(() => [
    {
      id: 'asset_no', header: 'Asset', accessorFn: (a) => a.asset_no,
      cell: ({ row }) => (
        <button
          type="button"
          className="font-medium text-[var(--text-primary)] hover:text-[var(--brand-bright)] underline-offset-2 hover:underline min-h-[44px] text-left"
          onClick={() => setAssetFilter(row.original.asset_no)}
          aria-label={`Filter the page to asset ${row.original.asset_no}`}
        >
          {row.original.asset_no}
        </button>
      ),
    },
    {
      id: 'burden', header: 'Burden', accessorFn: (a) => a.burden, meta: { align: 'right' },
      cell: ({ row }) => {
        const sev = row.original.worstSeverity
        return <span className="font-mono font-semibold" style={{ color: sev ? SEVERITY_META[sev]?.color : 'inherit' }}>{row.original.burden}{sev ? <span className="sr-only">, worst {sev}</span> : null}</span>
      },
    },
    { id: 'openCodes', header: 'Open', accessorFn: (a) => a.openCodes, meta: { align: 'right' } },
    { id: 'criticalActive', header: 'Critical', accessorFn: (a) => a.criticalActive || 0, meta: { align: 'right' } },
    { id: 'distinctCodes', header: 'Codes', accessorFn: (a) => a.distinctCodes, meta: { align: 'right' } },
    { id: 'worst', header: 'Worst severity', accessorFn: (a) => SEVERITY_META[a.worstSeverity]?.label || 'N/A' },
  ], [])

  const recurringColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', accessorFn: (g) => g.asset_no, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no}</span> },
    {
      id: 'code', header: 'Code', accessorFn: (g) => g.code,
      cell: ({ row }) => <span className="font-mono text-xs" style={{ color: row.original.worstSeverity ? SEVERITY_META[row.original.worstSeverity]?.color : 'inherit' }}>{row.original.code}</span>,
    },
    { id: 'occurrences', header: 'Times', accessorFn: (g) => g.occurrences, meta: { align: 'right' }, cell: ({ row }) => <span className="font-semibold text-orange-400 tabular-nums">{row.original.occurrences}</span> },
    { id: 'open', header: 'Open', accessorFn: (g) => g.open, meta: { align: 'right' } },
    { id: 'worst', header: 'Worst severity', accessorFn: (g) => SEVERITY_META[g.worstSeverity]?.label || 'N/A' },
    { id: 'spanDays', header: 'Over (days)', accessorFn: (g) => g.spanDays ?? -1, meta: { align: 'right' }, cell: ({ row }) => (row.original.spanDays == null ? 'N/A' : row.original.spanDays) },
    { id: 'lastSeen', header: 'Last seen', accessorFn: (g) => g.lastSeen ?? '', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.lastSeen)}</span> },
  ], [])

  const registerColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => r.asset_no ?? '', cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'code', header: 'Code', accessorFn: (r) => r.code ?? '', cell: ({ row }) => <span className="font-mono text-xs">{row.original.code || 'N/A'}</span> },
    { id: 'system', header: 'System', accessorFn: (r) => r.system ?? '', cell: ({ row }) => row.original.system || 'N/A' },
    { id: 'description', header: 'Description', accessorFn: (r) => r.description ?? '', cell: ({ row }) => <span className="block max-w-[280px] truncate" title={row.original.description || ''}>{row.original.description || 'N/A'}</span> },
    { id: 'severity', header: 'Severity', accessorFn: (r) => r.severityRank, cell: ({ row }) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${SEVERITY_META[row.original.severity]?.cls || ''}`}>{row.original.severityLabel}</span> },
    { id: 'status', header: 'Status', accessorFn: (r) => r.statusLabel, cell: ({ row }) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_META[row.original.status]?.cls || ''}`}>{row.original.statusLabel}</span> },
    { id: 'detected', header: 'Detected', accessorFn: (r) => r.detectedMs ?? -1, cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.detected_at)}</span> },
    { id: 'openDays', header: 'Days open', accessorFn: (r) => r.openDays ?? -1, meta: { align: 'right' }, cell: ({ row }) => (row.original.openDays == null ? 'N/A' : row.original.openDays) },
    {
      id: 'recurrence', header: 'Recurrence', accessorFn: (r) => r.recurrence ?? 0, meta: { align: 'right' },
      cell: ({ row }) => (row.original.recurrence
        ? <span className="badge text-[11px] px-2 py-0.5 rounded bg-orange-900/40 text-orange-300 border border-orange-700/50 inline-flex items-center gap-1"><Repeat size={11} aria-hidden="true" /> {row.original.recurrence} times</span>
        : <span className="text-[var(--text-muted)]">N/A</span>),
    },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site ?? '', cell: ({ row }) => row.original.site || 'N/A' },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => {
        const label = `${row.original.code || 'code'} on ${row.original.asset_no || 'asset'}`
        return (
          <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={() => openEdit(row.original.raw)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--brand-bright)] hover:bg-[var(--input-bg)]" aria-label={`Edit ${label}`}><Pencil size={15} /></button>
            <button type="button" onClick={() => setToDelete(row.original.raw)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--input-bg)]" aria-label={`Delete ${label}`}><Trash2 size={15} /></button>
          </div>
        )
      },
    },
  ], [openEdit])

  const scopeText = hasFilters ? `Figures cover the ${filtered.length} codes matching the filters.` : `Figures cover all ${filtered.length} codes loaded.`

  return (
    <div className="space-y-6">
      <PageHeader
        title="DTC Diagnostics"
        subtitle="Vehicle diagnostic trouble codes across the fleet: severity, status lifecycle, recurrence and ageing."
        icon={Cpu}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50" disabled={!registerRows.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50" disabled={!registerRows.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={() => { setEditing(null); setModalOpen(true) }} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50" disabled={missing}>
              <Plus size={14} aria-hidden="true" /> Log code
            </button>
          </div>
        }
      />

      {missing && (
        // The tint comes from `tone`, not a `border-*` class: Card sets
        // `border`/`borderColor` INLINE and a plain utility loses to that. Card
        // is `flex flex-col`, so the row direction goes in `style`.
        <Card tone="warn" role="status" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-300 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">DTC diagnostics are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V160_DTC_CODES.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" role="alert" className="items-start justify-between gap-[var(--space-3)]" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div><p className="text-[var(--text-primary)] font-medium">Something went wrong with the diagnostic codes.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm shrink-0 inline-flex items-center gap-1.5 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </Card>
      )}

      {truncated && (
        <Card tone="info" role="status" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <Info size={16} className="text-sky-300 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-muted)]">Showing the newest {READ_LIMIT} codes. Older codes are not loaded, so the figures cover this window only.</p>
        </Card>
      )}

      {/* Filters: scope every KPI, chart and table below. */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="relative flex-1 min-w-[200px]">
            <span className="sr-only">Search codes</span>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full min-h-[44px]" placeholder="Search asset, code, system, description, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}>
            <option value="all">All statuses</option>
            {DTC_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </FilterSelect>
          <FilterSelect label="Severity" value={severityFilter} onChange={setSeverityFilter}>
            <option value="all">All severities</option>
            {DTC_SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_META[s]?.label || s}</option>)}
          </FilterSelect>
          <FilterSelect label="System" value={systemFilter} onChange={setSystemFilter}>
            <option value="">All systems</option>
            {systems.map((s) => <option key={s} value={s}>{s}</option>)}
          </FilterSelect>
          <FilterSelect label="Asset" value={assetFilter} onChange={setAssetFilter}>
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </FilterSelect>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>}
        </div>
        <p className="text-xs text-[var(--text-muted)]" aria-live="polite">{loadingFirst ? 'Loading codes' : scopeText}</p>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <StatTile label="Open codes" value={loadingFirst ? 'N/A' : kpis.open} icon={Activity} tone="warn" sub={`${kpis.active} active`} />
        <StatTile label="Critical active" value={loadingFirst ? 'N/A' : kpis.criticalActive} icon={AlertTriangle} tone="crit" />
        <StatTile label="Acknowledged" value={loadingFirst ? 'N/A' : kpis.acknowledged} icon={Clock} tone="warn" />
        <StatTile label="Cleared" value={loadingFirst || kpis.clearedPct == null ? 'N/A' : kpis.clearedPct} unit={!loadingFirst && kpis.clearedPct != null ? '%' : undefined} icon={CheckCircle2} tone="accent" sub={`of ${kpis.total} codes`} />
        <StatTile label="Assets affected" value={loadingFirst ? 'N/A' : kpis.assetsAffected} icon={Truck} tone="info" />
        <StatTile label="Repeat offenders" value={loadingFirst ? 'N/A' : kpis.repeatOffenderAssets} icon={Repeat} tone="warn" sub="assets with a recurring code" />
        <StatTile label="Distinct codes" value={loadingFirst ? 'N/A' : kpis.distinctCodes} icon={Hash} tone="info" />
        <StatTile label="Open over 30 days" value={loadingFirst ? 'N/A' : kpis.openOver30} icon={Clock} tone="crit" sub={kpis.oldestOpenDays == null ? 'no dated open code' : `oldest ${kpis.oldestOpenDays} days`} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[var(--gap-grid)]">
        <Card>
          <CardHeader level={3} title="Codes by severity" />
          <CardBody style={{ height: '15rem' }}>
            <ChartSlot loading={loadingFirst} empty={!summary.total} emptyText="No codes to chart.">
              <Doughnut data={severityData} options={donutOpts} />
            </ChartSlot>
          </CardBody>
        </Card>
        <Card>
          <CardHeader level={3} title="Active, acknowledged and cleared" />
          <CardBody style={{ height: '15rem' }}>
            <ChartSlot loading={loadingFirst} empty={!summary.total} emptyText="No codes to chart.">
              <Doughnut data={statusData} options={donutOpts} />
            </ChartSlot>
          </CardBody>
        </Card>
        <Card>
          <CardHeader level={3} title="Faults by system" />
          <CardBody style={{ height: '15rem' }}>
            <ChartSlot loading={loadingFirst} empty={!bySystem.length} emptyText="No system recorded on these codes.">
              <Bar data={systemBarData} options={barOpts(true)} />
            </ChartSlot>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[var(--gap-grid)]">
        <Card className="lg:col-span-2">
          <CardHeader level={3} icon={Repeat} title="Top recurring faults" description="Same code reappearing on the same asset, two or more times." />
          <CardBody style={{ height: '16rem' }}>
            <ChartSlot loading={loadingFirst} empty={!topRecurring.length} emptyText="No recurring faults detected.">
              <Bar data={recurringBarData} options={barOpts(true)} />
            </ChartSlot>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            level={3}
            icon={Clock}
            title="Open code ageing"
            description={ageing.openTotal ? `${ageing.openTotal} open, avg ${ageing.avgDays ?? 'N/A'} days, oldest ${ageing.oldestDays ?? 'N/A'} days` : 'No open codes.'}
          />
          <ul className="space-y-2">
            {Object.entries(ageing.buckets).map(([label, n]) => {
              const pct = ageing.openTotal ? Math.round((n / ageing.openTotal) * 100) : 0
              return (
                <li key={label}>
                  <div className="flex justify-between text-xs text-[var(--text-muted)] mb-0.5"><span>{label}</span><span className="tabular-nums">{n} ({pct}%)</span></div>
                  <div className="h-2 rounded bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded" style={{ width: `${pct}%`, background: AGE_COLOUR[label] || withAlpha('#0ea5e9', 0.8) }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-[var(--gap-grid)]">
        <Card pad="none">
          <div className="px-4 pt-4"><CardHeader level={3} icon={Wrench} iconTone="warn" title="Worst assets by fault burden" description="Open codes weighted by severity. Select an asset to filter the page." /></div>
          <EnterpriseTable
            columns={burdenColumns}
            data={analysis.burden}
            getRowId={(a) => a.asset_no}
            loading={loadingFirst}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="No open faults to rank."
          />
        </Card>
        <Card pad="none">
          <div className="px-4 pt-4"><CardHeader level={3} icon={Repeat} iconTone="warn" title="Repeat offenders" description="Every asset and code pair seen two or more times." /></div>
          <EnterpriseTable
            columns={recurringColumns}
            data={analysis.recurring}
            getRowId={(g) => `${g.asset_no}-${g.code}`}
            loading={loadingFirst}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="No code has recurred on the same asset yet."
          />
        </Card>
      </div>

      {dq.flaggedRows > 0 && (
        <Card tone="warn">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Layers size={15} className="text-amber-300" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Data quality</h3>
            <span className="text-xs text-[var(--text-muted)]">{dq.flaggedRows} of {dq.total} rows need attention</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {dq.counts.missingCode > 0 && <span className="badge px-2 py-0.5 rounded bg-[var(--input-bg)]">Missing code: {dq.counts.missingCode}</span>}
            {dq.counts.missingDetectedAt > 0 && <span className="badge px-2 py-0.5 rounded bg-[var(--input-bg)]">Missing detected date: {dq.counts.missingDetectedAt}</span>}
            {dq.counts.missingSystem > 0 && <span className="badge px-2 py-0.5 rounded bg-[var(--input-bg)]">Missing system: {dq.counts.missingSystem}</span>}
            {dq.counts.unknownSeverity > 0 && <span className="badge px-2 py-0.5 rounded bg-[var(--input-bg)]">Unknown severity: {dq.counts.unknownSeverity}</span>}
            {dq.counts.unknownStatus > 0 && <span className="badge px-2 py-0.5 rounded bg-[var(--input-bg)]">Unknown status: {dq.counts.unknownStatus}</span>}
          </div>
        </Card>
      )}

      {/* Register. The filter card above is the search, so the table's own
          search is off to avoid two competing boxes; exports live in the header. */}
      <Card pad="none">
        <div className="px-4 pt-4"><CardHeader level={3} icon={Cpu} title="Code register" description={`${registerRows.length} codes`} /></div>
        <EnterpriseTable
          columns={registerColumns}
          data={registerRows}
          getRowId={(r, i) => String(r.id ?? i)}
          loading={loadingFirst}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          emptyMessage={summary.total === 0 && !hasFilters ? 'No diagnostic codes logged yet. Use "Log code" to record a fault.' : 'No codes match these filters.'}
        />
      </Card>

      <CodeModal
        open={modalOpen}
        initial={editing}
        country={activeCountry}
        onClose={() => setModalOpen(false)}
        onSaved={upsertRow}
      />
      <DeleteConfirm row={toDelete} onCancel={() => setToDelete(null)} onConfirm={confirmDelete} busy={deleteBusy} />
    </div>
  )
}
