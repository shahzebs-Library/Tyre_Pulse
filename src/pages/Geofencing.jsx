/**
 * Geofencing (route /geofencing) — define and manage geofence zones for the
 * fleet. Each zone is a named centre point (lat/lng) with a radius, typed as a
 * site / restricted / service / custom area. List- and coordinate-based (no map
 * dependency): KPI header, filters + search, create/edit modal, a typed table
 * with active/type badges, delete confirmation and Excel/PDF export.
 *
 * Runs on the `geofences` table (V133). Real data, search, filters, actions and
 * loading/empty/error states throughout. When the table is not yet provisioned,
 * the page renders an actionable "apply the migration" empty state.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  MapPin, Plus, Search, X, Filter, FileSpreadsheet, FileText, AlertTriangle,
  Pencil, Trash2, Loader2, Layers, CheckCircle2, Ban, Globe2,
  PieChart, BarChart3, Ruler, ShieldAlert, Map, Activity, RefreshCw,
} from 'lucide-react'
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listGeofences, createGeofence, updateGeofence, deleteGeofence,
} from '../lib/api/geofences'
import { probeRelation } from '../lib/api/_client'
import {
  ZONE_TYPES, ZONE_TYPE_META, validateGeofence, coverageSummary,
  hasValidCenter, zoneAreaKm2,
} from '../lib/geofences'
import { colorAt, withAlpha } from '../lib/reportColors'
import { compareValues } from '../lib/consoleTable'
import {
  filterGeofences, geofenceSiteOptions, hasGeofenceFilters, geofenceTableRows,
  geofenceExportRows, geofenceSiteRollup, headAndRest, geofenceEmptyState,
  GEOFENCE_EXPORT_COLS, GEOFENCE_EXPORT_HEADERS,
} from '../lib/geofencingAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

const TYPE_BADGE = {
  site: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  restricted: 'bg-red-900/40 text-red-300 border border-red-700/50',
  service: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
  custom: 'bg-violet-900/40 text-violet-300 border border-violet-700/50',
}
const ACTIVE_BADGE = {
  true: 'bg-green-900/40 text-green-300 border border-green-700/50',
  false: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

const EMPTY_FORM = {
  name: '', zone_type: 'custom', center_lat: '', center_lng: '',
  radius_m: '', site: '', active: true, notes: '',
}

const fmtCoord = (v) => (v == null || v === '' ? 'N/A' : Number(v).toFixed(4))
const fmtRadius = (m) => {
  const n = Number(m)
  if (!Number.isFinite(n) || n <= 0) return 'N/A'
  return n >= 1000 ? `${(n / 1000).toFixed(2)} km` : `${Math.round(n)} m`
}
const fmtArea = (km2) => {
  const n = Number(km2)
  if (!Number.isFinite(n) || n <= 0) return 'N/A'
  return n >= 1 ? `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} km2` : `${Math.round(n * 1e6).toLocaleString()} m2`
}
const fmtDistance = (km) => {
  const n = Number(km)
  if (!Number.isFinite(n)) return 'N/A'
  return n >= 1 ? `${n.toFixed(2)} km` : `${Math.round(n * 1000)} m`
}

// Theme-safe chart options (chartVarPlugin resolves the var() colours per theme).
const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom', labels: { color: 'var(--text-muted)', boxWidth: 10, padding: 10, font: { size: 11 } } },
    tooltip: {},
  },
}
const BAR_OPTS = {
  ...CHART_OPTS,
  plugins: { legend: { display: false }, tooltip: {} },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}

export default function Geofencing() {
  const { activeCountry } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [exportError, setExportError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  // Filters
  const [typeFilter, setTypeFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  // Modal + delete confirm
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listGeofences({ country: activeCountry })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      // An empty list is NOT evidence the table is missing. listGeofences
      // degrades a missing relation to [], so "no zones recorded yet" and "the
      // migration was never applied" arrive identically - and telling an owner
      // to run database surgery over an ordinary empty register is the worse
      // way to be wrong. Ask the database directly instead, and only when the
      // probe is CERTAIN the relation is absent (checked && !exists) does the
      // migration hint render; an inconclusive probe stays silent.
      if (list.length === 0) {
        const { exists, checked } = await probeRelation('geofences')
        setNotProvisioned(checked && !exists)
      }
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load geofences.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => coverageSummary(rows || []), [rows])

  const siteOptions = useMemo(() => geofenceSiteOptions(rows || []), [rows])
  const filters = { type: typeFilter, site: siteFilter, status: statusFilter, search }
  const filtered = useMemo(
    () => filterGeofences(rows || [], { type: typeFilter, site: siteFilter, status: statusFilter, search }),
    [rows, typeFilter, siteFilter, statusFilter, search],
  )
  const tableRows = useMemo(() => geofenceTableRows(filtered), [filtered])
  const siteRollup = useMemo(() => geofenceSiteRollup(rows || []), [rows])
  const overlapList = headAndRest(summary.overlaps, 12)
  const flaggedList = headAndRest(summary.flagged, 12)
  const emptyState = geofenceEmptyState({ rows, filtered, filters, notProvisioned })

  const clearFilters = () => { setTypeFilter('all'); setSiteFilter(''); setStatusFilter('all'); setSearch('') }
  const hasFilters = hasGeofenceFilters(filters)

  // ── Charts (follow the reportColors theme; status uses semantic green/slate) ──
  const typeLabels = ZONE_TYPES.map((t) => ZONE_TYPE_META[t].label)
  const typeDoughnutData = useMemo(() => ({
    labels: typeLabels,
    datasets: [{
      data: ZONE_TYPES.map((t) => summary.byType[t]),
      backgroundColor: ZONE_TYPES.map((_, i) => withAlpha(colorAt(i), 0.85)),
      borderColor: 'var(--card-bg)', borderWidth: 2,
    }],
  }), [summary]) // eslint-disable-line react-hooks/exhaustive-deps

  const areaBarData = useMemo(() => ({
    labels: typeLabels,
    datasets: [{
      label: 'Covered area (km2)',
      data: ZONE_TYPES.map((t) => summary.areaByType?.[t] ?? 0),
      backgroundColor: ZONE_TYPES.map((_, i) => withAlpha(colorAt(i), 0.7)),
      borderColor: ZONE_TYPES.map((_, i) => colorAt(i)),
      borderWidth: 1, borderRadius: 4,
    }],
  }), [summary]) // eslint-disable-line react-hooks/exhaustive-deps

  const statusDoughnutData = useMemo(() => ({
    labels: ['Active', 'Inactive'],
    datasets: [{
      data: [summary.active, summary.inactive],
      backgroundColor: [withAlpha('#22c55e', 0.85), withAlpha('#64748b', 0.7)],
      borderColor: 'var(--card-bg)', borderWidth: 2,
    }],
  }), [summary])

  const hasChartData = (rows?.length || 0) > 0
  // A failed read is not an empty register: every figure below reads N/A and
  // every panel says the data is unavailable rather than showing zero.
  const known = rows !== null && !error
  const unavailable = 'Unavailable: the zone register could not be read.'

  // ── Lightweight SVG coverage schematic (no external map dependency) ──────────
  const svgPlot = useMemo(() => {
    const located = (rows || []).filter(hasValidCenter)
    if (!located.length) return null
    const lats = located.map((r) => Number(r.center_lat))
    const lngs = located.map((r) => Number(r.center_lng))
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const W = 640, H = 340, pad = 34
    const spanLat = Math.max(maxLat - minLat, 1e-6)
    const spanLng = Math.max(maxLng - minLng, 1e-6)
    const innerW = W - pad * 2, innerH = H - pad * 2
    const radii = located.map((r) => Number(r.radius_m)).filter((n) => Number.isFinite(n) && n > 0)
    const rMax = radii.length ? Math.max(...radii) : 0
    const points = located.map((r) => {
      const lat = Number(r.center_lat), lng = Number(r.center_lng)
      const x = pad + ((lng - minLng) / spanLng) * innerW
      const y = pad + ((maxLat - lat) / spanLat) * innerH // north up
      const rad = Number(r.radius_m)
      const rpx = rMax > 0 && Number.isFinite(rad) && rad > 0 ? 6 + (rad / rMax) * 22 : 7
      const ti = Math.max(0, ZONE_TYPES.indexOf(ZONE_TYPES.includes(r.zone_type) ? r.zone_type : 'custom'))
      return {
        id: r.id, name: r.name || 'Unnamed zone', x, y, rpx,
        color: colorAt(ti), type: ZONE_TYPE_META[r.zone_type]?.label || 'Custom',
        active: r.active !== false,
        radiusLabel: fmtRadius(r.radius_m),
      }
    })
    return { W, H, points, count: located.length, total: rows.length }
  }, [rows])

  // ── Modal handlers ──────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormErrors({}); setSaveError(''); setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    setForm({
      name: row.name ?? '', zone_type: row.zone_type ?? 'custom',
      center_lat: row.center_lat ?? '', center_lng: row.center_lng ?? '',
      radius_m: row.radius_m ?? '', site: row.site ?? '',
      active: row.active !== false, notes: row.notes ?? '',
    })
    setFormErrors({}); setSaveError(''); setModalOpen(true)
  }
  const closeModal = () => { if (!saving) setModalOpen(false) }
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e?.preventDefault?.()
    setSaveError('')
    const errs = validateGeofence(form)
    setFormErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry && activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateGeofence(editing.id, payload)
      else await createGeofence(payload)
      setModalOpen(false)
      await load()
    } catch (err) {
      setSaveError(toUserMessage(err, 'Could not save the geofence.'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteGeofence(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setSaveError(toUserMessage(err, 'Could not delete the geofence.'))
    } finally {
      setDeleting(false)
    }
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  const exportRows = geofenceExportRows(filtered)
  const exportName = reportFileName('Geofence Zones')

  const kpis = [
    { label: 'Total zones', value: summary.total, icon: MapPin, tone: 'text-[var(--text-primary)]' },
    { label: 'Active zones', value: summary.active, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Site zones', value: summary.byType.site, icon: Layers, tone: 'text-sky-400' },
    { label: 'Covered area', value: !known ? 'N/A' : fmtArea(summary.areaKm2), icon: Globe2, tone: 'text-violet-400' },
  ]

  // ── Register columns (sortable across the WHOLE filtered set) ──────────────
  const sortBy = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
  const columns = [
    {
      id: 'name', header: 'Name', accessorFn: (r) => r.name || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 240,
      cell: ({ row: { original: r } }) => (
        <div className="min-w-0">
          <span className="font-medium text-[var(--text-primary)]">{r.name || 'N/A'}</span>
          {r.notes ? <span className="block text-xs text-[var(--text-muted)] truncate max-w-[240px]" title={r.notes}>{r.notes}</span> : null}
        </div>
      ),
    },
    {
      id: 'type', header: 'Type', accessorFn: (r) => r._typeLabel, sortingFn: sortBy, size: 120,
      cell: ({ row: { original: r } }) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${TYPE_BADGE[r.zone_type] || TYPE_BADGE.custom}`}>{r._typeLabel}</span>,
    },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 140, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'centre', header: 'Centre (lat, lng)', accessorFn: (r) => (r._located ? Number(r.center_lat) : undefined), sortUndefined: 'last', size: 170,
      cell: ({ row: { original: r } }) => <span className="font-mono text-xs text-[var(--text-secondary)]">{fmtCoord(r.center_lat)}, {fmtCoord(r.center_lng)}</span>,
    },
    { id: 'radius', header: 'Radius', accessorFn: (r) => r._radius ?? undefined, sortUndefined: 'last', size: 110, meta: { align: 'right' }, cell: ({ row: { original: r } }) => fmtRadius(r._radius) },
    { id: 'area', header: 'Area', accessorFn: (r) => r._area ?? undefined, sortUndefined: 'last', size: 120, meta: { align: 'right' }, cell: ({ row: { original: r } }) => fmtArea(r._area) },
    {
      id: 'status', header: 'Status', accessorFn: (r) => (r._active ? 'Active' : 'Inactive'), size: 110,
      cell: ({ row: { original: r } }) => (
        <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${ACTIVE_BADGE[r._active ? 'true' : 'false']}`}>
          {r._active ? <><CheckCircle2 size={11} aria-hidden="true" /> Active</> : <><Ban size={11} aria-hidden="true" /> Inactive</>}
        </span>
      ),
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 104, meta: { export: false },
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(r) }} className="inline-flex items-center justify-center w-11 h-11 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit zone ${r.name || ''}`.trim()}><Pencil size={15} aria-hidden="true" /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setSaveError(''); setConfirmDelete(r) }} className="inline-flex items-center justify-center w-11 h-11 rounded hover:bg-red-900/20 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete zone ${r.name || ''}`.trim()}><Trash2 size={15} aria-hidden="true" /></button>
        </div>
      ),
    },
  ]
  const siteColumns = [
    { id: 'site', header: 'Site', accessorFn: (r) => r.site, sortingFn: sortBy, size: 200 },
    { id: 'zones', header: 'Zones', accessorFn: (r) => r.zones, size: 90, meta: { align: 'right' } },
    { id: 'active', header: 'Active', accessorFn: (r) => r.active, size: 90, meta: { align: 'right' } },
    { id: 'area', header: 'Covered area', accessorFn: (r) => r.areaKm2 ?? undefined, sortUndefined: 'last', size: 140, meta: { align: 'right' }, cell: ({ row: { original: r } }) => fmtArea(r.areaKm2) },
    { id: 'types', header: 'Zone types', accessorFn: (r) => r.types.join(', '), enableSorting: false, size: 220, cell: ({ getValue }) => getValue() || 'N/A' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Geofencing"
        subtitle="Define virtual zones (sites, restricted, service or custom areas) by centre coordinate and radius."
        icon={MapPin}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={async () => { try { await exportToExcel(exportRows, GEOFENCE_EXPORT_COLS, GEOFENCE_EXPORT_HEADERS, exportName) } catch (e) { setExportError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!known || !filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button type="button" onClick={async () => { try { await exportToPdf(exportRows, GEOFENCE_EXPORT_COLS.map((k, i) => ({ key: k, header: GEOFENCE_EXPORT_HEADERS[i] })), 'Geofence Zones', exportName, 'landscape') } catch (e) { setExportError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!known || !filtered.length}>
              <FileText size={14} /> PDF
            </button>
            {/* A create into a table that does not exist can only fail, so the
                action is withheld once the probe is certain it is absent. */}
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} /> New zone
            </button>
          </div>
        }
      />

      {error && (
        <div role="alert" className="card border border-red-800/50 flex flex-wrap items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0"><p className="text-red-300 font-medium">Could not load geofences.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {exportError && <p role="alert" className="card text-sm text-red-300">{exportError}</p>}

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
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{!known ? 'N/A' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Zone-type distribution strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ZONE_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
            aria-pressed={typeFilter === t}
            aria-label={`${ZONE_TYPE_META[t].label} zones: ${known ? summary.byType[t] : 'N/A'}. Filter the register by this type`}
            className={`card text-left transition-colors min-h-[44px] focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${typeFilter === t ? 'ring-1 ring-[var(--brand-bright)]' : ''}`}
          >
            <span className={`badge text-[11px] px-2 py-0.5 rounded ${TYPE_BADGE[t]}`}>{ZONE_TYPE_META[t].label}</span>
            <p className="text-2xl font-bold mt-2 text-[var(--text-primary)]">{!known ? 'N/A' : summary.byType[t]}</p>
          </button>
        ))}
      </div>

      {/* Coverage summary stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total zones', value: !known ? 'N/A' : summary.total, sub: !known ? '' : `${summary.geolocated} geolocated`, icon: MapPin, tone: 'text-[var(--text-primary)]' },
          { label: 'Total covered area', value: !known ? 'N/A' : fmtArea(summary.areaKm2), sub: !known ? '' : `${summary.radiusCount} zones with a radius`, icon: Globe2, tone: 'text-violet-400' },
          { label: 'Average radius', value: !known ? 'N/A' : fmtRadius(summary.avgRadiusM), sub: 'across geolocated zones', icon: Ruler, tone: 'text-sky-400' },
          { label: 'Overlapping pairs', value: !known ? 'N/A' : summary.overlapPairs, sub: !known ? '' : (summary.flaggedCount ? `${summary.flaggedCount} data-quality flags` : 'no data-quality flags'), icon: ShieldAlert, tone: summary.overlapPairs > 0 ? 'text-amber-400' : 'text-green-400' },
        ].map((s) => {
          const Icon = s.icon
          return (
            <div key={s.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{s.label}</p>
                <Icon size={16} className={s.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${s.tone}`}>{s.value}</p>
              {s.sub ? <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{s.sub}</p> : null}
            </div>
          )
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><PieChart size={15} className="text-[var(--text-muted)]" /><h3 className="text-sm font-semibold text-[var(--text-primary)]">Zones by type</h3></div>
          <div className="h-56">
            {rows === null ? <div className="h-full rounded bg-[var(--input-bg)] animate-pulse" />
              : hasChartData ? <Doughnut data={typeDoughnutData} options={CHART_OPTS} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{error ? unavailable : 'No zones to chart yet.'}</div>}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><BarChart3 size={15} className="text-[var(--text-muted)]" /><h3 className="text-sm font-semibold text-[var(--text-primary)]">Covered area by type (km2)</h3></div>
          <div className="h-56">
            {rows === null ? <div className="h-full rounded bg-[var(--input-bg)] animate-pulse" />
              : hasChartData && summary.areaKm2 > 0 ? <Bar data={areaBarData} options={BAR_OPTS} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{error ? unavailable : 'No radii set, so no covered area yet.'}</div>}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><Activity size={15} className="text-[var(--text-muted)]" /><h3 className="text-sm font-semibold text-[var(--text-primary)]">Active vs inactive</h3></div>
          <div className="h-56">
            {rows === null ? <div className="h-full rounded bg-[var(--input-bg)] animate-pulse" />
              : hasChartData ? <Doughnut data={statusDoughnutData} options={CHART_OPTS} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{error ? unavailable : 'No zones to chart yet.'}</div>}
          </div>
        </div>
      </div>

      {/* Coverage schematic + Overlaps & data quality */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* SVG coverage schematic (no external map dependency) */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Map size={15} className="text-[var(--text-muted)]" /><h3 className="text-sm font-semibold text-[var(--text-primary)]">Coverage schematic</h3></div>
            {svgPlot ? <span className="text-[11px] text-[var(--text-muted)]">{svgPlot.count} of {svgPlot.total} located</span> : null}
          </div>
          {rows === null || error ? (
            error ? <p className="h-64 flex items-center justify-center text-sm text-[var(--text-muted)]">{unavailable}</p> : <div className="h-64 rounded bg-[var(--input-bg)] animate-pulse" />
          ) : svgPlot ? (
            <>
              <svg viewBox={`0 0 ${svgPlot.W} ${svgPlot.H}`} className="w-full h-64 rounded-lg bg-[var(--input-bg)]/40 border border-[var(--input-border)]" role="img" aria-label="Geofence coverage schematic">
                <rect x="0" y="0" width={svgPlot.W} height={svgPlot.H} fill="transparent" />
                {svgPlot.points.map((p) => (
                  <g key={p.id} opacity={p.active ? 1 : 0.45}>
                    <circle cx={p.x} cy={p.y} r={p.rpx} fill={withAlpha(p.color, 0.22)} stroke={p.color} strokeWidth="1.5" strokeDasharray={p.active ? '0' : '4 3'} />
                    <circle cx={p.x} cy={p.y} r="2.5" fill={p.color} />
                    <title>{`${p.name} | ${p.type} | radius ${p.radiusLabel}${p.active ? '' : ' | inactive'}`}</title>
                  </g>
                ))}
              </svg>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                {ZONE_TYPES.map((t, i) => (
                  <span key={t} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorAt(i) }} />{ZONE_TYPE_META[t].label}
                  </span>
                ))}
                <span className="text-[11px] text-[var(--text-muted)] ml-auto">Schematic layout, not to geographic scale. Circle size is proportional to radius.</span>
              </div>
            </>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-center text-sm text-[var(--text-muted)]">
              <Map size={22} className="mb-2 opacity-60" />
              No geolocated zones yet. Add a centre latitude and longitude to a zone to plot it here.
            </div>
          )}
        </div>

        {/* Overlaps & data quality */}
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><ShieldAlert size={15} className="text-[var(--text-muted)]" /><h3 className="text-sm font-semibold text-[var(--text-primary)]">Overlaps and data quality</h3></div>
          {rows === null || error ? (
            error ? <p className="text-sm text-[var(--text-muted)]">{unavailable}</p> : <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded bg-[var(--input-bg)] animate-pulse" />)}</div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Overlapping zones ({summary.overlapPairs})</p>
                {summary.overlaps.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)] inline-flex items-center gap-1.5"><CheckCircle2 size={14} className="text-green-400" /> No overlapping zones.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                    {overlapList.head.map((o, i) => (
                      <li key={i} className="text-sm flex items-center justify-between gap-2 border-b border-[var(--input-border)]/40 pb-1.5">
                        <span className="text-[var(--text-secondary)] truncate">
                          <span className="font-medium text-[var(--text-primary)]">{o.aName}</span> and <span className="font-medium text-[var(--text-primary)]">{o.bName}</span>
                          {o.contained ? <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/50">contained</span> : null}
                        </span>
                        <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{fmtDistance(o.distanceKm)} apart, {fmtDistance(o.overlapKm)} overlap</span>
                      </li>
                    ))}
                    {overlapList.rest > 0 ? <li className="text-xs text-[var(--text-muted)]">and {overlapList.rest} more</li> : null}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Data-quality flags ({summary.flaggedCount})</p>
                {summary.flagged.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)] inline-flex items-center gap-1.5"><CheckCircle2 size={14} className="text-green-400" /> Every zone has valid coordinates and radius.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                    {flaggedList.head.map((f) => (
                      <li key={f.id || f.name} className="text-sm flex items-start gap-2 border-b border-[var(--input-border)]/40 pb-1.5">
                        <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                        <span className="min-w-0">
                          <span className="font-medium text-[var(--text-primary)]">{f.name}</span>
                          <span className="block text-xs text-[var(--text-muted)]">{f.issues.join('; ')}</span>
                        </span>
                      </li>
                    ))}
                    {flaggedList.rest > 0 ? <li className="text-xs text-[var(--text-muted)]">and {flaggedList.rest} more</li> : null}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Per-site coverage rollup */}
      {rows !== null && siteRollup.length > 0 && (
        <div className="card !p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2"><Layers size={15} className="text-[var(--text-muted)]" aria-hidden="true" /><h2 className="text-sm font-semibold text-[var(--text-primary)]">Coverage by site</h2></div>
          <EnterpriseTable
            columns={siteColumns}
            data={siteRollup}
            getRowId={(r) => r.site}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="No sites recorded on any zone."
          />
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="geo-search" className="sr-only">Search zones</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="geo-search" type="search" className="input pl-9 w-full min-h-[44px]" placeholder="Search name, site, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Zone type">
            <option value="all">All types</option>
            {ZONE_TYPES.map((t) => <option key={t} value={t}>{ZONE_TYPE_META[t].label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select className="input min-h-[44px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Register */}
      <div className="card overflow-hidden !p-0">
        {emptyState && emptyState !== 'loading' && !error ? (
          <div className="px-4 py-12 text-center text-[var(--text-muted)]">
            {/* Three genuinely different empty states. Collapsing the last
                two is what sent owners to run a migration over a register
                that was simply empty. */}
            {emptyState === 'filtered' ? (
              <div className="space-y-2">
                <Filter size={22} className="mx-auto mb-1 opacity-60" aria-hidden="true" />
                <p>No zones match these filters.</p>
                <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>
              </div>
            ) : emptyState === 'not_provisioned' ? (
              <div className="space-y-2">
                <AlertTriangle size={24} className="mx-auto mb-1 text-amber-400 opacity-80" aria-hidden="true" />
                <p className="text-[var(--text-primary)] font-medium">Geofencing is not enabled on this database yet.</p>
                <p className="text-sm">Apply <code className="px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)]">MIGRATIONS_V133_GEOFENCES.sql</code> to provision the <code className="px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)]">geofences</code> table, then reload.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <MapPin size={24} className="mx-auto mb-1 opacity-60" aria-hidden="true" />
                <p className="text-[var(--text-primary)] font-medium">No geofence zones yet.</p>
                <p className="text-sm">Add a centre coordinate and radius to define your first zone.</p>
                <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 mt-1 min-h-[44px]"><Plus size={14} aria-hidden="true" /> New zone</button>
              </div>
            )}
          </div>
        ) : (
          <EnterpriseTable
            columns={columns}
            data={tableRows}
            getRowId={(r) => String(r.id)}
            loading={rows === null}
            error={error || null}
            onRetry={load}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="No zones to show."
          />
        )}
      </div>

      {/* Create / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit geofence' : 'New geofence'}
        size="md"
        footer={(
          <>
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="geofence-form" className="btn-primary text-sm inline-flex items-center justify-center gap-2 min-h-[44px]" disabled={saving}>
              {saving ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Saving</> : <>{editing ? 'Save changes' : 'Create zone'}</>}
            </button>
          </>
        )}
      >
        <form id="geofence-form" onSubmit={submit} className="space-y-4" noValidate>
          {saveError && (
            <div role="alert" className="border border-red-800/50 bg-red-900/20 rounded-lg px-3 py-2 text-sm text-red-300 flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {saveError}
            </div>
          )}
          <div>
            <label htmlFor="geo-name" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Zone name <span className="text-red-400" aria-hidden="true">*</span></label>
            <input id="geo-name" required aria-invalid={!!formErrors.name} aria-describedby={formErrors.name ? 'geo-name-err' : undefined} className="input w-full" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Jebel Ali Depot" />
            {formErrors.name && <p id="geo-name-err" className="text-red-400 text-xs mt-1">{formErrors.name}</p>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="geo-type" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Zone type</label>
              <select id="geo-type" className="input w-full" value={form.zone_type} onChange={(e) => setField('zone_type', e.target.value)}>
                {ZONE_TYPES.map((t) => <option key={t} value={t}>{ZONE_TYPE_META[t].label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="geo-site" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Site</label>
              <input id="geo-site" className="input w-full" value={form.site} onChange={(e) => setField('site', e.target.value)} placeholder="Optional" list="geo-site-options" />
              <datalist id="geo-site-options">{siteOptions.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="geo-lat" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Centre latitude</label>
              <input id="geo-lat" type="number" inputMode="decimal" step="0.0001" className="input w-full" value={form.center_lat} onChange={(e) => setField('center_lat', e.target.value)} placeholder="25.2048" aria-invalid={!!formErrors.center_lat} aria-describedby={formErrors.center_lat ? 'geo-lat-err' : undefined} />
              {formErrors.center_lat && <p id="geo-lat-err" className="text-red-400 text-xs mt-1">{formErrors.center_lat}</p>}
            </div>
            <div>
              <label htmlFor="geo-lng" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Centre longitude</label>
              <input id="geo-lng" type="number" inputMode="decimal" step="0.0001" className="input w-full" value={form.center_lng} onChange={(e) => setField('center_lng', e.target.value)} placeholder="55.2708" aria-invalid={!!formErrors.center_lng} aria-describedby={formErrors.center_lng ? 'geo-lng-err' : undefined} />
              {formErrors.center_lng && <p id="geo-lng-err" className="text-red-400 text-xs mt-1">{formErrors.center_lng}</p>}
            </div>
          </div>
          <div>
            <label htmlFor="geo-radius" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Radius (metres)</label>
            <input id="geo-radius" type="number" inputMode="numeric" step="1" min="0" className="input w-full" value={form.radius_m} onChange={(e) => setField('radius_m', e.target.value)} placeholder="e.g. 2500" aria-invalid={!!formErrors.radius_m} aria-describedby={formErrors.radius_m ? 'geo-radius-err' : undefined} />
            {formErrors.radius_m && <p id="geo-radius-err" className="text-red-400 text-xs mt-1">{formErrors.radius_m}</p>}
          </div>
          <div>
            <label htmlFor="geo-notes" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Notes</label>
            <textarea id="geo-notes" className="input w-full" rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Optional description or operating rules" />
          </div>
          <label htmlFor="geo-active" className="flex items-center justify-between min-h-[44px] cursor-pointer">
            <span className="text-sm text-[var(--text-secondary)]">Active</span>
            <input id="geo-active" type="checkbox" checked={form.active} onChange={(e) => setField('active', e.target.checked)} className="accent-[var(--brand-bright)] w-5 h-5" />
          </label>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete geofence?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center justify-center gap-2 min-h-[44px]" disabled={deleting}>
              {deleting ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Deleting</> : <><Trash2 size={14} aria-hidden="true" /> Delete</>}
            </button>
          </>
        )}
      >
        {saveError && !modalOpen && <p role="alert" className="text-sm text-red-300 mb-2">{saveError}</p>}
        <p className="text-sm text-[var(--text-muted)]">"{confirmDelete?.name}" will be permanently removed. This cannot be undone.</p>
      </Modal>
    </div>
  )
}
