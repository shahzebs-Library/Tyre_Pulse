/**
 * DisplayDashboard — Executive TV Display mode (/display).
 *
 * A full-screen, read-only, auto-refreshing board for control rooms /
 * reception / boardroom TVs. Deliberately DARK regardless of the app theme
 * (same intent as LiveFleetStatus): a wall display must not flash white.
 * Rendered OUTSIDE the normal Layout chrome — no sidebar, no header — but
 * still inside ProtectedRoute + TenantProvider, so data access and org
 * branding behave exactly like the rest of the app.
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
  AlertTriangle, ShieldCheck, Inbox, Maximize2, Minimize2,
  RefreshCw, Play, Pause, Radio, Gauge as GaugeIcon,
  LayoutGrid, LogOut, Check, X as XIcon,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useTenant } from '../contexts/TenantContext'
import Gauge from '../components/ui/Gauge'
import StatTile from '../components/ui/StatTile'
import {
  computeFleetAvailability, groupVehiclesBySite, computeTyreAttention,
  computeMonthlyTyreCost, computePressureCompliancePct, countTodaysInspections,
  summariseAlerts, nextBoardIndex, formatCountdown, formatCompactMoney,
} from '../lib/displayBoard'

const REFRESH_SECS = 60
const ROTATE_SECS  = 30
const CURSOR_HIDE_MS = 5000

const BOARDS = [
  { key: 'fleet',  label: 'Fleet Overview' },
  { key: 'tyre',   label: 'Tyre & Maintenance' },
  { key: 'alerts', label: 'Alerts & Compliance' },
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

const SEVERITY_COLORS = {
  Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#22c55e', Info: '#38bdf8',
}

// Force-dark theme tokens so shared components (Gauge/StatTile read CSS vars)
// render correctly on this page even when the app is in light mode.
const DARK_VARS = {
  '--text-primary': '#f8fafc',
  '--text-muted':   '#94a3b8',
  '--text-dim':     '#64748b',
  '--panel':        '#0d1420',
  '--hairline':     'rgba(148,163,184,0.14)',
  '--gauge-track':  'rgba(148,163,184,0.16)',
  '--good':         '#22c55e',
  '--crit':         '#f26161',
}

const EMPTY_SLICE = { rows: [], error: null, loaded: false }

// ── Presentational shells ─────────────────────────────────────────────────────

function Panel({ title, icon: Icon, children, className = '' }) {
  return (
    <div className={`bg-[#0d1420] border border-slate-800/70 rounded-2xl p-6 flex flex-col min-h-0 ${className}`}>
      <div className="flex items-center gap-2.5 mb-4 flex-shrink-0">
        {Icon && <Icon size={18} className="text-slate-500" />}
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">{title}</h2>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}

function WidgetError({ label = 'Data unavailable' }) {
  return (
    <div className="h-full min-h-[120px] flex flex-col items-center justify-center gap-2 text-center">
      <AlertTriangle size={28} className="text-amber-500/80" />
      <p className="text-slate-400 text-sm font-medium">{label}</p>
      <p className="text-slate-600 text-xs">Retries on next refresh</p>
    </div>
  )
}

function WidgetSkeleton({ lines = 3 }) {
  return (
    <div className="h-full min-h-[120px] animate-pulse space-y-3 py-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-6 bg-slate-800/70 rounded" style={{ width: `${85 - i * 15}%` }} />
      ))}
    </div>
  )
}

/** Per-slice guard: skeleton while loading, error tile on failure, else render. */
function SliceGuard({ slice, children, lines }) {
  if (!slice.loaded && !slice.error) return <WidgetSkeleton lines={lines} />
  if (slice.error) return <WidgetError />
  return children
}

function BigStat({ label, value, sub, color = '#f8fafc', icon: Icon }) {
  return (
    <div className="bg-[#0d1420] border border-slate-800/70 rounded-2xl p-6 flex items-start justify-between">
      <div className="min-w-0">
        <p className="text-[13px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
        <p className="text-5xl xl:text-6xl font-bold tabular-nums tracking-tight mt-3" style={{ color }}>{value}</p>
        {sub && <p className="text-slate-500 text-sm mt-2">{sub}</p>}
      </div>
      {Icon && <Icon size={26} className="text-slate-600 flex-shrink-0 mt-1" />}
    </div>
  )
}

