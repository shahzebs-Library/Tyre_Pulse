/**
 * DisplayShare — the ANON, read-only Executive TV board rendered at
 * /display/:token (roadmap item 21, backend: MIGRATIONS_V103_EXECUTIVE_DISPLAY.sql).
 *
 * Unlike DisplayDashboard (authed, queries tables directly), this page has NO
 * login and NO table access. Its ONLY data source is the token-gated
 * get_display_snapshot RPC, which returns aggregate KPIs + branding — never raw
 * rows or PII. The token in the URL is the sole credential; an optional viewer
 * password gates sensitive boards.
 *
 * Reuses DisplayDashboard's deliberate-dark visual approach (a wall display must
 * never flash white) by COPYING its shells — the two pages are intentionally
 * decoupled (different data contracts).
 *
 * States: loading · not-available-yet (V103 unapplied) · invalid/expired token ·
 * password-required · live board. Auto-refresh on the token's refresh cadence,
 * template rotation on the rotate cadence, live clock, org branding.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  Radio, RefreshCw, AlertTriangle, Lock, CircleDot, DollarSign, ShieldAlert,
  ClipboardList, Wrench, Car, Truck, Activity, Maximize2, Minimize2, WifiOff,
} from 'lucide-react'
import { getDisplaySnapshot, shapeSnapshot } from '../lib/api/displayTokens'
import { formatCompactMoney, formatCountdown, nextBoardIndex } from '../lib/displayBoard'

// Force-dark palette (independent of app theme) — same intent as DisplayDashboard.
const RISK_COLORS = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e',
  unclassified: '#64748b',
}
const CURSOR_HIDE_MS = 5000

// ── Presentational shells (copied pattern from DisplayDashboard) ───────────────

function FullScreenShell({ children }) {
  return (
    <div className="min-h-screen w-full bg-[#060a12] text-slate-100 flex items-center justify-center p-8">
      {children}
    </div>
  )
}

function Panel({ title, icon: Icon, children, className = '' }) {
  return (
    <div className={`bg-[#0d1420] border border-slate-800/70 rounded-2xl p-6 flex flex-col min-h-0 ${className}`}>
      {title && (
        <div className="flex items-center gap-2.5 mb-4 flex-shrink-0">
          {Icon && <Icon size={18} className="text-slate-500" />}
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">{title}</h2>
        </div>
      )}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
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

function TrendBars({ trend }) {
  if (!trend.length) return <p className="text-slate-600 text-sm py-4 text-center">No spend recorded</p>
  const max = Math.max(...trend.map((t) => t.spend), 1)
  return (
    <div className="flex items-end justify-between gap-3 h-full min-h-[160px] pt-2">
      {trend.map((t) => (
        <div key={t.month} className="flex-1 flex flex-col items-center justify-end gap-2 h-full">
          <span className="text-slate-300 text-xs font-semibold tabular-nums">{formatCompactMoney(t.spend)}</span>
          <div
            className="w-full max-w-[52px] rounded-t-lg bg-gradient-to-t from-emerald-700 to-emerald-400 transition-all duration-700"
            style={{ height: `${Math.max((t.spend / max) * 100, 3)}%` }}
          />
          <span className="text-slate-500 text-xs">{(t.month || '').slice(5)}</span>
        </div>
      ))}
    </div>
  )
}

function RiskBars({ risk }) {
  if (!risk.length) return <p className="text-slate-600 text-sm py-4 text-center">No tyres classified</p>
  const total = risk.reduce((s, r) => s + r.count, 0) || 1
  return (
    <div className="space-y-3.5">
      {risk.slice(0, 6).map((r) => {
        const color = RISK_COLORS[String(r.level).toLowerCase()] || RISK_COLORS.unclassified
        return (
          <div key={r.level}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-slate-200 text-lg font-semibold capitalize truncate mr-3">{r.level}</span>
              <span className="text-slate-400 text-lg font-bold tabular-nums flex-shrink-0">
                {r.count.toLocaleString()}
                <span className="text-slate-600 text-sm font-medium ml-1.5">
                  {Math.round((r.count / total) * 100)}%
                </span>
              </span>
            </div>
            <div className="h-2.5 bg-slate-800/80 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(r.count / total) * 100}%`, backgroundColor: color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ActivityList({ events }) {
  if (!events.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
        <Activity size={40} className="text-slate-700" />
        <p className="text-slate-500 text-lg">No activity in the last 24 hours</p>
      </div>
    )
  }
  const max = Math.max(...events.map((e) => e.count), 1)
  return (
    <div className="space-y-2.5 overflow-hidden">
      {events.slice(0, 8).map((e) => (
        <div key={e.type} className="flex items-center gap-3 bg-slate-900/60 border border-slate-800/60 rounded-xl px-4 py-2.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-200 text-base font-medium truncate">
                {String(e.type).replace(/[_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
              <span className="text-slate-300 text-lg font-bold tabular-nums flex-shrink-0">{e.count.toLocaleString()}</span>
            </div>
            <div className="h-1.5 mt-1.5 bg-slate-800/70 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-sky-500/70" style={{ width: `${(e.count / max) * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Board pages (rotated by the token template) ────────────────────────────────

function OverviewBoard({ s }) {
  const k = s.kpis
  return (
    <div className="grid grid-cols-12 gap-6 h-full">
      <div className="col-span-12 grid grid-cols-2 xl:grid-cols-4 gap-6">
        <BigStat label="Tyres Tracked" value={k.tyresTotal.toLocaleString()} icon={CircleDot} sub="Across the fleet" />
        <BigStat label="Spend (30 days)" value={formatCompactMoney(k.spend30d)} icon={DollarSign} sub="Tyre issue cost" />
        <BigStat label="High Risk" value={k.highRisk.toLocaleString()} icon={ShieldAlert}
          color={k.highRisk > 0 ? '#f97316' : '#22c55e'} sub="High / critical tyres" />
        <BigStat label="Fleet Size" value={k.fleetSize.toLocaleString()} icon={Truck} sub="Registered vehicles" />
      </div>
      <div className="col-span-12 grid grid-cols-2 xl:grid-cols-3 gap-6">
        <BigStat label="Inspections (30d)" value={k.inspections30d.toLocaleString()} icon={ClipboardList} sub="Completed inspections" />
        <BigStat label="Open Work Orders" value={k.openWorkorders.toLocaleString()} icon={Wrench}
          color={k.openWorkorders > 0 ? '#eab308' : '#22c55e'} sub="Awaiting completion" />
        <BigStat label="Open Accidents" value={k.openAccidents.toLocaleString()} icon={Car}
          color={k.openAccidents > 0 ? '#ef4444' : '#22c55e'} sub="Unresolved incidents" />
      </div>
    </div>
  )
}

function SpendBoard({ s }) {
  return (
    <div className="grid grid-cols-12 gap-6 h-full">
      <div className="col-span-12 xl:col-span-7">
        <Panel title="6-Month Tyre Spend" icon={DollarSign} className="h-full">
          <TrendBars trend={s.spendTrend} />
        </Panel>
      </div>
      <div className="col-span-12 xl:col-span-5 grid grid-rows-2 gap-6">
        <BigStat label="Spend (30 days)" value={formatCompactMoney(s.kpis.spend30d)} icon={DollarSign} sub="Rolling tyre cost" />
        <BigStat label="Tyres Tracked" value={s.kpis.tyresTotal.toLocaleString()} icon={CircleDot} sub="Fleet-wide" />
      </div>
    </div>
  )
}

function RiskBoard({ s }) {
  return (
    <div className="grid grid-cols-12 gap-6 h-full">
      <div className="col-span-12 xl:col-span-6">
        <Panel title="Tyre Risk Breakdown" icon={ShieldAlert} className="h-full">
          <RiskBars risk={s.riskBreakdown} />
        </Panel>
      </div>
      <div className="col-span-12 xl:col-span-6">
        <Panel title="Recent Activity (24h)" icon={Activity} className="h-full">
          <ActivityList events={s.recentActivity} />
        </Panel>
      </div>
    </div>
  )
}

const BOARD_RENDERERS = {
  overview: { label: 'Fleet Overview', render: (s) => <OverviewBoard s={s} /> },
  spend: { label: 'Spend Trend', render: (s) => <SpendBoard s={s} /> },
  risk: { label: 'Risk & Activity', render: (s) => <RiskBoard s={s} /> },
}

// Resolve the token template pages -> renderable boards (unknown pages skipped;
// always at least one board so the page never blanks).
function resolveBoards(pages) {
  const boards = (pages || [])
    .map((p) => (BOARD_RENDERERS[p] ? { key: p, ...BOARD_RENDERERS[p] } : null))
    .filter(Boolean)
  return boards.length ? boards : [{ key: 'overview', ...BOARD_RENDERERS.overview }]
}

// ── Full-page state screens ────────────────────────────────────────────────────

function CenteredState({ icon: Icon, iconColor, title, children }) {
  return (
    <FullScreenShell>
      <div className="max-w-md text-center flex flex-col items-center gap-5">
        {Icon && <Icon size={56} style={{ color: iconColor }} />}
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {children}
      </div>
    </FullScreenShell>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function DisplayShare() {
  const { token } = useParams()

  const [status, setStatus] = useState('loading') // loading|ok|unavailable|invalid|password|error|offline
  const [snapshot, setSnapshot] = useState(null)
  const [reason, setReason] = useState(null)
  const [errorText, setErrorText] = useState(null)

  const [password, setPassword] = useState('')
  const [pwInput, setPwInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [now, setNow] = useState(() => new Date())
  const [countdown, setCountdown] = useState(60)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [boardIndex, setBoardIndex] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [cursorHidden, setCursorHidden] = useState(false)

  const loadingRef = useRef(false)
  const cursorTimerRef = useRef(null)

  // ── Snapshot load (token-gated RPC only) ───────────────────────────────────
  const load = useCallback(async (pw, { initial = false } = {}) => {
    if (loadingRef.current) return
    loadingRef.current = true
    if (initial) setStatus('loading')
    setRefreshing(true)
    try {
      const res = await getDisplaySnapshot(token, pw ?? null)
      if (!res.available) {
        setStatus('unavailable')
      } else if (res.ok) {
        const shaped = shapeSnapshot(res.snapshot)
        setSnapshot(shaped)
        setStatus('ok')
        setCountdown(shaped.refreshSeconds)
        setLastUpdated(new Date())
        setReason(null)
        setErrorText(null)
      } else if (res.reason === 'password_required' || res.reason === 'invalid_password') {
        setStatus('password')
        setReason(res.reason)
      } else if (res.reason === 'request_failed') {
        setStatus('error')
        setErrorText(res.error || 'Could not load the display board.')
      } else {
        setStatus('invalid')
        setReason(res.reason || 'invalid_token')
      }
    } catch (e) {
      // Network / unexpected — treat as offline; retries on next cadence.
      setStatus((prev) => (prev === 'ok' ? 'ok' : 'offline'))
      setErrorText(e?.message || 'Network error')
    } finally {
      setRefreshing(false)
      loadingRef.current = false
    }
  }, [token])

  useEffect(() => { load(null, { initial: true }) }, [load])

  // ── 1s tick: clock + refresh countdown (only counts down on a live board) ──
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date())
      setCountdown((c) => (status === 'ok' ? Math.max(0, c - 1) : c))
    }, 1000)
    return () => clearInterval(id)
  }, [status])

  useEffect(() => {
    if (status === 'ok' && countdown === 0) load(password)
  }, [countdown, status, password, load])

  // ── Board rotation on the token's rotate cadence ───────────────────────────
  const boards = useMemo(() => resolveBoards(snapshot?.pages), [snapshot?.pages])
  useEffect(() => {
    if (status !== 'ok' || boards.length <= 1) return undefined
    const ms = Math.max(5, snapshot?.rotateSeconds || 15) * 1000
    const id = setInterval(() => setBoardIndex((i) => nextBoardIndex(i, boards.length)), ms)
    return () => clearInterval(id)
  }, [status, boards.length, snapshot?.rotateSeconds])

  // Keep the board index in range if the template shrinks between refreshes.
  useEffect(() => {
    if (boardIndex >= boards.length) setBoardIndex(0)
  }, [boards.length, boardIndex])

  // ── Fullscreen + cursor hide ───────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else document.documentElement.requestFullscreen?.()
  }, [])
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  useEffect(() => {
    const wake = () => {
      setCursorHidden(false)
      clearTimeout(cursorTimerRef.current)
      cursorTimerRef.current = setTimeout(() => setCursorHidden(true), CURSOR_HIDE_MS)
    }
    wake()
    window.addEventListener('mousemove', wake)
    return () => {
      clearTimeout(cursorTimerRef.current)
      window.removeEventListener('mousemove', wake)
    }
  }, [])

  function submitPassword(e) {
    e.preventDefault()
    if (!pwInput.trim() || submitting) return
    setSubmitting(true)
    setPassword(pwInput)
    load(pwInput, { initial: false }).finally(() => setSubmitting(false))
  }

  // ── State screens ──────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <CenteredState icon={Radio} iconColor="#34d399" title="Loading display…">
        <p className="text-slate-400">Fetching the latest fleet snapshot.</p>
        <RefreshCw size={22} className="animate-spin text-emerald-400" />
      </CenteredState>
    )
  }

  if (status === 'unavailable') {
    return (
      <CenteredState icon={AlertTriangle} iconColor="#fbbf24" title="Display not available yet">
        <p className="text-slate-400 leading-relaxed">
          The executive display backend hasn&apos;t been provisioned on this environment.
          An administrator needs to apply migration <span className="font-mono text-slate-300">V103</span>{' '}
          (Executive Display) before shared boards will work.
        </p>
      </CenteredState>
    )
  }

  if (status === 'invalid') {
    return (
      <CenteredState icon={AlertTriangle} iconColor="#ef4444" title="This display link is invalid or has expired">
        <p className="text-slate-400 leading-relaxed">
          The link may have been revoked or reached its expiry date. Please request a fresh
          display link from your administrator.
        </p>
      </CenteredState>
    )
  }

  if (status === 'error') {
    return (
      <CenteredState icon={AlertTriangle} iconColor="#f97316" title="Couldn’t load this display">
        <p className="text-slate-400">{errorText || 'An unexpected error occurred.'}</p>
        <button onClick={() => load(password, { initial: true })}
          className="mt-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors">
          Try again
        </button>
      </CenteredState>
    )
  }

  if (status === 'offline') {
    return (
      <CenteredState icon={WifiOff} iconColor="#94a3b8" title="Connection lost">
        <p className="text-slate-400">{errorText || 'Unable to reach the server.'} Retrying…</p>
        <button onClick={() => load(password, { initial: true })}
          className="mt-2 px-5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold transition-colors">
          Retry now
        </button>
      </CenteredState>
    )
  }

  if (status === 'password') {
    return (
      <FullScreenShell>
        <form onSubmit={submitPassword} className="w-full max-w-sm text-center flex flex-col items-center gap-5">
          <Lock size={52} className="text-emerald-400" />
          <h1 className="text-2xl font-bold text-white">Protected display</h1>
          <p className="text-slate-400">Enter the viewer password to show this board.</p>
          {reason === 'invalid_password' && (
            <p className="text-red-400 text-sm w-full text-center">Incorrect password — please try again.</p>
          )}
          <input
            type="password"
            autoFocus
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            placeholder="Viewer password"
            className="w-full px-4 py-3 rounded-xl bg-[#0d1420] border border-slate-700 text-white text-center text-lg tracking-wider focus:outline-none focus:border-emerald-500"
          />
          <button type="submit" disabled={submitting || !pwInput.trim()}
            className="w-full px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold transition-colors flex items-center justify-center gap-2">
            {submitting ? <RefreshCw size={18} className="animate-spin" /> : <Lock size={18} />}
            Unlock display
          </button>
        </form>
      </FullScreenShell>
    )
  }

  // ── Live board ─────────────────────────────────────────────────────────────
  const s = snapshot
  const board = boards[Math.min(boardIndex, boards.length - 1)]
  const brandName = s.branding.name || s.name || 'Tyre Pulse'
  const accent = s.branding.primaryColor || '#34d399'

  return (
    <div
      className="min-h-screen w-full bg-[#060a12] text-slate-100 flex flex-col overflow-y-auto"
      style={{ cursor: cursorHidden ? 'none' : 'default' }}
    >
      <header className="flex items-center justify-between gap-6 px-8 py-5 border-b border-slate-800/70 flex-shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          {s.branding.logoUrl ? (
            <img src={s.branding.logoUrl} alt="" className="h-11 w-auto max-w-[180px] object-contain"
              onError={(e) => { e.currentTarget.style.display = 'none' }} />
          ) : (
            <div className="h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${accent}22`, border: `1px solid ${accent}55` }}>
              <Radio size={22} style={{ color: accent }} />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{brandName}</h1>
            <p className="text-slate-500 text-sm flex items-center gap-2">
              {board.label}
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: accent }}>
                <span className={`w-1.5 h-1.5 rounded-full ${refreshing ? 'animate-ping' : 'animate-pulse'}`} style={{ backgroundColor: accent }} />
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
          <button onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="p-2.5 rounded-xl border bg-slate-900 border-slate-800 text-slate-400 hover:text-white transition-colors">
            {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
        </div>
      </header>

      <main className="flex-1 p-8 min-h-0">{board.render(s)}</main>

      {boards.length > 1 && (
        <footer className="flex items-center justify-center gap-3 pb-6 flex-shrink-0">
          {boards.map((b, i) => (
            <span key={b.key} className={`w-2.5 h-2.5 rounded-full transition-colors ${i === (boardIndex % boards.length) ? '' : 'bg-slate-700'}`}
              style={i === (boardIndex % boards.length) ? { backgroundColor: accent } : undefined} />
          ))}
        </footer>
      )}
    </div>
  )
}
