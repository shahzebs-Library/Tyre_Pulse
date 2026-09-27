/**
 * EngineHours (route /engine-hours) - Engine Hours Tracker. Logs engine-hour
 * meter readings per asset over time for non-odometer assets (generators, plant,
 * pumps) so the fleet can trend utilisation, plan hour-based servicing, and spot
 * meter/data anomalies. Full CRUD on the `engine_hours_logs` table (V161) with a
 * utilisation KPI row, run-hours trend + utilisation-by-asset/site charts, a
 * data-quality anomaly panel, a filterable / searchable / sortable log table with
 * anomaly badges, Excel/PDF export, and loading / empty / error / pre-migration
 * states throughout. All analytics come from the pure engineHoursAnalytics engine
 * over real data only - honest N/A where a metric is not computable, never a
 * fabricated figure.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Gauge, Activity, Clock, Truck, Plus, Pencil, Trash2, Search, X, Filter,
  Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, TrendingUp, BarChart3,
  MapPin, Moon, ShieldAlert, Timer, LayoutGrid, ListChecks, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listEngineHours, createEngineHours, updateEngineHours, deleteEngineHours,
  ENGINE_HOURS_SOURCES,
} from '../lib/api/engineHours'
import {
  summarizeEngineHours, filterEngineHours, anomalyRowIds, detectAnomalies,
  monthlyHoursTrend, utilizationByAsset, utilizationBySite,
  distinctFieldValues, engineHoursRow, engineHoursExportRow,
  ENGINE_HOURS_EXPORT_COLS, ENGINE_HOURS_EXPORT_HEADERS,
  LOW_UTILISATION_HOURS_PER_DAY, STALE_READING_DAYS,
} from '../lib/engineHoursAnalytics'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { compareValues, sortRows } from '../lib/consoleTable'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Filler, Tooltip, Legend,
)

// Shared light-legible chart options (grid var resolved by chartVarPlugin).
const AXIS = {
  x: { grid: { display: false }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
  y: { beginAtZero: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
}

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blankToUndef = (v) => (v === null || v === undefined || v === '' ? undefined : v)

const TABS = [
  { id: 'overview', label: 'Utilisation', icon: LayoutGrid },
  { id: 'anomalies', label: 'Data quality', icon: ShieldAlert },
  { id: 'register', label: 'Reading log', icon: ListChecks },
]
const TAB_IDS = TABS.map((t) => t.id)

/** Accessible tab strip synced to ?tab= (arrow keys move between tabs). */
function PageTabs({ tab, onChange, badges = {} }) {
  const refs = useRef([])
  const onKey = (e, i) => {
    let next = null
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next == null) return
    e.preventDefault()
    onChange(TABS[next].id)
    refs.current[next]?.focus()
  }
  return (
    <div role="tablist" aria-label="Engine hours views" className="flex flex-wrap gap-1 border-b border-[var(--border-bright)]">
      {TABS.map((t, i) => {
        const Icon = t.icon
        const active = tab === t.id
        const badge = badges[t.id]
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="tab"
            id={`eh-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`eh-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`inline-flex items-center gap-1.5 px-4 min-h-[44px] text-sm font-medium border-b-2 -mb-px rounded-t-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#16a34a)] ${active ? 'border-[var(--accent,#16a34a)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
          >
            <Icon size={15} aria-hidden="true" /> {t.label}
            {badge ? <span className="ml-1 text-[11px] px-1.5 rounded-full bg-red-900/40 text-red-300 border border-red-700/50 tabular-nums">{badge}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

const today = () => new Date().toISOString().slice(0, 10)
const emptyForm = () => ({ asset_no: '', engine_hours: '', reading_date: today(), source: 'manual', site: '', notes: '' })

const fmtHours = (v) => (v === null || v === undefined || v === '') ? 'N/A'
  : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })
const fmtDate = (d) => {
  if (!d) return 'N/A'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? 'N/A' : dt.toLocaleDateString()
}

export default function EngineHours() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [assetFilter, setAssetFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = TAB_IDS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'overview'
  const setTab = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (id === 'overview') next.delete('tab'); else next.set('tab', id)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null) // row being edited, or null for create
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [confirmDelete, setConfirmDelete] = useState(null) // row pending delete
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listEngineHours({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load engine-hour readings.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const filters = useMemo(
    () => ({ asset: assetFilter, site: siteFilter, from, to, search }),
    [assetFilter, siteFilter, from, to, search],
  )

  // All analytics run over the FILTERED set so KPIs, charts and the table agree.
  const filtered = useMemo(() => filterEngineHours(rows || [], filters), [rows, filters])
  const summary = useMemo(() => summarizeEngineHours(filtered), [filtered])
  const anomalies = useMemo(() => detectAnomalies(filtered), [filtered])
  const anomalyIds = useMemo(() => anomalyRowIds(filtered), [filtered])
  const trend = useMemo(() => monthlyHoursTrend(filtered), [filtered])
  const byAsset = useMemo(() => utilizationByAsset(filtered, new Date(), 12), [filtered])
  const bySite = useMemo(() => utilizationBySite(filtered), [filtered])

  const assetOptions = useMemo(() => distinctFieldValues(rows || [], 'asset_no'), [rows])
  const siteOptions = useMemo(() => distinctFieldValues(rows || [], 'site'), [rows])

  // Newest first by default; the table re-sorts on any header click and pages
  // the WHOLE filtered set (it used to stop at 500 of 4,379 readings).
  const sortedRows = useMemo(
    () => sortRows(filtered.map((r) => engineHoursRow(r, anomalyIds)), { key: 'day', dir: 'desc' }),
    [filtered, anomalyIds],
  )

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setFormError(''); setModalOpen(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '',
      engine_hours: r.engine_hours ?? '',
      reading_date: r.reading_date || today(),
      source: r.source || 'manual',
      site: r.site || '',
      notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }, [])
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  // One guarded close for Escape, the backdrop and the X - the legacy overlay
  // guarded only the backdrop, so the X could dismiss a dialog mid-save.
  const closeForm = () => { if (!saving) setModalOpen(false) }
  const closeDelete = () => { if (!deleting) setConfirmDelete(null) }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (String(form.engine_hours).trim() === '' || Number.isNaN(Number(form.engine_hours))) {
      setFormError('A numeric engine-hours reading is required.'); return
    }
    setSaving(true)
    try {
      const payload = {
        asset_no: form.asset_no,
        engine_hours: form.engine_hours,
        reading_date: form.reading_date || null,
        source: form.source || null,
        site: form.site || null,
        notes: form.notes || null,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateEngineHours(editing.id, payload)
      else await createEngineHours(payload)
      setModalOpen(false)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the reading.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteEngineHours(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the reading.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // Export -------------------------------------------------------------------
  // The export covers the WHOLE filtered set, not the page on screen.
  const exportRows = useMemo(() => sortedRows.map((r) => engineHoursExportRow(r, anomalyIds)), [sortedRows, anomalyIds])
  const fileName = reportFileName('TyrePulse Engine Hours', activeCountry && activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExport = async (kind) => {
    try {
      if (kind === 'excel') await exportToExcel(exportRows, ENGINE_HOURS_EXPORT_COLS, ENGINE_HOURS_EXPORT_HEADERS, fileName, 'Engine hours')
      else await exportToPdf(exportRows, ENGINE_HOURS_EXPORT_COLS.map((c, i) => ({ key: c, header: ENGINE_HOURS_EXPORT_HEADERS[i] })), 'Engine Hours', fileName, 'landscape')
    } catch (e) {
      setError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const logColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => blankToUndef(r.asset_no), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'hours', header: 'Engine hours', accessorFn: (r) => r.hours ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="font-semibold tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
          {row.original.hours == null ? 'N/A' : `${fmtHours(row.original.hours)} h`}
          {row.original.isAnomaly && <span className="ml-2 badge text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/50 inline-flex items-center gap-1"><ShieldAlert size={10} aria-hidden="true" /> anomaly</span>}
        </span>
      ) },
    { id: 'day', header: 'Reading date', accessorFn: (r) => blankToUndef(r.day), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.reading_date || row.original.created_at)}</span> },
    { id: 'source', header: 'Source', accessorFn: (r) => blankToUndef(r.source), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: (r) => blankToUndef(r.site), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'notes', header: 'Notes', accessorFn: (r) => blankToUndef(r.notes), enableSorting: false,
      cell: ({ getValue }) => <span className="block max-w-[240px] truncate text-[var(--text-muted)]" title={getValue() || ''}>{getValue() || 'N/A'}</span> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        const label = `${r.asset_no || 'asset'} ${fmtDate(r.reading_date)}`
        return (
          <div className="flex items-center gap-1 justify-end">
            <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(r) }} aria-label={`Edit reading ${label}`} title="Edit" className="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#16a34a)]"><Pencil size={14} aria-hidden="true" /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(r) }} aria-label={`Delete reading ${label}`} title="Delete" className="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><Trash2 size={14} aria-hidden="true" /></button>
          </div>
        )
      } },
  ], [openEdit])

  const anomalyColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', accessorKey: 'asset_no', sortingFn: valueSort,
      cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'reading_date', header: 'Reading date', accessorFn: (a) => blankToUndef(a.reading_date), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => fmtDate(getValue()) },
    { id: 'engine_hours', header: 'Reading', accessorFn: (a) => a.engine_hours ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{fmtHours(getValue())} h</span> },
    { id: 'prevHours', header: 'Previous', accessorFn: (a) => a.prevHours ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-muted)]">{fmtHours(row.original.prevHours)} h {row.original.prevDate ? `(${fmtDate(row.original.prevDate)})` : ''}</span> },
    { id: 'drop', header: 'Drop', accessorFn: (a) => a.drop ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums text-red-400 font-semibold">-{fmtHours(getValue())} h</span> },
  ], [])

  const kpis = [
    { label: 'Readings logged', value: summary.totalReadings, icon: Activity, tone: 'text-[var(--text-primary)]' },
    { label: 'Assets tracked', value: summary.assetsTracked, icon: Truck, tone: 'text-sky-400' },
    { label: 'Hours accumulated', value: fmtHours(summary.totalHoursAdded), icon: Gauge, tone: 'text-amber-400', suffix: ' h' },
    { label: 'Avg daily hours', value: summary.avgDailyHours == null ? 'N/A' : fmtHours(summary.avgDailyHours), icon: Clock, tone: 'text-green-400', suffix: summary.avgDailyHours == null ? '' : ' h/day' },
    { label: 'Idle assets', value: summary.idleAssets, icon: Moon, tone: 'text-indigo-300', hint: `Below ${LOW_UTILISATION_HOURS_PER_DAY} h/day` },
    { label: 'Data anomalies', value: summary.anomalies, icon: ShieldAlert, tone: summary.anomalies ? 'text-red-400' : 'text-[var(--text-primary)]', hint: 'Meter below previous' },
  ]

  const clearFilters = () => { setAssetFilter(''); setSiteFilter(''); setFrom(''); setTo(''); setSearch('') }
  const hasFilters = assetFilter || siteFilter || from || to || search
  // A failed read must never render as "no readings" or a row of zeros.
  const loadFailed = Boolean(error) && rows !== null && rows.length === 0 && !missing

  // Chart datasets (only rendered when data exists).
  const trendHasData = trend.some((b) => b.hoursAdded > 0 || b.readings > 0)
  const trendData = {
    labels: trend.map((b) => b.label),
    datasets: [{
      label: 'Hours accumulated',
      data: trend.map((b) => b.hoursAdded),
      borderColor: colorAt(0),
      backgroundColor: withAlpha(colorAt(0), 0.18),
      fill: true, tension: 0.35, pointRadius: 2,
    }],
  }
  const assetData = {
    labels: byAsset.map((a) => a.asset),
    datasets: [{
      label: 'Hours accumulated',
      data: byAsset.map((a) => a.hoursAdded),
      backgroundColor: byAsset.map((_, i) => withAlpha(colorAt(i), 0.85)),
      borderRadius: 4,
    }],
  }
  const siteData = {
    labels: bySite.map((s) => s.key),
    datasets: [{
      data: bySite.map((s) => s.hoursAdded),
      backgroundColor: categorical(bySite.length),
      borderWidth: 0,
    }],
  }
  const lineOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: AXIS }
  const barOpts = {
    responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
    scales: { x: AXIS.x, y: { ...AXIS.y, title: { display: true, text: 'Hours', color: 'var(--text-muted)', font: { size: 10 } } } },
  }
  const doughnutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '58%',
    plugins: { legend: { position: 'right', labels: { color: 'var(--text-muted)', font: { size: 11 }, boxWidth: 12 } } },
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engine Hours Tracker"
        subtitle="Log engine-hour meter readings per asset - trend utilisation, plan hour-based servicing, and catch meter anomalies for non-odometer assets."
        icon={Gauge}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!exportRows.length} title="Exports the readings matching the filters">
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!exportRows.length} title="Exports the readings matching the filters">
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing}>
              <Plus size={14} aria-hidden="true" /> Log reading
            </button>
          </div>
        }
      />

      {missing && (
        // `border border-amber-800/50` as classes would be DEAD here: Card sets
        // `border` inline and inline beats a class, so the tint is carried by
        // `tone`. Card is `flex flex-col` and Tailwind emits .flex-col after
        // .flex-row, so the row direction goes in `style`, which Card spreads last.
        <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Engine hours tracking is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V161_ENGINE_HOURS.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" role="alert" className="items-start justify-between gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div><p className="text-red-300 font-medium">Could not load engine-hour readings.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm shrink-0 inline-flex items-center gap-1.5 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </Card>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-[var(--gap-grid)]">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <Card key={k.label}>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>
                {rows === null || loadFailed ? 'N/A' : k.value}{rows !== null && !loadFailed && k.suffix ? <span className="text-sm font-medium text-[var(--text-muted)]">{k.suffix}</span> : ''}
              </p>
              {k.hint && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{k.hint}</p>}
            </Card>
          )
        })}
      </div>

      {/* Filters. NOT clipped: the asset/site/date controls are native inputs
          whose popups the browser paints outside this element, but leaving the
          card unclipped is what keeps any future anchored popover usable here. */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input type="search" aria-label="Search readings" className="input pl-9 w-full" placeholder="Search asset, site, source, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <label htmlFor="eh-from" className="text-xs text-[var(--text-muted)]">From</label>
            <input id="eh-from" type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="eh-to" className="text-xs text-[var(--text-muted)]">To</label>
            <input id="eh-to" type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {rows?.length || 0} readings. Every tab follows these filters.</span>
        </div>
      </Card>

      <PageTabs tab={tab} onChange={setTab} badges={{ anomalies: loadFailed ? 0 : anomalies.length }} />

      {tab === 'overview' && (
        <div role="tabpanel" id="eh-panel-overview" aria-labelledby="eh-tab-overview" className="space-y-6">
          {rows === null ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-[var(--gap-grid)]">
              {[0, 1, 2].map((i) => <div key={i} className="h-72 rounded-xl bg-[var(--input-bg)] animate-pulse" />)}
            </div>
          ) : loadFailed ? (
            <Card><div className="py-12 text-center text-sm text-[var(--text-muted)]">Utilisation is unavailable because the readings could not be loaded. Use Retry above.</div></Card>
          ) : (<>
          {/* Most / least utilised strip */}
          {(summary.mostUtilized || summary.staleAssets > 0) && (
            // Each tile is an icon BESIDE its text, so the row direction goes in
            // `style` (Card is flex-col and a .flex-row class cannot beat it), and
            // `items-center` keeps the 9x9 icon chip from stretching - Card brings
            // align-items:stretch, which the legacy block `.card` did not.
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-[var(--gap-grid)]">
              {summary.mostUtilized && (
                <Card className="items-center gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
                  <div className="w-9 h-9 rounded-xl bg-green-900/30 flex items-center justify-center shrink-0"><TrendingUp size={17} className="text-green-400" /></div>
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--text-muted)]">Most utilised</p>
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{summary.mostUtilized.asset_no}</p>
                    <p className="text-xs text-green-400">{fmtHours(summary.mostUtilized.avgDailyHours)} h/day</p>
                  </div>
                </Card>
              )}
              {summary.leastUtilized && summary.leastUtilized.asset_no !== summary.mostUtilized?.asset_no && (
                <Card className="items-center gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
                  <div className="w-9 h-9 rounded-xl bg-indigo-900/30 flex items-center justify-center shrink-0"><Moon size={17} className="text-indigo-300" /></div>
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--text-muted)]">Least utilised</p>
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{summary.leastUtilized.asset_no}</p>
                    <p className="text-xs text-indigo-300">{fmtHours(summary.leastUtilized.avgDailyHours)} h/day</p>
                  </div>
                </Card>
              )}
              {summary.staleAssets > 0 && (
                <Card className="items-center gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
                  <div className="w-9 h-9 rounded-xl bg-amber-900/30 flex items-center justify-center shrink-0"><Timer size={17} className="text-amber-400" /></div>
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--text-muted)]">Stale meters</p>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{summary.staleAssets} asset{summary.staleAssets === 1 ? '' : 's'}</p>
                    <p className="text-xs text-amber-400">No reading in {STALE_READING_DAYS}+ days</p>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* Charts */}
          {!missing && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-[var(--gap-grid)]">
              <Card className="lg:col-span-2">
                <CardHeader icon={TrendingUp} title="Run-hours accumulated (12 months)" />
                <div className="h-64">
                  {trendHasData
                    ? <Line data={trendData} options={lineOpts} />
                    : <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] text-sm"><TrendingUp size={22} className="mb-2 opacity-60" />No dated readings to trend yet.</div>}
                </div>
              </Card>
              <Card>
                <CardHeader icon={MapPin} title="Utilisation by site" />
                <div className="h-64">
                  {bySite.length
                    ? <Doughnut data={siteData} options={doughnutOpts} />
                    : <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] text-sm"><MapPin size={22} className="mb-2 opacity-60" />Need 2+ readings per asset to attribute hours.</div>}
                </div>
              </Card>
              <Card className="lg:col-span-3">
                <CardHeader icon={BarChart3} title={`Utilisation by asset (top ${byAsset.length})`} />
                <div className="h-64">
                  {byAsset.some((a) => a.hoursAdded > 0)
                    ? <Bar data={assetData} options={barOpts} />
                    : <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] text-sm"><BarChart3 size={22} className="mb-2 opacity-60" />Log at least two readings per asset to measure accumulated hours.</div>}
                </div>
              </Card>
            </div>
          )}

          </>)}
        </div>
      )}

      {tab === 'anomalies' && (
        <div role="tabpanel" id="eh-panel-anomalies" aria-labelledby="eh-tab-anomalies" className="space-y-3">
          <Card>
            <CardHeader
              icon={ShieldAlert}
              title={`Data-quality anomalies${loadFailed || rows === null ? '' : ` (${anomalies.length})`}`}
              description="A reading lower than the previous one for the same asset: a meter reset, replacement, or a keying error. Surfaced, never smoothed away."
            />
          </Card>
          <Card pad="none" clip>
            <EnterpriseTable
              columns={anomalyColumns}
              data={anomalies}
              getRowId={(a) => String(a.id)}
              loading={rows === null}
              error={loadFailed ? error : null}
              onRetry={load}
              enableColumnFilters={false}
              searchPlaceholder="Search anomalies"
              exportFileName={reportFileName('TyrePulse Engine Hours Anomalies', reportDateLabel())}
              reportMeta={{ title: 'Engine Hours Data-Quality Anomalies' }}
              emptyMessage={rows && rows.length === 0 ? 'No readings logged yet.' : 'No meter drops in the filtered readings. Every asset reads at or above its previous reading.'}
              emptyIcon={<ShieldAlert size={22} className="opacity-60" aria-hidden="true" />}
            />
          </Card>
        </div>
      )}

      {tab === 'register' && (
        <div role="tabpanel" id="eh-panel-register" aria-labelledby="eh-tab-register">
          <Card pad="none" clip>
            <EnterpriseTable
              columns={logColumns}
              data={sortedRows}
              getRowId={(r) => String(r.id)}
              loading={rows === null}
              error={loadFailed ? error : null}
              onRetry={load}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              viewKey="engine-hours-log"
              initialPageSize={50}
              pageSizeOptions={[25, 50, 100, 250]}
              emptyMessage={missing ? 'Engine hours tracking is not enabled on this database yet.' : rows && rows.length === 0 ? 'No engine-hour readings yet. Log the first reading to get started.' : 'No readings match these filters.'}
              emptyIcon={<Filter size={22} className="opacity-60" aria-hidden="true" />}
            />
          </Card>
        </div>
      )}

      {/* Create / Edit modal. The submit button stays INSIDE the <form> rather
          than moving to Modal's `footer`: a footer button would need a
          `form="..."` association to keep submitting, which is a behaviour
          change, not a migration. Modal already owns the height cap, the focus
          trap, the scroll lock, escape-to-close and its own X. */}
      {modalOpen && (
        <Modal
          open
          onClose={closeForm}
          size="md"
          title={editing ? 'Edit reading' : 'Log engine-hour reading'}
        >
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. GEN-014" value={form.asset_no} maxLength={120} onChange={(e) => setField('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Engine hours</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="0.0" value={form.engine_hours} onChange={(e) => setField('engine_hours', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Reading date</label>
                  <input className="input w-full" type="date" value={form.reading_date} onChange={(e) => setField('reading_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Source</label>
                  <select className="input w-full" value={form.source} onChange={(e) => setField('source', e.target.value)}>
                    {ENGINE_HOURS_SOURCES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Site (optional)</label>
                <input className="input w-full" placeholder="Depot / site" value={form.site} maxLength={200} onChange={(e) => setField('site', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="Meter reset, telematics sync, anomaly" value={form.notes} maxLength={4000} onChange={(e) => setField('notes', e.target.value)} />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeForm} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving' : (editing ? 'Save changes' : 'Log reading')}
                </button>
              </div>
            </form>
        </Modal>
      )}

      {/* Delete confirm. No <form> here, so the actions belong in Modal's
          `footer`, which pins them where a user can always reach them. */}
      {confirmDelete && (
        <Modal
          open
          onClose={closeDelete}
          size="sm"
          title="Delete reading?"
          footer={
            <>
              <button onClick={closeDelete} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting' : 'Delete'}
              </button>
            </>
          }
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
            <p className="text-sm text-[var(--text-muted)]">
              This removes the {fmtHours(confirmDelete.engine_hours)} h reading for
              <span className="font-medium text-[var(--text-secondary)]"> {confirmDelete.asset_no || 'this asset'}</span>
              {confirmDelete.reading_date ? ` (${fmtDate(confirmDelete.reading_date)})` : ''}. This cannot be undone.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
