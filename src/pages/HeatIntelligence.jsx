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
import Card, { CardBody, CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTemperatureReadings, createTemperatureReading,
  updateTemperatureReading, deleteTemperatureReading, listTyresForHeatRisk,
} from '../lib/api/heatIntelligence'
import {
  summariseHeat, latestPerPosition, hotspots, classifyTemp,
  GCC_CITIES, currentConditions, pressureByTimeOfDay,
  enrichRoutes, correlationFromReadings,
  cityCoords, mergeLiveConditions, hottestHours,
} from '../lib/heatIntelligence'
import { getCurrentWeather, getAirQuality, aqiBand } from '../lib/api/weather'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { compareValues } from '../lib/consoleTable'
import { isMissingRelation } from '../lib/api/_client'
import {
  RISK_LEVELS, scoreInstalledFleet, riskSites, filterRiskRows, riskExportRows,
  RISK_EXPORT_COLS, RISK_EXPORT_HEADERS, filterReadings, readingRows, readingExportRows,
  READING_EXPORT_COLS, READING_EXPORT_HEADERS,
} from '../lib/heatIntelligenceAnalytics'

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

/**
 * Blowout-risk band styling (5 levels from blowoutRiskScore).
 *
 * The per-band SURFACE classes these maps used to carry are gone: the card
 * surface now comes from the kit's Card, which sets its padding, background and
 * border inline. A class here would be dead, and dead style strings are how a
 * later reader re-applies one and wonders why nothing moves. Border tint lives
 * in RISK_CARD_TONE / SEVERITY_CARD_TONE below.
 */
const RISK_META = {
  extreme: { label: 'Extreme', badge: 'bg-red-900/50 text-red-300 border-red-700/60', pill: 'bg-red-600 text-white', tone: 'text-red-400' },
  high: { label: 'High', badge: 'bg-orange-900/40 text-orange-300 border-orange-700/50', pill: 'bg-orange-500 text-white', tone: 'text-orange-400' },
  elevated: { label: 'Elevated', badge: 'bg-amber-900/30 text-amber-300 border-amber-700/50', pill: 'bg-amber-500 text-slate-900', tone: 'text-amber-300' },
  medium: { label: 'Medium', badge: 'bg-sky-900/30 text-sky-300 border-sky-700/50', pill: 'bg-sky-500 text-white', tone: 'text-sky-300' },
  low: { label: 'Low', badge: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/50', pill: 'bg-emerald-500 text-white', tone: 'text-emerald-300' },
}

/** Ambient severity → pill styling. */
const SEVERITY_META = {
  extreme: { label: 'Extreme', pill: 'bg-red-600 text-white' },
  very_high: { label: 'Very high', pill: 'bg-orange-500 text-white' },
  high: { label: 'High', pill: 'bg-amber-500 text-slate-900' },
  moderate: { label: 'Moderate', pill: 'bg-sky-500 text-white' },
  low: { label: 'Low', pill: 'bg-emerald-500 text-white' },
}

/**
 * Band → Card border tone.
 *
 * The kit's Card tints the BORDER only, deliberately, so a wall of band tiles
 * stays scannable. Card has four tints against five bands, so extreme and high
 * share `crit`: they are the two "act now" bands. Nothing is lost by the
 * collapse, because the pill, the badge and the label colour beside each border
 * still carry all five levels.
 */
const RISK_CARD_TONE = { extreme: 'crit', high: 'crit', elevated: 'warn', medium: 'info', low: 'good' }
const SEVERITY_CARD_TONE = { extreme: 'crit', very_high: 'crit', high: 'warn', moderate: 'info', low: 'good' }

// The manual log reads the newest N readings (listTemperatureReadings default).
const READINGS_LIMIT = 500

// One sort rule for every table column: consoleTable's number/date aware
// comparison, with blank cells pushed to the end whatever the direction.
const SORT = {
  sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)),
  sortUndefined: 'last',
}
const blankToUndef = (v) => (v == null || v === '' ? undefined : v)

const TABS = [
  ['conditions', 'Conditions', Sun],
  ['risk', 'Fleet blowout risk', Flame],
  ['calculator', 'Pressure calculator', Gauge],
  ['routes', 'Desert routes', Navigation],
  ['log', 'Temperature log', Thermometer],
]

