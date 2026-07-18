/**
 * TyreServiceEvents (route /tyre-service-events) - the operational fit / remove /
 * rotate / repair lifecycle log behind CPK and rotation. Full CRUD on the
 * `tyre_service_events` table (V151) plus a deep analytics layer: 6 KPI tiles
 * (total, this period, top type, distinct assets serviced, documented-removal
 * data quality, mean interval between interventions), an event-type doughnut, a
 * 12-month trend bar, most-active assets / positions and a by-site breakdown -
 * every metric derived from real rows via src/lib/tyreServiceEventsAnalytics.js
 * with honest empty / null states (NEVER fabricated). Filterable, searchable,
 * sortable table with date-range + site + position + type filters and Excel/PDF
 * export. Loading / error+Retry / empty states throughout.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement,
  Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  Wrench, Activity, RotateCcw, Gauge, Plus, Pencil, Trash2, Search, X, Filter,
  Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, CircleDot,
  Building2, MapPin, TrendingUp, ClipboardCheck, Timer, ArrowUp, ArrowDown,
  RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  listServiceEvents, createServiceEvent, updateServiceEvent, deleteServiceEvent,
} from '../lib/api/tyreServiceEvents'
import { EVENT_TYPES, EVENT_TYPE_META } from '../lib/tyreServiceEvents'
import {
  analyzeServiceEvents, filterEvents, distinctValues, eventTypeLabel,
} from '../lib/tyreServiceEventsAnalytics'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const EVENT_ICON = {
  rotation: RotateCcw,
  repair: Wrench,
  inflation: Gauge,
  inspection: Activity,
  replacement: CircleDot,
  other: CircleDot,
}
const BADGE_STYLES = {
  rotation:    'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  repair:      'bg-red-900/40 text-red-300 border border-red-700/50',
  inflation:   'bg-green-900/40 text-green-300 border border-green-700/50',
  inspection:  'bg-violet-900/40 text-violet-300 border border-violet-700/50',
  replacement: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  other:       'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
const num = (v) => (v == null || v === '' ? 'N/A' : v)
const fmtDate = (v) => (v ? String(v).slice(0, 10) : 'N/A')
const cssVar = (name, fallback) => {
  try { return (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim() || fallback }
  catch { return fallback }
}

const EMPTY_FORM = {
  tyre_serial: '', asset_no: '', position: '', event_type: 'inspection',
  event_date: new Date().toISOString().slice(0, 10),
  tread_depth: '', pressure: '', cost: '', technician: '', site: '', notes: '',
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
function EventModal({ open, initial, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editing = Boolean(initial?.id)

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(initial ? { ...EMPTY_FORM, ...initial, event_date: initial.event_date || EMPTY_FORM.event_date } : EMPTY_FORM)
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const isRemoval = form.event_type === 'replacement' || form.event_type === 'repair'

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.tyre_serial.trim() && !form.asset_no.trim()) {
      setError('Provide a tyre serial or an asset number.'); return
    }
    setBusy(true)
    try {
      if (editing) await updateServiceEvent(initial.id, form)
      else await createServiceEvent(form)
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the service event.'))
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, onSaved, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {editing ? 'Edit service event' : 'Log service event'}
          </h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Tyre serial</label>
            <input className="input w-full font-mono" placeholder="e.g. SN-00123" value={form.tyre_serial} onChange={(e) => set('tyre_serial', e.target.value)} />
          </div>
          <div>
            <label className="label">Asset no.</label>
            <input className="input w-full font-mono" placeholder="e.g. TRK-42" value={form.asset_no} onChange={(e) => set('asset_no', e.target.value)} />
          </div>
          <div>
            <label className="label">Event type</label>
            <select className="input w-full" value={form.event_type} onChange={(e) => set('event_type', e.target.value)}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_META[t]?.label || t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Event date</label>
            <input type="date" className="input w-full" value={form.event_date || ''} onChange={(e) => set('event_date', e.target.value)} />
          </div>
          <div>
            <label className="label">Position</label>
            <input className="input w-full" placeholder="e.g. Steer L, Drive R" value={form.position} onChange={(e) => set('position', e.target.value)} />
          </div>
          <div>
            <label className="label">Site</label>
            <input className="input w-full" placeholder="Workshop / depot" value={form.site} onChange={(e) => set('site', e.target.value)} />
          </div>
          <div>
            <label className="label">Tread depth (mm)</label>
            <input type="number" step="0.1" min="0" className="input w-full" value={form.tread_depth} onChange={(e) => set('tread_depth', e.target.value)} />
          </div>
          <div>
            <label className="label">Pressure (PSI)</label>
            <input type="number" step="0.1" min="0" className="input w-full" value={form.pressure} onChange={(e) => set('pressure', e.target.value)} />
          </div>
          <div>
            <label className="label">Cost</label>
            <input type="number" step="0.01" min="0" className="input w-full" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
          </div>
          <div>
            <label className="label">Technician</label>
            <input className="input w-full" placeholder="Name / ID" value={form.technician} onChange={(e) => set('technician', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">
            Notes {isRemoval && <span className="text-amber-400">(reason recommended for this removal)</span>}
          </label>
          <textarea className="input w-full min-h-[90px] resize-y" placeholder="Observations, root cause, actions taken..." value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {busy ? 'Saving...' : editing ? 'Save changes' : 'Log event'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
        </div>
      </form>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function ConfirmDelete({ open, onCancel, onConfirm, busy }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onMouseDown={onCancel}>
      <div className="card w-full max-w-sm space-y-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-[var(--text-primary)] font-semibold">Delete this service event?</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">This action cannot be undone.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 justify-end">
          <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Small ranking list card ────────────────────────────────────────────────
function RankCard({ title, icon: Icon, rows, labelKey, currency, empty }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 inline-flex items-center gap-2">
        <Icon size={15} className="text-[var(--text-muted)]" /> {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] py-6 text-center">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r[labelKey] || 'x'} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-[var(--text-primary)] truncate" title={r[labelKey]}>{r[labelKey]}</span>
                <span className="text-[var(--text-muted)] text-xs shrink-0">
                  {r.count} {r.count === 1 ? 'event' : 'events'}
                  {r.totalCost > 0 && <span className="ml-2 text-amber-400">{formatCurrencyCompact(r.totalCost, currency)}</span>}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded bg-[var(--input-bg)] overflow-hidden">
                <div className="h-full bg-sky-500/70 rounded" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const SORTS = {
  event_date: (a, b) => String(a.event_date || '').localeCompare(String(b.event_date || '')),
  event_type: (a, b) => eventTypeLabel(a.event_type).localeCompare(eventTypeLabel(b.event_type)),
  asset_no: (a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || '')),
  cost: (a, b) => (Number(a.cost) || 0) - (Number(b.cost) || 0),
}

export default function TyreServiceEvents() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [typeFilter, setTypeFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [positionFilter, setPositionFilter] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('event_date')
  const [sortDir, setSortDir] = useState('desc')

  const [modalOpen, setModalOpen] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [deleteRow, setDeleteRow] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listServiceEvents({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(isMissingRelation(err) ? 'missing' : (toUserMessage(err, 'Could not load service events.')))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Whole-dataset analytics (KPIs, breakdown, trend, rankings). Honest on [].
  const analysis = useMemo(() => analyzeServiceEvents(rows || [], { periodDays: 30, months: 12 }), [rows])
  const siteOptions = useMemo(() => distinctValues(rows || [], 'site'), [rows])
  const positionOptions = useMemo(() => distinctValues(rows || [], 'position'), [rows])

  const filtered = useMemo(() => {
    const list = filterEvents(rows || [], { type: typeFilter, site: siteFilter, position: positionFilter, from, to, search })
    const cmp = SORTS[sortKey] || SORTS.event_date
    const sorted = [...list].sort(cmp)
    return sortDir === 'desc' ? sorted.reverse() : sorted
  }, [rows, typeFilter, siteFilter, positionFilter, from, to, search, sortKey, sortDir])

  const chartText = cssVar('--text-muted', '#9ca3af')
  const gridColor = cssVar('--panel-2', 'rgba(148,163,184,0.15)')

  const donutData = {
    labels: analysis.breakdown.items.map((i) => i.label),
    datasets: [{
      data: analysis.breakdown.items.map((i) => i.count),
      backgroundColor: analysis.breakdown.items.map((i) => i.color),
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'right', labels: { color: chartText, boxWidth: 12 } } },
  }

  const trendData = {
    labels: analysis.trend.map((b) => b.label),
    datasets: [{
      label: 'Events',
      data: analysis.trend.map((b) => b.total),
      backgroundColor: '#38bdf8',
      borderRadius: 4,
      maxBarThickness: 28,
    }],
  }
  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: chartText, maxRotation: 0, autoSkip: true }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: chartText, precision: 0 }, grid: { color: gridColor } },
    },
  }

  const siteChart = {
    labels: analysis.bySite.map((s) => s.site),
    datasets: [{
      label: 'Events',
      data: analysis.bySite.map((s) => s.count),
      backgroundColor: '#818cf8',
      borderRadius: 4,
      maxBarThickness: 22,
    }],
  }
  const siteBarOpts = {
    ...barOpts,
    indexAxis: 'y',
    scales: {
      x: { beginAtZero: true, ticks: { color: chartText, precision: 0 }, grid: { color: gridColor } },
      y: { ticks: { color: chartText }, grid: { display: false } },
    },
  }

  const EXPORT_COLS = ['event_date', 'event_type', 'tyre_serial', 'asset_no', 'position', 'tread_depth', 'pressure', 'cost', 'technician', 'site', 'notes']
  const EXPORT_HEADERS = ['Date', 'Type', 'Serial', 'Asset', 'Position', 'Tread (mm)', 'Pressure', 'Cost', 'Technician', 'Site', 'Notes']
  const exportRows = filtered.map((r) => ({
    event_date: fmtDate(r.event_date),
    event_type: EVENT_TYPE_META[r.event_type]?.label || r.event_type,
    tyre_serial: r.tyre_serial || '',
    asset_no: r.asset_no || '',
    position: r.position || '',
    tread_depth: r.tread_depth ?? '',
    pressure: r.pressure ?? '',
    cost: r.cost ?? '',
    technician: r.technician || '',
    site: r.site || '',
    notes: r.notes || '',
  }))

  const k = analysis.kpis
  const kpis = [
    { label: 'Total events', value: k.total, icon: Activity, tone: 'text-[var(--text-primary)]',
      sub: `${analysis.breakdown.items.length} event ${analysis.breakdown.items.length === 1 ? 'type' : 'types'}` },
    { label: `Last ${k.periodDays} days`, value: k.thisPeriod, icon: TrendingUp, tone: 'text-sky-400',
      sub: 'recent activity' },
    { label: 'Top event type', value: k.topType ? k.topType.label : 'N/A', icon: Gauge, tone: 'text-green-400',
      sub: k.topType ? `${k.topType.count} logged` : 'no events yet' },
    { label: 'Assets serviced', value: k.distinctAssets, icon: Building2, tone: 'text-indigo-400',
      sub: `${k.distinctTyres} distinct tyres` },
    { label: 'Removals documented', value: k.removalEvents ? `${k.removalDocumentedPct}%` : 'N/A', icon: ClipboardCheck, tone: 'text-amber-400',
      sub: k.removalEvents ? `${k.removalBlank} of ${k.removalEvents} missing reason` : 'no removals' },
    { label: 'Mean interval', value: k.meanDaysBetween == null ? 'N/A' : `${k.meanDaysBetween}d`, icon: Timer, tone: 'text-violet-400',
      sub: k.meanDaysBetween == null ? 'need 2+ events / tyre' : 'between events per tyre' },
  ]

  const clearFilters = () => { setTypeFilter('all'); setSiteFilter('all'); setPositionFilter('all'); setFrom(''); setTo(''); setSearch('') }
  const hasFilters = typeFilter !== 'all' || siteFilter !== 'all' || positionFilter !== 'all' || from || to || search
  const openCreate = () => { setEditRow(null); setModalOpen(true) }
  const openEdit = (r) => { setEditRow(r); setModalOpen(true) }
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }
  const SortIcon = ({ col }) => sortKey !== col ? null : (sortDir === 'asc' ? <ArrowUp size={11} className="inline ml-1" /> : <ArrowDown size={11} className="inline ml-1" />)

  const confirmDelete = useCallback(async () => {
    if (!deleteRow) return
    setDeleting(true)
    try {
      await deleteServiceEvent(deleteRow.id)
      setDeleteRow(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the service event.'))
    } finally {
      setDeleting(false)
    }
  }, [deleteRow, load])

  const hasData = rows && rows.length > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Service Events"
        subtitle="Operational fit, remove, rotate, repair and inflation log per tyre - the lifecycle history behind CPK and rotation, with tread, pressure, cost and technician."
        icon={Wrench}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'tyre_service_events')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k2, i) => ({ key: k2, header: EXPORT_HEADERS[i] })), 'Tyre Service Events', 'tyre_service_events', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> Log event
            </button>
          </div>
        }
      />

      {error === 'missing' && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Tyre service events are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V151_TYRE_SERVICE_EVENTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}
      {error && error !== 'missing' && (
        <div className="card border border-red-800/50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div><p className="text-red-300 font-medium">Could not load service events.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0"><RefreshCw size={14} /> Retry</button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((kp) => {
          const Icon = kp.icon
          return (
            <div key={kp.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{kp.label}</p>
                <Icon size={16} className={kp.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${kp.tone}`}>{rows === null ? 'N/A' : kp.value}</p>
              <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{rows === null ? '' : kp.sub}</p>
            </div>
          )
        })}
      </div>

      {/* Charts row: type doughnut + monthly trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Events by type</h3>
          <div className="h-64">
            {rows === null
              ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : hasData && analysis.breakdown.items.length
                ? <Doughnut data={donutData} options={donutOpts} />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No service events yet.</div>}
          </div>
        </div>

        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Events over the last 12 months</h3>
          <div className="h-64">
            {rows === null
              ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : hasData
                ? <Bar data={trendData} options={barOpts} />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No dated events to trend.</div>}
          </div>
        </div>
      </div>

      {/* Rankings + site breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RankCard title="Most-serviced assets" icon={Building2} rows={analysis.topAssets} labelKey="asset_no" currency={activeCurrency} empty={rows === null ? 'Loading...' : 'No asset-linked events.'} />
        <RankCard title="Most-serviced positions" icon={MapPin} rows={analysis.topPositions} labelKey="position" currency={activeCurrency} empty={rows === null ? 'Loading...' : 'No position data recorded.'} />
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 inline-flex items-center gap-2">
            <Building2 size={15} className="text-[var(--text-muted)]" /> Events by site
          </h3>
          <div className="h-52">
            {analysis.bySite.length
              ? <Bar data={siteChart} options={siteBarOpts} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{rows === null ? 'Loading...' : 'No site data recorded.'}</div>}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search serial, asset, position, technician, notes..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Event type">
            <option value="all">All types</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_META[t].label}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site" disabled={!siteOptions.length}>
            <option value="all">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} aria-label="Position" disabled={!positionOptions.length}>
            <option value="all">All positions</option>
            {positionOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--text-muted)]">From</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <label className="text-xs text-[var(--text-muted)]">To</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {k.total}</span>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {analysis.breakdown.items.length === 0 ? (
            <span className="text-xs text-[var(--text-dim)]">No events logged yet.</span>
          ) : EVENT_TYPES.filter((t) => analysis.breakdown.byType[t] > 0).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter((cur) => (cur === t ? 'all' : t))}
              className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${BADGE_STYLES[t]} ${typeFilter === t ? 'ring-1 ring-[var(--text-secondary)]' : ''}`}
            >
              {EVENT_TYPE_META[t].label}: <span className="font-semibold">{analysis.breakdown.byType[t]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                <th className="px-4 py-3 font-semibold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('event_date')}>Date<SortIcon col="event_date" /></th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('event_type')}>Type<SortIcon col="event_type" /></th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Serial</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('asset_no')}>Asset<SortIcon col="asset_no" /></th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Position</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Tread</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">PSI</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('cost')}>Cost<SortIcon col="cost" /></th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Technician</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Site</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={11} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 ? 'No service events logged yet - use "Log event" to add the first.' : 'No events match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const Icon = EVENT_ICON[r.event_type] || CircleDot
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.event_date)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${BADGE_STYLES[r.event_type] || BADGE_STYLES.other}`}>
                          <Icon size={11} /> {EVENT_TYPE_META[r.event_type]?.label || r.event_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.tyre_serial || 'N/A'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.asset_no || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.position || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{num(r.tread_depth)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{num(r.pressure)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.cost == null ? 'N/A' : formatCurrencyCompact(r.cost, activeCurrency)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.technician || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setDeleteRow(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" title="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 - refine filters or export for the full set.</p>}
      </div>

      <EventModal open={modalOpen} initial={editRow} onClose={() => setModalOpen(false)} onSaved={load} />
      <ConfirmDelete open={Boolean(deleteRow)} busy={deleting} onCancel={() => setDeleteRow(null)} onConfirm={confirmDelete} />
    </div>
  )
}
