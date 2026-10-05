/**
 * DisplayDashboard - TV Display Mode (/display).
 *
 * A read-only, auto-refreshing control-room board, rebuilt on the Command
 * Center kit to the owner's mockup: header with live clock and full-screen
 * control, five headline tiles, fleet-by-site, operations summary, live
 * alerts, live job activity, the rotation controls and the TV screens (shared
 * board links), then the rotating boards themselves. It follows the app theme
 * (light and dark from the same --cc-* tokens). Rendered OUTSIDE the normal
 * Layout chrome but inside ProtectedRoute + TenantProvider.
 *
 * Honest gaps: there is no GPS feed (gps_positions has no rows), so fleet
 * location is shown by registered site, not on a map; there is no fuel feed,
 * so fuel consumption reads "Not recorded". Tyre spend is per country currency.
 * Pure shaping lives in src/lib/displayBoard.js and src/lib/displayDashboardView.js.
 *
 * Data sources (all read-only, per-widget failure isolation):
 *   vehicle_fleet   → availability, vehicles by site
 *   tyre_records    → tyres needing attention, monthly tyre cost
 *   inspections     → today's inspections, pressure-compliance proxy
 *   alerts          → active alerts by severity + ticker
 *   import_batches  → pending approvals (approval_status = 'pending_approval')
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Truck, MapPin, Bell, ClipboardList, CircleDot, DollarSign,
  AlertTriangle, ShieldCheck, Inbox, Minimize2,
  RefreshCw, Play, Pause, Gauge as GaugeIcon,
  LayoutGrid, LogOut, Check, X as XIcon,
  Wrench, Repeat, Car, Stamp, Clock, Timer, FileCheck2,
  CalendarDays, Activity, CalendarClock, ClipboardCheck,
  Monitor, ChevronRight, Eye, Plus, ExternalLink, Info, Fuel, HeartPulse,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { safeImageSrc } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'
import { useTenant } from '../contexts/TenantContext'
import { useTheme } from '../contexts/ThemeContext'
import { severityColor, normalizeSeverity } from '../lib/severity'
import { canonSeverity, canonStatus } from '../lib/accidentVocab'
import StatTile from '../components/ui/StatTile'
import {
  computeFleetAvailability, groupVehiclesBySite, computeTyreAttention,
  computePressureCompliancePct, countTodaysInspections,
  summariseAlerts, nextBoardIndex, formatCountdown,
  computeWorkOrderBoard, computeReplacementBoard, computeAccidentBoard,
  computeApprovalsBoard, daysBetween,
} from '../lib/displayBoard'
import { loadPmDashboard } from '../lib/api/pmPrograms'
import { loadWorkshopKpis } from '../lib/api/workshopLive'
import { listReportShares, buildShareUrl } from '../lib/api/reportShares'
import { summarizePmCompliance } from '../lib/pmSchedule'
import EChart from '../components/charts/EChart'
import {
  donutOption, hBarOption, vBarOption, gaugeOption,
  tyreRiskItems, inspectionStatusItems, alertSeverityItems, countBy,
} from '../lib/displayCharts'
import { Card, CardState, Kpi, Tabs, KitTable, ViewAll, Donut, useCard } from '../components/commandCenter/kit'
import {
  tvKpis, monthSpendByCurrency, money, liveAlertRows, jobActivityRows,
  rotationRows, screenRows, themeChartOption, clockParts,
} from '../lib/displayDashboardView'
import './DisplayDashboard.css'

const REFRESH_SECS = 60
const ROTATE_SECS  = 30
const CURSOR_HIDE_MS = 5000

const BOARDS = [
  { key: 'today',        label: 'Today at a Glance' },
  { key: 'fleet',        label: 'Fleet Overview' },
  { key: 'tyre',         label: 'Tyre & Maintenance' },
  { key: 'jobcards',     label: 'Open Job Cards' },
  { key: 'workshop',     label: 'Workshop' },
  { key: 'replacements', label: 'Tyre Replacements' },
  { key: 'accidents',    label: 'Accidents' },
  { key: 'pm',           label: 'Preventive Maintenance' },
  { key: 'approvals',    label: 'Approvals Queue' },
  { key: 'alerts',       label: 'Alerts & Compliance' },
]

// Which boards are shown / rotated, persisted so a given TV keeps its selection.
const BOARD_STORE = 'tp_tv_boards'
function loadEnabledBoards() {
  try {
    const v = JSON.parse(localStorage.getItem(BOARD_STORE))
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch { /* ignore */ }
  return {}
}

const KPI_ICON = {
  vehicles: Truck, alerts: AlertTriangle, workshop: Wrench, inspections: ClipboardCheck, health: HeartPulse,
}

const SEVERITY_COLORS = {
  Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#22c55e', Info: '#38bdf8',
}
const ACC_SEV_COLOR = { Major: '#ef4444', Moderate: '#f97316', Minor: '#eab308' }

const EMPTY_SLICE = { rows: [], error: null, loaded: false }

// ── Presentational shells ─────────────────────────────────────────────────────

function Panel({ title, icon: Icon, children, className = '' }) {
  return (
    <div className={`tv-panel flex flex-col min-h-0 ${className}`}>
      <div className="tv-panel-head">
        {Icon && <Icon size={16} aria-hidden="true" />}
        <h3>{title}</h3>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}

function WidgetError({ label = 'Could not load this data', message }) {
  return (
    <div className="tv-widget-error" role="alert">
      <AlertTriangle size={24} aria-hidden="true" />
      <p className="tv-strong">{message || label}</p>
      <p className="tv-muted">Retries automatically on the next refresh.</p>
    </div>
  )
}

function WidgetSkeleton({ lines = 3 }) {
  return (
    <div className="h-full min-h-[120px] animate-pulse space-y-3 py-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="cc-skel" style={{ height: 24, width: `${85 - i * 15}%` }} />
      ))}
    </div>
  )
}

/** Per-slice guard: skeleton while loading, error tile on failure, else render. */
function SliceGuard({ slice, children, lines }) {
  if (!slice.loaded && !slice.error) return <WidgetSkeleton lines={lines} />
  if (slice.error) return <WidgetError message={slice.error} />
  return children
}

function BigStat({ label, value, sub, color, icon: Icon }) {
  return (
    <div className="tv-panel tv-bigstat">
      <div className="min-w-0">
        <p className="tv-bigstat-label">{label}</p>
        <p className="tv-bigstat-val" style={color ? { color } : undefined}>{value}</p>
        {sub && <p className="tv-muted">{sub}</p>}
      </div>
      {Icon && <Icon size={24} className="tv-bigstat-icon" aria-hidden="true" />}
    </div>
  )
}

// Full-height honest empty state for a board list panel.
function BoardEmpty({ icon: Icon = ShieldCheck, label }) {
  return (
    <div className="tv-board-empty">
      <Icon size={36} aria-hidden="true" />
      <p>{label}</p>
    </div>
  )
}

// Severity / priority pill coloured via the canonical severity ladder.
function SevPill({ value, label }) {
  const text = label ?? (value || 'N/A')
  const norm = normalizeSeverity(value, null)
  const color = norm ? severityColor(norm) : '#64748b'
  return (
    <span
      className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-md flex-shrink-0"
      style={{ color, backgroundColor: `${color}1f` }}
    >
      {text}
    </span>
  )
}

// Neutral status chip (non-severity vocab such as work-order / accident status).
function StatusChip({ value }) {
  if (!value) return null
  return (
    <span className="cc-pill muted flex-shrink-0">{value}</span>
  )
}

// Compact "N days ago" label for TV distance reading. Null-safe.
function agoLabel(when, ref) {
  const d = daysBetween(when, ref)
  if (d == null) return ''
  if (d === 0) return 'today'
  if (d === 1) return '1 day'
  return `${d} days`
}

// Human due phrase for a PM plan (date axis first, meter axis as fallback).
// Null-safe: returns 'Due date not set' when neither axis has a signal.
function pmDueLabel(item) {
  const d = item?.daysToDue
  if (d != null) {
    if (d < 0) return `${Math.abs(d)} days overdue`
    if (d === 0) return 'Due today'
    if (d === 1) return 'Due in 1 day'
    return `Due in ${d} days`
  }
  const m = item?.meterRemaining
  const unit = item?.unit || ''
  if (m != null && Number.isFinite(m)) {
    if (m < 0) return `${Math.abs(Math.round(m))} ${unit} overdue`
    return `${Math.round(m)} ${unit} to service`
  }
  return 'Due date not set'
}


// ── Main component ────────────────────────────────────────────────────────────

