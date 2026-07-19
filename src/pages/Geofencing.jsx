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
  PieChart, BarChart3, Ruler, ShieldAlert, Map, Activity,
} from 'lucide-react'
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listGeofences, createGeofence, updateGeofence, deleteGeofence,
} from '../lib/api/geofences'
import {
  ZONE_TYPES, ZONE_TYPE_META, validateGeofence, coverageSummary,
  hasValidCenter, zoneAreaKm2,
} from '../lib/geofences'
import { colorAt, withAlpha } from '../lib/reportColors'
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
      setRows(Array.isArray(data) ? data : [])
      if (Array.isArray(data) && data.length === 0) {
        // Distinguish "no rows" from "table missing" — a follow-up probe would
        // be redundant; the service already returns [] for a missing relation.
        // We surface the migration hint only when the empty state has no filters.
        setNotProvisioned(true)
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

  const siteOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (typeFilter !== 'all' && r.zone_type !== typeFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (statusFilter === 'active' && r.active === false) return false
      if (statusFilter === 'inactive' && r.active !== false) return false
      if (q) {
        const hay = `${r.name || ''} ${r.site || ''} ${r.notes || ''} ${r.zone_type || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, typeFilter, siteFilter, statusFilter, search])

  const clearFilters = () => { setTypeFilter('all'); setSiteFilter(''); setStatusFilter('all'); setSearch('') }
  const hasFilters = typeFilter !== 'all' || siteFilter || statusFilter !== 'all' || search

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
  const EXPORT_COLS = ['name', 'zone_type', 'site', 'center_lat', 'center_lng', 'radius_m', 'area_km2', 'active']
  const EXPORT_HEADERS = ['Name', 'Type', 'Site', 'Latitude', 'Longitude', 'Radius (m)', 'Area (km2)', 'Active']
  const exportRows = filtered.map((r) => {
    const area = zoneAreaKm2(r.radius_m)
    return {
      name: r.name || '', zone_type: ZONE_TYPE_META[r.zone_type]?.label || r.zone_type || '',
      site: r.site || '', center_lat: r.center_lat ?? '', center_lng: r.center_lng ?? '',
      radius_m: r.radius_m ?? '',
      area_km2: area == null ? '' : Math.round(area * 1000) / 1000,
      active: r.active === false ? 'No' : 'Yes',
    }
  })
  const exportName = reportFileName('Geofence Zones')

  const kpis = [
    { label: 'Total zones', value: summary.total, icon: MapPin, tone: 'text-[var(--text-primary)]' },
    { label: 'Active zones', value: summary.active, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Site zones', value: summary.byType.site, icon: Layers, tone: 'text-sky-400' },
    { label: 'Covered area', value: rows === null ? 'N/A' : fmtArea(summary.areaKm2), icon: Globe2, tone: 'text-violet-400' },
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
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, exportName) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Geofence Zones', exportName, 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New zone
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load geofences.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Zone-type distribution strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ZONE_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
            className={`card text-left transition-colors ${typeFilter === t ? 'ring-1 ring-[var(--brand-bright)]' : ''}`}
          >
            <span className={`badge text-[11px] px-2 py-0.5 rounded ${TYPE_BADGE[t]}`}>{ZONE_TYPE_META[t].label}</span>
            <p className="text-2xl font-bold mt-2 text-[var(--text-primary)]">{rows === null ? 'N/A' : summary.byType[t]}</p>
          </button>
        ))}
      </div>

      {/* Coverage summary stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total zones', value: rows === null ? 'N/A' : summary.total, sub: rows === null ? '' : `${summary.geolocated} geolocated`, icon: MapPin, tone: 'text-[var(--text-primary)]' },
          { label: 'Total covered area', value: rows === null ? 'N/A' : fmtArea(summary.areaKm2), sub: rows === null ? '' : `${summary.radiusCount} zones with a radius`, icon: Globe2, tone: 'text-violet-400' },
          { label: 'Average radius', value: rows === null ? 'N/A' : fmtRadius(summary.avgRadiusM), sub: 'across geolocated zones', icon: Ruler, tone: 'text-sky-400' },
          { label: 'Overlapping pairs', value: rows === null ? 'N/A' : summary.overlapPairs, sub: rows === null ? '' : (summary.flaggedCount ? `${summary.flaggedCount} data-quality flags` : 'no data-quality flags'), icon: ShieldAlert, tone: summary.overlapPairs > 0 ? 'text-amber-400' : 'text-green-400' },
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
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No zones to chart yet.</div>}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><BarChart3 size={15} className="text-[var(--text-muted)]" /><h3 className="text-sm font-semibold text-[var(--text-primary)]">Covered area by type (km2)</h3></div>
          <div className="h-56">
            {rows === null ? <div className="h-full rounded bg-[var(--input-bg)] animate-pulse" />
              : hasChartData && summary.areaKm2 > 0 ? <Bar data={areaBarData} options={BAR_OPTS} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No radii set, so no covered area yet.</div>}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><Activity size={15} className="text-[var(--text-muted)]" /><h3 className="text-sm font-semibold text-[var(--text-primary)]">Active vs inactive</h3></div>
          <div className="h-56">
            {rows === null ? <div className="h-full rounded bg-[var(--input-bg)] animate-pulse" />
              : hasChartData ? <Doughnut data={statusDoughnutData} options={CHART_OPTS} />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No zones to chart yet.</div>}
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
          {rows === null ? (
            <div className="h-64 rounded bg-[var(--input-bg)] animate-pulse" />
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
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded bg-[var(--input-bg)] animate-pulse" />)}</div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Overlapping zones ({summary.overlapPairs})</p>
                {summary.overlaps.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)] inline-flex items-center gap-1.5"><CheckCircle2 size={14} className="text-green-400" /> No overlapping zones.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                    {summary.overlaps.slice(0, 12).map((o, i) => (
                      <li key={i} className="text-sm flex items-center justify-between gap-2 border-b border-[var(--input-border)]/40 pb-1.5">
                        <span className="text-[var(--text-secondary)] truncate">
                          <span className="font-medium text-[var(--text-primary)]">{o.aName}</span> and <span className="font-medium text-[var(--text-primary)]">{o.bName}</span>
                          {o.contained ? <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/50">contained</span> : null}
                        </span>
                        <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{fmtDistance(o.distanceKm)} apart, {fmtDistance(o.overlapKm)} overlap</span>
                      </li>
                    ))}
                    {summary.overlaps.length > 12 ? <li className="text-xs text-[var(--text-muted)]">and {summary.overlaps.length - 12} more...</li> : null}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Data-quality flags ({summary.flaggedCount})</p>
                {summary.flagged.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)] inline-flex items-center gap-1.5"><CheckCircle2 size={14} className="text-green-400" /> Every zone has valid coordinates and radius.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                    {summary.flagged.slice(0, 12).map((f) => (
                      <li key={f.id || f.name} className="text-sm flex items-start gap-2 border-b border-[var(--input-border)]/40 pb-1.5">
                        <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                        <span className="min-w-0">
                          <span className="font-medium text-[var(--text-primary)]">{f.name}</span>
                          <span className="block text-xs text-[var(--text-muted)]">{f.issues.join('; ')}</span>
                        </span>
                      </li>
                    ))}
                    {summary.flagged.length > 12 ? <li className="text-xs text-[var(--text-muted)]">and {summary.flagged.length - 12} more...</li> : null}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search name, site, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Zone type">
            <option value="all">All types</option>
            {ZONE_TYPES.map((t) => <option key={t} value={t}>{ZONE_TYPE_META[t].label}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Name', 'Type', 'Site', 'Centre (lat, lng)', 'Radius', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {notProvisioned && !hasFilters ? (
                    <div className="space-y-2">
                      <MapPin size={24} className="mx-auto mb-1 opacity-60" />
                      <p className="text-[var(--text-primary)] font-medium">No geofence zones yet.</p>
                      <p className="text-sm">If this is a fresh install, apply <code className="px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)]">MIGRATIONS_V133_GEOFENCES.sql</code> to provision the <code className="px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)]">geofences</code> table, then add your first zone.</p>
                      <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 mt-1"><Plus size={14} /> New zone</button>
                    </div>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No zones match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.name || 'N/A'}{r.notes ? <span className="block text-xs text-[var(--text-muted)] font-normal truncate max-w-[240px]">{r.notes}</span> : null}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${TYPE_BADGE[r.zone_type] || TYPE_BADGE.custom}`}>{ZONE_TYPE_META[r.zone_type]?.label || r.zone_type}</span></td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{fmtCoord(r.center_lat)}, {fmtCoord(r.center_lng)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtRadius(r.radius_m)}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${ACTIVE_BADGE[r.active === false ? 'false' : 'true']}`}>{r.active === false ? <><Ban size={11} /> Inactive</> : <><CheckCircle2 size={11} /> Active</>}</span></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Edit zone"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/20 text-[var(--text-muted)] hover:text-red-400" title="Delete zone"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={closeModal}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--input-border)]">
              <h2 className="font-bold text-lg text-[var(--text-primary)]">{editing ? 'Edit geofence' : 'New geofence'}</h2>
              <button onClick={closeModal} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="p-5 space-y-4">
              {saveError && (
                <div className="border border-red-800/50 bg-red-900/20 rounded-lg px-3 py-2 text-sm text-red-300 flex items-start gap-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {saveError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Zone name <span className="text-red-400">*</span></label>
                <input className="input w-full" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Jebel Ali Depot" autoFocus />
                {formErrors.name && <p className="text-red-400 text-xs mt-1">{formErrors.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Zone type</label>
                  <select className="input w-full" value={form.zone_type} onChange={(e) => setField('zone_type', e.target.value)}>
                    {ZONE_TYPES.map((t) => <option key={t} value={t}>{ZONE_TYPE_META[t].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Site</label>
                  <input className="input w-full" value={form.site} onChange={(e) => setField('site', e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Centre latitude</label>
                  <input type="number" step="0.0001" className="input w-full" value={form.center_lat} onChange={(e) => setField('center_lat', e.target.value)} placeholder="25.2048" />
                  {formErrors.center_lat && <p className="text-red-400 text-xs mt-1">{formErrors.center_lat}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Centre longitude</label>
                  <input type="number" step="0.0001" className="input w-full" value={form.center_lng} onChange={(e) => setField('center_lng', e.target.value)} placeholder="55.2708" />
                  {formErrors.center_lng && <p className="text-red-400 text-xs mt-1">{formErrors.center_lng}</p>}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Radius (metres)</label>
                <input type="number" step="1" min="0" className="input w-full" value={form.radius_m} onChange={(e) => setField('radius_m', e.target.value)} placeholder="e.g. 2500" />
                {formErrors.radius_m && <p className="text-red-400 text-xs mt-1">{formErrors.radius_m}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Notes</label>
                <textarea className="input w-full" rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Optional description or operating rules" />
              </div>

              <label className="flex items-center justify-between">
                <span className="text-sm text-[var(--text-secondary)]">Active</span>
                <input type="checkbox" checked={form.active} onChange={(e) => setField('active', e.target.checked)} className="accent-[var(--brand-bright)] w-4 h-4" />
              </label>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary flex-1 text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary flex-1 text-sm inline-flex items-center justify-center gap-2" disabled={saving}>
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving</> : <>{editing ? 'Save changes' : 'Create zone'}</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => !deleting && setConfirmDelete(null)}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-sm shadow-2xl p-5" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-900/30 border border-red-800/50 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="font-semibold text-[var(--text-primary)]">Delete geofence?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">"{confirmDelete.name}" will be permanently removed. This cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary flex-1 text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="flex-1 text-sm inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 hover:bg-red-500 text-white px-3 py-2 font-medium transition-colors disabled:opacity-60" disabled={deleting}>
                {deleting ? <><Loader2 size={14} className="animate-spin" /> Deleting</> : <>Delete</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
