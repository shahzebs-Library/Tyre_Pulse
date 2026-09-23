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
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Gauge, Activity, Clock, Truck, Plus, Pencil, Trash2, Search, X, Filter,
  Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, TrendingUp, BarChart3,
  MapPin, Moon, ShieldAlert, ArrowUp, ArrowDown, ArrowUpDown, Timer,
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
  LOW_UTILISATION_HOURS_PER_DAY, STALE_READING_DAYS,
} from '../lib/engineHoursAnalytics'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { usePagedRows, TablePagination } from '../components/ui/TablePagination'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Filler, Tooltip, Legend,
)

// Shared light-legible chart options (grid var resolved by chartVarPlugin).
const AXIS = {
  x: { grid: { display: false }, ticks: { color: 'rgba(148,163,184,0.9)', font: { size: 10 } } },
  y: { beginAtZero: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'rgba(148,163,184,0.9)', font: { size: 10 } } },
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

// Sortable log-table columns.
const SORT_COLS = {
  asset_no: (r) => String(r.asset_no || '').toLowerCase(),
  engine_hours: (r) => (r.engine_hours == null || r.engine_hours === '' ? -Infinity : Number(r.engine_hours)),
  reading_date: (r) => (r.reading_date || r.created_at || ''),
  source: (r) => String(r.source || '').toLowerCase(),
  site: (r) => String(r.site || '').toLowerCase(),
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
  const [sort, setSort] = useState({ key: 'reading_date', dir: 'desc' })

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

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )
  const siteOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )

  const sortedRows = useMemo(() => {
    const get = SORT_COLS[sort.key] || SORT_COLS.reading_date
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = get(a); const bv = get(b)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }, [filtered, sort])

  const toggleSort = (key) => setSort((s) =>
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
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
  }
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
  const EXPORT_COLS = ['asset_no', 'engine_hours', 'reading_date', 'source', 'site', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Engine hours', 'Reading date', 'Source', 'Site', 'Notes']
  // Paged, not capped. This table used to render sortedRows.slice(0, 500)
  // against 4,379 stored readings, so 3,879 were unreachable.
  // The EXPORT deliberately still covers sortedRows in full - a page of 50
  // is a reading convenience, not a narrowing of what you asked for.
  const pager = usePagedRows(sortedRows)

  const exportRows = sortedRows.map((r) => ({
    asset_no: r.asset_no || '',
    engine_hours: r.engine_hours ?? '',
    reading_date: r.reading_date || '',
    source: r.source || '',
    site: r.site || '',
    notes: r.notes || '',
  }))

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
  const hasData = filtered.length > 0

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
    scales: { x: AXIS.x, y: { ...AXIS.y, title: { display: true, text: 'Hours', color: 'rgba(148,163,184,0.9)', font: { size: 10 } } } },
  }
  const doughnutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '58%',
    plugins: { legend: { position: 'right', labels: { color: 'rgba(148,163,184,0.95)', font: { size: 11 }, boxWidth: 12 } } },
  }

  const SortHead = ({ label, colKey, align = 'left' }) => {
    const active = sort.key === colKey
    const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
    return (
      <th className={`px-4 py-3 font-semibold whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}>
        <button
          type="button"
          onClick={() => toggleSort(colKey)}
          className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${active ? 'text-[var(--text-primary)]' : ''}`}
        >
          {label} <Icon size={12} className={active ? '' : 'opacity-50'} />
        </button>
      </th>
    )
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
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'engine_hours') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!exportRows.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Engine Hours', 'engine_hours', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!exportRows.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={missing}>
              <Plus size={14} /> Log reading
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
        <Card tone="crit" className="items-start justify-between gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div><p className="text-red-300 font-medium">Could not load engine-hour readings.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button onClick={load} className="btn-secondary text-sm shrink-0">Retry</button>
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
                {rows === null ? 'N/A' : k.value}{rows !== null && k.suffix ? <span className="text-sm font-medium text-[var(--text-muted)]">{k.suffix}</span> : ''}
              </p>
              {k.hint && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{k.hint}</p>}
            </Card>
          )
        })}
      </div>

      {/* Most / least utilised strip */}
      {rows !== null && (summary.mostUtilized || summary.staleAssets > 0) && (
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

      {/* Filters. NOT clipped: the asset/site/date controls are native inputs
          whose popups the browser paints outside this element, but leaving the
          card unclipped is what keeps any future anchored popover usable here. */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, site, source, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
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
            <label className="text-xs text-[var(--text-muted)]">From</label>
            <input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-[var(--text-muted)]">To</label>
            <input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {rows?.length || 0}</span>
        </div>
      </Card>

      {/* Charts */}
      {rows !== null && !missing && (
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

      {/* Anomaly panel. A meter that READS LOWER than its previous reading is
          surfaced, never smoothed away - the drop is what tells an engineer a
          meter was reset or swapped. `tone="crit"` carries the red edge the old
          `border-red-800/40` class gave; as a class it would now be dead, since
          Card sets `border` inline. The explanation of what counts as an anomaly
          moves to CardHeader's `description`, verbatim. */}
      {anomalies.length > 0 && (
        <Card tone="crit">
          <CardHeader
            icon={ShieldAlert}
            title={`Data-quality anomalies (${anomalies.length})`}
            description="Reading lower than the previous one (meter reset, replacement, or a keying error)"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--input-border)]">
                  {['Asset', 'Reading date', 'Reading', 'Previous', 'Drop'].map((h) => <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {anomalies.slice(0, 50).map((a) => (
                  <tr key={String(a.id)} className="border-b border-[var(--input-border)]/50">
                    <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{a.asset_no}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtDate(a.reading_date)}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtHours(a.engine_hours)} h</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{fmtHours(a.prevHours)} h {a.prevDate ? `(${fmtDate(a.prevDate)})` : ''}</td>
                    <td className="px-3 py-2 text-red-400 font-semibold">-{fmtHours(a.drop)} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Log table. `pad="none" clip` reproduces the edge-to-edge crop the legacy
          `.card overflow-hidden !p-0` gave. Clipping is safe here: the only
          popup inside is TablePagination's rows-per-page native <select>, whose
          option list the browser paints outside this overflow context. */}
      <Card pad="none" clip>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                <SortHead label="Asset" colKey="asset_no" />
                <SortHead label="Engine hours" colKey="engine_hours" />
                <SortHead label="Reading date" colKey="reading_date" />
                <SortHead label="Source" colKey="source" />
                <SortHead label="Site" colKey="site" />
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Notes</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap text-right"></th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : sortedRows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {(rows.length === 0 && !missing)
                    ? <><Gauge size={22} className="mx-auto mb-2 opacity-60" />No engine-hour readings yet. Log the first reading to get started.</>
                    : <><Filter size={22} className="mx-auto mb-2 opacity-60" />No readings match these filters.</>}
                </td></tr>
              ) : (
                pager.pageRows.map((r) => {
                  const isAnomaly = anomalyIds.has(r.id)
                  return (
                    <tr key={r.id} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 ${isAnomaly ? 'bg-red-900/10' : ''}`}>
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] font-semibold">
                        {fmtHours(r.engine_hours)} h
                        {isAnomaly && <span className="ml-2 badge text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/50 inline-flex items-center gap-1"><ShieldAlert size={10} /> anomaly</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.reading_date)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.source || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-muted)] max-w-[240px] truncate" title={r.notes || ''}>{r.notes || 'N/A'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" title="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <TablePagination {...pager} />
      </Card>

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
