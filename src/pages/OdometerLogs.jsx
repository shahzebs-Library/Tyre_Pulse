/**
 * OdometerLogs (route /odometer-logs) — Odometer Logs. Captures time-series
 * odometer (km) readings per asset, whether entered manually, imported from an
 * ERP, or read off a telematics feed. Distance history is the backbone of CPK,
 * tyre-life, and service-interval analytics, so every reading is org-isolated
 * and country-scoped.
 *
 * Runs on the `odometer_logs` table (V162). Real data only, honest empty/error
 * states, never fabricated. All mileage intelligence (per-asset distance, avg
 * daily km, high/low-mileage, data-quality anomalies, fleet KPIs, chart series)
 * lives in the pure `src/lib/odometerAnalytics.js` engine. The service
 * (`src/lib/api/odometerLogs.js`) is the only Supabase seam.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  Gauge, Activity, TrendingUp, Truck, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, BarChart3, ShieldAlert,
  ArrowUpDown, MapPin, Timer,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listAllOdometerLogs, createOdometerLog, updateOdometerLog, deleteOdometerLog,
} from '../lib/api/odometerLogs'
import {
  summarizeMileage, computeAssetMileage, detectAnomalies, mileageTrend,
  kmByAsset, kmBySite, ANOMALY,
} from '../lib/odometerAnalytics'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Tooltip, Legend)

const EMPTY_FORM = {
  asset_no: '', odometer_km: '', reading_date: '', source: '', site: '', notes: '',
}

const ANOMALY_LABEL = {
  [ANOMALY.BACKWARD]: 'Rollback',
  [ANOMALY.JUMP]: 'Jump',
  [ANOMALY.DUPLICATE]: 'Duplicate',
}

const fmtKm = (v) =>
  v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()} km`

const fmtNum = (v) =>
  v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString()

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

/** 'YYYY-MM' -> 'Mon YY'. */
function monthLabel(key) {
  const s = String(key || '')
  if (!/^\d{4}-\d{2}/.test(s)) return s
  const [y, m] = s.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en', { month: 'short', year: '2-digit' })
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'var(--panel-2)', titleColor: 'var(--panel-ink)',
      bodyColor: '#9ca3af', borderColor: 'var(--hairline)', borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}

function ChartCard({ title, icon: Icon, empty, children }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
        {Icon ? <Icon size={15} /> : null} {title}
      </h3>
      {empty ? (
        <div className="h-[220px] flex items-center justify-center text-sm text-[var(--text-muted)]">
          Not enough consecutive readings to chart yet.
        </div>
      ) : (
        <div style={{ height: 220 }}>{children}</div>
      )}
    </div>
  )
}

const SORTS = {
  reading_date: (a, b) => new Date(a.reading_date || a.created_at || 0) - new Date(b.reading_date || b.created_at || 0),
  odometer_km: (a, b) => (Number(a.odometer_km) || 0) - (Number(b.odometer_km) || 0),
  asset_no: (a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || '')),
}

