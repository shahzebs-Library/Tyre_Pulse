/**
 * WorkshopTv - PUBLIC, anonymous, LIGHT-THEME workshop live TV / kiosk board
 * mounted at /workshop-tv/:token (outside the app auth shell).
 *
 * The ONLY data source is the token-gated get_workshop_snapshot RPC
 * (src/lib/api/reportShares.js), which returns a PII-FREE org-scoped aggregate
 * snapshot (technician status counts, job KPIs, open job cards, vehicles off
 * road, safety alerts) - never names, salaries or employee numbers. The token in
 * the URL is the sole credential; an optional viewer password gates the snapshot.
 *
 * Design goals mirror ReportShare.jsx:
 *  - Always LIGHT (a workshop wall board must never flash dark).
 *  - Silently auto-refreshes on the share refresh cadence and keeps the last good
 *    data if a refresh fails (never flips to an error after a good paint).
 *  - Visibility gated: a TV that is off / a backgrounded tab stops polling and
 *    does one catch-up refresh when it becomes visible again.
 *  - Fullscreen toggle, live wall clock, honest loading / error / empty states.
 *  - Copy contains NO em or en dashes, arrows, middle dots or curly quotes.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  Maximize2, Minimize2, RotateCw, AlertTriangle, Lock, Clock, KeyRound, Loader2,
  Wrench, Timer, Car, CheckCircle2, PauseCircle, Coffee, UserX, ShieldAlert,
  ClipboardList, Gauge, Activity,
} from 'lucide-react'
import { getWorkshopSnapshot } from '../lib/api/reportShares'
import { categorical, colorAt, withAlpha } from '../lib/reportColors'
import EChart from '../components/charts/EChart'

// ── Light chart palette (pinned literals so canvases read on white paper) ──────
const P = {
  text: '#0f172a', subText: '#334155', muted: '#64748b',
  axisLine: 'rgba(16,24,40,0.16)', splitLine: 'rgba(16,24,40,0.07)',
}
const TOOLTIP = {
  backgroundColor: '#ffffff', borderColor: 'rgba(16,24,40,0.12)', borderWidth: 1,
  textStyle: { color: P.text, fontSize: 13 },
}

const GROUP = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const fmtInt = (v) => GROUP.format(Math.round(Number(v) || 0))
const arr = (v) => (Array.isArray(v) ? v : [])
const safeStr = (v) => (v == null || v === '' ? 'N/A' : String(v))
const clampSec = (v, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function fmtClock(d) {
  try { return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) } catch { return '' }
}
function fmtUpdated(iso) {
  if (!iso) return 'N/A'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function fmtSince(iso) {
  if (!iso) return 'N/A'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const hrs = Math.max(0, Math.round((Date.now() - d.getTime()) / 3_600_000))
  if (hrs < 24) return `${hrs}h`
  return `${Math.round(hrs / 24)}d`
}

function priorityTone(p) {
  const k = String(p || '').toLowerCase()
  if (k.includes('crit')) return 'wt-pill-red'
  if (k.includes('high')) return 'wt-pill-orange'
  if (k.includes('med')) return 'wt-pill-amber'
  return 'wt-pill-slate'
}
function statusTone(s) {
  const k = String(s || '').toLowerCase()
  if (k.includes('progress') || k.includes('open') || k.includes('assigned') || k.includes('new')) return 'wt-pill-blue'
  if (k.includes('hold') || k.includes('pending') || k.includes('wait')) return 'wt-pill-amber'
  if (k.includes('complete') || k.includes('closed') || k.includes('done') || k.includes('inspection')) return 'wt-pill-green'
  return 'wt-pill-slate'
}
function alertTone(level) {
  const k = String(level || '').toLowerCase()
  if (k === 'critical') return 'wt-alert-red'
  if (k === 'warning') return 'wt-alert-amber'
  return 'wt-alert-blue'
}

// ── ECharts option builders (light) ────────────────────────────────────────────
function doughnutOption(items) {
  const colors = categorical(items.length)
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'item', formatter: (p) => `${p.name}: <b>${fmtInt(p.value)}</b> (${p.percent}%)` },
    legend: { bottom: 0, textStyle: { color: P.subText, fontSize: 13 } },
    series: [{
      type: 'pie', radius: ['46%', '72%'], center: ['50%', '44%'], avoidLabelOverlap: true,
      itemStyle: { borderColor: '#ffffff', borderWidth: 2, borderRadius: 6 },
      label: { color: P.text, fontSize: 13, formatter: '{b}: {c}' },
      labelLine: { lineStyle: { color: P.axisLine } },
      data: items.map((it, i) => ({ name: it.label, value: it.value, itemStyle: { color: colors[i] } })),
    }],
  }
}

// Utilization dial (0-100). value may be null for an honest N/A.
function gaugeOption(value) {
  const has = Number.isFinite(value)
  const color = colorAt(0)
  const v = has ? Math.max(0, Math.min(100, value)) : 0
  return {
    backgroundColor: 'transparent',
    series: [{
      type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: 100,
      radius: '94%', center: ['50%', '58%'],
      progress: { show: true, width: 18, itemStyle: { color } },
      axisLine: { lineStyle: { width: 18, color: [[1, withAlpha(color, 0.14)]] } },
      pointer: { show: has, length: '60%', width: 6, itemStyle: { color } },
      anchor: { show: has, size: 14, itemStyle: { color } },
      axisTick: { show: false },
      splitLine: { length: 10, lineStyle: { color: P.axisLine, width: 2 } },
      axisLabel: { color: P.muted, fontSize: 12, distance: -34 },
      title: { offsetCenter: [0, '32%'], color: P.subText, fontSize: 15, fontWeight: 600 },
      detail: {
        offsetCenter: [0, '-4%'], color: has ? P.text : P.muted, fontSize: 40, fontWeight: 800,
        formatter: () => (has ? `${Math.round(v)}%` : 'N/A'),
      },
      data: [{ value: v, name: 'Utilization' }],
    }],
  }
}

// ── KPI tile config (icon + which snapshot.kpis key + a semantic accent) ────────
const KPI_TILES = [
  { key: 'open_jobs', label: 'Open Jobs', icon: ClipboardList, tone: 'blue' },
  { key: 'overdue_jobs', label: 'Overdue Jobs', icon: Timer, tone: 'red' },
  { key: 'vehicles_off_road', label: 'Vehicles Off Road', icon: Car, tone: 'red' },
  { key: 'jobs_completed_today', label: 'Completed Today', icon: CheckCircle2, tone: 'green' },
  { key: 'working', label: 'Working', icon: Wrench, tone: 'green' },
  { key: 'available', label: 'Available', icon: Activity, tone: 'blue' },
  { key: 'waiting_parts', label: 'Waiting Parts', icon: PauseCircle, tone: 'amber' },
  { key: 'waiting_approval', label: 'Waiting Approval', icon: PauseCircle, tone: 'amber' },
  { key: 'on_break', label: 'On Break', icon: Coffee, tone: 'purple' },
  { key: 'absent', label: 'Absent', icon: UserX, tone: 'slate' },
  { key: 'on_duty', label: 'On Duty', icon: ShieldAlert, tone: 'green' },
]

function KpiTile({ tile, value }) {
  const Icon = tile.icon
  return (
    <div className={`wt-tile wt-tone-${tile.tone}`}>
      <div className="wt-tile-head">
        <span className="wt-tile-label">{tile.label}</span>
        {Icon && <Icon size={20} className="wt-tile-icon" aria-hidden="true" />}
      </div>
      <div className="wt-tile-value">{fmtInt(value)}</div>
    </div>
  )
}

function Card({ title, icon: Icon, empty, emptyText, children, className = '' }) {
  return (
    <section className={`wt-card ${className}`}>
      <div className="wt-card-head">
        {Icon && <Icon size={18} className="wt-card-icon" aria-hidden="true" />}
        <h3 className="wt-card-title">{title}</h3>
      </div>
      {empty ? (
        <div className="wt-empty"><p>{emptyText || 'No data right now.'}</p></div>
      ) : children}
    </section>
  )
}

function CenterShell({ children }) {
  return (
    <div className="wt-root wt-center tp-report-paper">
      <ScopedStyle />
      <div className="wt-center-box">{children}</div>
    </div>
  )
}

const REASON_COPY = {
  invalid: { title: 'This board link is not available.', body: 'The link may be incorrect. Please request a new share link.' },
  revoked: { title: 'This board link is not available.', body: 'Sharing for this board has been turned off.' },
  expired: { title: 'This board link has expired.', body: 'Please request a new share link to continue viewing.' },
  unavailable: { title: 'The workshop board is not available right now.', body: 'Please try again in a few minutes.' },
}

// ── Main component ────────────────────────────────────────────────────────────
export default function WorkshopTv() {
  const { token } = useParams()

  const [status, setStatus] = useState('loading') // loading | ok | error | password
  const [reason, setReason] = useState('invalid')
  const [snapshot, setSnapshot] = useState(null)
  const [isFs, setIsFs] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [lastRefresh, setLastRefresh] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const pwRef = useRef(null)
  const loadedRef = useRef(false)

  const load = useCallback(async (pw = null) => {
    if (!token) { setStatus('error'); setReason('invalid'); return false }
    if (!loadedRef.current) setStatus('loading')
    let res
    try { res = await getWorkshopSnapshot(token, pw) } catch { res = { ok: false, reason: 'unavailable' } }
    if (res && res.ok) {
      pwRef.current = pw
      loadedRef.current = true
      setSnapshot(res)
      setStatus('ok')
      setLastRefresh(new Date())
      return true
    }
    const r = res?.reason || 'invalid'
    if (r === 'password') { setStatus('password'); setReason('password'); return false }
    setStatus('error'); setReason(r)
    return false
  }, [token])

  useEffect(() => { load() }, [load])

  // Silent, visibility-gated refresh keeping the last good paint on failure.
  const silentUpdate = useCallback(async () => {
    if (!token) return
    try {
      const res = await getWorkshopSnapshot(token, pwRef.current)
      if (res && res.ok) { setSnapshot(res); setLastRefresh(new Date()) }
    } catch { /* keep the last good snapshot */ }
  }, [token])

  useEffect(() => {
    if (status !== 'ok') return undefined
    const sec = clampSec(snapshot?.refresh_seconds, 60)
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      silentUpdate()
    }, sec * 1000)
    const onVisible = () => { if (typeof document !== 'undefined' && !document.hidden) silentUpdate() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [status, snapshot?.refresh_seconds, silentUpdate])

  const manualRefresh = useCallback(async () => {
    setRefreshing(true)
    await silentUpdate()
    setRefreshing(false)
  }, [silentUpdate])

  const submitPassword = useCallback(async (e) => {
    e.preventDefault()
    setPwBusy(true); setPwError('')
    const ok = await load(pwInput)
    setPwBusy(false)
    if (!ok) setPwError('Incorrect password. Please try again.')
  }, [load, pwInput])

  const toggleFs = useCallback(() => {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.()
      else document.exitFullscreen?.()
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    const onChange = () => setIsFs(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const kpis = snapshot?.kpis || {}
  const jobsByStatus = useMemo(() => arr(snapshot?.jobs_by_status).filter((x) => Number(x?.value) > 0), [snapshot])
  const openCards = useMemo(() => arr(snapshot?.open_job_cards), [snapshot])
  const vorList = useMemo(() => arr(snapshot?.vor_list), [snapshot])
  const alerts = useMemo(() => arr(snapshot?.safety_alerts), [snapshot])
  const utilization = Number.isFinite(Number(kpis.utilization)) ? Number(kpis.utilization) : null

  // ── loading ─────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <CenterShell>
        <Loader2 size={40} className="wt-spin" aria-hidden="true" />
        <p className="wt-center-title">Loading workshop board</p>
        <p className="wt-center-body">Preparing the latest snapshot.</p>
      </CenterShell>
    )
  }

  // ── password ─────────────────────────────────────────────────────────────────
  if (status === 'password') {
    return (
      <CenterShell>
        <KeyRound size={38} className="wt-center-ic" aria-hidden="true" />
        <p className="wt-center-title">This board is protected.</p>
        <p className="wt-center-body">Enter the viewer password to continue.</p>
        <form onSubmit={submitPassword} className="wt-pwform">
          <input
            type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)}
            placeholder="Viewer password" aria-label="Viewer password" autoFocus className="wt-pwinput"
          />
          <button type="submit" disabled={pwBusy || !pwInput} className="wt-pwbtn">
            {pwBusy ? <Loader2 size={16} className="wt-spin" /> : <Lock size={16} />}
            <span>View board</span>
          </button>
        </form>
        {pwError && <p className="wt-pwerror">{pwError}</p>}
      </CenterShell>
    )
  }

  // ── error ────────────────────────────────────────────────────────────────────
  if (status === 'error') {
    const copy = REASON_COPY[reason] || REASON_COPY.invalid
    return (
      <CenterShell>
        <AlertTriangle size={38} className="wt-center-ic" aria-hidden="true" />
        <p className="wt-center-title">{copy.title}</p>
        <p className="wt-center-body">{copy.body}</p>
        {reason === 'unavailable' && (
          <button type="button" onClick={() => load(pwRef.current)} className="wt-pwbtn wt-retry">
            <RotateCw size={16} /> <span>Retry</span>
          </button>
        )}
      </CenterShell>
    )
  }

  // ── ok: live board ───────────────────────────────────────────────────────────
  return (
    <div className="wt-root tp-report-paper">
      <ScopedStyle />

      <header className="wt-header">
        <div className="wt-head-left">
          <div className="wt-brand-mark" aria-hidden="true"><Wrench size={26} /></div>
          <div className="wt-head-titles">
            <p className="wt-company">{snapshot?.company || 'Workshop'}</p>
            <h1 className="wt-name">Workshop Live Board</h1>
          </div>
        </div>
        <div className="wt-head-right">
          <span className="wt-clock" title="Local time">
            <Clock size={18} aria-hidden="true" />
            <span className="wt-clock-time">{fmtClock(now)}</span>
          </span>
          <span className="wt-updated">Updated {fmtUpdated(snapshot?.generated_at)}</span>
          <button type="button" onClick={manualRefresh} disabled={refreshing} className="wt-icbtn" title="Refresh now" aria-label="Refresh now">
            <RotateCw size={18} className={refreshing ? 'wt-spin' : ''} />
          </button>
          <button type="button" onClick={toggleFs} className="wt-icbtn" title={isFs ? 'Exit full screen' : 'Full screen'} aria-label={isFs ? 'Exit full screen' : 'Full screen'}>
            {isFs ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
          </button>
        </div>
      </header>

      <main className="wt-body">
        {/* KPI strip */}
        <div className="wt-kpis">
          {KPI_TILES.map((tile) => <KpiTile key={tile.key} tile={tile} value={kpis[tile.key]} />)}
        </div>

        {/* Charts row: jobs-by-status doughnut + utilization gauge */}
        <div className="wt-row wt-row-2">
          <Card
            title="Jobs by Status" icon={ClipboardList}
            empty={jobsByStatus.length === 0} emptyText="No open job cards."
          >
            <div className="wt-chart"><EChart option={doughnutOption(jobsByStatus)} ariaLabel="Jobs by status" /></div>
          </Card>
          <Card title="Workshop Utilization" icon={Gauge}>
            <div className="wt-chart"><EChart option={gaugeOption(utilization)} ariaLabel="Workshop utilization" /></div>
            <p className="wt-note">Productive time as a share of on-duty time today.</p>
          </Card>
        </div>

        {/* Tables row: open job cards + vehicles off road */}
        <div className="wt-row wt-row-2">
          <Card
            title="Open Job Cards" icon={Wrench}
            empty={openCards.length === 0} emptyText="No open job cards right now."
            className="wt-card-tall"
          >
            <div className="wt-table-wrap">
              <table className="wt-table">
                <thead>
                  <tr>
                    <th>Job No</th><th>Asset</th><th>Status</th><th>Priority</th><th>Site</th>
                  </tr>
                </thead>
                <tbody>
                  {openCards.map((c, i) => (
                    <tr key={`${c.wo_no || 'wo'}-${i}`}>
                      <td className="wt-mono">{safeStr(c.wo_no)}</td>
                      <td className="wt-mono">{safeStr(c.asset_no)}</td>
                      <td><span className={`wt-pill ${statusTone(c.status)}`}>{safeStr(c.status)}</span></td>
                      <td><span className={`wt-pill ${priorityTone(c.priority)}`}>{safeStr(c.priority)}</span></td>
                      <td>{safeStr(c.site)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="wt-stack">
            <Card
              title="Vehicles Off Road" icon={Car}
              empty={vorList.length === 0} emptyText="No vehicles off road."
              className="wt-card-vor"
            >
              <ul className="wt-vor-list">
                {vorList.map((v, i) => (
                  <li key={`${v.asset_no || 'a'}-${i}`} className="wt-vor-item">
                    <span className="wt-vor-asset wt-mono">{safeStr(v.asset_no)}</span>
                    <span className="wt-vor-site">{safeStr(v.site)}</span>
                    <span className="wt-vor-since"><Timer size={14} aria-hidden="true" /> {fmtSince(v.since)}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card
              title="Safety and Operations Alerts" icon={ShieldAlert}
              empty={alerts.length === 0} emptyText="All clear. No active alerts."
              className="wt-card-alerts"
            >
              <ul className="wt-alert-list">
                {alerts.map((a, i) => (
                  <li key={i} className={`wt-alert ${alertTone(a.level)}`}>
                    <ShieldAlert size={16} aria-hidden="true" />
                    <span>{safeStr(a.message)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}

// ── Scoped, forced-light styles (self-contained, no app CSS dependency) ─────────
function ScopedStyle() {
  return (
    <style>{`
      .wt-root {
        --wt-bg: #f1f5f9; --wt-surface: #ffffff; --wt-border: rgba(16,24,40,0.10);
        --wt-text: #0f172a; --wt-sub: #334155; --wt-muted: #64748b;
        min-height: 100vh; background: var(--wt-bg); color: var(--wt-text);
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        display: flex; flex-direction: column;
      }
      .wt-center { align-items: center; justify-content: center; }
      .wt-center-box { text-align: center; max-width: 420px; padding: 32px; }
      .wt-center-title { font-size: 1.25rem; font-weight: 700; margin: 14px 0 6px; }
      .wt-center-body { color: var(--wt-muted); font-size: 0.98rem; }
      .wt-center-ic { color: #ef4444; }
      .wt-spin { animation: wt-spin 1s linear infinite; }
      @keyframes wt-spin { to { transform: rotate(360deg); } }

      .wt-pwform { display: flex; gap: 8px; margin-top: 18px; justify-content: center; flex-wrap: wrap; }
      .wt-pwinput { padding: 10px 14px; border: 1px solid var(--wt-border); border-radius: 10px; font-size: 1rem; background: #fff; color: var(--wt-text); }
      .wt-pwbtn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 10px; border: none; background: #4f46e5; color: #fff; font-weight: 600; cursor: pointer; }
      .wt-pwbtn:disabled { opacity: 0.6; cursor: not-allowed; }
      .wt-retry { background: #334155; margin-top: 16px; }
      .wt-pwerror { color: #ef4444; margin-top: 12px; font-size: 0.92rem; }

      .wt-header {
        display: flex; align-items: center; justify-content: space-between; gap: 16px;
        padding: 16px 24px; background: var(--wt-surface); border-bottom: 1px solid var(--wt-border);
      }
      .wt-head-left { display: flex; align-items: center; gap: 14px; }
      .wt-brand-mark { width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center; background: #eef2ff; color: #4f46e5; }
      .wt-company { font-size: 0.85rem; color: var(--wt-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
      .wt-name { font-size: 1.5rem; font-weight: 800; line-height: 1.1; }
      .wt-head-right { display: flex; align-items: center; gap: 14px; }
      .wt-clock { display: inline-flex; align-items: center; gap: 6px; color: var(--wt-sub); font-weight: 700; font-variant-numeric: tabular-nums; }
      .wt-clock-time { font-size: 1.1rem; }
      .wt-updated { color: var(--wt-muted); font-size: 0.85rem; }
      .wt-icbtn { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 10px; border: 1px solid var(--wt-border); background: #fff; color: var(--wt-sub); cursor: pointer; }
      .wt-icbtn:disabled { opacity: 0.6; cursor: not-allowed; }

      .wt-body { flex: 1; padding: 18px 24px 26px; display: flex; flex-direction: column; gap: 16px; min-height: 0; }

      .wt-kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
      .wt-tile { background: var(--wt-surface); border: 1px solid var(--wt-border); border-radius: 14px; padding: 14px 16px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); border-left-width: 4px; }
      .wt-tile-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .wt-tile-label { font-size: 0.82rem; color: var(--wt-muted); font-weight: 600; }
      .wt-tile-icon { color: var(--wt-muted); }
      .wt-tile-value { font-size: 2rem; font-weight: 800; margin-top: 6px; font-variant-numeric: tabular-nums; }
      .wt-tone-green  { border-left-color: #22c55e; }
      .wt-tone-blue   { border-left-color: #3b82f6; }
      .wt-tone-amber  { border-left-color: #f59e0b; }
      .wt-tone-red    { border-left-color: #ef4444; }
      .wt-tone-purple { border-left-color: #a855f7; }
      .wt-tone-slate  { border-left-color: #64748b; }

      .wt-row { display: grid; gap: 16px; }
      .wt-row-2 { grid-template-columns: 3fr 2fr; }
      .wt-stack { display: flex; flex-direction: column; gap: 16px; min-height: 0; }

      .wt-card { background: var(--wt-surface); border: 1px solid var(--wt-border); border-radius: 16px; padding: 16px 18px; display: flex; flex-direction: column; min-height: 0; box-shadow: 0 1px 2px rgba(16,24,40,0.04); }
      .wt-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .wt-card-icon { color: #4f46e5; }
      .wt-card-title { font-size: 1.05rem; font-weight: 700; }
      .wt-empty { flex: 1; min-height: 160px; display: grid; place-items: center; color: var(--wt-muted); font-size: 0.95rem; }
      .wt-chart { height: 320px; }
      .wt-card-tall .wt-table-wrap { max-height: 420px; }
      .wt-note { margin-top: 6px; color: var(--wt-muted); font-size: 0.82rem; text-align: center; }

      .wt-table-wrap { overflow: auto; border-radius: 10px; }
      .wt-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
      .wt-table thead th { position: sticky; top: 0; background: #f8fafc; text-align: left; padding: 10px 12px; color: var(--wt-muted); font-weight: 700; border-bottom: 1px solid var(--wt-border); white-space: nowrap; }
      .wt-table tbody td { padding: 10px 12px; border-bottom: 1px solid rgba(16,24,40,0.06); color: var(--wt-sub); }
      .wt-table tbody tr:nth-child(even) { background: #fafbfd; }
      .wt-mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--wt-text); }

      .wt-pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 0.78rem; font-weight: 700; }
      .wt-pill-blue { background: #dbeafe; color: #1d4ed8; }
      .wt-pill-green { background: #dcfce7; color: #15803d; }
      .wt-pill-amber { background: #fef3c7; color: #b45309; }
      .wt-pill-orange { background: #ffedd5; color: #c2410c; }
      .wt-pill-red { background: #fee2e2; color: #b91c1c; }
      .wt-pill-slate { background: #e2e8f0; color: #334155; }

      .wt-vor-list, .wt-alert-list { list-style: none; display: flex; flex-direction: column; gap: 8px; overflow: auto; max-height: 240px; }
      .wt-vor-item { display: grid; grid-template-columns: 1fr 1fr auto; align-items: center; gap: 8px; padding: 8px 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; }
      .wt-vor-asset { font-weight: 700; }
      .wt-vor-site { color: var(--wt-sub); font-size: 0.9rem; }
      .wt-vor-since { display: inline-flex; align-items: center; gap: 4px; color: #b91c1c; font-weight: 700; font-size: 0.85rem; }

      .wt-alert { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 10px; font-size: 0.9rem; font-weight: 600; }
      .wt-alert-red { background: #fee2e2; color: #b91c1c; }
      .wt-alert-amber { background: #fef3c7; color: #b45309; }
      .wt-alert-blue { background: #dbeafe; color: #1d4ed8; }

      @media (max-width: 1100px) {
        .wt-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .wt-row-2 { grid-template-columns: 1fr; }
      }
      @media (min-width: 1920px) {
        .wt-name { font-size: 1.9rem; }
        .wt-tile-value { font-size: 2.5rem; }
        .wt-chart { height: 400px; }
      }
    `}</style>
  )
}
