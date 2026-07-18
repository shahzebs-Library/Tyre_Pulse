/**
 * VehicleWashing (route /vehicle-washing) - log vehicle washes and report on
 * them.
 *
 * Two tabs:
 *   1. Reporting - date-range + site + area + wash-type filters (with quick
 *      ranges), volume KPI tiles, three charts (monthly trend line, washes by
 *      type doughnut, washes by site bar) and a filtered records table with
 *      per-asset links and PDF / Excel export.
 *   2. Quick Log - a compact create form. The asset is a searchable picker that
 *      auto-fills vehicle type + site from the fleet master; time is captured
 *      automatically at save; the supervisor sets the status; photos optional.
 *
 * All maths live in the pure, unit-tested washAnalytics engine; this page is
 * presentation + orchestration only. Data is org-isolated and country + site
 * scoped by RLS. Honest loading / empty / error states, no fabricated data.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Droplets, LayoutDashboard, ClipboardList, Plus, X, Filter,
  MapPin, Layers, Car, TrendingUp, PieChart, BarChart3, CheckCircle2,
  AlertTriangle, Loader2, Save, FileSpreadsheet, FileText, Trash2, ExternalLink,
  ImagePlus, Image as ImageIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import ReferencePicker from '../components/checklist/ReferencePicker'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  listWashRecords, createWashRecord, deleteWashRecord, uploadWashPhoto,
  distinctSites, distinctAreas, WASH_TYPES, WASH_STATUS_CHOICES,
} from '../lib/api/washRecords'
import { getAssetByNo } from '../lib/api/assets'
import { summarizeWashes, filterWashes } from '../lib/washAnalytics'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { resolveStorageUrl } from '../lib/storageRefs'
import { safeImageSrc } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Filler, Tooltip, Legend,
)

const WRITE_ROLES = new Set(['Admin', 'Manager', 'Director'])

const TABS = [
  { id: 'reporting', label: 'Reporting', icon: LayoutDashboard },
  { id: 'log', label: 'Quick Log', icon: ClipboardList },
]

const EMPTY_FORM = {
  asset_no: '', vehicle_type: '', site: '', area: '',
  wash_date: '', wash_type: 'Full', bay: '', washed_by: '',
  odometer_km: '', status: 'In Progress', notes: '', photos: [],
}

const MAX_PHOTOS = 6

const STATUS_TONE = {
  Completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'In Progress': 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  Scheduled: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Cancelled: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

/** Current local time as HH:MM (auto-captured at save; not user-editable). */
function nowHHMM() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
const todayISO = () => new Date().toISOString().slice(0, 10)
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString()
}
function fmtNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString() : 'N/A'
}

// Date helpers for the quick ranges.
function firstOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function firstOfYear() {
  return new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10)
}
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// Shared light-legible chart options (grid var resolved by chartVarPlugin).
const AXIS = {
  x: { grid: { display: false }, ticks: { color: 'rgba(148,163,184,0.9)', font: { size: 10 } } },
  y: { beginAtZero: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'rgba(148,163,184,0.9)', font: { size: 10 }, precision: 0 } },
}