export default function OdometerLogs() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [assetFilter, setAssetFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')
  const [onlyAnomalies, setOnlyAnomalies] = useState(false)
  const [sort, setSort] = useState({ key: 'reading_date', dir: 'desc' })

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
      const data = await listAllOdometerLogs({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load odometer logs.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Engine roll-ups (real data only) ──────────────────────────────────────
  const summary = useMemo(() => summarizeMileage(rows || []), [rows])
  const assetMileage = useMemo(() => computeAssetMileage(rows || []), [rows])
  const anomalies = useMemo(() => detectAnomalies(rows || []), [rows])
  const trend = useMemo(() => mileageTrend(rows || []), [rows])
  const topAssets = useMemo(() => kmByAsset(rows || [], { limit: 12 }), [rows])
  const siteKm = useMemo(() => kmBySite(rows || [], { limit: 12 }), [rows])

  /** Set of log ids that carry an anomaly, plus id -> anomaly type for badges. */
  const anomalyById = useMemo(() => {
    const m = new Map()
    for (const a of anomalies) if (a.id != null) m.set(a.id, a.type)
    return m
  }, [anomalies])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )
  const siteOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = (rows || []).filter((r) => {
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (onlyAnomalies && !anomalyById.has(r.id)) return false
      const d = r.reading_date || (r.created_at ? String(r.created_at).slice(0, 10) : '')
      if (fromDate && d && d < fromDate) return false
      if (toDate && d && d > toDate) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.site || ''} ${r.source || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const cmp = SORTS[sort.key] || SORTS.reading_date
    const sorted = [...list].sort(cmp)
    return sort.dir === 'desc' ? sorted.reverse() : sorted
  }, [rows, assetFilter, siteFilter, onlyAnomalies, anomalyById, fromDate, toDate, search, sort])

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Assets tracked', value: fmtNum(summary.assetsTracked), icon: Truck, tone: 'text-sky-400' },
    { label: 'Readings logged', value: fmtNum(summary.totalReadings), icon: Activity, tone: 'text-[var(--text-primary)]' },
    { label: 'Distance logged', value: summary.totalKmLogged ? `${fmtNum(summary.totalKmLogged)} km` : 'N/A', icon: TrendingUp, tone: 'text-green-400' },
    { label: 'Avg daily km', value: summary.avgDailyKm == null ? 'N/A' : `${fmtNum(summary.avgDailyKm)} km`, icon: Gauge, tone: 'text-amber-400' },
    {
      label: 'Most driven',
      value: summary.mostDriven ? `${fmtNum(summary.mostDriven.km)} km` : 'N/A',
      sub: summary.mostDriven ? summary.mostDriven.asset : null,
      icon: BarChart3, tone: 'text-indigo-400',
    },
    {
      label: 'Data-quality flags',
      value: fmtNum(summary.anomalyCount),
      sub: summary.staleAssets ? `${summary.staleAssets} stale asset${summary.staleAssets === 1 ? '' : 's'}` : null,
      icon: ShieldAlert, tone: summary.anomalyCount ? 'text-red-400' : 'text-green-400',
    },
  ]

  // ── Charts ───────────────────────────────────────────────────────────────
  const trendData = useMemo(() => ({
    labels: trend.map((t) => monthLabel(t.period)),
    datasets: [{
      label: 'Distance (km)', data: trend.map((t) => t.km),
      borderColor: colorAt(0), backgroundColor: withAlpha(colorAt(0), 0.18),
      fill: true, tension: 0.35, pointRadius: 2,
    }],
  }), [trend])

  const assetBar = useMemo(() => ({
    labels: topAssets.map((a) => a.label),
    datasets: [{ label: 'Distance (km)', data: topAssets.map((a) => a.value), backgroundColor: categorical(topAssets.length), borderRadius: 4 }],
  }), [topAssets])

  const siteBar = useMemo(() => ({
    labels: siteKm.map((s) => s.label),
    datasets: [{ label: 'Distance (km)', data: siteKm.map((s) => s.value), backgroundColor: withAlpha(colorAt(2), 0.85), borderRadius: 4 }],
  }), [siteKm])

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'odometer_km', 'reading_date', 'flag', 'source', 'site', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Odometer (km)', 'Reading date', 'Data flag', 'Source', 'Site', 'Notes']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '', odometer_km: r.odometer_km ?? '',
    reading_date: r.reading_date || '',
    flag: anomalyById.has(r.id) ? (ANOMALY_LABEL[anomalyById.get(r.id)] || 'Flag') : '',
    source: r.source || '', site: r.site || '', notes: r.notes || '',
  }))

  const ASSET_EXPORT_COLS = ['asset', 'latestKm', 'kmAdded', 'avgDailyKm', 'readingCount', 'latestDate', 'staleFor', 'anomalyCount']
  const ASSET_EXPORT_HEADERS = ['Asset', 'Latest km', 'Distance km', 'Avg daily km', 'Readings', 'Last reading', 'Days since', 'Flags']
  const assetExportRows = assetMileage.map((a) => ({
    asset: a.asset, latestKm: a.latestKm ?? '', kmAdded: a.kmAdded ?? '',
    avgDailyKm: a.avgDailyKm ?? '', readingCount: a.readingCount,
    latestDate: a.latestDate || '', staleFor: a.staleFor ?? '', anomalyCount: a.anomalyCount,
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', odometer_km: r.odometer_km ?? '',
      reading_date: r.reading_date || '', source: r.source || '',
      site: r.site || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (form.odometer_km === '' || form.odometer_km == null) { setFormError('An odometer reading (km) is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateOdometerLog(editing.id, payload)
      else await createOdometerLog(payload)
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
      await deleteOdometerLog(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the reading.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => {
    setAssetFilter(''); setSiteFilter(''); setFromDate(''); setToDate('')
    setSearch(''); setOnlyAnomalies(false)
  }
  const hasFilters = assetFilter || siteFilter || fromDate || toDate || search || onlyAnomalies

  const SortHead = ({ label, k }) => (
    <th className="px-4 py-3 font-semibold whitespace-nowrap">
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
        {label}
        <ArrowUpDown size={11} className={sort.key === k ? 'text-[var(--text-primary)]' : 'opacity-40'} />
      </button>
    </th>
  )

  const noData = rows !== null && rows.length === 0 && !notProvisioned
  const hasCharts = trend.length > 0 || topAssets.length > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Odometer Logs"
        subtitle="Manual and imported odometer (km) readings per asset - the distance basis for CPK, tyre-life, utilisation, and service intervals."
        icon={Gauge}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'odometer_logs')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Odometer Logs', 'odometer_logs', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
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
            <p className="text-amber-300 font-medium">Odometer logging isn't enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V162_ODOMETER_LOGS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Couldn't load odometer logs.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button onClick={load} className="btn-secondary text-sm shrink-0">Retry</button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{rows === null ? 'N/A' : k.value}</p>
              {k.sub ? <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{k.sub}</p> : null}
            </div>
          )
        })}
      </div>

      {/* Charts */}
      {rows === null ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1].map((i) => <div key={i} className="card h-[280px] animate-pulse" />)}
        </div>
      ) : noData ? null : hasCharts ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Fleet mileage trend (km per month)" icon={TrendingUp} empty={trend.length === 0}>
            <Line data={trendData} options={CHART_BASE} />
          </ChartCard>
          <ChartCard title="Distance travelled by asset" icon={BarChart3} empty={topAssets.length === 0}>
            <Bar data={assetBar} options={CHART_BASE} />
          </ChartCard>
          {siteKm.length > 0 && (
            <ChartCard title="Distance travelled by site" icon={MapPin} empty={false}>
              <Bar data={siteBar} options={CHART_BASE} />
            </ChartCard>
          )}
        </div>
      ) : null}

      {/* Data-quality anomalies */}
      {anomalies.length > 0 && (
        <div className="card border border-amber-800/40">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ShieldAlert size={15} className="text-amber-400" />
            Data-quality flags
            <span className="text-xs font-normal text-[var(--text-muted)]">({anomalies.length})</span>
          </h3>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {anomalies.slice(0, 40).map((a, i) => (
              <div key={`${a.id || a.asset}-${i}`} className="flex items-center gap-3 text-sm border-b border-[var(--input-border)]/40 pb-1.5">
                <span className={`px-2 py-0.5 rounded text-[11px] font-medium shrink-0 ${
                  a.type === ANOMALY.BACKWARD ? 'bg-red-900/40 text-red-300'
                    : a.type === ANOMALY.JUMP ? 'bg-amber-900/40 text-amber-300'
                    : 'bg-sky-900/40 text-sky-300'}`}>
                  {ANOMALY_LABEL[a.type] || 'Flag'}
                </span>
                <span className="font-medium text-[var(--text-primary)] shrink-0 w-28 truncate">{a.asset}</span>
                <span className="text-[var(--text-secondary)] flex-1 min-w-0 truncate">{a.message}</span>
                <span className="text-[var(--text-muted)] text-xs shrink-0">{fmtDate(a.reading_date)}</span>
              </div>
            ))}
            {anomalies.length > 40 && <p className="text-xs text-[var(--text-muted)] pt-1">Showing first 40. Use the "Flagged only" filter below to review the rest.</p>}
          </div>
        </div>
      )}

      {/* Per-asset mileage */}
      <div className="card overflow-hidden !p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--input-border)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Timer size={15} /> Per-asset mileage
          </h3>
          {assetMileage.length > 0 && (
            <button
              onClick={() => exportToExcel(assetExportRows, ASSET_EXPORT_COLS, ASSET_EXPORT_HEADERS, 'asset_mileage')}
              className="btn-secondary text-xs inline-flex items-center gap-1.5"
            >
              <FileSpreadsheet size={12} /> Export
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Latest', 'Distance', 'Avg/day', 'Readings', 'Last reading', 'Status'].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : assetMileage.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">No assets tracked yet.</td></tr>
              ) : (
                [...assetMileage]
                  .sort((a, b) => (b.kmAdded ?? -1) - (a.kmAdded ?? -1))
                  .slice(0, 100)
                  .map((a) => (
                    <tr key={a.asset} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{a.asset}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtKm(a.latestKm)}</td>
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] whitespace-nowrap">{a.kmAdded == null ? 'N/A' : `${fmtNum(a.kmAdded)} km`}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{a.avgDailyKm == null ? 'N/A' : `${fmtNum(a.avgDailyKm)} km`}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{a.readingCount}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(a.latestDate)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {a.anomalyCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-900/40 text-red-300">{a.anomalyCount} flag{a.anomalyCount === 1 ? '' : 's'}</span>
                          )}
                          {a.isStale && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-900/40 text-amber-300">Stale {a.staleFor}d</span>
                          )}
                          {a.anomalyCount === 0 && !a.isStale && <span className="text-[10px] text-green-400">OK</span>}
                        </div>
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, site, source, notes..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="input" type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
          <span className="text-xs text-[var(--text-muted)]">to</span>
          <input className="input" type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
          <button
            onClick={() => setOnlyAnomalies((v) => !v)}
            className={`btn-secondary text-sm inline-flex items-center gap-1.5 ${onlyAnomalies ? 'ring-1 ring-amber-500 text-amber-300' : ''}`}
          >
            <ShieldAlert size={14} /> Flagged only
          </button>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalReadings}</span>
        </div>
      </div>

      {/* Log table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                <SortHead label="Asset" k="asset_no" />
                <SortHead label="Odometer" k="odometer_km" />
                <SortHead label="Reading date" k="reading_date" />
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Flag</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Source</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Site</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {noData ? 'No readings logged yet - log your first reading.' : 'No readings match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const flag = anomalyById.get(r.id)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || 'N/A'}</td>
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">{fmtKm(r.odometer_km)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.reading_date)}</td>
                      <td className="px-4 py-2.5">
                        {flag ? (
                          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                            flag === ANOMALY.BACKWARD ? 'bg-red-900/40 text-red-300'
                              : flag === ANOMALY.JUMP ? 'bg-amber-900/40 text-amber-300'
                              : 'bg-sky-900/40 text-sky-300'}`}>
                            {ANOMALY_LABEL[flag] || 'Flag'}
                          </span>
                        ) : <span className="text-[var(--text-muted)]">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.source || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
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
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 - refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit reading' : 'Log odometer reading'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Odometer (km)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="45000" value={form.odometer_km} onChange={(e) => set('odometer_km', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Reading date</label>
                  <input className="input w-full" type="date" value={form.reading_date} onChange={(e) => set('reading_date', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use today.</p>
                </div>
                <div>
                  <label className="label">Source (optional)</label>
                  <input className="input w-full" placeholder="Manual / ERP / Telematics" value={form.source} maxLength={120} onChange={(e) => set('source', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Site (optional)</label>
                <input className="input w-full" placeholder="e.g. Riyadh depot" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. monthly manual reading" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving...' : editing ? 'Save changes' : 'Log reading'}
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
                  {confirmDelete.asset_no || 'Reading'} | {fmtKm(confirmDelete.odometer_km)} | {fmtDate(confirmDelete.reading_date)}. This can't be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