function SiteBars({ sites, total }) {
  if (!sites.length) return <p className="text-slate-600 text-sm py-4 text-center">No vehicles recorded</p>
  const max = Math.max(...sites.map(s => s.count), 1)
  return (
    <div className="space-y-3.5">
      {sites.map(s => (
        <div key={s.site}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-slate-200 text-lg font-semibold truncate mr-3">{s.site}</span>
            <span className="text-slate-400 text-lg font-bold tabular-nums flex-shrink-0">
              {s.count}
              <span className="text-slate-600 text-sm font-medium ml-1.5">
                {total ? Math.round((s.count / total) * 100) : 0}%
              </span>
            </span>
          </div>
          <div className="h-2.5 bg-slate-800/80 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700"
              style={{ width: `${(s.count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
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
          const { data, error } = await supabase
            .from('vehicle_fleet')
            .select('asset_no,site,status,vehicle_type')
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
            .select('cost_per_tyre,qty,issue_date')
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
            .select('asset_no,scheduled_date,status,findings,site')
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
    ]

    await Promise.allSettled(tasks.map(async t => {
      try {
        const rows = await t.run()
        t.set({ rows, error: null, loaded: true })
      } catch (e) {
        // Keep last good rows on transient failure; surface the error state.
        t.set(prev => ({ ...prev, error: e?.message || 'Query failed', loaded: true }))
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
  const monthCost    = useMemo(
    () => computeMonthlyTyreCost(monthTyres.rows, new Date(`${todayStr}T12:00:00`)),
    [monthTyres.rows, todayStr],
  )
  const compliance   = useMemo(() => computePressureCompliancePct(inspections.rows), [inspections.rows])
  const todayInsp    = useMemo(() => countTodaysInspections(inspections.rows, todayStr), [inspections.rows, todayStr])
  const alertSummary = useMemo(() => summariseAlerts(alerts.rows), [alerts.rows])

  const board = visibleBoards[safeIndex] ?? BOARDS[0]

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      ref={rootRef}
      className="tv-display min-h-screen w-full bg-[#060a12] text-slate-100 flex flex-col overflow-y-auto"
      style={{ ...DARK_VARS, cursor: cursorHidden ? 'none' : 'default' }}
    >
      {/* Shared components (StatTile) use the global .card class — pin it dark
          inside this page only, so TV mode ignores the light theme. */}
      <style>{`
        .tv-display .card {
          background: #0d1420 !important;
          border: 1px solid rgba(148,163,184,0.14) !important;
          box-shadow: none !important;
        }
      `}</style>

      {/* ── Header: branding | clock | controls ── */}
      <header className="flex items-center justify-between gap-6 px-8 py-5 border-b border-slate-800/70 flex-shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          {branding?.logo_url ? (
            <img
              src={branding.logo_url}
              alt=""
              className="h-11 w-auto max-w-[180px] object-contain"
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
          ) : (
            <div className="h-11 w-11 rounded-xl bg-emerald-600/20 border border-emerald-700/40 flex items-center justify-center flex-shrink-0">
              <Radio size={22} className="text-emerald-400" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{orgName || 'Tyre Pulse'}</h1>
            <p className="text-slate-500 text-sm flex items-center gap-2">
              {board.label}
              <span className="inline-flex items-center gap-1.5 text-emerald-400/90 text-xs font-semibold uppercase tracking-wider">
                <span className={`w-1.5 h-1.5 rounded-full bg-emerald-400 ${refreshing ? 'animate-ping' : 'animate-pulse'}`} />
                Live
              </span>
            </p>
          </div>
        </div>

        <div className="text-center flex-shrink-0">
          <p className="text-4xl font-bold tabular-nums tracking-tight text-white leading-none">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-slate-500 text-sm mt-1.5">
            {now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right mr-1">
            <p className="text-slate-400 text-sm font-semibold tabular-nums flex items-center gap-1.5 justify-end">
              <RefreshCw size={13} className={refreshing ? 'animate-spin text-emerald-400' : 'text-slate-600'} />
              {formatCountdown(countdown)}
            </p>
            <p className="text-slate-600 text-xs">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Loading…'}
            </p>
          </div>
          {/* Board picker — choose which boards are shown / rotated */}
          <div className="relative">
            <button
              onClick={() => setShowPicker(v => !v)}
              title="Choose boards to display"
              className={`p-2.5 rounded-xl border transition-colors ${
                showPicker
                  ? 'bg-emerald-900/30 border-emerald-800/60 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <LayoutGrid size={17} />
            </button>
            {showPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowPicker(false)} />
                <div className="absolute right-0 mt-2 z-20 w-64 rounded-xl border border-slate-700 bg-[#0d1420] shadow-2xl p-2">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Displayed boards</p>
                    <button onClick={() => setShowPicker(false)} className="text-slate-500 hover:text-slate-300">
                      <XIcon size={14} />
                    </button>
                  </div>
                  {BOARDS.map(b => {
                    const on = enabledBoards[b.key] !== false
                    return (
                      <button
                        key={b.key}
                        onClick={() => toggleBoard(b.key)}
                        className="w-full flex items-center justify-between gap-2 px-2 py-2 rounded-lg text-left text-sm text-slate-200 hover:bg-slate-800/70 transition-colors"
                      >
                        <span>{b.label}</span>
                        <span className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                          on ? 'bg-emerald-600 border-emerald-500' : 'border-slate-600'
                        }`}>
                          {on && <Check size={13} className="text-white" />}
                        </span>
                      </button>
                    )
                  })}
                  <p className="text-[11px] text-slate-600 px-2 pt-1.5 pb-0.5">At least one board stays on.</p>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => setAutoRotate(v => !v)}
            title={autoRotate ? 'Pause board rotation' : 'Resume board rotation'}
            className={`p-2.5 rounded-xl border transition-colors ${
              autoRotate
                ? 'bg-emerald-900/30 border-emerald-800/60 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            {autoRotate ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="p-2.5 rounded-xl border bg-slate-900 border-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          {/* Exit TV mode back to the app */}
          <button
            onClick={() => { if (document.fullscreenElement) document.exitFullscreen?.(); navigate('/') }}
            title="Exit TV display"
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border bg-slate-900 border-slate-800 text-slate-300 hover:text-white hover:border-slate-600 transition-colors text-sm font-semibold"
          >
            <LogOut size={16} /> Exit
          </button>
        </div>
      </header>

      {/* ── Board content ── */}
      <main className="flex-1 p-8 min-h-0">

        {/* ── (a) Fleet Overview ── */}
        {board.key === 'fleet' && (
          <div className="grid grid-cols-12 gap-6 h-full">
            <div className="col-span-12 xl:col-span-4">
              <Panel title="Fleet Availability" icon={GaugeIcon} className="h-full items-stretch">
                <SliceGuard slice={fleet} lines={4}>
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <Gauge value={availability.pct} max={100} unit="%" size={260} label="Available" />
                    <p className="text-slate-400 text-lg">
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
                  <SiteBars sites={siteGroups} total={availability.total} />
                </SliceGuard>
              </Panel>
            </div>

            <div className="col-span-12 grid grid-cols-2 xl:grid-cols-4 gap-6">
              <SliceGuard slice={inspections} lines={2}>
                <BigStat label="Inspections Today" value={todayInsp.total} icon={ClipboardList}
                  sub={`${todayInsp.done} done · ${todayInsp.pending} pending · ${todayInsp.overdue} overdue`} />
              </SliceGuard>
              <SliceGuard slice={tyres} lines={2}>
                <BigStat label="Tyres in Service" value={attention.total.toLocaleString()} icon={CircleDot} sub="Currently fitted" />
              </SliceGuard>
              <SliceGuard slice={tyres} lines={2}>
                <BigStat label="Tyres Needing Attention" value={attention.attention}
                  color={attention.attention > 0 ? '#f97316' : '#22c55e'} icon={AlertTriangle}
                  sub={`${attention.critical} critical · ${attention.high} high risk`} />
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
                <BigStat label="Tyre Cost This Month" value={formatCompactMoney(monthCost.cost)} icon={DollarSign}
                  sub={`${monthCost.tyreCount.toLocaleString()} tyres issued in ${now.toLocaleDateString([], { month: 'long' })}`} />
              </SliceGuard>
            </div>

            <div className="col-span-12 xl:col-span-6">
              <Panel title="Pressure Compliance" icon={ShieldCheck} className="h-full">
                <SliceGuard slice={inspections} lines={4}>
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <Gauge value={compliance.pct} max={100} unit="%" size={240} label="Compliant Inspections" />
                    <p className="text-slate-400 text-lg">
                      <span className="text-white font-bold tabular-nums">{compliance.compliant}</span>
                      {' of '}
                      <span className="text-white font-bold tabular-nums">{compliance.total}</span>
                      {' inspections compliant (90 days)'}
                    </p>
                  </div>
                </SliceGuard>
              </Panel>
            </div>

            <div className="col-span-12 xl:col-span-6">
              <Panel title="Today's Inspection Programme" icon={ClipboardList} className="h-full">
                <SliceGuard slice={inspections} lines={4}>
                  <div className="grid grid-cols-2 gap-4 h-full content-center">
                    {[
                      { label: 'Scheduled', value: todayInsp.total,   color: '#38bdf8' },
                      { label: 'Completed', value: todayInsp.done,    color: '#22c55e' },
                      { label: 'Pending',   value: todayInsp.pending, color: '#eab308' },
                      { label: 'Overdue',   value: todayInsp.overdue, color: todayInsp.overdue > 0 ? '#ef4444' : '#22c55e' },
                    ].map(s => (
                      <div key={s.label} className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-5 text-center">
                        <p className="text-4xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                        <p className="text-slate-500 text-sm font-semibold uppercase tracking-wider mt-2">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </SliceGuard>
              </Panel>
            </div>
          </div>
        )}

        {/* ── (c) Alerts & Compliance ── */}
        {board.key === 'alerts' && (
          <div className="grid grid-cols-12 gap-6 h-full">
            <div className="col-span-12 grid grid-cols-2 xl:grid-cols-5 gap-6">
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
                      <p className="text-slate-300 text-xl font-semibold">All clear — no active alerts</p>
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
                              {a.asset_no ?? ''}{a.asset_no && a.created_at ? ' · ' : ''}
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
                          {' · '}{(b.total_rows ?? 0).toLocaleString()} rows
                        </p>
                      ))}
                      {pending.rows.length === 0 && <p className="text-slate-500 text-sm">Queue is clear</p>}
                    </div>
                  </div>
                </SliceGuard>
              </Panel>
              <div className="grid grid-cols-2 gap-6">
                <StatTile label="Pressure Compliance" value={inspections.error ? '—' : `${compliance.pct}`} unit="%"
                  tone={compliance.pct >= 90 ? 'accent' : compliance.pct >= 70 ? 'warn' : 'crit'} icon={ShieldCheck}
                  sub="Rolling 90 days" />
                <StatTile label="Overdue Today" value={inspections.error ? '—' : todayInsp.overdue}
                  tone={todayInsp.overdue > 0 ? 'crit' : 'accent'} icon={ClipboardList}
                  sub="Inspections past due" />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── Footer: board dots ── */}
      <footer className="flex items-center justify-center gap-3 pb-6 flex-shrink-0">
        {visibleBoards.map((b, i) => (
          <button
            key={b.key}
            onClick={() => { setBoardIndex(i) }}
            title={b.label}
            className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${
              i === safeIndex
                ? 'bg-emerald-900/40 border-emerald-700/60 text-emerald-300'
                : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${i === safeIndex ? 'bg-emerald-400' : 'bg-slate-700'}`} />
            {b.label}
          </button>
        ))}
      </footer>
    </div>
  )
}
