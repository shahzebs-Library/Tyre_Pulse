/**
 * HeatIntelligence (route /heat-intelligence) — GCC Desert-Heat intelligence.
 *
 * Five tabs, all on real data, no fabrication:
 *   • Conditions        — per-city climatology: ambient/road hero, severity +
 *                         advisory, all-city ambient bars, Gay-Lussac pressure
 *                         rise, and the desert heat-safety protocol.
 *   • Fleet blowout risk — every installed `tyre_records` tyre scored 0–100 for
 *                         blowout risk (tread · pressure · heat · age · load),
 *                         band tiles, fleet risk score, ranked at-risk cards.
 *   • Pressure calculator — Gay-Lussac hot-pressure projection across four
 *                         times of day for a cold inflation pressure.
 *   • Desert routes     — the 10 GCC desert corridors enriched with today's
 *                         ambient/road and risk-appropriate pre-trip checks.
 *   • Temperature log   — the manual thermal-reading logger (create/edit/delete,
 *                         hotspots, latest-per-position, filters, export) on the
 *                         `tyre_temperature_readings` table.
 *
 * All engineering constants and formulas live in the pure, unit-tested
 * `src/lib/heatIntelligence.js`. Blowout scoring reads the canonical
 * `tyre_records` table (no new table). Loading / empty / error /
 * not-provisioned states throughout.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend, Title,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  Thermometer, ThermometerSun, Flame, Activity, TrendingUp, Truck,
  AlertTriangle, ShieldAlert, ShieldCheck, Search, X, Filter, FileSpreadsheet,
  FileText, Plus, Pencil, Trash2, Sun, Wind, MapPin, Gauge, Calculator,
  Navigation,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTemperatureReadings, createTemperatureReading,
  updateTemperatureReading, deleteTemperatureReading, listTyresForHeatRisk,
} from '../lib/api/heatIntelligence'
import {
  summariseHeat, latestPerPosition, hotspots, classifyTemp, tempOverAmbient,
  GCC_CITIES, currentConditions, assessFleetRisk, pressureByTimeOfDay,
  enrichRoutes, correlationFromReadings,
  cityCoords, mergeLiveConditions, hottestHours,
} from '../lib/heatIntelligence'
import { getCurrentWeather, getAirQuality, aqiBand } from '../lib/api/weather'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend, Title)

const EMPTY_FORM = {
  asset_no: '', tyre_position: '', tyre_serial: '', temperature_c: '', ambient_c: '',
  pressure_bar: '', speed_kmh: '', threshold_c: '', status: '', location: '',
  recorded_at: '', notes: '',
}

const STATUS_META = {
  critical: { label: 'Critical', badge: 'bg-red-900/40 text-red-300 border-red-800/50', dot: 'bg-red-400', icon: Flame },
  high: { label: 'High', badge: 'bg-orange-900/40 text-orange-300 border-orange-800/50', dot: 'bg-orange-400', icon: ThermometerSun },
  elevated: { label: 'Elevated', badge: 'bg-amber-900/30 text-amber-300 border-amber-800/50', dot: 'bg-amber-400', icon: Thermometer },
  normal: { label: 'Normal', badge: 'bg-emerald-900/30 text-emerald-300 border-emerald-800/50', dot: 'bg-emerald-400', icon: Thermometer },
}

/** Blowout-risk band styling (5 levels from blowoutRiskScore). */
const RISK_META = {
  extreme: { label: 'Extreme', badge: 'bg-red-900/50 text-red-200 border-red-700/60', card: 'border-red-800/60 bg-red-950/30', pill: 'bg-red-600 text-white', tone: 'text-red-400' },
  high: { label: 'High', badge: 'bg-orange-900/40 text-orange-200 border-orange-700/50', card: 'border-orange-800/50 bg-orange-950/20', pill: 'bg-orange-500 text-white', tone: 'text-orange-400' },
  elevated: { label: 'Elevated', badge: 'bg-amber-900/30 text-amber-200 border-amber-700/50', card: 'border-amber-800/40 bg-amber-950/10', pill: 'bg-amber-500 text-slate-900', tone: 'text-amber-400' },
  medium: { label: 'Medium', badge: 'bg-sky-900/30 text-sky-200 border-sky-700/50', card: 'border-sky-800/40', pill: 'bg-sky-500 text-white', tone: 'text-sky-400' },
  low: { label: 'Low', badge: 'bg-emerald-900/30 text-emerald-200 border-emerald-700/50', card: 'border-emerald-800/40', pill: 'bg-emerald-500 text-white', tone: 'text-emerald-400' },
}

/** Ambient severity → hero panel styling. */
const SEVERITY_META = {
  extreme: { label: 'Extreme', panel: 'border-red-800/60 bg-red-950/30', pill: 'bg-red-600 text-white' },
  very_high: { label: 'Very high', panel: 'border-orange-800/50 bg-orange-950/20', pill: 'bg-orange-500 text-white' },
  high: { label: 'High', panel: 'border-amber-800/50 bg-amber-950/10', pill: 'bg-amber-500 text-slate-900' },
  moderate: { label: 'Moderate', panel: 'border-sky-800/40', pill: 'bg-sky-500 text-white' },
  low: { label: 'Low', panel: 'border-emerald-800/40', pill: 'bg-emerald-500 text-white' },
}

const TABS = [
  ['conditions', 'Conditions', Sun],
  ['risk', 'Fleet blowout risk', Flame],
  ['calculator', 'Pressure calculator', Gauge],
  ['routes', 'Desert routes', Navigation],
  ['log', 'Temperature log', Thermometer],
]