export default function VehicleWashing() {
  const { activeCountry, activeCurrency } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const canWrite = isSuperAdmin === true || WRITE_ROLES.has(profile?.role)

  const [tab, setTab] = useState('reporting')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  // Reporting filters.
  const [filters, setFilters] = useState({ from: '', to: '', site: 'All', area: 'All', type: 'All' })
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const clearFilters = () => setFilters({ from: '', to: '', site: 'All', area: 'All', type: 'All' })

  // Quick-log form.
  const [form, setForm] = useState({ ...EMPTY_FORM, wash_date: todayISO() })
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formOk, setFormOk] = useState('')
  const assetLookupRef = useRef(0)

  // Master context (read-only) for the picked asset.
  const [master, setMaster] = useState(null)

  // Photos: form.photos holds tp-storage:// refs; previews holds resolved signed
  // URLs for the thumbnails (parallel array, keyed by ref).
  const [previews, setPreviews] = useState({})
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const photoInputRef = useRef(null)

  // Delete confirm.
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      const data = await listWashRecords({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setMissing(false)
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else setError(toUserMessage(err, 'Could not load wash records.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { setLoading(true); load() }, [load])

  // Filter option lists derived from the loaded rows.
  const siteOptions = useMemo(() => distinctSites(rows), [rows])
  const areaOptions = useMemo(() => distinctAreas(rows), [rows])

  // Filtered rows + KPI/chart summary (single pure pass).
  const filtered = useMemo(() => filterWashes(rows, filters), [rows, filters])
  const summary = useMemo(() => summarizeWashes(rows, filters), [rows, filters])

  // ── Chart data ────────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const t = summary.monthlyTrend
    const accent = colorAt(0)
    return {
      labels: t.map((b) => b.label),
      datasets: [{
        label: 'Washes',
        data: t.map((b) => b.count),
        borderColor: accent,
        backgroundColor: withAlpha(accent, 0.15),
        pointBackgroundColor: accent,
        borderWidth: 2,
        tension: 0.35,
        fill: true,
      }],
    }
  }, [summary.monthlyTrend])

  const typeData = useMemo(() => {
    const g = summary.byType
    const colors = categorical(g.length)
    return {
      labels: g.map((x) => x.key),
      datasets: [{ data: g.map((x) => x.count), backgroundColor: colors, borderColor: colors, borderWidth: 1 }],
    }
  }, [summary.byType])

  const siteCountData = useMemo(() => {
    const g = summary.bySite.slice(0, 12)
    const colors = g.map((_, i) => colorAt(i))
    return {
      labels: g.map((x) => x.key),
      datasets: [{ label: 'Washes', data: g.map((x) => x.count), backgroundColor: colors, borderColor: colors, borderWidth: 1, borderRadius: 4 }],
    }
  }, [summary.bySite])

  const barOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: AXIS }
  const lineOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: AXIS }
  const doughnutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '58%',
    plugins: { legend: { position: 'right', labels: { color: 'rgba(148,163,184,0.95)', font: { size: 11 }, boxWidth: 12 } } },
  }

  // ── Quick ranges ──────────────────────────────────────────────────────────
  const quickRanges = [
    { id: 'month', label: 'This month', from: firstOfMonth(), to: todayISO() },
    { id: '30', label: 'Last 30 days', from: daysAgo(30), to: todayISO() },
    { id: 'year', label: 'This year', from: firstOfYear(), to: todayISO() },
    { id: 'all', label: 'All', from: '', to: '' },
  ]

  // ── Asset picker: on select, auto-fill vehicle type + site + country from the
  // fleet master (only when empty, never overwriting a typed value) and show a
  // read-only master context line. ─────────────────────────────────────────────
  const onAssetPick = useCallback(async (value) => {
    const assetNo = String(value || '').trim()
    setForm((f) => ({ ...f, asset_no: assetNo }))
    if (!assetNo) { setMaster(null); return }
    const ticket = ++assetLookupRef.current
    try {
      const asset = await getAssetByNo(assetNo)
      if (ticket !== assetLookupRef.current) return
      setMaster(asset || null)
      if (asset) {
        setForm((f) => ({
          ...f,
          vehicle_type: f.vehicle_type || asset.vehicle_type || '',
          site: f.site || asset.site || '',
        }))
      }
    } catch { /* lookup is a convenience; never surface an error */ }
  }, [])

  const resetForm = useCallback(() => {
    setForm({ ...EMPTY_FORM, wash_date: todayISO() })
    setMaster(null)
    setPreviews({})
    setPhotoError('')
  }, [])

  // ── Photos: validate + upload to the private bucket, storing tp-storage refs ─
  const onAddPhotos = useCallback(async (e) => {
    const files = Array.from(e.target?.files || [])
    if (photoInputRef.current) photoInputRef.current.value = ''
    if (!files.length) return
    setPhotoError('')
    setPhotoBusy(true)
    try {
      let added = 0
      for (const file of files) {
        // Cap using the latest known count to avoid exceeding MAX_PHOTOS.
        if ((form.photos?.length || 0) + added >= MAX_PHOTOS) break
        const ref = await uploadWashPhoto(file, (form.photos?.length || 0) + added)
        added += 1
        let url = null
        try { url = await resolveStorageUrl(ref) } catch { /* preview best-effort */ }
        setForm((f) => ({ ...f, photos: [...(f.photos || []), ref] }))
        setPreviews((p) => ({ ...p, [ref]: url }))
      }
    } catch (err) {
      setPhotoError(toUserMessage(err, 'Could not add the photo.'))
    } finally {
      setPhotoBusy(false)
    }
  }, [form.photos])

  const removePhoto = useCallback((ref) => {
    setForm((f) => ({ ...f, photos: (f.photos || []).filter((r) => r !== ref) }))
    setPreviews((p) => { const n = { ...p }; delete n[ref]; return n })
  }, [])

  const submitForm = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError(''); setFormOk('')
    if (!String(form.asset_no || '').trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const created = await createWashRecord({
        ...form,
        wash_date: form.wash_date || todayISO(),
        wash_time: nowHHMM(),               // captured automatically at save
        country: activeCountry !== 'All' ? activeCountry : null,
      })
      if (created) setRows((r) => [created, ...r])
      setFormOk('Wash logged.')
      resetForm()
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not log the wash.'))
    } finally {
      setSaving(false)
    }
  }, [form, activeCountry, resetForm])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteWashRecord(confirmDelete.id)
      setRows((r) => r.filter((x) => x.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the record.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  // ── Exports (filtered rows) ────────────────────────────────────────────────
  const EXPORT_COLS = ['wash_date', 'wash_time', 'asset_no', 'vehicle_type', 'wash_type', 'site', 'area', 'bay', 'washed_by', 'status']
  const EXPORT_HEADERS = ['Date', 'Time', 'Asset', 'Vehicle Type', 'Wash Type', 'Site', 'Area', 'Bay', 'Operator', 'Status']
  const exportRows = () => filtered.map((r) => ({
    wash_date: r.wash_date ? String(r.wash_date).slice(0, 10) : '',
    wash_time: r.wash_time || '',
    asset_no: r.asset_no || '',
    vehicle_type: r.vehicle_type || '',
    wash_type: r.wash_type || '',
    site: r.site || '',
    area: r.area || '',
    bay: r.bay || '',
    washed_by: r.washed_by || '',
    status: r.status || '',
  }))
  const exportExcel = () => {
    const name = reportFileName('Vehicle Washing', reportDateLabel())
    exportToExcel(exportRows(), EXPORT_COLS, EXPORT_HEADERS, name, 'Washes', { title: 'Vehicle Washing', currency: activeCurrency })
  }
  const exportPdf = () => {
    const name = reportFileName('Vehicle Washing', reportDateLabel())
    exportToPdf(
      exportRows(),
      EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })),
      'Vehicle Washing Report',
      name,
      'landscape',
      '',
      { currency: activeCurrency },
    )
  }

  const kpis = [
    { label: 'Total Washes', value: fmtNum(summary.totalWashes), icon: Droplets },
    { label: 'Vehicles Washed', value: fmtNum(summary.distinctAssets), icon: Car },
    { label: 'Sites Covered', value: fmtNum(summary.bySite.length), icon: MapPin },
    { label: 'Wash Types', value: fmtNum(summary.byType.length), icon: Layers },
  ]

  const inputCls = 'w-full rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Washing"
        subtitle="Log vehicle washes for quick use and report on them by date range, site, area and wash type. Track wash volume and coverage across the fleet."
        icon={Droplets}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={canWrite && (
          <button onClick={() => setTab('log')} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={missing}>
            <Plus size={14} /> Log a wash
          </button>
        )}
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Vehicle Washing is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V270_WASH_MODULE.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Something went wrong.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--input-border)]">
        {TABS.filter((t) => t.id !== 'log' || canWrite).map((t) => {
          const on = tab === t.id
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${on ? 'border-blue-500 text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* ─────────────── REPORTING ─────────────── */}
      {tab === 'reporting' && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="card space-y-3">
            <div className="flex items-center gap-2 text-[var(--text-secondary)]">
              <Filter size={15} /> <span className="text-sm font-medium">Filters</span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                {quickRanges.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => setFilters((f) => ({ ...f, from: q.from, to: q.to }))}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] hover:border-blue-600/50 text-[var(--text-secondary)]"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>From</span>
                <input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} className={inputCls} />
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>To</span>
                <input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} className={inputCls} />
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Site</span>
                <select value={filters.site} onChange={(e) => setFilter('site', e.target.value)} className={inputCls}>
                  <option value="All">All sites</option>
                  {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Area</span>
                <select value={filters.area} onChange={(e) => setFilter('area', e.target.value)} className={inputCls}>
                  <option value="All">All areas</option>
                  {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Wash type</span>
                <select value={filters.type} onChange={(e) => setFilter('type', e.target.value)} className={inputCls}>
                  <option value="All">All types</option>
                  {WASH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <div className="flex items-end">
                <button onClick={clearFilters} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  <X size={14} /> Reset
                </button>
              </div>
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {kpis.map((k) => {
              const Icon = k.icon
              return (
                <div key={k.label} className="card">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                    <Icon size={15} className="text-[var(--text-muted)]" />
                  </div>
                  <p className="text-xl font-bold text-[var(--text-primary)] mt-1">{loading ? '-' : k.value}</p>
                </div>
              )
            })}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={16} className="text-[var(--text-secondary)]" />
                <h3 className="font-semibold text-[var(--text-primary)]">Monthly wash trend</h3>
              </div>
              <div className="h-[240px]">
                {summary.totalWashes === 0
                  ? <EmptyChart />
                  : <Line data={trendData} options={lineOpts} />}
              </div>
            </div>
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <PieChart size={16} className="text-[var(--text-secondary)]" />
                <h3 className="font-semibold text-[var(--text-primary)]">Washes by type</h3>
              </div>
              <div className="h-[240px]">
                {summary.byType.length === 0
                  ? <EmptyChart />
                  : <Doughnut data={typeData} options={doughnutOpts} />}
              </div>
            </div>
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={16} className="text-[var(--text-secondary)]" />
                <h3 className="font-semibold text-[var(--text-primary)]">Washes by site</h3>
              </div>
              <div className="h-[240px]">
                {summary.bySite.length === 0
                  ? <EmptyChart />
                  : <Bar data={siteCountData} options={barOpts} />}
              </div>
            </div>
          </div>

          {/* Records table */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList size={16} className="text-[var(--text-secondary)]" />
              <h3 className="font-semibold text-[var(--text-primary)]">Wash records</h3>
              <span className="text-[11px] text-[var(--text-muted)]">{filtered.length} shown</span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={exportExcel} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
                  <FileSpreadsheet size={14} /> Excel
                </button>
                <button onClick={exportPdf} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
                  <FileText size={14} /> PDF
                </button>
              </div>
            </div>
            {loading ? (
              <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-[var(--text-muted)]">
                <Droplets size={28} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No wash records for the selected filters.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Asset</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Site</th>
                      <th className="py-2 pr-3 font-medium">Area</th>
                      <th className="py-2 pr-3 font-medium">Bay</th>
                      <th className="py-2 pr-3 font-medium">Operator</th>
                      <th className="py-2 pr-3 font-medium text-center">Photos</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      {canWrite && <th className="py-2 font-medium text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 500).map((r) => (
                      <tr key={r.id} className="border-b border-[var(--input-border)]/60 hover:bg-[var(--input-bg)]/50">
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">{fmtDate(r.wash_date)}</td>
                        <td className="py-2 pr-3">
                          {r.asset_no ? (
                            <Link to={`/assets/${encodeURIComponent(r.asset_no)}`} className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300">
                              {r.asset_no} <ExternalLink size={11} className="opacity-70" />
                            </Link>
                          ) : <span className="text-[var(--text-muted)]">N/A</span>}
                        </td>
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.wash_type || 'N/A'}</td>
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.area || 'N/A'}</td>
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.bay || 'N/A'}</td>
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.washed_by || 'N/A'}</td>
                        <td className="py-2 pr-3 text-center text-[var(--text-secondary)]">
                          {Array.isArray(r.photos) && r.photos.length > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                              <ImageIcon size={13} className="opacity-70" /> {r.photos.length}
                            </span>
                          ) : <span className="text-[var(--text-muted)]">-</span>}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${STATUS_TONE[r.status] || STATUS_TONE.Cancelled}`}>{r.status || 'N/A'}</span>
                        </td>
                        {canWrite && (
                          <td className="py-2 text-right">
                            <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-300" title="Delete">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length > 500 && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-2">Showing the first 500 of {filtered.length}. Narrow the filters or export for the full set.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────── QUICK LOG ─────────────── */}
      {tab === 'log' && canWrite && (
        <div className="card max-w-4xl">
          <div className="flex items-center gap-2 mb-4">
            <Droplets size={18} className="text-[var(--text-secondary)]" />
            <h3 className="font-semibold text-[var(--text-primary)]">Log a vehicle wash</h3>
          </div>

          {formOk && (
            <div className="mb-4 rounded-lg border border-emerald-800/50 bg-emerald-500/10 flex items-center gap-2 px-3 py-2">
              <CheckCircle2 size={15} className="text-emerald-400" />
              <span className="text-sm text-emerald-200">{formOk}</span>
              <button onClick={() => setFormOk('')} className="ml-auto p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
            </div>
          )}
          {formError && (
            <div className="mb-4 rounded-lg border border-red-800/50 bg-red-500/10 flex items-center gap-2 px-3 py-2">
              <AlertTriangle size={15} className="text-red-400" />
              <span className="text-sm text-red-200">{formError}</span>
            </div>
          )}

          <form onSubmit={submitForm} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Asset picker (searchable) + read-only master context */}
            <div className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2 lg:col-span-3">
              <span>Asset number <span className="text-red-400">*</span></span>
              <ReferencePicker
                source="asset"
                value={form.asset_no}
                onChange={onAssetPick}
                country={activeCountry}
                placeholder="Search assets by number..."
              />
              {master && (
                <p className="text-[11px] text-[var(--text-secondary)] pt-0.5">
                  Master: {[
                    master.vehicle_type,
                    [master.make, master.model].filter(Boolean).join(' '),
                    master.fleet_number ? `Fleet ${master.fleet_number}` : null,
                    master.site,
                  ].filter(Boolean).join(' | ') || 'no additional details'}
                </p>
              )}
            </div>

            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Vehicle type</span>
              <input value={form.vehicle_type} onChange={(e) => setField('vehicle_type', e.target.value)} className={inputCls} placeholder="auto-filled from asset" />
            </label>
            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Wash type</span>
              <select value={form.wash_type} onChange={(e) => setField('wash_type', e.target.value)} className={inputCls}>
                {WASH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Status</span>
              <select value={form.status} onChange={(e) => setField('status', e.target.value)} className={inputCls}>
                {WASH_STATUS_CHOICES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Wash date</span>
              <input type="date" value={form.wash_date} onChange={(e) => setField('wash_date', e.target.value)} className={inputCls} />
            </label>
            <div className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Wash time</span>
              <div className={`${inputCls} flex items-center gap-1.5 text-[var(--text-secondary)]`}>
                <CheckCircle2 size={13} className="text-[var(--text-muted)]" />
                Captured automatically at save
              </div>
            </div>
            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Operator name <span className="text-[var(--text-muted)]">(optional)</span></span>
              <input value={form.washed_by} onChange={(e) => setField('washed_by', e.target.value)} className={inputCls} placeholder="who washed the vehicle" />
            </label>

            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Site</span>
              <input value={form.site} onChange={(e) => setField('site', e.target.value)} className={inputCls} placeholder="auto-filled from asset" />
            </label>
            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Area</span>
              <input value={form.area} onChange={(e) => setField('area', e.target.value)} className={inputCls} placeholder="e.g. North yard" />
            </label>
            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Wash bay</span>
              <input value={form.bay} onChange={(e) => setField('bay', e.target.value)} className={inputCls} placeholder="e.g. Bay 2" />
            </label>

            <label className="text-xs text-[var(--text-muted)] space-y-1">
              <span>Odometer (km) <span className="text-[var(--text-muted)]">(optional)</span></span>
              <input type="number" min="0" step="any" value={form.odometer_km} onChange={(e) => setField('odometer_km', e.target.value)} className={inputCls} />
            </label>
            <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2 lg:col-span-2">
              <span>Notes <span className="text-[var(--text-muted)]">(optional)</span></span>
              <input value={form.notes} onChange={(e) => setField('notes', e.target.value)} className={inputCls} placeholder="optional" />
            </label>

            {/* Photos */}
            <div className="text-xs text-[var(--text-muted)] space-y-2 sm:col-span-2 lg:col-span-3">
              <span>Photos <span className="text-[var(--text-muted)]">(optional, up to {MAX_PHOTOS})</span></span>
              <div className="flex flex-wrap items-center gap-2">
                {(form.photos || []).map((ref) => {
                  const src = safeImageSrc(previews[ref] || '')
                  return (
                    <div key={ref} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--input-border)] bg-[var(--input-bg)]">
                      {src ? (
                        <img src={src} alt="Wash" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><ImageIcon size={18} className="text-[var(--text-muted)]" /></div>
                      )}
                      <button
                        type="button"
                        onClick={() => removePhoto(ref)}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/55 text-white hover:bg-black/75"
                        title="Remove photo"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )
                })}
                {(form.photos?.length || 0) < MAX_PHOTOS && (
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={photoBusy}
                    className="w-20 h-20 rounded-lg border-2 border-dashed border-[var(--input-border)] flex flex-col items-center justify-center gap-1 text-[var(--text-muted)] hover:border-blue-500/50 hover:text-[var(--text-secondary)] disabled:opacity-60"
                  >
                    {photoBusy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                    <span className="text-[10px]">Add photo</span>
                  </button>
                )}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  multiple
                  onChange={onAddPhotos}
                  className="hidden"
                />
              </div>
              {photoError && <p className="text-[11px] text-red-300">{photoError}</p>}
            </div>

            <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3 pt-1">
              <button type="submit" disabled={saving || missing} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Log wash
              </button>
              <button type="button" onClick={resetForm} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Clear</button>
            </div>
          </form>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-red-400" />
              <h3 className="font-semibold text-[var(--text-primary)]">Delete wash record</h3>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              Delete the wash logged for <span className="text-[var(--text-primary)] font-medium">{confirmDelete.asset_no || 'this asset'}</span> on {fmtDate(confirmDelete.wash_date)}? This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="px-3 py-1.5 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">Cancel</button>
              <button onClick={doDelete} disabled={deleting} className="px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white inline-flex items-center gap-1.5 disabled:opacity-60">
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyChart({ hint = 'No data for the selected filters.' }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)]">
      <Droplets size={26} className="opacity-40 mb-2" />
      <p className="text-xs">{hint}</p>
    </div>
  )
}
