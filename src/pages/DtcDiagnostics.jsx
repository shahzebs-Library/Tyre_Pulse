/**
 * DtcDiagnostics (route /dtc) — Workshop & Downtime module. Logs vehicle
 * diagnostic trouble codes (OBD-II / telematics faults) against fleet assets
 * with a severity + status lifecycle so workshops can triage engine/ABS/
 * emissions faults, plan downtime, and track resolution.
 *
 * Real data on `dtc_codes` (V160). KPI tiles, a severity doughnut, full CRUD
 * (create/edit/delete), status + severity + asset filters, search, Excel/PDF
 * export, and loading / empty / error / not-migrated states throughout.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  BarElement, CategoryScale, LinearScale,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  Cpu, AlertTriangle, Activity, Wrench, Plus, Pencil, Trash2, Search, X,
  Filter, Save, Loader2, FileSpreadsheet, FileText, Repeat, Layers, Hash, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDtcCodes, createDtcCode, updateDtcCode, deleteDtcCode,
  DTC_SEVERITIES, DTC_STATUSES,
} from '../lib/api/dtcCodes'
import { analyzeDtc, severityRank } from '../lib/dtcCodes'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale)

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

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Cpu size={18} className="text-[var(--brand-bright)]" />
            {editing ? 'Edit diagnostic code' : 'Log diagnostic code'}
          </h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Asset number *</label>
            <input className="input w-full" placeholder="e.g. TRK-014" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
          </div>
          <div>
            <label className="label">Trouble code</label>
            <input className="input w-full font-mono" placeholder="e.g. P0301" value={form.code} maxLength={60} onChange={(e) => set('code', e.target.value)} />
          </div>
          <div>
            <label className="label">System</label>
            <input className="input w-full" placeholder="e.g. Engine, ABS, Emissions" value={form.system} maxLength={120} onChange={(e) => set('system', e.target.value)} />
          </div>
          <div>
            <label className="label">Detected on</label>
            <input type="date" className="input w-full" value={form.detected_at || ''} onChange={(e) => set('detected_at', e.target.value)} />
          </div>
          <div>
            <label className="label">Severity</label>
            <select className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
              {DTC_SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_META[s]?.label || s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {DTC_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Site</label>
            <input className="input w-full" placeholder="Depot / workshop" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Description</label>
          <input className="input w-full" placeholder="Fault description" value={form.description} maxLength={2000} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input w-full min-h-[90px] resize-y" placeholder="Diagnosis notes, actions taken" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {editing ? 'Save changes' : 'Log code'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function DeleteConfirm({ row, onCancel, onConfirm, busy }) {
  if (!row) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onMouseDown={onCancel}>
      <div className="card w-full max-w-md space-y-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
          <div>
            <h3 className="font-bold text-[var(--text-primary)]">Delete diagnostic code?</h3>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {row.code ? <span className="font-mono">{row.code}</span> : 'This code'} on <span className="font-medium">{row.asset_no}</span> will be permanently removed.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </div>
  )
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
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listDtcCodes({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load diagnostic codes.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const analysis = useMemo(() => analyzeDtc(rows || []), [rows])
  const summary = analysis.summary

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (severityFilter !== 'all' && r.severity !== severityFilter) return false
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.code || ''} ${r.description || ''} ${r.system || ''} ${r.site || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, severityFilter, assetFilter, search])

  const chartText = typeof document !== 'undefined'
    ? (getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af')
    : '#9ca3af'
  const gridColor = withAlpha('#94a3b8', 0.15)

  // Severity doughnut (SEMANTIC severity colours, hard-coded).
  const donutData = {
    labels: ['Critical', 'Warning', 'Info'],
    datasets: [{
      data: [summary.bySeverity.critical, summary.bySeverity.warning, summary.bySeverity.info],
      backgroundColor: [SEVERITY_META.critical.color, SEVERITY_META.warning.color, SEVERITY_META.info.color],
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: chartText, boxWidth: 12 } } },
  }

  // Active vs cleared doughnut (SEMANTIC status colours).
  const statusData = {
    labels: ['Active', 'Acknowledged', 'Cleared'],
    datasets: [{
      data: [summary.byStatus.active, summary.byStatus.acknowledged, summary.byStatus.cleared],
      backgroundColor: [STATUS_META.active.color, STATUS_META.acknowledged.color, STATUS_META.cleared.color],
      borderWidth: 0,
    }],
  }

  // Codes-by-severity bar (SEMANTIC severity colours).
  const severityBarData = {
    labels: ['Info', 'Warning', 'Critical'],
    datasets: [{
      label: 'Codes',
      data: [summary.bySeverity.info, summary.bySeverity.warning, summary.bySeverity.critical],
      backgroundColor: [SEVERITY_META.info.color, SEVERITY_META.warning.color, SEVERITY_META.critical.color],
      borderRadius: 4,
    }],
  }

  // Top recurring codes bar (NON-semantic -> reportColors theme).
  const recurring = analysis.recurring
  const topRecurring = recurring.slice(0, 8)
  const recurringBarData = {
    labels: topRecurring.map((g) => `${g.code} @ ${g.asset_no}`),
    datasets: [{
      label: 'Occurrences',
      data: topRecurring.map((g) => g.occurrences),
      backgroundColor: topRecurring.map((_, i) => colorAt(i)),
      borderRadius: 4,
    }],
  }

  // Faults by system bar (NON-semantic -> reportColors theme).
  const bySystem = analysis.bySystem.slice(0, 10)
  const systemBarData = {
    labels: bySystem.map((g) => g.system || 'Unspecified'),
    datasets: [{
      label: 'Codes',
      data: bySystem.map((g) => g.count),
      backgroundColor: categorical(bySystem.length),
      borderRadius: 4,
    }],
  }

  const barOpts = (horizontal = false) => ({
    responsive: true, maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: chartText, precision: 0 }, grid: { color: gridColor } },
      y: { ticks: { color: chartText, precision: 0 }, grid: { color: gridColor } },
    },
  })

  const burden = analysis.burden
  const ageing = analysis.ageing
  const dq = analysis.dataQuality

  const kpis = [
    { label: 'Active codes', value: summary.active, icon: Activity, tone: 'text-amber-400' },
    { label: 'Critical active', value: summary.criticalActive, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'Repeat-offender assets', value: analysis.kpis.repeatOffenderAssets, icon: Repeat, tone: 'text-orange-400' },
    { label: 'Distinct codes', value: analysis.kpis.distinctCodes, icon: Hash, tone: 'text-sky-400' },
  ]

  // Recurrence lookup so the table + export can show repeat counts per row.
  const recurrenceByKey = useMemo(() => {
    const m = new Map()
    for (const g of recurring) m.set(`${g.asset_no} ${String(g.code).toUpperCase()}`, g.occurrences)
    return m
  }, [recurring])
  const rowRecurrence = (r) => {
    const a = String(r.asset_no || '').trim()
    const c = String(r.code || '').trim().toUpperCase()
    if (!a || !c) return 0
    return recurrenceByKey.get(`${a} ${c}`) || 0
  }

  const EXPORT_COLS = ['asset_no', 'code', 'system', 'description', 'severity', 'sev_rank', 'status', 'detected_at', 'recurrence', 'site']
  const EXPORT_HEADERS = ['Asset', 'Code', 'System', 'Description', 'Severity', 'Severity rank', 'Status', 'Detected', 'Recurrence', 'Site']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '', code: r.code || '', system: r.system || '', description: r.description || '',
    severity: SEVERITY_META[r.severity]?.label || r.severity || '', sev_rank: severityRank(r.severity),
    status: STATUS_META[r.status]?.label || r.status || '',
    detected_at: fmtDate(r.detected_at), recurrence: rowRecurrence(r), site: r.site || '',
  }))

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

  const clearFilters = () => { setStatusFilter('all'); setSeverityFilter('all'); setAssetFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || severityFilter !== 'all' || assetFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="DTC Diagnostics"
        subtitle="Vehicle diagnostic trouble codes across the fleet: severity, status lifecycle, and root-cause tracking."
        icon={Cpu}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'dtc_diagnostics') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'DTC Diagnostics', 'dtc_diagnostics', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={() => { setEditing(null); setModalOpen(true) }} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> Log code
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">DTC diagnostics are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V160_DTC_CODES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Could not load diagnostic codes.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? 'N/A' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Codes by severity</h3>
          <div className="h-64">
            {rows && summary.total ? <Doughnut data={donutData} options={donutOpts} /> : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                {rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No codes logged.'}
              </div>
            )}
          </div>
        </div>

        {/* Filters + summary */}
        <div className="card lg:col-span-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input className="input pl-9 w-full" placeholder="Search asset, code, system, description" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
              <option value="all">All statuses</option>
              {DTC_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
            </select>
            <select className="input" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
              <option value="all">All severities</option>
              {DTC_SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_META[s]?.label || s}</option>)}
            </select>
            <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
              <option value="">All assets</option>
              {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
            <span className="badge px-2 py-0.5 rounded bg-[var(--input-bg)]">Active: {summary.byStatus.active}</span>
            <span className="badge px-2 py-0.5 rounded bg-[var(--input-bg)]">Acknowledged: {summary.byStatus.acknowledged}</span>
            <span className="badge px-2 py-0.5 rounded bg-[var(--input-bg)]">Cleared: {summary.byStatus.cleared}</span>
            <span className="ml-auto">{filtered.length} of {summary.total}</span>
          </div>
        </div>
      </div>

      {/* ── Fault analytics ─────────────────────────────────────────────── */}
      {rows !== null && (summary.total > 0 ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Codes by severity</h3>
              <div className="h-56"><Bar data={severityBarData} options={barOpts(false)} /></div>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Active vs cleared</h3>
              <div className="h-56"><Doughnut data={statusData} options={donutOpts} /></div>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Faults by system</h3>
              <div className="h-56">
                {bySystem.length ? <Bar data={systemBarData} options={barOpts(true)} /> : (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No system data recorded.</div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Top recurring codes chart */}
            <div className="card lg:col-span-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2">
                <Repeat size={15} className="text-orange-400" /> Top recurring faults
              </h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Same code reappearing on the same asset (two or more times).</p>
              <div className="h-64">
                {topRecurring.length ? <Bar data={recurringBarData} options={barOpts(true)} /> : (
                  <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No recurring faults detected.</div>
                )}
              </div>
            </div>

            {/* Ageing of open codes */}
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2">
                <Clock size={15} className="text-sky-400" /> Open code ageing
              </h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                {ageing.openTotal ? `${ageing.openTotal} open, avg ${ageing.avgDays ?? 'N/A'}d, oldest ${ageing.oldestDays ?? 'N/A'}d` : 'No open codes.'}
              </p>
              <div className="space-y-2">
                {Object.entries(ageing.buckets).map(([label, n]) => {
                  const pct = ageing.openTotal ? Math.round((n / ageing.openTotal) * 100) : 0
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-xs text-[var(--text-muted)] mb-0.5"><span>{label}</span><span>{n}</span></div>
                      <div className="h-2 rounded bg-[var(--input-bg)] overflow-hidden">
                        <div className="h-full rounded" style={{ width: `${pct}%`, background: label === 'over 90d' ? SEVERITY_META.critical.color : label === '31 to 90d' ? SEVERITY_META.warning.color : withAlpha('#0ea5e9', 0.8) }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Worst assets by fault burden */}
            <div className="card !p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
                <Wrench size={15} className="text-orange-400" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Worst assets by fault burden</h3>
              </div>
              {burden.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">No open faults to rank.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--input-border)]">
                        {['Asset', 'Burden', 'Open', 'Critical', 'Codes'].map((h) => <th key={h} className="px-4 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {burden.map((a) => (
                        <tr key={a.asset_no} className="border-b border-[var(--input-border)]/50">
                          <td className="px-4 py-2 font-medium text-[var(--text-primary)]">
                            <button className="hover:text-[var(--brand-bright)]" onClick={() => { setAssetFilter(a.asset_no); if (typeof window !== 'undefined') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }) }}>{a.asset_no}</button>
                          </td>
                          <td className="px-4 py-2"><span className="font-mono font-semibold" style={{ color: a.worstSeverity ? SEVERITY_META[a.worstSeverity]?.color : 'inherit' }}>{a.burden}</span></td>
                          <td className="px-4 py-2 text-[var(--text-secondary)]">{a.openCodes}</td>
                          <td className="px-4 py-2 text-red-400">{a.criticalActive || 0}</td>
                          <td className="px-4 py-2 text-[var(--text-secondary)]">{a.distinctCodes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recurring codes table */}
            <div className="card !p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
                <Repeat size={15} className="text-orange-400" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Repeat offenders</h3>
              </div>
              {recurring.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">No code has recurred on the same asset yet.</p>
              ) : (
                <div className="overflow-x-auto max-h-[320px]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--input-border)]">
                        {['Asset', 'Code', 'Times', 'Open', 'Last seen'].map((h) => <th key={h} className="px-4 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {recurring.slice(0, 50).map((g) => (
                        <tr key={`${g.asset_no}-${g.code}`} className="border-b border-[var(--input-border)]/50">
                          <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{g.asset_no}</td>
                          <td className="px-4 py-2 font-mono text-xs" style={{ color: g.worstSeverity ? SEVERITY_META[g.worstSeverity]?.color : 'inherit' }}>{g.code}</td>
                          <td className="px-4 py-2 font-semibold text-orange-400">{g.occurrences}</td>
                          <td className="px-4 py-2 text-[var(--text-secondary)]">{g.open}</td>
                          <td className="px-4 py-2 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(g.lastSeen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Data quality */}
          {dq.flaggedRows > 0 && (
            <div className="card border border-amber-800/40">
              <div className="flex items-center gap-2 mb-2">
                <Layers size={15} className="text-amber-400" />
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
            </div>
          )}
        </>
      ) : null)}

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Code', 'System', 'Description', 'Severity', 'Status', 'Detected', 'Recurrence', 'Site', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={10} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {summary.total === 0 ? (
                    <><Cpu size={22} className="mx-auto mb-2 opacity-60" />No diagnostic codes logged yet. Use "Log code" to record a fault.</>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No codes match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const rec = rowRecurrence(r)
                  return (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">{r.asset_no || 'N/A'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.code || 'N/A'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.system || 'N/A'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[280px] truncate" title={r.description || ''}>{r.description || 'N/A'}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${SEVERITY_META[r.severity]?.cls || ''}`}>{SEVERITY_META[r.severity]?.label || r.severity}</span></td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_META[r.status]?.cls || ''}`}>{STATUS_META[r.status]?.label || r.status}</span></td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.detected_at)}</td>
                    <td className="px-4 py-2.5">
                      {rec > 1
                        ? <span className="badge text-[11px] px-2 py-0.5 rounded bg-orange-900/40 text-orange-300 border border-orange-700/50 inline-flex items-center gap-1"><Repeat size={11} /> {rec}x</span>
                        : <span className="text-[var(--text-muted)]">N/A</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditing(r); setModalOpen(true) }} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--brand-bright)] hover:bg-[var(--input-bg)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setToDelete(r)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--input-bg)]" aria-label="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500. Refine filters or export for the full set.</p>}
      </div>

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