const fmtC = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()} °C`)
const fmtBar = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()} bar`)
const fmtNum = (v, unit) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()}${unit ? ` ${unit}` : ''}`)
const barColorFor = (t) => (t >= 45 ? '#dc2626' : t >= 40 ? '#ea580c' : t >= 35 ? '#f59e0b' : t >= 28 ? '#eab308' : '#38bdf8')

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

// Live-weather formatters (kept ASCII, no dash glyphs).
function fmtHour(v) {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtDay(v) {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString([], { weekday: 'short' })
}
function fmtStamp(v) {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'recently' : d.toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
}

/** Compact metric tile used by the live weather panel. */
function LiveTile({ label, value, accent = 'text-[var(--text-primary)]' }) {
  return (
    <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-center">
      <p className={`text-xl font-bold ${accent}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mt-0.5">{label}</p>
    </div>
  )
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

/** Severity badge — colour-scaled by classification band. */
function StatusBadge({ band }) {
  const meta = STATUS_META[band] || STATUS_META.normal
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${meta.badge}`}>
      <Icon size={11} /> {meta.label}
    </span>
  )
}

/** Temperature cell — text colour scales with the band for at-a-glance scanning. */
function TempCell({ reading }) {
  const band = classifyTemp(reading)
  const color = band === 'critical' ? 'text-red-400'
    : band === 'high' ? 'text-orange-400'
    : band === 'elevated' ? 'text-amber-400'
    : 'text-[var(--text-primary)]'
  return <span className={`font-semibold ${color}`}>{fmtC(reading.temperature_c)}</span>
}

export default function HeatIntelligence() {
  const { activeCountry } = useSettings()

  const [tab, setTab] = useState('conditions')
  const [city, setCity] = useState('Dubai')
  const [coldPsi, setColdPsi] = useState('105')

  // Live weather (Open-Meteo, free/keyless). Falls back to seasonal climatology.
  const [weather, setWeather] = useState(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherError, setWeatherError] = useState('')

  // Live air quality (Open-Meteo Air Quality, free/keyless). Independent of weather.
  const [airQuality, setAirQuality] = useState(null)
  const [aqLoading, setAqLoading] = useState(false)
  const [aqError, setAqError] = useState('')

  // Manual-logger data
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  // Installed-fleet data (blowout risk)
  const [tyres, setTyres] = useState(null)
  const [tyresError, setTyresError] = useState('')
  const [tyresLoading, setTyresLoading] = useState(false)

  const [assetFilter, setAssetFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [positionFilter, setPositionFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [search, setSearch] = useState('')

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
      const data = await listTemperatureReadings({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load temperature readings.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  const loadTyres = useCallback(async () => {
    setTyresLoading(true); setTyresError('')
    try {
      const data = await listTyresForHeatRisk({ country: activeCountry })
      setTyres(Array.isArray(data) ? data : [])
    } catch (err) {
      setTyresError(err?.message || 'Could not load fleet tyres for risk assessment.')
      setTyres([])
    } finally {
      setTyresLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadTyres() }, [loadTyres])

  // Fetch live ambient temperature for the selected city. Never throws: on any
  // failure we clear the live reading and the page uses the seasonal average.
  const loadWeather = useCallback(async (signal) => {
    const coords = cityCoords(city)
    if (!coords) { setWeather(null); setWeatherError(''); return }
    setWeatherLoading(true); setWeatherError('')
    const res = await getCurrentWeather(coords.lat, coords.lon, { signal })
    if (res.aborted) return
    // Stamp the reading with the city it belongs to so a stale in-flight result
    // is never rendered under a different city's label.
    if (res.ok) { setWeather({ ...res.data, city_key: city }); setWeatherError('') }
    else { setWeather(null); setWeatherError(res.error || 'Live weather is unavailable right now.') }
    setWeatherLoading(false)
  }, [city])

  useEffect(() => {
    const ctrl = new AbortController()
    loadWeather(ctrl.signal)
    return () => ctrl.abort()
  }, [loadWeather])

  // Fetch live air quality for the selected city. Never throws; on failure the
  // Air Quality panel shows an honest unavailable state.
  const loadAirQuality = useCallback(async (signal) => {
    const coords = cityCoords(city)
    if (!coords) { setAirQuality(null); setAqError(''); return }
    setAqLoading(true); setAqError('')
    const res = await getAirQuality(coords.lat, coords.lon, { signal })
    if (res.aborted) return
    // City-stamp the reading so a stale in-flight result never shows under a
    // different city's label.
    if (res.ok) { setAirQuality({ ...res.data, city_key: city }); setAqError('') }
    else { setAirQuality(null); setAqError(res.error || 'Live air quality is unavailable right now.') }
    setAqLoading(false)
  }, [city])

  useEffect(() => {
    const ctrl = new AbortController()
    loadAirQuality(ctrl.signal)
    return () => ctrl.abort()
  }, [loadAirQuality])

  const refreshAll = useCallback(() => { load(); loadTyres(); loadWeather(); loadAirQuality() }, [load, loadTyres, loadWeather, loadAirQuality])

  // ── Derived: climatology, fleet risk, calculator, routes, correlation ──────
  // Base is seasonal climatology; when a live reading is present we overlay the
  // real ambient temperature so risk, calculator and hero all use actual weather.
  // Only treat the reading as live when it belongs to the currently selected city.
  const liveWeather = useMemo(() => (weather && weather.city_key === city ? weather : null), [weather, city])
  // Only treat the air-quality reading as live when it belongs to the selected city.
  const liveAir = useMemo(() => (airQuality && airQuality.city_key === city ? airQuality : null), [airQuality, city])
  const aqBand = useMemo(() => (liveAir ? aqiBand(liveAir.aqi) : null), [liveAir])
  const conditions = useMemo(() => {
    const base = currentConditions(city)
    return liveWeather?.ambient_c != null ? mergeLiveConditions(base, liveWeather.ambient_c, liveWeather.source) : base
  }, [city, liveWeather])
  const hotHours = useMemo(() => hottestHours(liveWeather?.hourly, 3), [liveWeather])
  const fleetRisk = useMemo(
    () => assessFleetRisk(tyres || [], { ambient_c: conditions.ambient_c, road_c: conditions.road_surface_c }),
    [tyres, conditions],
  )
  const calcPoints = useMemo(
    () => pressureByTimeOfDay(Number(coldPsi) || 0, 25, conditions.ambient_c),
    [coldPsi, conditions],
  )
  const routes = useMemo(() => enrichRoutes(), [])
  const correlation = useMemo(() => correlationFromReadings(rows || []), [rows])

  const cityBarData = useMemo(() => {
    const entries = Object.entries(conditions.all_city_temps)
    return {
      labels: entries.map(([c]) => c),
      datasets: [{
        label: `Ambient °C — ${conditions.month}`,
        data: entries.map(([, t]) => t),
        backgroundColor: entries.map(([, t]) => barColorFor(t)),
        borderRadius: 4,
        maxBarThickness: 26,
      }],
    }
  }, [conditions])

  const cityBarOptions = useMemo(() => ({
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c) => `${c.parsed.x} °C` } },
    },
    scales: {
      x: { grid: { color: 'rgba(148,163,184,0.15)' }, ticks: { color: 'var(--text-muted)', callback: (v) => `${v}°` } },
      y: { grid: { display: false }, ticks: { color: 'var(--text-muted)' } },
    },
  }), [])

  // ── Manual-logger roll-ups ─────────────────────────────────────────────────
  const summary = useMemo(() => summariseHeat(rows || []), [rows])
  const latest = useMemo(() => latestPerPosition(rows || []), [rows])
  const hot = useMemo(() => hotspots(rows || []), [rows])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )
  const positionOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.tyre_position).filter(Boolean))].sort(),
    [rows],
  )
  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (positionFilter && r.tyre_position !== positionFilter) return false
      if (countryFilter && r.country !== countryFilter) return false
      if (statusFilter && classifyTemp(r) !== statusFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.tyre_position || ''} ${r.tyre_serial || ''} ${r.location || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, assetFilter, positionFilter, countryFilter, statusFilter, search])

  const kpis = [
    { label: 'Readings logged', value: summary.totalReadings, icon: Activity, tone: 'text-[var(--text-primary)]' },
    { label: 'Critical', value: summary.criticalCount, icon: Flame, tone: 'text-red-400' },
    { label: 'High', value: summary.highCount, icon: ThermometerSun, tone: 'text-orange-400' },
    { label: 'Assets tracked', value: summary.distinctAssets, icon: Truck, tone: 'text-sky-400' },
    { label: 'Max temperature', value: summary.maxTempC == null ? '—' : fmtC(summary.maxTempC), icon: Thermometer, tone: 'text-amber-400' },
    { label: 'Avg temperature', value: summary.avgTempC == null ? '—' : fmtC(Math.round(summary.avgTempC * 10) / 10), icon: TrendingUp, tone: 'text-green-400' },
  ]

  // ── Log export ─────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'tyre_position', 'tyre_serial', 'temperature_c', 'ambient_c', 'rise_c', 'pressure_bar', 'speed_kmh', 'threshold_c', 'status', 'location', 'recorded_at', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Position', 'Serial', 'Temp (°C)', 'Ambient (°C)', 'Rise (°C)', 'Pressure (bar)', 'Speed (km/h)', 'Threshold (°C)', 'Status', 'Location', 'Recorded', 'Notes']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '',
    tyre_position: r.tyre_position || '',
    tyre_serial: r.tyre_serial || '',
    temperature_c: r.temperature_c ?? '',
    ambient_c: r.ambient_c ?? '',
    rise_c: tempOverAmbient(r) ?? '',
    pressure_bar: r.pressure_bar ?? '',
    speed_kmh: r.speed_kmh ?? '',
    threshold_c: r.threshold_c ?? '',
    status: STATUS_META[classifyTemp(r)]?.label || '',
    location: r.location || '',
    recorded_at: r.recorded_at || '',
    notes: r.notes || '',
  }))

  // ── Fleet-risk export ───────────────────────────────────────────────────────
  const RISK_COLS = ['serial', 'asset_no', 'site', 'position', 'brand', 'size', 'risk_score', 'risk_level', 'road_surface_temp_c', 'target_psi', 'factors', 'action']
  const RISK_HEADERS = ['Serial', 'Asset', 'Site', 'Position', 'Brand', 'Size', 'Risk score', 'Risk level', 'Road °C', 'Target PSI (ref)', 'Contributing factors', 'Top action']
  const riskExportRows = (fleetRisk.high_risk_tyres || []).map((t) => ({
    serial: t.serial || '',
    asset_no: t.asset_no || '',
    site: t.site || '',
    position: t.position || '',
    brand: t.brand || '',
    size: t.size || '',
    risk_score: t.risk_score,
    risk_level: RISK_META[t.risk_level]?.label || t.risk_level,
    road_surface_temp_c: t.road_surface_temp_c,
    target_psi: t.target_psi,
    factors: (t.contributing_factors || []).map((f) => `${f.factor} (${f.value})`).join('; '),
    action: t.recommended_actions?.[0] || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', tyre_position: r.tyre_position || '', tyre_serial: r.tyre_serial || '',
      temperature_c: r.temperature_c ?? '', ambient_c: r.ambient_c ?? '', pressure_bar: r.pressure_bar ?? '',
      speed_kmh: r.speed_kmh ?? '', threshold_c: r.threshold_c ?? '', status: r.status || '',
      location: r.location || '',
      recorded_at: r.recorded_at ? new Date(r.recorded_at).toISOString().slice(0, 16) : '',
      notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const previewBand = useMemo(
    () => classifyTemp({ temperature_c: form.temperature_c, threshold_c: form.threshold_c }),
    [form.temperature_c, form.threshold_c],
  )

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const status = form.status || classifyTemp({ temperature_c: form.temperature_c, threshold_c: form.threshold_c })
      const payload = {
        ...form,
        status,
        recorded_at: form.recorded_at || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateTemperatureReading(editing.id, payload)
      else await createTemperatureReading(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the reading.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTemperatureReading(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the reading.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setAssetFilter(''); setStatusFilter(''); setPositionFilter(''); setCountryFilter(''); setSearch('') }
  const hasFilters = assetFilter || statusFilter || positionFilter || countryFilter || search

  const severityMeta = SEVERITY_META[conditions.heat_severity] || SEVERITY_META.low

  return (
    <div className="space-y-6">
      <PageHeader
        title="Desert Heat Intelligence"
        subtitle="GCC-exclusive heat analytics — climatology, Gay-Lussac pressure physics, and fleet-wide blowout-risk scoring. Overheating is the leading indicator of blowouts, bearing failure, and chronic under-inflation."
        icon={ThermometerSun}
        badge={fleetRisk.risk_summary?.extreme ? `${fleetRisk.risk_summary.extreme} extreme risk` : (summary.criticalCount > 0 ? `${summary.criticalCount} critical` : undefined)}
        onRefresh={refreshAll}
        refreshing={refreshing || tyresLoading}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="heat-city">City</label>
            <select id="heat-city" className="input" value={city} onChange={(e) => setCity(e.target.value)}>
              {GCC_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        }
      />

      {/* Tab bar */}
      <div className="flex border-b border-[var(--input-border)] gap-1 overflow-x-auto">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap ${tab === id ? 'border-sky-500 text-sky-400' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ═══════════════ CONDITIONS ═══════════════ */}
      {tab === 'conditions' && (
        <div className="space-y-6">
          {/* Hero */}
          <div className={`card border ${severityMeta.panel}`}>
            <div className="flex flex-wrap items-center gap-6">
              <div className="text-center">
                <p className="text-5xl font-bold text-[var(--text-primary)]">{conditions.ambient_c}°C</p>
                <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] mt-1">Ambient</p>
              </div>
              <div className="w-px h-14 bg-[var(--input-border)]" />
              <div className="text-center">
                <p className="text-5xl font-bold text-red-400">{conditions.road_surface_c}°C</p>
                <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] mt-1">Road surface</p>
              </div>
              <div className="flex-1 min-w-[240px]">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-xs font-bold uppercase px-2.5 py-1 rounded ${severityMeta.pill}`}>{severityMeta.label}</span>
                  <span className="text-sm font-semibold text-[var(--text-secondary)]">{conditions.city} · {conditions.month}</span>
                </div>
                <p className="text-sm text-[var(--text-secondary)]">{conditions.advisory}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1.5 inline-flex items-center gap-1">
                  <Sun size={12} className="text-amber-400" /> Peak heat window: <strong className="text-[var(--text-secondary)]">{conditions.peak_hours}</strong>
                </p>
              </div>
            </div>
          </div>

          {/* Live ambient weather (Open-Meteo, free/keyless) with seasonal fallback */}
          <div className="card">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <ThermometerSun size={15} className="text-amber-400" /> Live ambient weather
              </h3>
              {liveWeather?.ambient_c != null ? (
                <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-700/40 inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live : {liveWeather.source}
                </span>
              ) : (
                <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]">
                  Seasonal average
                </span>
              )}
            </div>

            {weatherLoading && liveWeather == null ? (
              <p className="text-sm text-[var(--text-muted)] inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Fetching live conditions for {city}...
              </p>
            ) : liveWeather?.ambient_c != null ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <LiveTile label="Now" value={`${liveWeather.ambient_c}°C`} accent="text-orange-300" />
                  <LiveTile label="Feels like" value={liveWeather.apparent_c != null ? `${liveWeather.apparent_c}°C` : 'N/A'} accent="text-red-300" />
                  <LiveTile label="Humidity" value={liveWeather.humidity_pct != null ? `${liveWeather.humidity_pct}%` : 'N/A'} />
                  <LiveTile label="UV index" value={liveWeather.uv_index != null ? `${liveWeather.uv_index}` : 'N/A'} accent="text-amber-300" />
                  <LiveTile label="Wind" value={liveWeather.wind_kmh != null ? `${liveWeather.wind_kmh} km/h` : 'N/A'} />
                  <LiveTile label="Gusts" value={liveWeather.wind_gusts_kmh != null ? `${liveWeather.wind_gusts_kmh} km/h` : 'N/A'} />
                  <LiveTile label="Precipitation" value={liveWeather.precipitation_mm != null ? `${liveWeather.precipitation_mm} mm` : 'N/A'} />
                </div>
                {hotHours.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Hottest hours ahead</p>
                    <div className="flex flex-wrap gap-2">
                      {hotHours.map((h) => (
                        <span key={h.time} className="text-xs px-2 py-1 rounded bg-orange-500/10 text-orange-300 border border-orange-700/40">
                          {fmtHour(h.time)} : {h.temp_c}°C
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {liveWeather.daily?.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] mb-1">7 day max</p>
                    <div className="flex flex-wrap gap-2">
                      {liveWeather.daily.slice(0, 7).map((d) => (
                        <span key={d.date} className="text-xs px-2 py-1 rounded bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]">
                          {fmtDay(d.date)} : <strong className="text-[var(--text-primary)]">{d.max_c != null ? `${Math.round(d.max_c)}°` : 'N/A'}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-[var(--text-muted)] mt-3">
                  Observed {liveWeather.observed_at ? fmtStamp(liveWeather.observed_at) : 'recently'} for {city}. The ambient, road surface, severity and pressure figures above use this live reading; blowout risk and the calculator follow it too.
                </p>
              </>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                {weatherError ? `${weatherError} ` : ''}Showing the seasonal average for {city} ({conditions.ambient_c}°C). Live weather refreshes hourly when reachable.
              </p>
            )}
          </div>

          {/* Air Quality & Dust (Open-Meteo Air Quality, free/keyless) */}
          <div className="card">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Wind size={15} className="text-sky-400" /> Air quality &amp; dust
              </h3>
              {liveAir ? (
                <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-700/40 inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live : {liveAir.source}
                </span>
              ) : (
                <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]">
                  Unavailable
                </span>
              )}
            </div>

            {aqLoading && liveAir == null ? (
              <p className="text-sm text-[var(--text-muted)] inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Fetching air quality for {city}...
              </p>
            ) : liveAir ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <LiveTile label="PM2.5 ug/m3" value={liveAir.pm2_5 != null ? `${liveAir.pm2_5}` : 'N/A'} accent="text-orange-300" />
                  <LiveTile label="PM10 ug/m3" value={liveAir.pm10 != null ? `${liveAir.pm10}` : 'N/A'} accent="text-amber-300" />
                  <LiveTile label="Dust ug/m3" value={liveAir.dust != null ? `${liveAir.dust}` : 'N/A'} accent="text-yellow-300" />
                  <LiveTile label="UV index" value={liveAir.uv != null ? `${liveAir.uv}` : 'N/A'} />
                  <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-center flex flex-col items-center justify-center">
                    {aqBand ? (
                      <span className={`text-sm font-bold uppercase px-2.5 py-1 rounded ${(SEVERITY_META[aqBand.severity] || SEVERITY_META.low).pill}`}>{aqBand.label}</span>
                    ) : (
                      <span className="text-xl font-bold text-[var(--text-primary)]">N/A</span>
                    )}
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mt-1">AQI {liveAir.aqi != null ? liveAir.aqi : ''}</p>
                  </div>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-3">
                  European AQI band for {city}{liveAir.observed_at ? `, observed ${fmtStamp(liveAir.observed_at)}` : ''}. High airborne dust and particulates accelerate tyre and air-filter abrasion across GCC fleets.
                </p>
              </>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                {aqError ? `${aqError} ` : ''}Live air quality for {city} is unavailable right now. It refreshes hourly when reachable.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* All-city bars + Gay-Lussac + correlation */}
            <div className="space-y-6">
              <div className="card">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <Thermometer size={15} className="text-orange-400" /> All GCC cities — {conditions.month} ambient
                </h3>
                <div style={{ height: 320 }}><Bar data={cityBarData} options={cityBarOptions} /></div>
              </div>

              <div className="card">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
                  <Gauge size={15} className="text-sky-400" /> Gay-Lussac pressure effect
                </h3>
                <p className="text-sm text-[var(--text-secondary)]">
                  At {conditions.road_surface_c}°C road surface, a 105 PSI cold tyre reaches approximately{' '}
                  <strong className="text-[var(--text-primary)]">{Math.round(105 * (conditions.road_surface_c + 273.15) / (25 + 273.15))} PSI</strong>{' '}
                  — a <strong className="text-orange-400">{conditions.pressure_increase_pct}% expected rise</strong> from ambient heat.
                </p>
                <div className="mt-3 rounded-lg border border-red-800/50 bg-red-950/20 px-3 py-2">
                  <p className="text-xs font-bold uppercase text-red-300 mb-0.5 inline-flex items-center gap-1"><AlertTriangle size={12} /> Critical</p>
                  <p className="text-sm text-red-200">Always inflate when COLD. Never release pressure from hot tyres — the reading is normal heat expansion.</p>
                </div>
              </div>

              <div className="card">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
                  <Activity size={15} className="text-emerald-400" /> Heat–pressure correlation (logged readings)
                </h3>
                {correlation.correlation == null ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    Need at least 3 logged readings carrying both temperature and pressure to compute a correlation. Currently {correlation.samples} complete pair{correlation.samples === 1 ? '' : 's'}.
                  </p>
                ) : (
                  <p className="text-sm text-[var(--text-secondary)]">
                    Pearson r = <strong className={`${correlation.correlation > 0.5 ? 'text-orange-400' : 'text-[var(--text-primary)]'}`}>{correlation.correlation}</strong>{' '}
                    across {correlation.samples} logged reading{correlation.samples === 1 ? '' : 's'} — {correlation.correlation > 0.5 ? 'temperature and pressure rise together as expected under heat.' : correlation.correlation < -0.5 ? 'inverse relationship — investigate sensor placement or bleeding of hot tyres.' : 'weak linear relationship in the current sample.'}
                  </p>
                )}
              </div>
            </div>

            {/* Safety protocol */}
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                <ShieldCheck size={15} className="text-emerald-400" /> Desert heat-safety protocol
              </h3>
              <div className="space-y-4">
                {[
                  ['Before departure', Wind, ['Check all tyre pressures when COLD (before 08:00)', 'Inspect for sidewall bulges and cracks', 'Ensure tread depth is ≥3mm for desert routes', 'Verify no damage from the previous trip']],
                  ['During operation', ThermometerSun, ['Avoid sudden braking on hot roads', 'If a pressure warning sounds — pull over safely', 'Do NOT deflate hot tyres to reduce pressure', 'Allow tyres to cool 30+ mins before inspection']],
                  ['Post-trip', Thermometer, ['Check for embedded debris', 'Allow full cool-down before storing the vehicle', 'Flag any unusual wear patterns for inspection']],
                ].map(([heading, Icon, items]) => (
                  <div key={heading}>
                    <p className="text-xs font-bold uppercase text-[var(--text-muted)] mb-1.5 inline-flex items-center gap-1.5"><Icon size={13} className="text-sky-400" /> {heading}</p>
                    <ul className="space-y-1">
                      {items.map((item) => (
                        <li key={item} className="text-sm text-[var(--text-secondary)] flex gap-2">
                          <span className="text-sky-400 shrink-0">•</span>{item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ FLEET BLOWOUT RISK ═══════════════ */}
      {tab === 'risk' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-[var(--text-secondary)]">
                Scored under <strong className="text-[var(--text-primary)]">{conditions.city}</strong> conditions —{' '}
                {conditions.ambient_c}°C ambient · {conditions.road_surface_c}°C road · {conditions.month}.{' '}
                {fleetRisk.fleet_size} installed tyre{fleetRisk.fleet_size === 1 ? '' : 's'} assessed.
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Target PSI uses published size references (this dataset carries no measured per-tyre target); load assumed nominal where not captured.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right mr-2">
                <p className="text-2xl font-bold text-orange-400 leading-none">{fleetRisk.fleet_risk_score}%</p>
                <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Fleet risk score</p>
              </div>
              <button onClick={() => exportToExcel(riskExportRows, RISK_COLS, RISK_HEADERS, 'heat_blowout_risk')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!riskExportRows.length}>
                <FileSpreadsheet size={14} /> Excel
              </button>
              <button onClick={() => exportToPdf(riskExportRows, RISK_COLS.map((k, i) => ({ key: k, header: RISK_HEADERS[i] })), 'Fleet Blowout Risk', 'heat_blowout_risk', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!riskExportRows.length}>
                <FileText size={14} /> PDF
              </button>
            </div>
          </div>

          {tyresError && (
            <div className="card border border-red-800/50 flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
              <div><p className="text-red-300 font-medium">Couldn’t load fleet tyres.</p><p className="text-[var(--text-muted)] text-sm mt-1">{tyresError}</p></div>
            </div>
          )}

          {/* Band tiles */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {['extreme', 'high', 'elevated', 'medium', 'low'].map((level) => {
              const meta = RISK_META[level]
              return (
                <div key={level} className={`card border ${meta.card}`}>
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-semibold uppercase tracking-wider ${meta.tone}`}>{meta.label}</p>
                    <Flame size={14} className={meta.tone} />
                  </div>
                  <p className="text-2xl font-bold mt-1 text-[var(--text-primary)]">{tyres === null ? '—' : (fleetRisk.risk_summary?.[level] || 0)}</p>
                </div>
              )
            })}
          </div>

          {/* Ranked cards */}
          {tyres === null || tyresLoading ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 card animate-pulse" />)}</div>
          ) : (tyres || []).length === 0 ? (
            <div className="card text-center py-12">
              <Truck size={26} className="mx-auto mb-2 text-[var(--text-muted)] opacity-60" />
              <p className="text-[var(--text-secondary)] font-medium">No installed tyres to assess.</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">Blowout risk scores every fitted tyre in <span className="font-mono">tyre_records</span>. Import or fit tyres to populate this view.</p>
            </div>
          ) : (fleetRisk.high_risk_tyres || []).length === 0 ? (
            <div className="card border border-emerald-800/50 text-center py-12">
              <ShieldCheck size={26} className="mx-auto mb-2 text-emerald-400" />
              <p className="text-emerald-300 font-medium">No elevated-or-higher blowout risk under {conditions.city} heat.</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">All {fleetRisk.fleet_size} installed tyres score below 30.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(fleetRisk.high_risk_tyres || []).map((t) => {
                const meta = RISK_META[t.risk_level] || RISK_META.medium
                return (
                  <div key={t.id ?? `${t.asset_no}-${t.position}-${t.serial}`} className={`card border ${meta.card}`}>
                    <div className="flex items-start gap-3">
                      <span className={`shrink-0 mt-0.5 text-sm font-bold px-2.5 py-1 rounded ${meta.pill}`}>{Math.round(t.risk_score)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full border ${meta.badge}`}>{meta.label}</span>
                          <span className="font-mono font-semibold text-sm text-[var(--text-primary)]">{t.serial || '—'}</span>
                          {t.asset_no && <span className="text-xs text-[var(--text-muted)]">· {t.asset_no}</span>}
                          {t.position && <span className="text-xs text-[var(--text-muted)]">· {t.position}</span>}
                          {t.brand && <span className="text-xs text-[var(--text-muted)]">· {t.brand}</span>}
                          {t.size && <span className="text-xs text-[var(--text-muted)]">· {t.size}</span>}
                        </div>
                        {(t.contributing_factors || []).length > 0 && (
                          <div className="flex gap-x-3 gap-y-1 mt-1.5 flex-wrap">
                            {t.contributing_factors.map((f, j) => (
                              <span key={j} className="text-xs text-[var(--text-secondary)] inline-flex items-center gap-1">
                                <AlertTriangle size={11} className="text-orange-400 shrink-0" /> {f.factor} <span className="text-[var(--text-muted)]">({f.value})</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {(t.recommended_actions || []).map((a, j) => (
                          <p key={j} className="text-xs font-semibold text-[var(--text-primary)] mt-1">→ {a}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}
              {fleetRisk.high_risk_tyres.length >= 30 && (
                <p className="text-xs text-[var(--text-muted)] px-1">Showing the 30 highest-risk tyres. Export for the full ranked set.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ PRESSURE CALCULATOR ═══════════════ */}
      {tab === 'calculator' && (
        <div className="max-w-2xl space-y-5">
          <div className="card">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <Calculator size={15} className="text-sky-400" /> Gay-Lussac heat pressure calculator
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Projects hot tyre pressure from a cold inflation figure using P₁/T₁ = P₂/T₂, at {conditions.city}’s {conditions.month} ambient of {conditions.ambient_c}°C.
            </p>
            <div className="max-w-xs">
              <label className="label" htmlFor="cold-psi">Cold inflation pressure (PSI)</label>
              <input id="cold-psi" className="input w-full" type="number" step="1" min="0" value={coldPsi} onChange={(e) => setColdPsi(e.target.value)} />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Inflation temperature assumed 25°C (cold).</p>
            </div>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Expected pressure by time of day — {conditions.city}, {conditions.month}</h3>
            {!(Number(coldPsi) > 0) ? (
              <p className="text-sm text-[var(--text-muted)]">Enter a cold inflation pressure above to project hot pressures.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {calcPoints.map((c) => {
                    const cold = Number(coldPsi)
                    const tone = c.expected_hot_pressure_psi > cold * 1.2 ? 'text-red-400'
                      : c.expected_hot_pressure_psi > cold * 1.1 ? 'text-orange-400' : 'text-emerald-400'
                    return (
                      <div key={c.time_label} className="flex items-center justify-between rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2.5">
                        <div>
                          <p className="text-sm font-semibold text-[var(--text-primary)]">{c.time_label}</p>
                          <p className="text-xs text-[var(--text-muted)]">{c.actual_temp_c}°C operating</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-xl font-bold ${tone}`}>{c.expected_hot_pressure_psi} PSI</p>
                          <p className="text-xs text-[var(--text-muted)]">+{c.pressure_increase_psi} PSI (+{c.pressure_increase_pct}%)</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {calcPoints.length > 0 && (
                  <div className="mt-4 rounded-lg border border-red-800/50 bg-red-950/20 px-3 py-2.5">
                    <p className="text-sm text-red-200">
                      <strong>At {conditions.road_surface_c}°C road surface, pressure rises to {calcPoints[calcPoints.length - 1].expected_hot_pressure_psi} PSI.</strong>{' '}
                      NEVER release pressure from hot tyres.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════ DESERT ROUTES ═══════════════ */}
      {tab === 'routes' && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">GCC desert corridors enriched with today’s {conditions.month} ambient/road temperatures and risk-appropriate pre-trip checks.</p>
          {routes.map((route) => {
            const meta = RISK_META[route.risk] || SEVERITY_META[route.risk] || RISK_META.medium
            const badge = RISK_META[route.risk]?.badge || 'bg-sky-900/30 text-sky-200 border-sky-700/50'
            return (
              <div key={route.name} className={`card border ${RISK_META[route.risk]?.card || ''}`}>
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <MapPin size={15} className="text-[var(--text-muted)] shrink-0" />
                      <p className="font-semibold text-[var(--text-primary)]">{route.name}</p>
                      <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full border ${badge}`}>{route.risk.replace('_', ' ')}</span>
                      <span className="text-xs text-[var(--text-muted)]">{route.current_ambient_c}°C ambient · {route.road_surface_temp_c}°C road · {route.surface.replace('_', ' ')}</span>
                    </div>
                    <div className="mt-2 space-y-0.5">
                      {route.recommended_checks.slice(0, 4).map((check) => (
                        <p key={check} className="text-xs text-[var(--text-secondary)] flex gap-1.5"><span className="text-sky-400 shrink-0">•</span>{check}</p>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-[var(--text-muted)]">Desert exposure</p>
                    <p className={`text-xl font-bold ${meta.tone || 'text-[var(--text-primary)]'}`}>{Math.round(route.desert_exposure * 100)}%</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ═══════════════ TEMPERATURE LOG (existing manual logger) ═══════════════ */}
      {tab === 'log' && (
        <div className="space-y-6">
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'heat_intelligence')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Heat Intelligence', 'heat_intelligence', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Log reading
            </button>
          </div>

          {notProvisioned && (
            <div className="card border border-amber-800/50 flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-amber-300 font-medium">The manual temperature logger isn’t enabled on this database yet.</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">
                  Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V188_TYRE_TEMPERATURE_READINGS.sql</span>, then reload. Conditions, blowout risk, calculator and routes work without it.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="card border border-red-800/50 flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
              <div><p className="text-red-300 font-medium">Couldn’t load temperature readings.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
                  <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
                </div>
              )
            })}
          </div>

          {/* Hotspots attention panel */}
          <div className="card">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <ShieldAlert size={15} className="text-red-400" /> Thermal hotspots
              <span className="text-xs font-normal text-[var(--text-muted)]">(high &amp; critical, hottest first)</span>
            </h3>
            {rows === null ? (
              <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
            ) : hot.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] flex items-center gap-2">
                <Thermometer size={15} className="text-emerald-400" /> No tyres reading high or critical — fleet is within safe thermal limits.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {hot.slice(0, 24).map((h, i) => {
                  const meta = STATUS_META[h.status] || STATUS_META.high
                  const Icon = meta.icon
                  return (
                    <div key={`${h.asset_no}-${h.tyre_position}-${i}`} className={`rounded-lg border px-3 py-2 ${meta.badge}`}>
                      <div className="flex items-center gap-1.5">
                        <Icon size={13} />
                        <span className="text-xs font-semibold">{h.asset_no || '—'}</span>
                        {h.tyre_position && <span className="text-[11px] opacity-80">· {h.tyre_position}</span>}
                      </div>
                      <p className="text-lg font-bold leading-tight mt-0.5">{fmtC(h.temperature_c)}</p>
                    </div>
                  )
                })}
                {hot.length > 24 && <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 flex items-center text-xs text-[var(--text-muted)]">+{hot.length - 24} more</div>}
              </div>
            )}
          </div>

          {/* Latest-per-position snapshot */}
          <div className="card overflow-hidden !p-0">
            <div className="px-4 pt-4 pb-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Thermometer size={15} /> Latest reading per tyre position
              </h3>
            </div>
            {rows === null ? (
              <div className="px-4 pb-4"><div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" /></div>
            ) : latest.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-[var(--text-muted)]">No readings logged yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                      {['Asset', 'Position', 'Temp', 'Rise vs ambient', 'Pressure', 'Status', 'Recorded'].map((h, i) => <th key={i} className="px-4 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {latest
                      .slice()
                      .sort((a, b) => (Number(b.temperature_c) || -Infinity) - (Number(a.temperature_c) || -Infinity))
                      .slice(0, 40)
                      .map((r) => {
                        const rise = tempOverAmbient(r)
                        return (
                          <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                            <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                            <td className="px-4 py-2 text-[var(--text-secondary)]">{r.tyre_position || '—'}</td>
                            <td className="px-4 py-2"><TempCell reading={r} /></td>
                            <td className="px-4 py-2 text-[var(--text-secondary)]">{rise == null ? '—' : `+${fmtC(rise)}`}</td>
                            <td className="px-4 py-2 text-[var(--text-secondary)]">{fmtBar(r.pressure_bar)}</td>
                            <td className="px-4 py-2"><StatusBadge band={classifyTemp(r)} /></td>
                            <td className="px-4 py-2 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.recorded_at)}</td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input className="input pl-9 w-full" placeholder="Search asset, position, serial, location, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
                <option value="">All assets</option>
                {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select className="input" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} aria-label="Position">
                <option value="">All positions</option>
                {positionOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
                <option value="">All statuses</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="elevated">Elevated</option>
                <option value="normal">Normal</option>
              </select>
              {countryOptions.length > 1 && (
                <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
                  <option value="">All countries</option>
                  {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
              <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalReadings}</span>
            </div>
          </div>

          {/* Table */}
          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    {['Asset', 'Position', 'Temp', 'Ambient', 'Rise', 'Pressure', 'Speed', 'Status', 'Recorded', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows === null ? (
                    [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={10} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                      <Filter size={22} className="mx-auto mb-2 opacity-60" />
                      {rows.length === 0 && !notProvisioned ? 'No readings logged yet — log your first thermal reading.' : 'No readings match these filters.'}
                    </td></tr>
                  ) : (
                    filtered.slice(0, 500).map((r) => {
                      const rise = tempOverAmbient(r)
                      return (
                        <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                          <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.tyre_position || '—'}</td>
                          <td className="px-4 py-2.5"><TempCell reading={r} /></td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtC(r.ambient_c)}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{rise == null ? '—' : `+${fmtC(rise)}`}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtBar(r.pressure_bar)}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtNum(r.speed_kmh, 'km/h')}</td>
                          <td className="px-4 py-2.5"><StatusBadge band={classifyTemp(r)} /></td>
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
            {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
          </div>
        </div>
      )}

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit reading' : 'Log temperature reading'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Tyre position (optional)</label>
                  <input className="input w-full" placeholder="e.g. FL, RRo, Drive-2" value={form.tyre_position} maxLength={60} onChange={(e) => set('tyre_position', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Temperature (°C)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="95" value={form.temperature_c} onChange={(e) => set('temperature_c', e.target.value)} />
                </div>
                <div>
                  <label className="label">Ambient (°C, optional)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="42" value={form.ambient_c} onChange={(e) => set('ambient_c', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Pressure (bar, optional)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="8.5" value={form.pressure_bar} onChange={(e) => set('pressure_bar', e.target.value)} />
                </div>
                <div>
                  <label className="label">Speed (km/h, optional)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="80" value={form.speed_kmh} onChange={(e) => set('speed_kmh', e.target.value)} />
                </div>
                <div>
                  <label className="label">Alarm threshold (°C, optional)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="90" value={form.threshold_c} onChange={(e) => set('threshold_c', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Tyre serial (optional)</label>
                  <input className="input w-full" placeholder="e.g. DOT-3521-XT" value={form.tyre_serial} maxLength={120} onChange={(e) => set('tyre_serial', e.target.value)} />
                </div>
                <div>
                  <label className="label">Recorded at (optional)</label>
                  <input className="input w-full" type="datetime-local" value={form.recorded_at} onChange={(e) => set('recorded_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Status (optional)</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    <option value="">Auto-classify from temperature</option>
                    <option value="normal">Normal</option>
                    <option value="elevated">Elevated</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1 inline-flex items-center gap-1">
                    Live classification: <StatusBadge band={previewBand} />
                  </p>
                </div>
                <div>
                  <label className="label">Location (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh depot, Route 40" value={form.location} maxLength={200} onChange={(e) => set('location', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. infrared gun reading after 4h haul; hub warm to touch" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Log reading'}
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
                  {confirmDelete.asset_no || 'Reading'}{confirmDelete.tyre_position ? ` · ${confirmDelete.tyre_position}` : ''} · {fmtC(confirmDelete.temperature_c)} · {fmtDateTime(confirmDelete.recorded_at)}. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