const fmtC = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()} °C`)
const fmtBar = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()} bar`)
const fmtNum = (v, unit) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()}${unit ? ` ${unit}` : ''}`)
const barColorFor = (t) => (t >= 45 ? '#dc2626' : t >= 40 ? '#ea580c' : t >= 35 ? '#f59e0b' : t >= 28 ? '#eab308' : '#38bdf8')

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
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
    : band === 'elevated' ? 'text-amber-300'
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
      const data = await listTemperatureReadings({ country: activeCountry, limit: READINGS_LIMIT })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load temperature readings.'))
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
      setTyresError(toUserMessage(err, 'Could not load fleet tyres for risk assessment.'))
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
  // Every installed tyre scored (the engine's assessFleetRisk keeps only the
  // top 30 for cards; the table and exports need the whole ranked set).
  const fleetScored = useMemo(
    () => scoreInstalledFleet(tyres || [], { ambient_c: conditions.ambient_c, road_c: conditions.road_surface_c }),
    [tyres, conditions],
  )
  const [riskLevel, setRiskLevel] = useState('at_risk')
  const [riskSite, setRiskSite] = useState('')
  const [riskSearch, setRiskSearch] = useState('')
  const riskSiteOptions = useMemo(() => riskSites(fleetScored.rows), [fleetScored])
  const riskFiltered = useMemo(
    () => filterRiskRows(fleetScored.rows, { level: riskLevel, site: riskSite, search: riskSearch }),
    [fleetScored, riskLevel, riskSite, riskSearch],
  )
  const riskRowsForExport = useMemo(() => riskExportRows(riskFiltered), [riskFiltered])
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
        label: `Ambient °C, ${conditions.month}`,
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
  // Hottest first; the table pages and re-sorts across the whole set.
  const latestRows = useMemo(
    () => readingRows(latest).sort((a, b) => (b.temp_num ?? -Infinity) - (a.temp_num ?? -Infinity)),
    [latest],
  )
  const readingsCapped = (rows || []).length >= READINGS_LIMIT
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

  const filtered = useMemo(
    () => filterReadings(rows || [], { asset: assetFilter, position: positionFilter, country: countryFilter, status: statusFilter, search }),
    [rows, assetFilter, positionFilter, countryFilter, statusFilter, search],
  )
  // Paged by the table, not capped. The exports below walk `filtered` in full.
  const logRows = useMemo(() => readingRows(filtered), [filtered])

  const kpis = [
    { label: 'Readings logged', value: summary.totalReadings, icon: Activity, tone: 'text-[var(--text-primary)]' },
    { label: 'Critical', value: summary.criticalCount, icon: Flame, tone: 'text-red-400' },
    { label: 'High', value: summary.highCount, icon: ThermometerSun, tone: 'text-orange-400' },
    { label: 'Assets tracked', value: summary.distinctAssets, icon: Truck, tone: 'text-sky-300' },
    { label: 'Max temperature', value: summary.maxTempC == null ? 'N/A' : fmtC(summary.maxTempC), icon: Thermometer, tone: 'text-amber-300' },
    { label: 'Avg temperature', value: summary.avgTempC == null ? 'N/A' : fmtC(Math.round(summary.avgTempC * 10) / 10), icon: TrendingUp, tone: 'text-green-400' },
  ]

  // ── Log export ─────────────────────────────────────────────────────────────
  const exportRows = useMemo(() => readingExportRows(filtered), [filtered])
  const runExport = useCallback(async (fn) => {
    try { await fn() } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }, [])

  // ── Table columns ──────────────────────────────────────────────────────────
  const riskColumns = useMemo(() => [
    {
      id: 'risk_score', header: 'Score', accessorKey: 'risk_score', size: 80, ...SORT,
      cell: ({ row }) => {
        const meta = RISK_META[row.original.risk_level] || RISK_META.medium
        return <span className={`text-sm font-bold px-2 py-0.5 rounded tabular-nums ${meta.pill}`}>{Math.round(row.original.risk_score)}</span>
      },
    },
    {
      id: 'risk_level', header: 'Level', accessorFn: (r) => RISK_LEVELS.length - RISK_LEVELS.indexOf(r.risk_level), size: 100, ...SORT,
      cell: ({ row }) => {
        const meta = RISK_META[row.original.risk_level] || RISK_META.medium
        return <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full border ${meta.badge}`}>{meta.label}</span>
      },
      meta: { exportValue: (r) => r.risk_label },
    },
    { id: 'serial', header: 'Serial', accessorFn: (r) => blankToUndef(r.serial), size: 140, ...SORT,
      cell: ({ row }) => <span className="font-mono text-sm text-[var(--text-primary)]">{row.original.serial || 'N/A'}</span> },
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => blankToUndef(r.asset_no), size: 100, ...SORT,
      cell: ({ row }) => row.original.asset_no || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: (r) => blankToUndef(r.site), size: 110, ...SORT,
      cell: ({ row }) => row.original.site || 'Not recorded' },
    { id: 'position', header: 'Position', accessorFn: (r) => blankToUndef(r.position), size: 90, ...SORT,
      cell: ({ row }) => row.original.position || 'N/A' },
    { id: 'tread_mm', header: 'Tread (mm)', accessorFn: (r) => blankToUndef(r.tread_mm), size: 90, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => row.original.tread_mm ?? 'N/A' },
    { id: 'pressure_psi', header: 'PSI / target', accessorFn: (r) => blankToUndef(r.pressure_psi), size: 110, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => `${row.original.pressure_psi ?? 'N/A'} / ${row.original.target_psi}` },
    {
      id: 'factors', header: 'Contributing factors', accessorFn: (r) => blankToUndef(r.factors_text), size: 280, ...SORT,
      cell: ({ row }) => (row.original.factors.length ? (
        <ul className="space-y-0.5">
          {row.original.factors.map((f, j) => (
            <li key={j} className="text-xs text-[var(--text-secondary)] flex items-start gap-1">
              <AlertTriangle size={11} className="text-orange-400 shrink-0 mt-0.5" aria-hidden="true" /> {f.factor} <span className="text-[var(--text-muted)]">({f.value})</span>
            </li>
          ))}
        </ul>
      ) : <span className="text-xs text-[var(--text-muted)]">None</span>),
    },
    { id: 'top_action', header: 'Top action', accessorFn: (r) => blankToUndef(r.top_action), size: 260, ...SORT,
      cell: ({ row }) => <span className="text-xs font-semibold text-[var(--text-primary)]">{row.original.top_action || 'No action needed'}</span> },
  ], [])

  const latestColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => blankToUndef(r.asset_no), size: 110, ...SORT,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'tyre_position', header: 'Position', accessorFn: (r) => blankToUndef(r.tyre_position), size: 100, ...SORT,
      cell: ({ row }) => row.original.tyre_position || 'N/A' },
    { id: 'temp', header: 'Temp', accessorFn: (r) => blankToUndef(r.temp_num), size: 100, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => <TempCell reading={row.original} /> },
    { id: 'rise', header: 'Rise vs ambient', accessorFn: (r) => blankToUndef(r.rise_c), size: 120, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => (row.original.rise_c == null ? 'N/A' : `+${fmtC(row.original.rise_c)}`) },
    { id: 'pressure', header: 'Pressure', accessorFn: (r) => blankToUndef(r.pressure_num), size: 100, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => fmtBar(row.original.pressure_bar) },
    { id: 'band', header: 'Status', accessorKey: 'band_rank', size: 110, ...SORT,
      cell: ({ row }) => <StatusBadge band={row.original.band} />, meta: { exportValue: (r) => r.band_label } },
    { id: 'recorded_at', header: 'Recorded', accessorFn: (r) => blankToUndef(r.recorded_at), size: 170, ...SORT,
      cell: ({ row }) => <span className="whitespace-nowrap">{fmtDateTime(row.original.recorded_at)}</span> },
  ], [])

  const logColumns = useMemo(() => [
    ...latestColumns.filter((c) => c.id !== 'rise' && c.id !== 'band' && c.id !== 'recorded_at' && c.id !== 'pressure'),
    { id: 'ambient', header: 'Ambient', accessorFn: (r) => blankToUndef(r.ambient_num), size: 100, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => fmtC(row.original.ambient_c) },
    { id: 'rise', header: 'Rise', accessorFn: (r) => blankToUndef(r.rise_c), size: 90, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => (row.original.rise_c == null ? 'N/A' : `+${fmtC(row.original.rise_c)}`) },
    { id: 'pressure', header: 'Pressure', accessorFn: (r) => blankToUndef(r.pressure_num), size: 100, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => fmtBar(row.original.pressure_bar) },
    { id: 'speed', header: 'Speed', accessorFn: (r) => blankToUndef(r.speed_num), size: 90, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => fmtNum(row.original.speed_kmh, 'km/h') },
    { id: 'band', header: 'Status', accessorKey: 'band_rank', size: 110, ...SORT,
      cell: ({ row }) => <StatusBadge band={row.original.band} /> },
    { id: 'recorded_at', header: 'Recorded', accessorFn: (r) => blankToUndef(r.recorded_at), size: 170, ...SORT,
      cell: ({ row }) => <span className="whitespace-nowrap">{fmtDateTime(row.original.recorded_at)}</span> },
    {
      id: 'actions', header: '', enableSorting: false, size: 100, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" aria-label={`Edit reading for ${row.original.asset_no || 'asset'}`}><Pencil size={14} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row.original) }} className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" aria-label={`Delete reading for ${row.original.asset_no || 'asset'}`}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ], [latestColumns])

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
  // One named close per dialog, carrying the in-flight guard, because each is
  // reached from four places: Escape, the backdrop, the X and Cancel. Repeating
  // `!saving &&` at each of them is how one of them ends up missing it.
  //
  // `useCallback` is belt and braces rather than a requirement: this repo's
  // `useDialogBehavior` deliberately holds `onClose` in a ref and keeps it OUT
  // of its dependency array, precisely so a re-created callback cannot yank
  // focus out of a field on every keystroke. Stable identities cost nothing and
  // keep that true even if the hook's contract ever changes back.
  const closeModal = useCallback(() => { if (!saving) { setShowModal(false); setEditing(null) } }, [saving])
  const closeDelete = useCallback(() => { if (!deleting) setConfirmDelete(null) }, [deleting])
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
      setFormError(toUserMessage(err, 'Could not save the reading.'))
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
      setError(toUserMessage(err, 'Could not delete the reading.'))
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
        subtitle="GCC-exclusive heat analytics: climatology, Gay-Lussac pressure physics, and fleet-wide blowout-risk scoring. Overheating is the leading indicator of blowouts, bearing failure, and chronic under-inflation."
        icon={ThermometerSun}
        badge={fleetScored.summary.bands.extreme ? `${fleetScored.summary.bands.extreme} extreme risk` : (summary.criticalCount > 0 ? `${summary.criticalCount} critical` : undefined)}
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
      <div role="tablist" aria-label="Heat intelligence views" className="flex border-b border-[var(--input-border)] gap-1 overflow-x-auto">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap ${tab === id ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ═══════════════ CONDITIONS ═══════════════ */}
      {tab === 'conditions' && (
        <div className="space-y-6">
          {/* Hero */}
          <Card tone={SEVERITY_CARD_TONE[conditions.heat_severity] || 'good'}>
            <div className="flex flex-wrap items-center gap-[var(--space-6)]">
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
                  <Sun size={12} className="text-amber-300" /> Peak heat window: <strong className="text-[var(--text-secondary)]">{conditions.peak_hours}</strong>
                </p>
              </div>
            </div>
          </Card>

          {/* Live ambient weather (Open-Meteo, free/keyless) with seasonal fallback */}
          <Card>
            {/* The Live-vs-Seasonal badge sits in `actions` so it stays beside the
                title: it is what tells the reader whether the figures above are a
                real reading or climatology. */}
            <CardHeader
              level={2}
              icon={ThermometerSun}
              title="Live ambient weather"
              actions={liveWeather?.ambient_c != null ? (
                <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-700/40 inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live : {liveWeather.source}
                </span>
              ) : (
                <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]">
                  Seasonal average
                </span>
              )}
            />
            <CardBody>
            {weatherLoading && liveWeather == null ? (
              <p className="text-sm text-[var(--text-muted)] inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-[var(--input-border)] border-t-[var(--text-primary)] rounded-full animate-spin inline-block" aria-hidden="true" /> Fetching live conditions for {city}...
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
            </CardBody>
          </Card>

          {/* Air Quality & Dust (Open-Meteo Air Quality, free/keyless) */}
          <Card>
            <CardHeader
              level={2}
              icon={Wind}
              title="Air quality & dust"
              actions={liveAir ? (
                <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-700/40 inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live : {liveAir.source}
                </span>
              ) : (
                <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]">
                  Unavailable
                </span>
              )}
            />
            <CardBody>
            {aqLoading && liveAir == null ? (
              <p className="text-sm text-[var(--text-muted)] inline-flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-[var(--input-border)] border-t-[var(--text-primary)] rounded-full animate-spin inline-block" aria-hidden="true" /> Fetching air quality for {city}...
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
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--gap-grid)]">
            {/* All-city bars + Gay-Lussac + correlation */}
            <div className="space-y-[var(--space-6)]">
              <Card>
                <CardHeader level={2} icon={Thermometer} title={`All GCC cities, ${conditions.month} ambient`} />
                <CardBody style={{ height: 320 }}><Bar data={cityBarData} options={cityBarOptions} /></CardBody>
              </Card>

              <Card>
                <CardHeader level={2} icon={Gauge} title="Gay-Lussac pressure effect" />
                <p className="text-sm text-[var(--text-secondary)]">
                  At {conditions.road_surface_c}°C road surface, a 105 PSI cold tyre reaches approximately{' '}
                  <strong className="text-[var(--text-primary)]">{Math.round(105 * (conditions.road_surface_c + 273.15) / (25 + 273.15))} PSI</strong>
                  , a <strong className="text-orange-400">{conditions.pressure_increase_pct}% expected rise</strong> from ambient heat.
                </p>
                <div className="mt-[var(--space-3)] rounded-lg border border-red-800/50 bg-red-950/20 px-3 py-2">
                  <p className="text-xs font-bold uppercase text-red-300 mb-0.5 inline-flex items-center gap-1"><AlertTriangle size={12} /> Critical</p>
                  <p className="text-sm text-red-300">Always inflate when COLD. Never release pressure from hot tyres. The reading is normal heat expansion.</p>
                </div>
              </Card>

              <Card>
                <CardHeader level={2} icon={Activity} title="Heat-pressure correlation" description="Computed from the logged readings." />
                {correlation.correlation == null ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    Need at least 3 logged readings carrying both temperature and pressure to compute a correlation. Currently {correlation.samples} complete pair{correlation.samples === 1 ? '' : 's'}.
                  </p>
                ) : (
                  <p className="text-sm text-[var(--text-secondary)]">
                    Pearson r = <strong className={`${correlation.correlation > 0.5 ? 'text-orange-400' : 'text-[var(--text-primary)]'}`}>{correlation.correlation}</strong>{' '}
                    across {correlation.samples} logged reading{correlation.samples === 1 ? '' : 's'}: {correlation.correlation > 0.5 ? 'temperature and pressure rise together as expected under heat.' : correlation.correlation < -0.5 ? 'inverse relationship, investigate sensor placement or bleeding of hot tyres.' : 'weak linear relationship in the current sample.'}
                  </p>
                )}
              </Card>
            </div>

            {/* Safety protocol */}
            <Card>
              <CardHeader level={2} icon={ShieldCheck} title="Desert heat-safety protocol" />
              <div className="space-y-[var(--space-4)]">
                {[
                  ['Before departure', Wind, ['Check all tyre pressures when COLD (before 08:00)', 'Inspect for sidewall bulges and cracks', 'Ensure tread depth is ≥3mm for desert routes', 'Verify no damage from the previous trip']],
                  ['During operation', ThermometerSun, ['Avoid sudden braking on hot roads', 'If a pressure warning sounds, pull over safely', 'Do NOT deflate hot tyres to reduce pressure', 'Allow tyres to cool 30+ mins before inspection']],
                  ['Post-trip', Thermometer, ['Check for embedded debris', 'Allow full cool-down before storing the vehicle', 'Flag any unusual wear patterns for inspection']],
                ].map(([heading, Icon, items]) => (
                  <div key={heading}>
                    <p className="text-xs font-bold uppercase text-[var(--text-muted)] mb-1.5 inline-flex items-center gap-1.5"><Icon size={13} className="text-sky-300" /> {heading}</p>
                    <ul className="space-y-1">
                      {items.map((item) => (
                        <li key={item} className="text-sm text-[var(--text-secondary)] flex gap-2">
                          <span className="text-sky-300 shrink-0">•</span>{item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ═══════════════ FLEET BLOWOUT RISK ═══════════════ */}
      {tab === 'risk' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-[var(--text-secondary)]">
                Scored under <strong className="text-[var(--text-primary)]">{conditions.city}</strong> conditions:{' '}
                {conditions.ambient_c}°C ambient, {conditions.road_surface_c}°C road, {conditions.month}.{' '}
                {fleetScored.summary.fleet_size} installed tyre{fleetScored.summary.fleet_size === 1 ? '' : 's'} assessed.
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Target PSI uses published size references (this dataset carries no measured per-tyre target); load assumed nominal where not captured.
                {fleetScored.summary.fleet_size > 0 && ` ${fleetScored.summary.with_tread.toLocaleString()} carry a tread reading, ${fleetScored.summary.with_pressure.toLocaleString()} a pressure reading; ${fleetScored.summary.unmeasured.toLocaleString()} are scored on heat and age alone.`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-right mr-2">
                <p className="text-2xl font-bold text-orange-400 leading-none tabular-nums">{fleetScored.summary.fleet_risk_score == null ? 'N/A' : `${fleetScored.summary.fleet_risk_score}%`}</p>
                <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Fleet risk score</p>
              </div>
              <button type="button" onClick={() => runExport(() => exportToExcel(riskRowsForExport, RISK_EXPORT_COLS, RISK_EXPORT_HEADERS, reportFileName('TyrePulse Heat Blowout Risk', conditions.city)))} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]" disabled={!riskRowsForExport.length}>
                <FileSpreadsheet size={14} aria-hidden="true" /> Excel
              </button>
              <button type="button" onClick={() => runExport(() => exportToPdf(riskRowsForExport, RISK_EXPORT_COLS.map((k, i) => ({ key: k, header: RISK_EXPORT_HEADERS[i] })), `Fleet Blowout Risk, ${conditions.city}`, reportFileName('TyrePulse Heat Blowout Risk', conditions.city), 'landscape'))} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]" disabled={!riskRowsForExport.length}>
                <FileText size={14} aria-hidden="true" /> PDF
              </button>
            </div>
          </div>

          {tyresError && (
            /* Card is flex-col by default and Tailwind emits .flex-col after
               .flex-row, so a row-direction card sets its direction through
               `style`, where Card spreads it last and it deterministically wins. */
            <Card tone="crit" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
              <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="flex-1" role="alert">
                <p className="text-red-300 font-medium">Couldn’t load fleet tyres.</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">{tyresError}</p>
              </div>
              <button type="button" onClick={loadTyres} className="btn-secondary text-sm min-h-[40px]">Retry</button>
            </Card>
          )}

          {/* Band tiles: each is a filter toggle for the table below */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-[var(--gap-grid)]">
            {RISK_LEVELS.map((level) => {
              const meta = RISK_META[level]
              const on = riskLevel === level
              return (
                <button
                  key={level}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setRiskLevel(on ? '' : level)}
                  className="text-left rounded-[var(--radius-card)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <Card pad="tight" tone={RISK_CARD_TONE[level]} style={on ? { borderColor: 'var(--accent)' } : undefined}>
                    <div className="flex items-center justify-between">
                      <p className={`text-xs font-semibold uppercase tracking-wider ${meta.tone}`}>{meta.label}</p>
                      <Flame size={14} className={meta.tone} aria-hidden="true" />
                    </div>
                    <p className="text-2xl font-bold mt-1 text-[var(--text-primary)] tabular-nums">{tyres === null || tyresError ? 'N/A' : (fleetScored.summary.bands[level] || 0)}</p>
                  </Card>
                </button>
              )
            })}
          </div>

          {/* Filters */}
          <Card className="space-y-[var(--space-3)]">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                <input className="input pl-9 w-full min-h-[44px]" placeholder="Search serial, asset, brand, size, position" aria-label="Search scored tyres" value={riskSearch} onChange={(e) => setRiskSearch(e.target.value)} />
              </div>
              <select className="input min-h-[44px]" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} aria-label="Filter by risk level">
                <option value="">All risk levels</option>
                <option value="at_risk">Elevated or higher (score 30+)</option>
                {RISK_LEVELS.map((l) => <option key={l} value={l}>{RISK_META[l].label}</option>)}
              </select>
              <select className="input min-h-[44px]" value={riskSite} onChange={(e) => setRiskSite(e.target.value)} aria-label="Filter by site">
                <option value="">All sites</option>
                {riskSiteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="flex items-center gap-2 justify-end">
                <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{riskFiltered.length.toLocaleString()} of {fleetScored.rows.length.toLocaleString()}</span>
                {(riskLevel || riskSite || riskSearch) && (
                  <button type="button" onClick={() => { setRiskLevel(''); setRiskSite(''); setRiskSearch('') }} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]"><X size={14} aria-hidden="true" /> Clear</button>
                )}
              </div>
            </div>
          </Card>

          <EnterpriseTable
            columns={riskColumns}
            data={riskFiltered}
            getRowId={(r, i) => String(r.id ?? `${r.asset_no}-${r.position}-${r.serial}-${i}`)}
            loading={tyres === null || tyresLoading}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage={fleetScored.rows.length === 0
              ? 'No installed tyres to assess. Import or fit tyres to populate this view.'
              : 'No tyre matches these filters.'}
            emptyIcon={<ShieldCheck size={26} className="text-emerald-300" aria-hidden="true" />}
          />
        </div>
      )}

      {/* ═══════════════ PRESSURE CALCULATOR ═══════════════ */}
      {tab === 'calculator' && (
        <div className="max-w-2xl space-y-5">
          <Card>
            <CardHeader level={2} icon={Calculator} title="Gay-Lussac heat pressure calculator" />
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Projects hot tyre pressure from a cold inflation figure using P₁/T₁ = P₂/T₂, at {conditions.city}’s {conditions.month} ambient of {conditions.ambient_c}°C.
            </p>
            <div className="max-w-xs">
              <label className="label" htmlFor="cold-psi">Cold inflation pressure (PSI)</label>
              <input id="cold-psi" className="input w-full" type="number" step="1" min="0" value={coldPsi} onChange={(e) => setColdPsi(e.target.value)} />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Inflation temperature assumed 25°C (cold).</p>
            </div>
          </Card>

          <Card>
            <CardHeader level={2} title={`Expected pressure by time of day: ${conditions.city}, ${conditions.month}`} />
            {!(Number(coldPsi) > 0) ? (
              <p className="text-sm text-[var(--text-muted)]">Enter a cold inflation pressure above to project hot pressures.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {calcPoints.map((c) => {
                    const cold = Number(coldPsi)
                    const tone = c.expected_hot_pressure_psi > cold * 1.2 ? 'text-red-400'
                      : c.expected_hot_pressure_psi > cold * 1.1 ? 'text-orange-400' : 'text-emerald-300'
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
                    <p className="text-sm text-red-300">
                      <strong>At {conditions.road_surface_c}°C road surface, pressure rises to {calcPoints[calcPoints.length - 1].expected_hot_pressure_psi} PSI.</strong>{' '}
                      NEVER release pressure from hot tyres.
                    </p>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {/* ═══════════════ DESERT ROUTES ═══════════════ */}
      {tab === 'routes' && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">GCC desert corridors enriched with today’s {conditions.month} ambient/road temperatures and risk-appropriate pre-trip checks.</p>
          {routes.map((route) => {
            const meta = RISK_META[route.risk] || SEVERITY_META[route.risk] || RISK_META.medium
            const badge = RISK_META[route.risk]?.badge || 'bg-sky-900/30 text-sky-300 border-sky-700/50'
            return (
              <Card key={route.name} pad="tight" tone={RISK_CARD_TONE[route.risk] || 'default'}>
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
                        <p key={check} className="text-xs text-[var(--text-secondary)] flex gap-1.5"><span className="text-sky-300 shrink-0">•</span>{check}</p>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-[var(--text-muted)]">Desert exposure</p>
                    <p className={`text-xl font-bold ${meta.tone || 'text-[var(--text-primary)]'}`}>{Math.round(route.desert_exposure * 100)}%</p>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* ═══════════════ TEMPERATURE LOG (existing manual logger) ═══════════════ */}
      {tab === 'log' && (
        <div className="space-y-6">
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => runExport(() => exportToExcel(exportRows, READING_EXPORT_COLS, READING_EXPORT_HEADERS, reportFileName('TyrePulse Heat Intelligence Log')))} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button type="button" onClick={() => runExport(() => exportToPdf(exportRows, READING_EXPORT_COLS.map((k, i) => ({ key: k, header: READING_EXPORT_HEADERS[i] })), 'Heat Intelligence temperature log', reportFileName('TyrePulse Heat Intelligence Log'), 'landscape'))} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Log reading
            </button>
          </div>

          {notProvisioned && (
            <Card tone="warn" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
              <AlertTriangle size={18} className="text-amber-300 mt-0.5 shrink-0" />
              <div>
                <p className="text-amber-300 font-medium">The manual temperature logger isn’t enabled on this database yet.</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">
                  Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V188_TYRE_TEMPERATURE_READINGS.sql</span>, then reload. Conditions, blowout risk, calculator and routes work without it.
                </p>
              </div>
            </Card>
          )}

          {error && (
            <Card tone="crit" className="items-start gap-[var(--space-3)]" style={{ flexDirection: 'row' }}>
              <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
              <div><p className="text-red-300 font-medium">Couldn’t load temperature readings.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
            </Card>
          )}

          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-[var(--gap-grid)]">
            {kpis.map((k) => {
              const Icon = k.icon
              return (
                <Card key={k.label} pad="tight">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                    <Icon size={16} className={k.tone} />
                  </div>
                  <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{rows === null ? 'N/A' : k.value}</p>
                </Card>
              )
            })}
          </div>

          {/* Hotspots attention panel */}
          <Card>
            <CardHeader level={2} icon={ShieldAlert} title="Thermal hotspots" description="High and critical readings, hottest first." />
            {rows === null ? (
              <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
            ) : hot.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] flex items-center gap-2">
                <Thermometer size={15} className="text-emerald-300" /> No tyres reading high or critical. Fleet is within safe thermal limits.
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
                        <span className="text-xs font-semibold">{h.asset_no || 'N/A'}</span>
                        {h.tyre_position && <span className="text-[11px] opacity-80">· {h.tyre_position}</span>}
                      </div>
                      <p className="text-lg font-bold leading-tight mt-0.5">{fmtC(h.temperature_c)}</p>
                    </div>
                  )
                })}
                {hot.length > 24 && <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 flex items-center text-xs text-[var(--text-muted)]">+{hot.length - 24} more</div>}
              </div>
            )}
          </Card>

          {/* Latest-per-position snapshot */}
          <section className="space-y-2" aria-labelledby="heat-latest">
            <h3 id="heat-latest" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 px-1">
              <Thermometer size={15} aria-hidden="true" /> Latest reading per tyre position
            </h3>
            <EnterpriseTable
              columns={latestColumns}
              data={latestRows}
              getRowId={(r, i) => String(r.id ?? i)}
              loading={rows === null}
              enableColumnFilters={false}
              searchPlaceholder="Search asset or position"
              exportFileName={reportFileName('TyrePulse Latest Tyre Temperatures')}
              reportMeta={{ title: 'Latest reading per tyre position' }}
              initialPageSize={25}
              emptyMessage="No readings logged yet."
            />
          </section>

          {/* Filters. Deliberately NOT clipped: this card hosts native selects,
              and a clipped card is what cuts a dropdown off. */}
          <Card className="space-y-[var(--space-3)]">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] gap-2 items-center">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                <input className="input pl-9 w-full min-h-[44px]" placeholder="Search asset, position, serial, location, notes" aria-label="Search readings" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input min-h-[44px]" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Filter by asset">
                <option value="">All assets</option>
                {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select className="input min-h-[44px]" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} aria-label="Filter by position">
                <option value="">All positions</option>
                {positionOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
                <option value="">All statuses</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="elevated">Elevated</option>
                <option value="normal">Normal</option>
              </select>
              <div className="flex items-center gap-2 justify-end">
                {countryOptions.length > 1 && (
                  <select className="input min-h-[44px]" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Filter by country">
                    <option value="">All countries</option>
                    {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]"><X size={14} aria-hidden="true" /> Clear</button>}
                <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{filtered.length} of {summary.totalReadings}</span>
              </div>
            </div>
            {readingsCapped && (
              <p className="text-xs text-[var(--text-muted)]">Showing the newest {READINGS_LIMIT} readings. Older readings are not loaded into this view or its exports.</p>
            )}
          </Card>

          {/* Full log */}
          <EnterpriseTable
            columns={logColumns}
            data={logRows}
            getRowId={(r, i) => String(r.id ?? i)}
            loading={rows === null}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage={(rows || []).length === 0 && !notProvisioned ? 'No readings logged yet. Log your first thermal reading.' : 'No readings match these filters.'}
            emptyIcon={<Filter size={22} className="opacity-60" aria-hidden="true" />}
          />
        </div>
      )}

      {/* Create / Edit modal.
          The submit button stays INSIDE the <form> rather than moving to the
          Modal footer: a footer-hosted button would need an explicit form="id"
          association, which is a behaviour change this migration does not make. */}
      {showModal && (
        <Modal
          open
          onClose={closeModal}
          title={editing ? 'Edit reading' : 'Log temperature reading'}
          size="md"
        >
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="heat-f1">Asset number</label>
                  <input id="heat-f1" className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="heat-f2">Tyre position (optional)</label>
                  <input id="heat-f2" className="input w-full" placeholder="e.g. FL, RRo, Drive-2" value={form.tyre_position} maxLength={60} onChange={(e) => set('tyre_position', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="heat-f3">Temperature (°C)</label>
                  <input id="heat-f3" className="input w-full" type="number" step="0.1" min="0" placeholder="95" value={form.temperature_c} onChange={(e) => set('temperature_c', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="heat-f4">Ambient (°C, optional)</label>
                  <input id="heat-f4" className="input w-full" type="number" step="0.1" min="0" placeholder="42" value={form.ambient_c} onChange={(e) => set('ambient_c', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label" htmlFor="heat-f5">Pressure (bar, optional)</label>
                  <input id="heat-f5" className="input w-full" type="number" step="0.1" min="0" placeholder="8.5" value={form.pressure_bar} onChange={(e) => set('pressure_bar', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="heat-f6">Speed (km/h, optional)</label>
                  <input id="heat-f6" className="input w-full" type="number" step="1" min="0" placeholder="80" value={form.speed_kmh} onChange={(e) => set('speed_kmh', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="heat-f7">Alarm threshold (°C, optional)</label>
                  <input id="heat-f7" className="input w-full" type="number" step="0.1" min="0" placeholder="90" value={form.threshold_c} onChange={(e) => set('threshold_c', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="heat-f8">Tyre serial (optional)</label>
                  <input id="heat-f8" className="input w-full" placeholder="e.g. DOT-3521-XT" value={form.tyre_serial} maxLength={120} onChange={(e) => set('tyre_serial', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="heat-f9">Recorded at (optional)</label>
                  <input id="heat-f9" className="input w-full" type="datetime-local" value={form.recorded_at} onChange={(e) => set('recorded_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="heat-f10">Status (optional)</label>
                  <select id="heat-f10" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
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
                  <label className="label" htmlFor="heat-f11">Location (optional)</label>
                  <input id="heat-f11" className="input w-full" placeholder="e.g. Riyadh depot, Route 40" value={form.location} maxLength={200} onChange={(e) => set('location', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="heat-f12">Notes (optional)</label>
                <textarea id="heat-f12" className="input w-full min-h-[70px] resize-y" placeholder="e.g. infrared gun reading after 4h haul; hub warm to touch" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
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
        </Modal>
      )}

      {/* Delete confirm. No form here, so the actions belong in the footer. */}
      {confirmDelete && (
        <Modal
          open
          onClose={closeDelete}
          title="Delete this reading?"
          size="sm"
          footer={
            <>
              <button onClick={closeDelete} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </>
          }
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
            <p className="text-sm text-[var(--text-muted)]">
              {confirmDelete.asset_no || 'Reading'}{confirmDelete.tyre_position ? ` · ${confirmDelete.tyre_position}` : ''} · {fmtC(confirmDelete.temperature_c)} · {fmtDateTime(confirmDelete.recorded_at)}. This can’t be undone.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
