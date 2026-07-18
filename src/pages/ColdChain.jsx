/**
 * ColdChain (route /cold-chain) - Cold-Chain Monitor. Logs refrigerated-cargo
 * temperature readings for an asset/site against a configured safe range and
 * turns them into excursion intelligence: every reading is classified in-range /
 * above-max / below-min, deviation magnitude and excursion episode duration are
 * derived from the real timestamps, and compliance is rolled up by asset, site
 * and over time. Manual entry today; the schema + service are sensor-ready for a
 * future ingest feed.
 *
 * Runs on the `cold_chain_logs` table (V143). Real data only - honest empty
 * states, never a fabricated reading. KPI tiles, temperature-trend line,
 * excursion-distribution + breaches-by-asset bars, a status doughnut, a
 * filterable/searchable/sortable register, an excursion-episode feed,
 * create/edit modal, delete confirm, Excel/PDF export and loading/error/empty
 * states throughout. Breach classification lives in the pure `coldChain.js`
 * helpers; excursion analytics in the pure `coldChainAnalytics.js` engine.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Line, Bar } from 'react-chartjs-2'
import {
  Snowflake, ThermometerSnowflake, AlertTriangle, Boxes, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, Gauge, Timer, Percent,
  ArrowUp, ArrowDown, MapPin, ArrowUpDown, Activity, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listReadings, createReading, updateReading, deleteReading,
} from '../lib/api/coldChain'
import {
  classifyTemp, summarizeColdChain, COLD_CHAIN_STATUS_META,
} from '../lib/coldChain'
import {
  summarizeColdChainAnalytics, filterReadings, readingStatus, deviationC,
  excursionKind, readingTime,
} from '../lib/coldChainAnalytics'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Filler, Tooltip, Legend,
)

const STATUS_STYLES = {
  breach: 'bg-red-900/40 text-red-300 border border-red-700/50',
  warning: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  ok: 'bg-green-900/40 text-green-300 border border-green-700/50',
}
const TEMP_TONE = { breach: 'text-red-400', warning: 'text-amber-400', ok: 'text-[var(--text-primary)]' }
const KIND_TONE = { above: 'text-red-400', below: 'text-sky-400', in_range: 'text-[var(--text-muted)]', mixed: 'text-amber-400' }

const EMPTY_FORM = {
  asset_no: '', site: '', temperature_c: '', min_threshold_c: '', max_threshold_c: '',
  recorded_at: '', notes: '',
}

const NA = 'N/A'

function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}
function fmtDateTime(v) {
  if (!v) return NA
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? NA : d.toLocaleString()
}
function fmtDuration(min) {
  if (min == null) return NA
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}
const rangeText = (r) => {
  const lo = r.min_threshold_c
  const hi = r.max_threshold_c
  if (lo == null && hi == null) return NA
  if (lo != null && hi != null) return `${lo} to ${hi} C`
  if (lo != null) return `>= ${lo} C`
  return `<= ${hi} C`
}

export default function ColdChain() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [sort, setSort] = useState({ key: 'recorded_at', dir: 'desc' })

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
      const data = await listReadings({ country: activeCountry })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      // listReadings degrades a missing table to [] without throwing; flag it so
      // the "apply the migration" empty state can render instead of a bare table.
      setNotProvisioned(false)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load cold-chain readings.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Legacy KPI header counts (kept) + the deep excursion analytics engine.
  const summary = useMemo(() => summarizeColdChain(rows || []), [rows])

  const filters = useMemo(
    () => ({ asset: assetFilter, site: siteFilter, status: statusFilter, search, from: fromDate, to: toDate }),
    [assetFilter, siteFilter, statusFilter, search, fromDate, toDate],
  )

  const filtered = useMemo(() => filterReadings(rows || [], filters), [rows, filters])
  const analytics = useMemo(() => summarizeColdChainAnalytics(filtered), [filtered])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )
  const siteOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )

  // Sorted view of the filtered rows for the register table.
  const sorted = useMemo(() => {
    const list = [...filtered]
    const { key, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    const val = (r) => {
      switch (key) {
        case 'asset_no': return String(r.asset_no || '')
        case 'site': return String(r.site || '')
        case 'temperature_c': return r.temperature_c == null ? -Infinity : Number(r.temperature_c)
        case 'deviation': return deviationC(r)
        case 'status': return { breach: 0, warning: 1, ok: 2 }[readingStatus(r)] ?? 3
        case 'recorded_at': return readingTime(r) ?? -Infinity
        default: return 0
      }
    }
    list.sort((a, b) => {
      const va = val(a); const vb = val(b)
      if (typeof va === 'string') return va.localeCompare(vb) * mul
      return (va - vb) * mul
    })
    return list
  }, [filtered, sort])

  const toggleSort = (key) => setSort((s) => (
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'asset_no' || key === 'site' ? 'asc' : 'desc' }
  ))

  // Chart theme ---------------------------------------------------------------
  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const gridColor = 'var(--panel-2)'
  const hasData = rows != null && filtered.length > 0

  const donutData = {
    labels: ['OK', 'Warning', 'Breach'],
    datasets: [{
      data: [analytics.ok, analytics.warning, analytics.breach],
      backgroundColor: ['#22c55e', '#f59e0b', '#ef4444'],
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
  }

  const trendData = {
    labels: analytics.trend.map((t) => t.label),
    datasets: [
      {
        label: 'Avg temp (C)', data: analytics.trend.map((t) => t.avg),
        borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.15)',
        borderWidth: 2, tension: 0.3, fill: true, pointRadius: 2, spanGaps: true, yAxisID: 'y',
      },
      {
        label: 'Max', data: analytics.trend.map((t) => t.max),
        borderColor: 'rgba(239,68,68,0.6)', borderWidth: 1, borderDash: [4, 3],
        pointRadius: 0, tension: 0.3, fill: false, spanGaps: true, yAxisID: 'y',
      },
      {
        label: 'Min', data: analytics.trend.map((t) => t.min),
        borderColor: 'rgba(96,165,250,0.6)', borderWidth: 1, borderDash: [4, 3],
        pointRadius: 0, tension: 0.3, fill: false, spanGaps: true, yAxisID: 'y',
      },
      {
        label: 'Breaches', data: analytics.trend.map((t) => t.breaches),
        type: 'bar', backgroundColor: 'rgba(239,68,68,0.45)', yAxisID: 'y1',
      },
    ],
  }
  const trendOpts = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: chartText, boxWidth: 12, font: { size: 10 } } } },
    scales: {
      x: { ticks: { color: chartText, maxRotation: 0, autoSkip: true }, grid: { color: gridColor } },
      y: { position: 'left', ticks: { color: chartText }, grid: { color: gridColor }, title: { display: true, text: 'Temp (C)', color: chartText } },
      y1: { position: 'right', beginAtZero: true, ticks: { color: chartText, precision: 0 }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Breaches', color: chartText } },
    },
  }

  const distData = {
    labels: ['In range', 'Above max', 'Below min'],
    datasets: [{
      label: 'Readings',
      data: [analytics.distribution.in_range, analytics.distribution.above, analytics.distribution.below],
      backgroundColor: ['#22c55e', '#ef4444', '#38bdf8'], borderWidth: 0,
    }],
  }
  const distOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: chartText }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: chartText, precision: 0 }, grid: { color: gridColor } },
    },
  }

  const topBreachAssets = analytics.byAsset.filter((a) => a.breaches > 0).slice(0, 8)
  const assetBarData = {
    labels: topBreachAssets.map((a) => a.key),
    datasets: [{
      label: 'Breaches', data: topBreachAssets.map((a) => a.breaches),
      backgroundColor: '#ef4444', borderWidth: 0,
    }],
  }
  const assetBarOpts = {
    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, ticks: { color: chartText, precision: 0 }, grid: { color: gridColor } },
      y: { ticks: { color: chartText }, grid: { display: false } },
    },
  }

  // KPIs ----------------------------------------------------------------------
  const kpis = [
    { label: 'Readings', value: analytics.total, icon: ThermometerSnowflake, tone: 'text-[var(--text-primary)]' },
    { label: 'Compliance', value: analytics.compliancePct == null ? NA : `${analytics.compliancePct}%`, icon: Percent, tone: analytics.compliancePct != null && analytics.compliancePct < 90 ? 'text-amber-400' : 'text-green-400' },
    { label: 'Excursions', value: analytics.breaches, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'Near limit', value: analytics.warnings, icon: AlertTriangle, tone: 'text-amber-400' },
    { label: 'Excursion events', value: analytics.excursionEpisodes, icon: Activity, tone: 'text-orange-400' },
    { label: 'Avg deviation', value: analytics.avgDeviation ? `${analytics.avgDeviation} C` : NA, icon: Gauge, tone: 'text-red-300' },
    { label: 'Avg duration', value: fmtDuration(analytics.avgExcursionMin), icon: Timer, tone: 'text-sky-300' },
    { label: 'Assets', value: analytics.assetsMonitored, icon: Boxes, tone: 'text-sky-400' },
  ]

  // Export --------------------------------------------------------------------
  const EXPORT_COLS = ['asset_no', 'site', 'temperature_c', 'range', 'deviation', 'status', 'recorded_at', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Site', 'Temp (C)', 'Safe range', 'Deviation (C)', 'Status', 'Recorded at', 'Notes']
  const exportRows = sorted.map((r) => {
    const dev = deviationC(r)
    return {
      asset_no: r.asset_no || '', site: r.site || '',
      temperature_c: r.temperature_c ?? '', range: rangeText(r),
      deviation: dev > 0 ? dev : '',
      status: COLD_CHAIN_STATUS_META[readingStatus(r)]?.label || readingStatus(r) || '',
      recorded_at: r.recorded_at ? new Date(r.recorded_at).toLocaleString() : '',
      notes: r.notes || '',
    }
  })

  // Modal ---------------------------------------------------------------------
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', site: r.site || '',
      temperature_c: r.temperature_c ?? '', min_threshold_c: r.min_threshold_c ?? '',
      max_threshold_c: r.max_threshold_c ?? '', recorded_at: toLocalInput(r.recorded_at),
      notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const previewStatus = useMemo(
    () => classifyTemp(form.temperature_c, form.min_threshold_c, form.max_threshold_c),
    [form.temperature_c, form.min_threshold_c, form.max_threshold_c],
  )

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset (unit) number is required.'); return }
    if (form.temperature_c === '' || form.temperature_c == null) { setFormError('A temperature reading is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
        recorded_at: form.recorded_at ? new Date(form.recorded_at).toISOString() : null,
      }
      if (editing) await updateReading(editing.id, payload)
      else await createReading(payload)
      setShowModal(false); setEditing(null)
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
      await deleteReading(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the reading.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => {
    setStatusFilter('all'); setAssetFilter(''); setSiteFilter(''); setSearch(''); setFromDate(''); setToDate('')
  }
  const hasFilters = statusFilter !== 'all' || assetFilter || siteFilter || search || fromDate || toDate

  const SortHead = ({ label, k, align = 'left' }) => (
    <th className={`px-4 py-3 font-semibold whitespace-nowrap select-none cursor-pointer hover:text-[var(--text-primary)] ${align === 'right' ? 'text-right' : ''}`} onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown size={11} className={sort.key === k ? 'text-sky-400' : 'opacity-40'} />
      </span>
    </th>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cold-Chain Monitor"
        subtitle="Refrigerated-cargo temperature compliance. Every reading is checked against its safe range; excursions, deviation and event duration are flagged automatically."
        icon={Snowflake}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'cold_chain_readings')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!sorted.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Cold-Chain Monitor', 'cold_chain_readings', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!sorted.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Log reading
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Cold-Chain monitoring is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V143_COLD_CHAIN_LOGS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div><p className="text-red-300 font-medium">Could not load cold-chain readings.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button onClick={load} className="btn-secondary text-sm shrink-0">Retry</button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={15} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{rows === null ? NA : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Readings by status</h3>
          <div className="h-64">
            {hasData
              ? <Doughnut data={donutData} options={donutOpts} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No readings to chart.'}</div>}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-3 flex items-center gap-1.5">
            <ThermometerSnowflake size={12} />
            Compliance{' '}
            <span className="font-semibold text-[var(--text-secondary)]">{analytics.compliancePct == null ? NA : `${analytics.compliancePct}%`}</span>{' '}
            within safe limits across {analytics.assetsMonitored} asset{analytics.assetsMonitored === 1 ? '' : 's'} / {analytics.sitesMonitored} site{analytics.sitesMonitored === 1 ? '' : 's'}.
          </p>
        </div>
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><Clock size={14} /> Temperature trend (daily)</h3>
          <div className="h-64">
            {hasData
              ? <Line data={trendData} options={trendOpts} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No dated readings to trend.'}</div>}
          </div>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Excursion distribution</h3>
          <div className="h-56">
            {hasData
              ? <Bar data={distData} options={distOpts} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No readings to chart.'}</div>}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <div><p className="text-xs text-[var(--text-muted)]">In range</p><p className="text-lg font-bold text-green-400">{analytics.distribution.in_range}</p></div>
            <div><p className="text-xs text-[var(--text-muted)] flex items-center justify-center gap-0.5"><ArrowUp size={11} /> Above</p><p className="text-lg font-bold text-red-400">{analytics.distribution.above}</p></div>
            <div><p className="text-xs text-[var(--text-muted)] flex items-center justify-center gap-0.5"><ArrowDown size={11} /> Below</p><p className="text-lg font-bold text-sky-400">{analytics.distribution.below}</p></div>
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Breaches by asset (worst first)</h3>
          <div className="h-56">
            {topBreachAssets.length
              ? <Bar data={assetBarData} options={assetBarOpts} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No excursions recorded.'}</div>}
          </div>
        </div>
      </div>

      {/* Worst assets + excursion episodes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card !p-0 overflow-hidden">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] px-4 pt-4 pb-2 flex items-center gap-1.5"><MapPin size={14} /> Compliance by asset</h3>
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--surface-raised)]">
                <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="px-4 py-2 font-semibold">Asset</th>
                  <th className="px-4 py-2 font-semibold">Site</th>
                  <th className="px-4 py-2 font-semibold text-right">Reads</th>
                  <th className="px-4 py-2 font-semibold text-right">Breaches</th>
                  <th className="px-4 py-2 font-semibold text-right">Compliance</th>
                </tr>
              </thead>
              <tbody>
                {rows === null ? (
                  [0, 1, 2].map((i) => <tr key={i}><td colSpan={5} className="px-4 py-2"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                ) : analytics.byAsset.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">No assets in view.</td></tr>
                ) : analytics.byAsset.slice(0, 50).map((a) => (
                  <tr key={a.key} className="border-b border-[var(--input-border)]/50">
                    <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{a.key}</td>
                    <td className="px-4 py-2 text-[var(--text-secondary)]">{a.site || NA}</td>
                    <td className="px-4 py-2 text-right text-[var(--text-secondary)]">{a.total}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${a.breaches ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>{a.breaches}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${a.compliancePct != null && a.compliancePct < 90 ? 'text-amber-400' : 'text-green-400'}`}>{a.compliancePct == null ? NA : `${a.compliancePct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card !p-0 overflow-hidden">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] px-4 pt-4 pb-2 flex items-center gap-1.5"><Activity size={14} /> Excursion events</h3>
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--surface-raised)]">
                <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="px-4 py-2 font-semibold">Asset</th>
                  <th className="px-4 py-2 font-semibold">Started</th>
                  <th className="px-4 py-2 font-semibold text-right">Duration</th>
                  <th className="px-4 py-2 font-semibold text-right">Peak dev.</th>
                  <th className="px-4 py-2 font-semibold">State</th>
                </tr>
              </thead>
              <tbody>
                {rows === null ? (
                  [0, 1, 2].map((i) => <tr key={i}><td colSpan={5} className="px-4 py-2"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                ) : analytics.episodes.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">No excursion events in view.</td></tr>
                ) : analytics.episodes.slice(0, 50).map((e, i) => (
                  <tr key={`${e.asset_no}-${e.startAt}-${i}`} className="border-b border-[var(--input-border)]/50">
                    <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{e.asset_no}</td>
                    <td className="px-4 py-2 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(e.startAt)}</td>
                    <td className="px-4 py-2 text-right text-[var(--text-secondary)] whitespace-nowrap">{fmtDuration(e.durationMin)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-red-300">{e.peakDeviation ? `${e.peakDeviation} C` : NA}</td>
                    <td className="px-4 py-2">
                      <span className={`badge text-[11px] px-2 py-0.5 rounded ${e.recovered ? 'bg-green-900/40 text-green-300 border border-green-700/50' : 'bg-red-900/40 text-red-300 border border-red-700/50'}`}>
                        {e.recovered ? 'Recovered' : 'Open'}
                      </span>{' '}
                      <span className={`text-[11px] ${KIND_TONE[e.kind] || ''}`}>{e.kind === 'above' ? 'above max' : e.kind === 'below' ? 'below min' : e.kind}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, site, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="breach">Breach</option>
            <option value="warning">Warning</option>
            <option value="ok">OK</option>
          </select>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">From <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
          <label className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">To <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total} readings</span>
        </div>
      </div>

      {/* Register table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                <SortHead label="Asset" k="asset_no" />
                <SortHead label="Site" k="site" />
                <SortHead label="Temperature" k="temperature_c" align="right" />
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Safe range</th>
                <SortHead label="Deviation" k="deviation" align="right" />
                <SortHead label="Status" k="status" />
                <SortHead label="Recorded at" k="recorded_at" />
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : sorted.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {(rows.length === 0 && !notProvisioned) ? 'No readings logged yet. Log your first reading.' : 'No readings match these filters.'}
                </td></tr>
              ) : (
                sorted.slice(0, 500).map((r) => {
                  const st = readingStatus(r)
                  const dev = deviationC(r)
                  const kind = excursionKind(r)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || NA}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || NA}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${TEMP_TONE[st] || 'text-[var(--text-primary)]'}`}>
                        {r.temperature_c == null ? NA : `${r.temperature_c} C`}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{rangeText(r)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {dev > 0
                          ? <span className={`inline-flex items-center gap-0.5 font-semibold ${KIND_TONE[kind]}`}>{kind === 'above' ? <ArrowUp size={12} /> : kind === 'below' ? <ArrowDown size={12} /> : null}{dev} C</span>
                          : <span className="text-[var(--text-muted)]">{NA}</span>}
                      </td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[st] || ''}`}>{COLD_CHAIN_STATUS_META[st]?.label || st}</span></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.recorded_at)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {sorted.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500. Refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit reading' : 'Log temperature reading'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset / unit no.</label>
                  <input className="input w-full" placeholder="e.g. REEFER-01" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Site (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh DC" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Temperature (C)</label>
                  <input className="input w-full" type="number" step="0.1" placeholder="-18" value={form.temperature_c} onChange={(e) => set('temperature_c', e.target.value)} />
                </div>
                <div>
                  <label className="label">Min safe (C)</label>
                  <input className="input w-full" type="number" step="0.1" placeholder="-20" value={form.min_threshold_c} onChange={(e) => set('min_threshold_c', e.target.value)} />
                </div>
                <div>
                  <label className="label">Max safe (C)</label>
                  <input className="input w-full" type="number" step="0.1" placeholder="-15" value={form.max_threshold_c} onChange={(e) => set('max_threshold_c', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Recorded at (optional)</label>
                <input className="input w-full" type="datetime-local" value={form.recorded_at} onChange={(e) => set('recorded_at', e.target.value)} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to stamp now.</p>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="Door left open during loading" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {form.temperature_c !== '' && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[var(--text-muted)]">This reading classifies as</span>
                  <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[previewStatus]}`}>{COLD_CHAIN_STATUS_META[previewStatus].label}</span>
                </div>
              )}

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving' : editing ? 'Save changes' : 'Log reading'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this reading?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Reading'} at {confirmDelete.temperature_c == null ? NA : `${confirmDelete.temperature_c} C`} on {fmtDateTime(confirmDelete.recorded_at)}. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