export default function DisplayDashboard() {
  const { branding, orgName } = useTenant()
  const navigate = useNavigate()

  // Per-dataset slices so one failing query never blanks the board.
  const [fleet,        setFleet]        = useState(EMPTY_SLICE)
  const [tyres,        setTyres]        = useState(EMPTY_SLICE)
  const [monthTyres,   setMonthTyres]   = useState(EMPTY_SLICE)
  const [inspections,  setInspections]  = useState(EMPTY_SLICE)
  const [alerts,       setAlerts]       = useState(EMPTY_SLICE)
  const [pending,      setPending]      = useState(EMPTY_SLICE)
  const [workOrders,   setWorkOrders]   = useState(EMPTY_SLICE)
  const [replacements, setReplacements] = useState(EMPTY_SLICE)
  const [incidents,    setIncidents]    = useState(EMPTY_SLICE)
  const [approvals,    setApprovals]    = useState(EMPTY_SLICE)
  // Workshop slice carries the engine-computed KPI bundle (kpis + job-status
  // distribution + hasData), PII-free, from loadWorkshopKpis.
  const [workshop,     setWorkshop]     = useState(EMPTY_SLICE)
  // PM slice carries a bundle (plans + per-asset meter maps) rather than a flat
  // row array, so date AND meter due bands can be resolved on the board.
  const [pm,           setPm]           = useState({ rows: { plans: [], kmByAsset: {}, hoursByAsset: {} }, error: null, loaded: false })

  const [now,          setNow]          = useState(() => new Date())
  const [countdown,    setCountdown]    = useState(REFRESH_SECS)
  const [refreshing,   setRefreshing]   = useState(false)
  const [lastUpdated,  setLastUpdated]  = useState(null)

  const [boardIndex,   setBoardIndex]   = useState(0)
  const [autoRotate,   setAutoRotate]   = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [cursorHidden, setCursorHidden] = useState(false)
  const [enabledBoards, setEnabledBoards] = useState(loadEnabledBoards)
  const [showPicker,   setShowPicker]   = useState(false)
  const pickerRef = useRef(null)

  // Close the board picker on an outside press or Escape. A document listener
  // replaces the old invisible full-screen click catcher, which also swallowed
  // the first click on anything behind it.
  useEffect(() => {
    if (!showPicker) return undefined
    const onDown = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setShowPicker(false) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showPicker])

  // Boards the operator has chosen to show (missing key = on). Never empty:
  // if everything is toggled off we fall back to the full set.
  const visibleBoards = useMemo(() => {
    const vis = BOARDS.filter(b => enabledBoards[b.key] !== false)
    return vis.length ? vis : BOARDS
  }, [enabledBoards])

  // Keep the active index in range as the visible set changes.
  const safeIndex = Math.min(boardIndex, visibleBoards.length - 1)
  useEffect(() => {
    if (boardIndex > visibleBoards.length - 1) setBoardIndex(0)
  }, [visibleBoards.length, boardIndex])

  const toggleBoard = useCallback((key) => {
    setEnabledBoards(prev => {
      const next = { ...prev, [key]: prev[key] === false }
      // Guarantee at least one board stays enabled.
      if (!BOARDS.some(b => next[b.key] !== false)) return prev
      try { localStorage.setItem(BOARD_STORE, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const rootRef        = useRef(null)
  const cursorTimerRef = useRef(null)
  const loadingRef     = useRef(false)

  // ── Data load (per-slice isolation via allSettled) ─────────────────────────
  const load = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setRefreshing(true)

    const monthStart = new Date()
    monthStart.setDate(1)
    const monthStartStr = monthStart.toISOString().slice(0, 10)
    const windowStart = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)

    const tasks = [
      {
        set: setFleet,
        run: async () => {
          // Page past the 1000-row cap: feeds the fleet availability gauge total
          // and vehicles-by-site, which under-report on a fleet over 1000 rows.
          const { data, error } = await fetchAllPages((from, to) => supabase
            .from('vehicle_fleet')
            .select('asset_no,site,status,vehicle_type')
            .range(from, to), { max: 20000 })
          if (error) throw error
          return data ?? []
        },
      },
      {
        set: setTyres,
        run: async () => {
          const { data, error } = await fetchAllPages((from, to) => supabase
            .from('tyre_records')
            .select('asset_no,risk_level,site')
            .is('removal_date', null)
            .range(from, to))
          if (error) throw error
          return data ?? []
        },
      },
      {
        set: setMonthTyres,
        run: async () => {
          const { data, error } = await fetchAllPages((from, to) => supabase
            .from('tyre_records')
            .select('cost_per_tyre,qty,issue_date,country')
            .gte('issue_date', monthStartStr)
            .range(from, to))
          if (error) throw error
          return data ?? []
        },
      },
      {
        set: setInspections,
        run: async () => {
          const { data, error } = await fetchAllPages((from, to) => supabase
            .from('inspections')
            // tyre_conditions carries the recorded pressure_psi per position -
            // pressure compliance is measured from it, not from findings text.
            .select('asset_no,scheduled_date,status,findings,site,tyre_conditions')
            .gte('scheduled_date', windowStart)
            .order('scheduled_date', { ascending: false })
            .range(from, to), { max: 5000 })
          if (error) throw error
          return data ?? []
        },
      },
      {
        set: setAlerts,
        run: async () => {
          const { data, error } = await supabase
            .from('alerts')
            .select('severity,message,asset_no,created_at,is_active')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(500)
          if (error) throw error
          return data ?? []
        },
      },
      {
        set: setPending,
        run: async () => {
          const { data, error } = await supabase
            .from('import_batches')
            .select('id,module,total_rows,created_at')
            .eq('approval_status', 'pending_approval')
            .order('created_at', { ascending: false })
            .limit(200)
          if (error) throw error
          return data ?? []
        },
      },
      {
        set: setWorkOrders,
        run: async () => {
          const { data, error } = await fetchAllPages((from, to) => supabase
            .from('work_orders')
            .select('id,work_order_no,asset_no,status,priority,work_type,technician_name,site,opened_at,target_completion')
            .not('status', 'in', '("Completed","Closed","Cancelled")')
            .order('opened_at', { ascending: false })
            .range(from, to), { max: 5000 })
          if (error) throw error
          return data ?? []
        },
      },
      {
        set: setReplacements,
        run: async () => {
          const { data, error } = await fetchAllPages((from, to) => supabase
            .from('tyre_changes')
            .select('asset_no,tyre_serial,brand,position,removal_reason,removal_date,site,category')
            .not('removal_date', 'is', null)
            .gte('removal_date', windowStart)
            .order('removal_date', { ascending: false })
            .range(from, to), { max: 5000 })
          if (error) throw error
          return data ?? []
        },
      },
      {
        set: setIncidents,
        run: async () => {
          const { data, error } = await fetchAllPages((from, to) => supabase
            .from('accidents')
            .select('id,asset_no,site,incident_date,severity,status,accident_type,driver_name')
            .gte('incident_date', windowStart)
            .order('incident_date', { ascending: false })
            .range(from, to), { max: 5000 })
          if (error) throw error
          return data ?? []
        },
      },
      {
        set: setApprovals,
        run: async () => {
          // Aggregate every pending-approval surface into one unified list. Each
          // source is independently guarded so a missing relation degrades to an
          // honest zero for that kind rather than blanking the board.
          const items = []
          const safe = async (fn) => { try { await fn() } catch { /* honest skip */ } }

          await safe(async () => {
            const { data } = await supabase
              .from('workflow_instances')
              .select('id,entity_type,entity_label,step_started_at,started_at')
              .eq('status', 'pending')
              .order('started_at', { ascending: false })
              .limit(200)
            for (const w of data ?? []) items.push({
              kind: 'Workflow', label: w.entity_label || w.entity_type || 'Approval',
              sub: w.entity_type || '', when: w.step_started_at || w.started_at,
            })
          })
          await safe(async () => {
            const { data } = await supabase
              .from('accidents')
              .select('id,asset_no,site,severity,close_requested_at')
              .eq('closure_status', 'pending_closure')
              .order('close_requested_at', { ascending: true, nullsFirst: false })
              .limit(200)
            for (const a of data ?? []) items.push({
              kind: 'Accident closure', label: a.asset_no || 'Incident',
              sub: a.site || '', when: a.close_requested_at, severity: a.severity,
            })
          })
          await safe(async () => {
            const { data } = await supabase
              .from('checklist_submissions')
              .select('id,title,template_name,asset_no,site,submitted_at')
              .eq('approval_status', 'pending')
              .order('submitted_at', { ascending: true })
              .limit(200)
            for (const c of data ?? []) items.push({
              kind: 'Checklist', label: c.title || c.template_name || 'Checklist',
              sub: c.asset_no || c.site || '', when: c.submitted_at,
            })
          })
          await safe(async () => {
            const { data } = await supabase
              .from('import_batches')
              .select('id,module,total_rows,created_at')
              .eq('approval_status', 'pending_approval')
              .order('created_at', { ascending: false })
              .limit(200)
            for (const b of data ?? []) items.push({
              kind: 'Data import', label: b.module || 'Import',
              sub: `${(b.total_rows ?? 0).toLocaleString()} rows`, when: b.created_at,
            })
          })
          return items
        },
      },
      {
        set: setPm,
        run: async () => {
          // Active PM plans + per-asset meter readings. loadPmDashboard returns
          // an empty bundle (never throws) when pm_programs is unprovisioned, so
          // the board honestly shows the empty state rather than an error tile.
          const bundle = await loadPmDashboard({})
          const plans = (bundle?.plans ?? []).filter(p => p?.status === 'active')
          return {
            plans,
            kmByAsset: bundle?.kmByAsset ?? {},
            hoursByAsset: bundle?.hoursByAsset ?? {},
          }
        },
      },
      {
        set: setWorkshop,
        run: async () => {
          // Live workshop KPIs (technician status + job-card health) straight
          // from the shared workshopLive engine. PII-free aggregates only; never
          // throws (degrades to zeros / hasData false for an honest empty board).
          return await loadWorkshopKpis({})
        },
      },
    ]

    await Promise.allSettled(tasks.map(async t => {
      try {
        const rows = await t.run()
        t.set({ rows, error: null, loaded: true })
      } catch (e) {
        // Keep last good rows on transient failure; surface the error state.
        t.set(prev => ({ ...prev, error: toUserMessage(e, 'Query failed'), loaded: true }))
      }
    }))

    setLastUpdated(new Date())
    setCountdown(REFRESH_SECS)
    setRefreshing(false)
    loadingRef.current = false
  }, [])

  useEffect(() => { load() }, [load])

  // ── 1s master tick: clock + refresh countdown ──────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date())
      setCountdown(c => Math.max(0, c - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // Refresh when the countdown reaches zero (load() resets it to REFRESH_SECS).
  useEffect(() => {
    if (countdown === 0) load()
  }, [countdown, load])

  // ── Board auto-rotation ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!autoRotate || visibleBoards.length < 2) return undefined
    const id = setInterval(
      () => setBoardIndex(i => nextBoardIndex(i, visibleBoards.length)),
      ROTATE_SECS * 1000,
    )
    return () => clearInterval(id)
  }, [autoRotate, visibleBoards.length])

  // ── Fullscreen ──────────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
    } else {
      rootRef.current?.requestFullscreen?.()
    }
  }, [])

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // ── Hide cursor after inactivity ───────────────────────────────────────────
  useEffect(() => {
    const wake = () => {
      setCursorHidden(false)
      clearTimeout(cursorTimerRef.current)
      cursorTimerRef.current = setTimeout(() => setCursorHidden(true), CURSOR_HIDE_MS)
    }
    wake()
    window.addEventListener('mousemove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(cursorTimerRef.current)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  // ── Derived widget data (pure helpers, unit-tested) ────────────────────────
  const todayStr     = now.toISOString().slice(0, 10)
  const availability = useMemo(() => computeFleetAvailability(fleet.rows), [fleet.rows])
  const siteGroups   = useMemo(() => groupVehiclesBySite(fleet.rows), [fleet.rows])
  const attention    = useMemo(() => computeTyreAttention(tyres.rows), [tyres.rows])
  // Depend on the day (not the ticking clock) so this doesn't recompute every second.
  // Per-currency month spend: SAR, AED and EGP are never added together.
  const spend        = useMemo(
    () => monthSpendByCurrency(monthTyres.rows, new Date(`${todayStr}T12:00:00`)),
    [monthTyres.rows, todayStr],
  )
  const compliance   = useMemo(() => computePressureCompliancePct(inspections.rows), [inspections.rows])
  const todayInsp    = useMemo(() => countTodaysInspections(inspections.rows, todayStr), [inspections.rows, todayStr])
  const alertSummary = useMemo(() => summariseAlerts(alerts.rows), [alerts.rows])
  const dayRef       = useMemo(() => new Date(`${todayStr}T12:00:00`), [todayStr])
  const woBoard      = useMemo(() => computeWorkOrderBoard(workOrders.rows, dayRef), [workOrders.rows, dayRef])
  const replBoard    = useMemo(() => computeReplacementBoard(replacements.rows, dayRef), [replacements.rows, dayRef])
  const accBoard     = useMemo(() => computeAccidentBoard(incidents.rows, dayRef), [incidents.rows, dayRef])
  const apprBoard    = useMemo(() => computeApprovalsBoard(approvals.rows), [approvals.rows])
  const pmSummary    = useMemo(
    () => summarizePmCompliance(pm.rows.plans, {
      now: dayRef, kmByAsset: pm.rows.kmByAsset, hoursByAsset: pm.rows.hoursByAsset,
    }),
    [pm.rows, dayRef],
  )

  // ── Workshop board (engine-computed KPIs, PII-free). workshop.rows is the
  //    loadWorkshopKpis bundle once loaded; the initial EMPTY_SLICE array yields
  //    null kpis so guards below fall back to an honest empty state.
  const wsKpis     = workshop.rows?.kpis || null
  const wsHasData  = workshop.rows?.hasData === true
  const wsTechItems = useMemo(() => {
    if (!wsKpis) return []
    return [
      { label: 'Working',          value: Number(wsKpis.working) || 0,         color: '#22c55e' },
      { label: 'Available',        value: Number(wsKpis.available) || 0,       color: '#38bdf8' },
      { label: 'Waiting Parts',    value: Number(wsKpis.waitingParts) || 0,    color: '#f97316' },
      { label: 'Waiting Approval', value: Number(wsKpis.waitingApproval) || 0, color: '#eab308' },
      { label: 'On Break',         value: Number(wsKpis.onBreak) || 0,         color: '#a78bfa' },
    ].filter((x) => x.value > 0)
  }, [wsKpis])
  const wsJobStatusItems = useMemo(() => (workshop.rows?.jobsByStatus || []).slice(0, 7), [workshop.rows])

  // ── Chart data (ECharts) derived from the same slices, so a wall display gets
  //    a report-grade visual view alongside the number tiles. All honest: empty
  //    arrays yield an empty state, never a fabricated chart.
  const accSeverityItems = useMemo(() => (
    countBy(incidents.rows, (a) => canonSeverity(a.severity) || 'Unclassified')
      .map((it) => ({ ...it, color: ACC_SEV_COLOR[it.label] || '#64748b' }))
  ), [incidents.rows])
  const accSiteItems = useMemo(
    () => countBy(incidents.rows, (a) => a.site, { top: 7, fallback: 'No site' }),
    [incidents.rows],
  )
  const siteChartItems = useMemo(
    () => (siteGroups || []).map((s) => ({ label: s.site, value: s.count })),
    [siteGroups],
  )
  const tyreRisk = useMemo(() => tyreRiskItems(attention), [attention])
  const inspStatus = useMemo(() => inspectionStatusItems(todayInsp), [todayInsp])
  const alertSevItems = useMemo(() => alertSeverityItems(alertSummary.bySeverity), [alertSummary.bySeverity])

  // ── "Today" live executive tiles (honest date-scoped counts from the same
  //    slices the other boards use, so they share the board's auto-refresh). All
  //    date comparisons mirror countTodaysInspections: slice(0,10) === todayStr.
  const isToday = useCallback((v) => !!v && String(v).slice(0, 10) === todayStr, [todayStr])

  // Open job cards opened today + live status split. The work_orders slice is
  // already filtered to non-terminal (open) statuses, so this is an honest
  // "open job cards raised today" figure.
  const jobCardsToday = useMemo(() => {
    const rows = workOrders.rows.filter(o => isToday(o.opened_at))
    const byStatus = { 'Open': 0, 'In Progress': 0, 'Awaiting Parts': 0 }
    rows.forEach(o => { if (byStatus[o.status] != null) byStatus[o.status] += 1 })
    return { total: rows.length, byStatus }
  }, [workOrders.rows, isToday])

  // Tyres replaced today (tyre_changes rows carrying a removal_date of today).
  const tyresReplacedToday = useMemo(
    () => replacements.rows.filter(c => isToday(c.removal_date)).length,
    [replacements.rows, isToday],
  )

  // Accidents / incidents reported today.
  const accidentsToday = useMemo(
    () => incidents.rows.filter(a => isToday(a.incident_date)).length,
    [incidents.rows, isToday],
  )

  const board = visibleBoards[safeIndex] ?? BOARDS[0]

  // ── Shell (mockup header, KPI tiles, overview cards) ──────────────────────
  const { resolvedTheme } = useTheme()
  const light = resolvedTheme === 'light'
  // displayCharts builds dark options; re-ink them for the light theme.
  const tc = useCallback((option) => themeChartOption(option, light), [light])
  const clock = useMemo(() => ({
    ...clockParts(now),
    month: now.toLocaleDateString('en-GB', { month: 'long' }),
  }), [now])
  const logoSrc = safeImageSrc(branding?.logo_url)

  const kpiTiles = useMemo(() => {
    const ready = {
      fleet: fleet.loaded && !fleet.error,
      alerts: alerts.loaded && !alerts.error,
      workOrders: workOrders.loaded && !workOrders.error,
      inspections: inspections.loaded && !inspections.error,
    }
    const pendingOf = { vehicles: fleet, alerts, workshop: workOrders, inspections, health: fleet }
    return tvKpis({ availability, alertSummary, woBoard, todayInsp, ready }).map((t) => ({
      ...t,
      loading: !pendingOf[t.key].loaded && !pendingOf[t.key].error,
    }))
  }, [fleet, alerts, workOrders, inspections, availability, alertSummary, woBoard, todayInsp])

  const siteSegments = useMemo(() => {
    const palette = ['var(--cc-green)', 'var(--cc-blue)', 'var(--cc-amber)', 'var(--cc-purple)', 'var(--cc-orange)', 'var(--cc-red)']
    const top = groupVehiclesBySite(fleet.rows, 6)
    const shown = top.reduce((t, x) => t + x.count, 0)
    const rest = fleet.rows.length - shown
    const segs = top.map((x, i) => ({ label: x.site, count: x.count, color: palette[i % palette.length] }))
    if (rest > 0) segs.push({ label: 'Other sites', count: rest, color: 'var(--cc-ink-3)' })
    return segs
  }, [fleet.rows])

  const statusLegend = useMemo(() => {
    const active = availability.available
    return [
      { label: 'In service', count: active, color: 'var(--cc-green)' },
      { label: 'Not in service', count: Math.max(0, availability.total - active), color: 'var(--cc-ink-3)' },
      { label: 'Open job cards', count: woBoard.total, color: 'var(--cc-blue)' },
      { label: 'Inspections today', count: todayInsp.total, color: 'var(--cc-amber)' },
    ]
  }, [availability, woBoard.total, todayInsp.total])

  const alertRows = useMemo(() => liveAlertRows(alerts.rows, now, 6), [alerts.rows, now])
  const jobRows   = useMemo(() => jobActivityRows(woBoard.list, dayRef, 8), [woBoard.list, dayRef])
  const rotation  = useMemo(
    () => rotationRows(BOARDS, enabledBoards, { rotateSecs: ROTATE_SECS, activeKey: board.key, autoRotate }),
    [enabledBoards, board.key, autoRotate],
  )
  const showBoard = useCallback((key) => {
    const idx = visibleBoards.findIndex((b) => b.key === key)
    if (idx >= 0) setBoardIndex(idx)
  }, [visibleBoards])

  // TV screens = this org's active shared board links (report_shares).
  const screens = useCard(() => listReportShares(), [])
  const screenList = useMemo(() => screenRows(screens.data || [], dayRef).slice(0, 5), [screens.data, dayRef])

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      ref={rootRef}
      className={`cc tv-page tv-display ${isFullscreen ? 'is-fullscreen' : ''}`}
      style={{ cursor: cursorHidden ? 'none' : 'default' }}
    >
      {/* ── Header: breadcrumb, title, live badge | clock and controls ── */}
      <header className="tv-head">
        <div className="tv-head-copy">
          <nav aria-label="Breadcrumb" className="tv-crumb">
            Analytics &amp; Reports <ChevronRight size={13} aria-hidden="true" /> <span aria-current="page">TV Display Mode</span>
          </nav>
          <div className="tv-title-row">
            {logoSrc && (
              <img src={logoSrc} alt="" className="tv-logo" onError={e => { e.currentTarget.style.display = 'none' }} />
            )}
            <h1>TV Display Mode</h1>
            <span className="cc-pill good tv-live">
              <i className={`tv-dot ${refreshing ? 'is-busy' : ''}`} aria-hidden="true" /> Live
            </span>
          </div>
          <p>
            Control-room display{orgName ? ` for ${orgName}` : ''} with auto-rotating boards, large-format KPIs,
            live alerts and a refresh every {REFRESH_SECS} seconds.
          </p>
        </div>

        <div className="tv-head-actions">
          <div className="cc-card tv-clock" aria-live="off">
            <CalendarDays size={18} aria-hidden="true" />
            <div><b>{clock.date}</b><span>{clock.time}</span></div>
          </div>
          <div className="tv-refresh" title="Time to next automatic refresh">
            <span><RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" /> {formatCountdown(countdown)}</span>
            <small>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Loading...'}</small>
          </div>
          <button type="button" className="cc-icon-btn" onClick={() => load()} disabled={refreshing}
            aria-label="Refresh now" title="Refresh now">
            <RefreshCw size={15} />
          </button>
          <div className="tv-picker-wrap" ref={pickerRef}>
            <button type="button" className={`cc-icon-btn ${showPicker ? 'is-on' : ''}`}
              onClick={() => setShowPicker(v => !v)} title="Choose boards to display"
              aria-label="Choose boards to display" aria-haspopup="true" aria-expanded={showPicker}>
              <LayoutGrid size={15} />
            </button>
            {showPicker && (
              <div className="cc-card tv-picker">
                <div className="tv-picker-head">
                  <b>Displayed boards</b>
                  <button type="button" className="cc-icon-btn" onClick={() => setShowPicker(false)} aria-label="Close"><XIcon size={13} /></button>
                </div>
                {BOARDS.map(b => {
                  const on = enabledBoards[b.key] !== false
                  return (
                    <button key={b.key} type="button" className="tv-picker-row" onClick={() => toggleBoard(b.key)} aria-pressed={on}>
                      <span>{b.label}</span>
                      <span className={`tv-check ${on ? 'is-on' : ''}`}>{on && <Check size={12} />}</span>
                    </button>
                  )
                })}
                <p className="tv-muted">At least one board stays on.</p>
              </div>
            )}
          </div>
          <button type="button" className={`cc-icon-btn ${autoRotate ? 'is-on' : ''}`} onClick={() => setAutoRotate(v => !v)}
            title={autoRotate ? 'Pause board rotation' : 'Resume board rotation'}
            aria-label={autoRotate ? 'Pause board rotation' : 'Resume board rotation'}>
            {autoRotate ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button type="button" className="cc-btn-ghost"
            onClick={() => { if (document.fullscreenElement) document.exitFullscreen?.(); navigate('/') }}
            title="Exit TV display">
            <LogOut size={15} aria-hidden="true" /> Exit
          </button>
          <button type="button" className="cc-btn-primary tv-fs-btn" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Monitor size={16} aria-hidden="true" />}
            {isFullscreen ? 'Exit Full Screen' : 'Enter Full Screen'}
          </button>
        </div>
      </header>

      {/* ── Headline KPI tiles ── */}
      <div className="cc-kpis tv-kpis">
        {kpiTiles.map((x) => (
          <Kpi
            key={x.key}
            icon={KPI_ICON[x.key]}
            tone={`t-${x.tone}`}
            value={x.value}
            display={x.display ?? (x.value == null && !x.loading ? 'N/A' : undefined)}
            loading={x.loading}
            danger={x.danger}
            to={x.to}
            label={<>{x.label}<span className="tv-kpi-sub">{x.sub}</span></>}
          />
        ))}
      </div>

      {/* ── Fleet by site + operations summary + live alerts ── */}
      <div className="tv-grid-top">
        <Card
          className="tv-map"
          title="Fleet by Site"
          sub="No live GPS positions are recorded, so vehicles are placed by their registered site."
          action={<ViewAll to="/fleet-master" label="Open fleet" />}
        >
          <CardState
            state={{ loading: !fleet.loaded && !fleet.error, data: fleet.loaded ? fleet.rows : null, error: fleet.error, retry: load }}
            empty={fleet.loaded && !fleet.error && !fleet.rows.length ? 'No vehicles are registered yet. Add assets in Fleet Master.' : null}
          >
            <div className="tv-map-body">
              <div className="tv-status-legend">
                {statusLegend.map((s) => (
                  <span key={s.label}><i style={{ background: s.color }} aria-hidden="true" />{s.label} ({s.count.toLocaleString('en-US')})</span>
                ))}
              </div>
              <Donut
                segments={siteSegments}
                total={availability.total}
                centerLabel="vehicles"
              />
            </div>
          </CardState>
        </Card>

        <Card className="tv-ops" title="Operations Summary" sub={`This month and live, refreshed every ${REFRESH_SECS} seconds`}>
          <div className="tv-ops-grid">
            <div className="tv-ops-tile">
              <span className="cc-kpi-icon t-blue"><DollarSign size={19} aria-hidden="true" /></span>
              <div>
                <span className="tv-ops-label">Tyre Spend ({clock.month})</span>
                {!monthTyres.loaded && !monthTyres.error ? <b className="tv-ops-val">...</b>
                  : monthTyres.error ? <b className="tv-ops-val">N/A</b>
                  : spend.lines.length === 0 ? <b className="tv-ops-val tv-ops-none">No priced tyres yet</b>
                  : spend.lines.map((l) => <b key={l.country} className="tv-ops-val">{money(l.amount, l.currency)}</b>)}
                <small>{monthTyres.error ? 'Could not read tyre records' : 'Priced tyre records, per country currency'}</small>
              </div>
            </div>
            <div className="tv-ops-tile">
              <span className="cc-kpi-icon t-red"><Clock size={19} aria-hidden="true" /></span>
              <div>
                <span className="tv-ops-label">Delayed Jobs</span>
                <b className="tv-ops-val">{!workOrders.loaded && !workOrders.error ? '...' : workOrders.error ? 'N/A' : woBoard.overdue.toLocaleString('en-US')}</b>
                <small>Open job cards past their target date</small>
              </div>
            </div>
            <div className="tv-ops-tile">
              <span className="cc-kpi-icon t-orange"><Repeat size={19} aria-hidden="true" /></span>
              <div>
                <span className="tv-ops-label">Tyre Replacements</span>
                <b className="tv-ops-val">{!replacements.loaded && !replacements.error ? '...' : replacements.error ? 'N/A' : replBoard.recent.toLocaleString('en-US')}</b>
                <small>Tyres removed in the last {replBoard.windowDays} days</small>
              </div>
            </div>
            <div className="tv-ops-tile">
              <span className="cc-kpi-icon t-purple"><Fuel size={19} aria-hidden="true" /></span>
              <div>
                <span className="tv-ops-label">Fuel Consumption</span>
                <b className="tv-ops-val tv-ops-none">Not recorded</b>
                <small>No fuel transactions are recorded yet</small>
              </div>
            </div>
          </div>
        </Card>

        <Card className="tv-alerts" title="Live Alerts" action={<ViewAll to="/alerts" />}>
          <CardState
            state={{ loading: !alerts.loaded && !alerts.error, data: alerts.loaded ? alerts.rows : null, error: alerts.error, retry: load }}
            empty={alerts.loaded && !alerts.error && !alertRows.length ? 'No active alerts. The fleet is clear right now.' : null}
            lines={5}
          >
            <ul className="tv-alert-list">
              {alertRows.map((a) => (
                <li key={a.id}>
                  <span className={`tv-sev tv-sev-${a.tone}`} aria-hidden="true">
                    {a.severity === 'Info' ? <Info size={13} /> : <AlertTriangle size={13} />}
                  </span>
                  <span className="tv-alert-msg" title={a.message}>{a.message}</span>
                  <span className="tv-alert-asset">{a.asset}</span>
                  <span className="tv-alert-ago">{a.ago}</span>
                  <span className={`cc-pill ${a.tone}`}>{a.severity}</span>
                </li>
              ))}
            </ul>
          </CardState>
        </Card>
      </div>

      {/* ── Job activity + rotation controls + TV screens ── */}
      <div className="tv-grid-bottom">
        <Card title="Live Vehicle / Job Activity" action={<ViewAll to="/work-orders" />}>
          <CardState
            state={{ loading: !workOrders.loaded && !workOrders.error, data: workOrders.loaded ? workOrders.rows : null, error: workOrders.error, retry: load }}
            empty={workOrders.loaded && !workOrders.error && !jobRows.length ? 'No open job cards right now.' : null}
          >
            <KitTable
              compact
              rows={jobRows}
              columns={[
                { key: 'asset', header: 'Vehicle', cell: (r) => <span className="tv-strong"><Truck size={13} aria-hidden="true" /> {r.asset}</span> },
                { key: 'type', header: 'Type' },
                { key: 'site', header: 'Location', cell: (r) => r.site || <span className="cc-na">N/A</span> },
                { key: 'status', header: 'Status', cell: (r) => <span className={`cc-pill ${r.tone}`}>{r.status}</span> },
                { key: 'opened', header: 'Opened', cell: (r) => r.opened || <span className="cc-na">N/A</span> },
              ]}
            />
          </CardState>
        </Card>

        <Card title="Display Rotation & Broadcast Controls"
          sub={autoRotate ? `Rotating every ${ROTATE_SECS} seconds` : 'Rotation paused'}>
          <KitTable
            compact
            rows={rotation}
            columns={[
              { key: 'label', header: 'View', cell: (r) => <span className="tv-strong">{r.label}</span> },
              { key: 'duration', header: 'Duration' },
              { key: 'scope', header: 'Scope' },
              { key: 'state', header: 'State', cell: (r) => <span className={`cc-pill ${r.live ? 'good' : r.on ? 'info' : 'muted'}`}>{r.state}</span> },
              {
                key: 'actions', header: 'Actions', sortable: false,
                cell: (r) => (
                  <span className="tv-row-actions">
                    <button type="button" className="cc-icon-btn" disabled={!r.on}
                      onClick={() => showBoard(r.key)} aria-label={`Show ${r.label} now`} title="Show now"><Eye size={14} /></button>
                    <button type="button" className="cc-icon-btn" onClick={() => toggleBoard(r.key)}
                      aria-label={r.on ? `Remove ${r.label} from rotation` : `Add ${r.label} to rotation`}
                      title={r.on ? 'Remove from rotation' : 'Add to rotation'}>
                      {r.on ? <XIcon size={14} /> : <Plus size={14} />}
                    </button>
                  </span>
                ),
              },
            ]}
          />
        </Card>

        <Card title="TV Wall Management" sub="Shared board links open on any screen without signing in"
          action={<button type="button" className="cc-btn" onClick={() => navigate('/report-sharing')}>Add Screen</button>}>
          <CardState
            state={screens}
            empty={screens.data && !screens.data.length ? (
              <div>No TV screens set up yet.<br />
                <button type="button" className="cc-btn" onClick={() => navigate('/report-sharing')}>Create a shared board</button>
              </div>
            ) : null}
            lines={3}
          >
            <div className="tv-screens">
              {screenList.map((s) => (
                <div key={s.id} className="tv-screen">
                  <div className="tv-screen-head">
                    <b title={s.name}>{s.name}</b>
                    <span className={`cc-pill ${s.tone}`}>{s.status}</span>
                  </div>
                  <span className="tv-muted">{s.boards} boards : {s.views.toLocaleString('en-US')} views : {s.lastViewed}</span>
                  <a className="cc-btn tv-screen-open" href={buildShareUrl(s.token)} target="_blank" rel="noopener noreferrer">
                    Open <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </div>
              ))}
              <button type="button" className="tv-screen tv-screen-add" onClick={() => navigate('/report-sharing')}>
                <Plus size={18} aria-hidden="true" />
                <b>Add TV Screen</b>
                <span className="tv-muted">Configure another display</span>
              </button>
            </div>
          </CardState>
        </Card>
      </div>

      {/* ── Rotating boards ── */}
      <section className="cc-card tv-boards" aria-label="Rotating boards">
        <div className="tv-boards-head">
          <div>
            <h2 className="cc-card-title">{board.label}</h2>
            <p className="cc-card-sub">Board {safeIndex + 1} of {visibleBoards.length}{autoRotate ? `, next in ${ROTATE_SECS} seconds or less` : ', rotation paused'}</p>
          </div>
          <Tabs
            tabs={visibleBoards.map((b) => ({ key: b.key, label: b.label }))}
            value={board.key}
            onChange={showBoard}
            label="Boards"
          />
        </div>

        <div className="tv-board-body">

        {/* ── (0) Today at a Glance — daily executive live tiles ── */}
        {board.key === 'today' && (
          <div className="grid grid-cols-12 gap-6 h-full content-start">
            {/* Primary daily counters */}
            <div className="col-span-12 grid grid-cols-2 xl:grid-cols-3 gap-6">
              {/* Open Job Cards Today — big number + live status split */}
              <SliceGuard slice={workOrders} lines={3}>
                <div className="tv-panel flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold uppercase tracking-[0.16em] text-slate-500">Open Job Cards Today</p>
                      <p className="text-6xl xl:text-7xl font-bold tabular-nums tracking-tight mt-3"
                         style={{ color: jobCardsToday.total > 0 ? '#38bdf8' : '#22c55e' }}>
                        {jobCardsToday.total}
                      </p>
                    </div>
                    <Wrench size={26} className="text-slate-600 flex-shrink-0 mt-1" />
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-5">
                    {[
                      { label: 'Open',    value: jobCardsToday.byStatus['Open'],           color: '#38bdf8' },
                      { label: 'Progress',value: jobCardsToday.byStatus['In Progress'],    color: '#eab308' },
                      { label: 'Parts',   value: jobCardsToday.byStatus['Awaiting Parts'], color: '#f97316' },
                    ].map(s => (
                      <div key={s.label} className="bg-slate-900/60 border border-slate-800/60 rounded-xl py-3 text-center">
                        <p className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mt-1">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </SliceGuard>

              {/* Tyre Replacements Today */}
              <SliceGuard slice={replacements} lines={3}>
                <BigStat label="Tyre Replacements Today" value={tyresReplacedToday}
                  color={tyresReplacedToday > 0 ? '#f97316' : '#22c55e'} icon={Repeat}
                  sub="Tyres removed / changed today" />
              </SliceGuard>

              {/* Inspections Today */}
              <SliceGuard slice={inspections} lines={3}>
                <BigStat label="Inspections Today" value={todayInsp.total} icon={ClipboardList}
                  color={todayInsp.total > 0 ? '#38bdf8' : '#22c55e'}
                  sub={`${todayInsp.done} done : ${todayInsp.pending} pending : ${todayInsp.overdue} overdue`} />
              </SliceGuard>
            </div>

            {/* Secondary daily counters */}
            <div className="col-span-12 grid grid-cols-2 xl:grid-cols-4 gap-6">
              <SliceGuard slice={incidents} lines={2}>
                <BigStat label="Accidents Today" value={accidentsToday}
                  color={accidentsToday > 0 ? '#ef4444' : '#22c55e'} icon={Car}
                  sub={accidentsToday > 0 ? 'Incidents reported today' : 'No incidents today'} />
              </SliceGuard>
              <SliceGuard slice={alerts} lines={2}>
                <BigStat label="Critical Alerts" value={alertSummary.bySeverity.Critical}
                  color={alertSummary.bySeverity.Critical > 0 ? '#ef4444' : '#22c55e'} icon={AlertTriangle}
                  sub="Active, needs attention" />
              </SliceGuard>
              <SliceGuard slice={tyres} lines={2}>
                <BigStat label="Tyres Needing Attention" value={attention.attention}
                  color={attention.attention > 0 ? '#f97316' : '#22c55e'} icon={CircleDot}
                  sub={`${attention.critical} critical : ${attention.high} high risk`} />
              </SliceGuard>
              <SliceGuard slice={fleet} lines={2}>
                <BigStat label="Fleet Availability" value={`${availability.pct}%`}
                  color={availability.pct >= 90 ? '#22c55e' : availability.pct >= 70 ? '#eab308' : '#ef4444'}
                  icon={Activity}
                  sub={`${availability.available} of ${availability.total} in service`} />
              </SliceGuard>
            </div>

            {/* Today's job cards detail list */}
            <div className="col-span-12">
              <Panel title="Job Cards Opened Today" icon={CalendarDays} className="h-full">
                <SliceGuard slice={workOrders} lines={5}>
                  {(() => {
                    const todaysList = woBoard.list.filter(o => isToday(o.opened_at))
                    if (todaysList.length === 0) return <BoardEmpty icon={Wrench} label="No job cards opened today" />
                    return (
                      <div className="space-y-2.5">
                        {todaysList.slice(0, 6).map((o) => (
                          <div key={o.id} className="flex items-center gap-4 bg-slate-900/60 border border-slate-800/60 rounded-xl px-4 py-3">
                            <SevPill value={o.priority} />
                            <div className="min-w-0 flex-1">
                              <p className="text-slate-100 text-lg font-semibold truncate">
                                {o.asset_no || 'Unassigned asset'}
                                <span className="text-slate-500 text-base font-normal ml-2">{o.work_type || 'Job'}</span>
                              </p>
                              <p className="text-slate-500 text-sm font-mono truncate">
                                {o.work_order_no || ''}{o.work_order_no && o.technician_name ? ' : ' : ''}{o.technician_name || ''}
                              </p>
                            </div>
                            <StatusChip value={o.status} />
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </SliceGuard>
              </Panel>
            </div>
          </div>
        )}

        {/* ── (a) Fleet Overview ── */}
        {board.key === 'fleet' && (
          <div className="grid grid-cols-12 gap-6 h-full">
            <div className="col-span-12 xl:col-span-4">
              <Panel title="Fleet Availability" icon={GaugeIcon} className="h-full items-stretch">
                <SliceGuard slice={fleet} lines={4}>
                  <div className="flex flex-col h-full">
                    <div className="flex-1 min-h-[200px]">
                      <EChart option={tc(gaugeOption(availability.pct, { label: 'Available' }))} ariaLabel="Fleet availability" style={{ height: '100%', width: '100%' }} />
                    </div>
                    <p className="text-slate-400 text-lg text-center">
                      <span className="text-white font-bold tabular-nums">{availability.available}</span>
                      {' of '}
                      <span className="text-white font-bold tabular-nums">{availability.total}</span>
                      {' vehicles in service'}
                    </p>
                  </div>
                </SliceGuard>
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-4 grid grid-rows-2 gap-6">
              <SliceGuard slice={fleet} lines={2}>
                <BigStat label="Total Vehicles" value={availability.total} icon={Truck} sub="Registered fleet assets" />
              </SliceGuard>
              <SliceGuard slice={alerts} lines={2}>
                <BigStat
                  label="Active Alerts"
                  value={alertSummary.total}
                  icon={Bell}
                  color={alertSummary.total > 0 ? '#f97316' : '#22c55e'}
                  sub={alertSummary.bySeverity.Critical > 0 ? `${alertSummary.bySeverity.Critical} critical` : 'No critical alerts'}
                />
              </SliceGuard>
            </div>

            <div className="col-span-12 xl:col-span-4">
              <Panel title="Vehicles by Site" icon={MapPin} className="h-full">
                <SliceGuard slice={fleet} lines={5}>
                  {siteChartItems.length ? (
                    <div className="h-full min-h-[220px]">
                      <EChart option={tc(hBarOption(siteChartItems))} ariaLabel="Vehicles by site"
                        style={{ height: '100%', width: '100%' }} />
                    </div>
                  ) : (
                    <BoardEmpty icon={MapPin} label="No vehicles recorded" />
                  )}
                </SliceGuard>
              </Panel>
            </div>

            <div className="col-span-12 grid grid-cols-2 xl:grid-cols-4 gap-6">
              <SliceGuard slice={inspections} lines={2}>
                <BigStat label="Inspections Today" value={todayInsp.total} icon={ClipboardList}
                  sub={`${todayInsp.done} done : ${todayInsp.pending} pending : ${todayInsp.overdue} overdue`} />
              </SliceGuard>
              <SliceGuard slice={tyres} lines={2}>
                <BigStat label="Tyres in Service" value={attention.total.toLocaleString()} icon={CircleDot} sub="Currently fitted" />
              </SliceGuard>
              <SliceGuard slice={tyres} lines={2}>
                <BigStat label="Tyres Needing Attention" value={attention.attention}
                  color={attention.attention > 0 ? '#f97316' : '#22c55e'} icon={AlertTriangle}
                  sub={`${attention.critical} critical : ${attention.high} high risk`} />
              </SliceGuard>
              <SliceGuard slice={pending} lines={2}>
                <BigStat label="Pending Approvals" value={pending.rows.length}
                  color={pending.rows.length > 0 ? '#eab308' : '#22c55e'} icon={Inbox} sub="Data imports awaiting review" />
              </SliceGuard>
            </div>
          </div>
        )}

        {/* ── (b) Tyre & Maintenance ── */}
        {board.key === 'tyre' && (
          <div className="grid grid-cols-12 gap-6 h-full">
            <div className="col-span-12 grid grid-cols-2 xl:grid-cols-4 gap-6">
              <SliceGuard slice={tyres} lines={2}>
                <BigStat label="Active Tyres" value={attention.total.toLocaleString()} icon={CircleDot} sub="Fitted across the fleet" />
              </SliceGuard>
              <SliceGuard slice={tyres} lines={2}>
                <BigStat label="Critical Risk" value={attention.critical}
                  color={attention.critical > 0 ? '#ef4444' : '#22c55e'} icon={AlertTriangle} sub="Immediate action required" />
              </SliceGuard>
              <SliceGuard slice={tyres} lines={2}>
                <BigStat label="High Risk" value={attention.high}
                  color={attention.high > 0 ? '#f97316' : '#22c55e'} icon={AlertTriangle} sub="Monitor closely" />
              </SliceGuard>
              <SliceGuard slice={monthTyres} lines={2}>
                <BigStat label="Tyre Cost This Month"
                  value={spend.lines.length === 0 ? 'No priced tyres'
                    : spend.lines.length === 1 ? money(spend.lines[0].amount, spend.lines[0].currency)
                    : `${spend.lines.length} currencies`}
                  icon={DollarSign}
                  sub={spend.lines.length > 1
                    ? spend.lines.map((l) => money(l.amount, l.currency)).join(' : ')
                    : `${spend.lines.reduce((t, l) => t + l.tyres, 0).toLocaleString()} priced tyres issued in ${now.toLocaleDateString([], { month: 'long' })}`} />
              </SliceGuard>
            </div>

            <div className="col-span-12 xl:col-span-4">
              <Panel title="Pressure Compliance" icon={ShieldCheck} className="h-full">
                <SliceGuard slice={inspections} lines={4}>
                  <div className="flex flex-col h-full">
                    <div className="flex-1 min-h-[200px] flex items-center justify-center">
                      {compliance.pct == null ? (
                        <p className="text-slate-400 text-lg text-center px-4">Not measured</p>
                      ) : (
                        <EChart option={tc(gaugeOption(compliance.pct, { label: 'Compliant' }))} ariaLabel="Pressure compliance" style={{ height: '100%', width: '100%' }} />
                      )}
                    </div>
                    <p className="text-slate-400 text-base text-center">
                      {compliance.pct == null ? 'No tyre pressures recorded in the last 90 days' : (
                        <>
                          <span className="text-white font-bold tabular-nums">{compliance.compliant}</span>
                          {' of '}
                          <span className="text-white font-bold tabular-nums">{compliance.total}</span>
                          {' readings within 15% of the vehicle median (90 days)'}
                        </>
                      )}
                    </p>
                  </div>
                </SliceGuard>
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-4">
              <Panel title="Tyre Risk Composition" icon={CircleDot} className="h-full">
                <SliceGuard slice={tyres} lines={4}>
                  {tyreRisk.length ? (
                    <div className="h-full min-h-[220px]">
                      <EChart option={tc(donutOption(tyreRisk))} ariaLabel="Tyre risk composition"
                        style={{ height: '100%', width: '100%' }} />
                    </div>
                  ) : (
                    <BoardEmpty icon={CircleDot} label="No tyres in service" />
                  )}
                </SliceGuard>
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-4">
              <Panel title="Today's Inspections" icon={ClipboardList} className="h-full">
                <SliceGuard slice={inspections} lines={4}>
                  {todayInsp.total > 0 ? (
                    <div className="h-full min-h-[220px]">
                      <EChart option={tc(donutOption(inspStatus))} ariaLabel="Today's inspection status"
                        style={{ height: '100%', width: '100%' }} />
                    </div>
                  ) : (
                    <BoardEmpty icon={ClipboardList} label="No inspections scheduled today" />
                  )}
                </SliceGuard>
              </Panel>
            </div>
          </div>
        )}

        {/* ── (c) Open Job Cards / Work Orders ── */}
        {board.key === 'jobcards' && (
          <div className="grid grid-cols-12 gap-6 h-full">
            <div className="col-span-12 grid grid-cols-2 xl:grid-cols-4 gap-6">
              <SliceGuard slice={workOrders} lines={2}>
                <BigStat label="Open Job Cards" value={woBoard.total}
                  color={woBoard.total > 0 ? '#38bdf8' : '#22c55e'} icon={Wrench} sub="Active workshop jobs" />
              </SliceGuard>
              <SliceGuard slice={workOrders} lines={2}>
                <BigStat label="In Progress" value={woBoard.inProgress} icon={Play} color="#eab308" sub="Currently being worked" />
              </SliceGuard>
              <SliceGuard slice={workOrders} lines={2}>
                <BigStat label="Awaiting Parts" value={woBoard.awaitingParts} icon={Clock} color="#f97316" sub="Blocked on parts" />
              </SliceGuard>
              <SliceGuard slice={workOrders} lines={2}>
                <BigStat label="Overdue" value={woBoard.overdue}
                  color={woBoard.overdue > 0 ? '#ef4444' : '#22c55e'} icon={Timer} sub="Past target completion" />
              </SliceGuard>
            </div>

            <div className="col-span-12">
              <Panel title="Open Job Cards" icon={Wrench} className="h-full">
                <SliceGuard slice={workOrders} lines={6}>
                  {woBoard.list.length === 0 ? (
                    <BoardEmpty icon={Wrench} label="No open job cards" />
                  ) : (
                    <div className="space-y-2.5">
                      {woBoard.list.slice(0, 8).map((o) => (
                        <div key={o.id} className="flex items-center gap-4 bg-slate-900/60 border border-slate-800/60 rounded-xl px-4 py-3">
                          <SevPill value={o.priority} />
                          <div className="min-w-0 flex-1">
                            <p className="text-slate-100 text-lg font-semibold truncate">
                              {o.asset_no || 'Unassigned asset'}
                              <span className="text-slate-500 text-base font-normal ml-2">{o.work_type || 'Job'}</span>
                            </p>
                            <p className="text-slate-500 text-sm font-mono truncate">
                              {o.work_order_no || ''}{o.work_order_no && o.technician_name ? ' : ' : ''}{o.technician_name || ''}
                            </p>
                          </div>
                          <StatusChip value={o.status} />
                          <div className="text-right flex-shrink-0 w-24">
                            <p className="text-slate-300 text-base font-bold tabular-nums">{agoLabel(o.opened_at, dayRef) || 'N/A'}</p>
                            <p className="text-slate-600 text-xs">open</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SliceGuard>
              </Panel>
            </div>
          </div>
        )}

        {/* ── (c2) Workshop — technician status + job-card health ── */}
        {board.key === 'workshop' && (
          <div className="grid grid-cols-12 gap-6 h-full">
            {!wsHasData ? (
              <div className="col-span-12">
                <SliceGuard slice={workshop} lines={6}>
                  <BoardEmpty icon={Wrench} label="No workshop activity recorded" />
                </SliceGuard>
              </div>
            ) : (
              <>
                {/* Primary tiles */}
                <div className="col-span-12 grid grid-cols-2 xl:grid-cols-4 gap-6">
                  <SliceGuard slice={workshop} lines={2}>
                    <BigStat label="Technicians Working" value={wsKpis.working}
                      color={wsKpis.working > 0 ? '#22c55e' : '#64748b'} icon={Wrench}
                      sub={`${wsKpis.available} available : ${wsKpis.onDuty} on duty`} />
                  </SliceGuard>
                  <SliceGuard slice={workshop} lines={2}>
                    <BigStat label="Open Job Cards" value={wsKpis.openJobs}
                      color={wsKpis.openJobs > 0 ? '#38bdf8' : '#22c55e'} icon={ClipboardList}
                      sub="Active workshop jobs" />
                  </SliceGuard>
                  <SliceGuard slice={workshop} lines={2}>
                    <BigStat label="Overdue Jobs" value={wsKpis.overdueJobs}
                      color={wsKpis.overdueJobs > 0 ? '#ef4444' : '#22c55e'} icon={Timer}
                      sub="Past target completion" />
                  </SliceGuard>
                  <SliceGuard slice={workshop} lines={2}>
                    <BigStat label="Vehicles Off Road" value={wsKpis.vehiclesOffRoad}
                      color={wsKpis.vehiclesOffRoad > 0 ? '#ef4444' : '#22c55e'} icon={Car}
                      sub="Awaiting return to service" />
                  </SliceGuard>
                </div>

                {/* Technician status donut */}
                <div className="col-span-12 xl:col-span-4">
                  <Panel title="Technician Status" icon={Activity} className="h-full">
                    <SliceGuard slice={workshop} lines={4}>
                      {wsTechItems.length ? (
                        <div className="h-full min-h-[220px]">
                          <EChart option={tc(donutOption(wsTechItems))} ariaLabel="Technician status"
                            style={{ height: '100%', width: '100%' }} />
                        </div>
                      ) : (
                        <BoardEmpty icon={Activity} label="No technicians on duty" />
                      )}
                    </SliceGuard>
                  </Panel>
                </div>

                {/* Jobs by status bar */}
                <div className="col-span-12 xl:col-span-4">
                  <Panel title="Jobs by Status" icon={ClipboardList} className="h-full">
                    <SliceGuard slice={workshop} lines={4}>
                      {wsJobStatusItems.length ? (
                        <div className="h-full min-h-[220px]">
                          <EChart option={tc(hBarOption(wsJobStatusItems))} ariaLabel="Jobs by status"
                            style={{ height: '100%', width: '100%' }} />
                        </div>
                      ) : (
                        <BoardEmpty icon={ClipboardList} label="No open job cards" />
                      )}
                    </SliceGuard>
                  </Panel>
                </div>

                {/* Utilization gauge + completed today */}
                <div className="col-span-12 xl:col-span-4 grid grid-rows-2 gap-6">
                  <Panel title="Utilization" icon={GaugeIcon} className="h-full">
                    <SliceGuard slice={workshop} lines={3}>
                      {wsKpis.utilization == null ? (
                        <BoardEmpty icon={GaugeIcon} label="Utilization N/A" />
                      ) : (
                        <div className="h-full min-h-[160px]">
                          <EChart option={tc(gaugeOption(wsKpis.utilization, { label: 'Utilization' }))} ariaLabel="Workshop utilization" style={{ height: '100%', width: '100%' }} />
                        </div>
                      )}
                    </SliceGuard>
                  </Panel>
                  <SliceGuard slice={workshop} lines={2}>
                    <BigStat label="Jobs Completed Today" value={wsKpis.jobsCompletedToday}
                      color={wsKpis.jobsCompletedToday > 0 ? '#22c55e' : '#64748b'} icon={ShieldCheck}
                      sub="Signed off today" />
                  </SliceGuard>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── (d) Tyre Replacements ── */}
        {board.key === 'replacements' && (
          <div className="grid grid-cols-12 gap-6 h-full">
            <div className="col-span-12 xl:col-span-4 grid grid-rows-2 gap-6">
              <SliceGuard slice={replacements} lines={2}>
                <BigStat label="Replaced (30 days)" value={replBoard.recent}
                  color={replBoard.recent > 0 ? '#f97316' : '#22c55e'} icon={Repeat} sub="Tyres removed this period" />
              </SliceGuard>
              <SliceGuard slice={replacements} lines={2}>
                <BigStat label="Recent Removals" value={replBoard.total} icon={CircleDot} sub="Within the last 90 days" />
              </SliceGuard>
            </div>

            <div className="col-span-12 xl:col-span-8">
              <Panel title="Latest Tyre Replacements" icon={Repeat} className="h-full">
                <SliceGuard slice={replacements} lines={6}>
                  {replBoard.list.length === 0 ? (
                    <BoardEmpty icon={Repeat} label="No tyre replacements recorded" />
                  ) : (
                    <div className="space-y-2.5">
                      {replBoard.list.slice(0, 9).map((c, i) => (
                        <div key={`${c.tyre_serial ?? i}-${i}`} className="flex items-center gap-4 bg-slate-900/60 border border-slate-800/60 rounded-xl px-4 py-3">
                          <div className="w-16 flex-shrink-0 text-center">
                            <p className="text-slate-200 text-base font-bold">{c.position || 'N/A'}</p>
                            <p className="text-slate-600 text-xs uppercase tracking-wider">pos</p>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-slate-100 text-lg font-semibold truncate">
                              {c.asset_no || 'Unassigned asset'}
                              <span className="text-slate-500 text-base font-normal ml-2">{c.brand || ''}</span>
                            </p>
                            <p className="text-slate-500 text-sm truncate">
                              {c.removal_reason || 'Reason not recorded'}
                              {c.site ? ` : ${c.site}` : ''}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0 w-28">
                            <p className="text-slate-300 text-base font-bold tabular-nums">
                              {c.removal_date ? new Date(c.removal_date).toLocaleDateString([], { day: '2-digit', month: 'short' }) : 'N/A'}
                            </p>
                            <p className="text-slate-600 text-xs">{agoLabel(c.removal_date, dayRef)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SliceGuard>
              </Panel>
            </div>
          </div>
        )}

        {/* ── (e) Accidents ── */}
        {board.key === 'accidents' && (
          <div className="grid grid-cols-12 gap-6 h-full">
            <div className="col-span-12 grid grid-cols-2 xl:grid-cols-4 gap-6">
              <SliceGuard slice={incidents} lines={2}>
                <BigStat label="Open Incidents" value={accBoard.open}
                  color={accBoard.open > 0 ? '#f97316' : '#22c55e'} icon={Car} sub="Cases not yet closed" />
              </SliceGuard>
              <SliceGuard slice={incidents} lines={2}>
                <BigStat label="Last 30 Days" value={accBoard.recent} icon={AlertTriangle}
                  color={accBoard.recent > 0 ? '#eab308' : '#22c55e'} sub="Reported incidents" />
              </SliceGuard>
              <SliceGuard slice={incidents} lines={2}>
                <BigStat label="Recorded (90 days)" value={accBoard.total} icon={ClipboardList} sub="Total incidents on file" />
              </SliceGuard>
              <SliceGuard slice={incidents} lines={2}>
                <BigStat label="Closed" value={Math.max(0, accBoard.total - accBoard.open)}
                  color="#22c55e" icon={ShieldCheck} sub="Cases resolved" />
              </SliceGuard>
            </div>

            <div className="col-span-12 xl:col-span-5 grid grid-rows-2 gap-6">
              <Panel title="Accidents by Severity" icon={AlertTriangle} className="h-full">
                <SliceGuard slice={incidents} lines={4}>
                  {accSeverityItems.length ? (
                    <div className="h-full min-h-[180px]">
                      <EChart option={tc(donutOption(accSeverityItems))} ariaLabel="Accidents by severity"
                        style={{ height: '100%', width: '100%' }} />
                    </div>
                  ) : (
                    <BoardEmpty icon={ShieldCheck} label="No incidents recorded" />
                  )}
                </SliceGuard>
              </Panel>
              <Panel title="Incidents by Site" icon={MapPin} className="h-full">
                <SliceGuard slice={incidents} lines={4}>
                  {accSiteItems.length ? (
                    <div className="h-full min-h-[180px]">
                      <EChart option={tc(vBarOption(accSiteItems))} ariaLabel="Incidents by site"
                        style={{ height: '100%', width: '100%' }} />
                    </div>
                  ) : (
                    <BoardEmpty icon={ShieldCheck} label="No incidents recorded" />
                  )}
                </SliceGuard>
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-7">
              <Panel title="Latest Incidents" icon={Car} className="h-full">
                <SliceGuard slice={incidents} lines={6}>
                  {accBoard.list.length === 0 ? (
                    <BoardEmpty icon={Car} label="No incidents recorded" />
                  ) : (
                    <div className="space-y-2.5">
                      {accBoard.list.slice(0, 8).map((a) => (
                        <div key={a.id} className="flex items-center gap-4 bg-slate-900/60 border border-slate-800/60 rounded-xl px-4 py-3">
                          <SevPill value={a.severity} label={canonSeverity(a.severity) || undefined} />
                          <div className="min-w-0 flex-1">
                            <p className="text-slate-100 text-lg font-semibold truncate">
                              {a.asset_no || 'Unassigned asset'}
                              <span className="text-slate-500 text-base font-normal ml-2">{a.accident_type || 'Incident'}</span>
                            </p>
                            <p className="text-slate-500 text-sm truncate">
                              {a.driver_name || 'Driver not recorded'}{a.site ? ` : ${a.site}` : ''}
                            </p>
                          </div>
                          <StatusChip value={canonStatus(a.status) || a.status} />
                          <div className="text-right flex-shrink-0 w-28">
                            <p className="text-slate-300 text-base font-bold tabular-nums">
                              {a.incident_date ? new Date(a.incident_date).toLocaleDateString([], { day: '2-digit', month: 'short' }) : 'N/A'}
                            </p>
                            <p className="text-slate-600 text-xs">{agoLabel(a.incident_date, dayRef)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SliceGuard>
              </Panel>
            </div>
          </div>
        )}

        {/* ── (f) Preventive Maintenance ── */}
        {board.key === 'pm' && (
          <div className="grid grid-cols-12 gap-6 h-full">
            <div className="col-span-12 grid grid-cols-2 xl:grid-cols-4 gap-6">
              <SliceGuard slice={pm} lines={2}>
                <BigStat label="PM Overdue" value={pmSummary.overdue}
                  color={pmSummary.overdue > 0 ? '#ef4444' : '#22c55e'} icon={CalendarClock}
                  sub="Active plans past due" />
              </SliceGuard>
              <SliceGuard slice={pm} lines={2}>
                <BigStat label="Due Soon" value={pmSummary.dueSoon}
                  color={pmSummary.dueSoon > 0 ? '#eab308' : '#22c55e'} icon={CalendarDays}
                  sub="Within 14 days or meter" />
              </SliceGuard>
              <SliceGuard slice={pm} lines={2}>
                <BigStat label="PM Compliance"
                  value={pmSummary.compliantPct == null ? 'N/A' : `${pmSummary.compliantPct}%`}
                  color={pmSummary.compliantPct == null
                    ? '#64748b'
                    : pmSummary.compliantPct >= 90 ? '#22c55e' : pmSummary.compliantPct >= 70 ? '#eab308' : '#ef4444'}
                  icon={ShieldCheck}
                  sub={`${pmSummary.active} active plans`} />
              </SliceGuard>
              <SliceGuard slice={pm} lines={2}>
                <BigStat label="Active Plans" value={pmSummary.active} icon={ClipboardCheck}
                  sub="Preventive programmes" />
              </SliceGuard>
            </div>

            <div className="col-span-12">
              <Panel title="Preventive Maintenance Due" icon={CalendarClock} className="h-full">
                <SliceGuard slice={pm} lines={6}>
                  {pmSummary.dueList.length === 0 ? (
                    <BoardEmpty icon={ShieldCheck} label="No preventive maintenance due" />
                  ) : (
                    <div className="space-y-2.5">
                      {pmSummary.dueList.slice(0, 8).map((it, i) => {
                        const overdue = it.band === 'overdue'
                        const color = overdue ? '#ef4444' : '#eab308'
                        return (
                          <div key={it.id ?? `${it.asset_no ?? 'plan'}-${i}`}
                            className="flex items-center gap-4 bg-slate-900/60 border border-slate-800/60 rounded-xl px-4 py-3">
                            <span
                              className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-md flex-shrink-0"
                              style={{ color, backgroundColor: `${color}1f` }}
                            >
                              {overdue ? 'Overdue' : 'Due soon'}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-slate-100 text-lg font-semibold truncate">
                                {it.asset_no || 'Unassigned asset'}
                                <span className="text-slate-500 text-base font-normal ml-2">{it.name || 'PM plan'}</span>
                              </p>
                              <p className="text-slate-500 text-sm truncate">
                                {it.site ? `${it.site}` : 'Site not recorded'}
                                {it.asset_category ? ` : ${it.asset_category}` : ''}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0 w-40">
                              <p className="text-base font-bold tabular-nums" style={{ color }}>{pmDueLabel(it)}</p>
                              <p className="text-slate-600 text-xs">
                                {it.next_due
                                  ? new Date(it.next_due).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
                                  : 'no due date'}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </SliceGuard>
              </Panel>
            </div>
          </div>
        )}

        {/* ── (g) Approvals Queue ── */}
        {board.key === 'approvals' && (
          <div className="grid grid-cols-12 gap-6 h-full">
            <div className="col-span-12 grid grid-cols-2 xl:grid-cols-5 gap-6">
              <SliceGuard slice={approvals} lines={2}>
                <BigStat label="Pending Approvals" value={apprBoard.total}
                  color={apprBoard.total > 0 ? '#eab308' : '#22c55e'} icon={Stamp} sub="Awaiting a decision" />
              </SliceGuard>
              {[
                { kind: 'Workflow',         icon: FileCheck2 },
                { kind: 'Accident closure', icon: Car },
                { kind: 'Checklist',        icon: ClipboardList },
                { kind: 'Data import',      icon: Inbox },
              ].map(({ kind, icon }) => (
                <SliceGuard key={kind} slice={approvals} lines={2}>
                  <BigStat label={kind} value={apprBoard.byKind[kind] || 0}
                    color={(apprBoard.byKind[kind] || 0) > 0 ? '#38bdf8' : '#334155'} icon={icon} />
                </SliceGuard>
              ))}
            </div>

            <div className="col-span-12">
              <Panel title="Pending Approvals Queue" icon={Stamp} className="h-full">
                <SliceGuard slice={approvals} lines={6}>
                  {apprBoard.list.length === 0 ? (
                    <BoardEmpty icon={ShieldCheck} label="Approvals queue is clear" />
                  ) : (
                    <div className="space-y-2.5">
                      {apprBoard.list.slice(0, 8).map((it, i) => (
                        <div key={i} className="flex items-center gap-4 bg-slate-900/60 border border-slate-800/60 rounded-xl px-4 py-3">
                          {it.severity
                            ? <SevPill value={it.severity} label={canonSeverity(it.severity) || undefined} />
                            : <StatusChip value={it.kind} />}
                          <div className="min-w-0 flex-1">
                            <p className="text-slate-100 text-lg font-semibold truncate">
                              {it.label}
                              {it.severity ? <span className="text-slate-500 text-base font-normal ml-2">{it.kind}</span> : null}
                            </p>
                            {it.sub ? <p className="text-slate-500 text-sm truncate">{it.sub}</p> : null}
                          </div>
                          <div className="text-right flex-shrink-0 w-28">
                            <p className="text-slate-300 text-base font-bold tabular-nums">{agoLabel(it.when, dayRef) || 'N/A'}</p>
                            <p className="text-slate-600 text-xs">waiting</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SliceGuard>
              </Panel>
            </div>
          </div>
        )}

        {/* ── (h) Alerts & Compliance ── */}
        {board.key === 'alerts' && (
          <div className="grid grid-cols-12 gap-6 h-full">
            <div className="col-span-12 xl:col-span-4">
              <Panel title="Alerts by Severity" icon={Bell} className="h-full">
                <SliceGuard slice={alerts} lines={4}>
                  {alertSummary.total > 0 ? (
                    <div className="h-full min-h-[200px]">
                      <EChart option={tc(donutOption(alertSevItems))} ariaLabel="Alerts by severity"
                        style={{ height: '100%', width: '100%' }} />
                    </div>
                  ) : (
                    <BoardEmpty icon={ShieldCheck} label="No active alerts" />
                  )}
                </SliceGuard>
              </Panel>
            </div>
            <div className="col-span-12 xl:col-span-8 grid grid-cols-2 xl:grid-cols-5 gap-6 content-start">
              {['Critical', 'High', 'Medium', 'Low', 'Info'].map(sev => (
                <SliceGuard key={sev} slice={alerts} lines={2}>
                  <BigStat
                    label={`${sev} Alerts`}
                    value={alertSummary.bySeverity[sev]}
                    color={alertSummary.bySeverity[sev] > 0 ? SEVERITY_COLORS[sev] : '#334155'}
                    icon={Bell}
                  />
                </SliceGuard>
              ))}
            </div>

            <div className="col-span-12 xl:col-span-7">
              <Panel title="Latest Active Alerts" icon={Bell} className="h-full">
                <SliceGuard slice={alerts} lines={6}>
                  {alerts.rows.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-3">
                      <ShieldCheck size={44} className="text-emerald-500/70" />
                      <p className="text-slate-300 text-xl font-semibold">All clear, no active alerts</p>
                    </div>
                  ) : (
                    <div className="space-y-3 overflow-hidden">
                      {alerts.rows.slice(0, 6).map((a, i) => (
                        <div key={i} className="flex items-start gap-3 bg-slate-900/60 border border-slate-800/60 rounded-xl px-4 py-3">
                          <span
                            className="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md flex-shrink-0 mt-0.5"
                            style={{
                              color: SEVERITY_COLORS[a.severity] ?? SEVERITY_COLORS.Info,
                              backgroundColor: `${SEVERITY_COLORS[a.severity] ?? SEVERITY_COLORS.Info}1f`,
                            }}
                          >
                            {a.severity ?? 'Info'}
                          </span>
                          <div className="min-w-0">
                            <p className="text-slate-200 text-base leading-snug line-clamp-2">{a.message ?? 'Alert'}</p>
                            <p className="text-slate-600 text-xs mt-1 font-mono">
                              {a.asset_no ?? ''}{a.asset_no && a.created_at ? ' : ' : ''}
                              {a.created_at ? new Date(a.created_at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SliceGuard>
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-5 grid grid-rows-2 gap-6">
              <Panel title="Pending Import Approvals" icon={Inbox}>
                <SliceGuard slice={pending} lines={3}>
                  <div className="flex items-center justify-between h-full">
                    <p className="text-6xl font-bold tabular-nums" style={{ color: pending.rows.length > 0 ? '#eab308' : '#22c55e' }}>
                      {pending.rows.length}
                    </p>
                    <div className="text-right space-y-1">
                      {pending.rows.slice(0, 3).map((b, i) => (
                        <p key={i} className="text-slate-400 text-sm">
                          <span className="text-slate-200 font-semibold">{b.module ?? 'import'}</span>
                          {' : '}{(b.total_rows ?? 0).toLocaleString()} rows
                        </p>
                      ))}
                      {pending.rows.length === 0 && <p className="text-slate-500 text-sm">Queue is clear</p>}
                    </div>
                  </div>
                </SliceGuard>
              </Panel>
              <div className="grid grid-cols-2 gap-6">
                <StatTile label="Pressure Compliance"
                  value={inspections.error || compliance.pct == null ? 'N/A' : `${compliance.pct}`}
                  unit={compliance.pct == null ? '' : '%'}
                  tone={compliance.pct == null ? 'neutral'
                    : compliance.pct >= 90 ? 'accent' : compliance.pct >= 70 ? 'warn' : 'crit'}
                  icon={ShieldCheck}
                  sub={compliance.pct == null ? 'No pressures recorded' : 'Rolling 90 days'} />
                <StatTile label="Overdue Today" value={inspections.error ? 'N/A' : todayInsp.overdue}
                  tone={todayInsp.overdue > 0 ? 'crit' : 'accent'} icon={ClipboardList}
                  sub="Inspections past due" />
              </div>
            </div>
          </div>
        )}
        </div>
      </section>
    </div>
  )
}
