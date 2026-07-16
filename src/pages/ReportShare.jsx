/**
 * ReportShare - PUBLIC, anonymous, LIGHT-THEME auto-rotating TV / kiosk report
 * viewer mounted at /report/:token (outside the app auth shell).
 *
 * The ONLY data source is the token-gated get_report_snapshot RPC
 * (src/lib/api/reportShares.js), which returns an org-scoped AGGREGATE snapshot
 * (KPIs, 12-month trends, breakdowns) - never raw rows or PII. The token in the
 * URL is the sole credential; an optional viewer password gates the snapshot.
 *
 * Design goals:
 *  - Always LIGHT (a wall board of a boardroom report must never flash dark).
 *  - Advanced ECharts visuals in the Executive Analytics style (dual-axis combo,
 *    smooth area lines, rounded doughnut, treemap), all rendered on white.
 *  - Rotates through only the pages the share creator selected, on the share's
 *    rotate cadence; silently refreshes on the refresh cadence and keeps the last
 *    good data if a refresh fails (never flips to an error after a good paint).
 *  - Honest loading / error(by reason) / per-chart empty states. No fabrication.
 *  - Copy contains NO em or en dashes, arrows, middle dots or curly quotes.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  Maximize2, Minimize2, RefreshCw, AlertTriangle, Lock, Clock, KeyRound,
  TrendingUp, BarChart3, PieChart, Activity, ShieldAlert, MapPin, LayoutGrid,
  Car, CircleDot, Wallet, ClipboardCheck, Loader2,
} from 'lucide-react'
import { getReportSnapshot, REPORT_PAGES } from '../lib/api/reportShares'
import { categorical, colorAt, withAlpha } from '../lib/reportColors'

// ── Light chart palette (pinned literals so canvases read on white paper) ──────
const P = {
  text: '#0f172a',
  subText: '#334155',
  muted: '#64748b',
  axisLine: 'rgba(16,24,40,0.16)',
  splitLine: 'rgba(16,24,40,0.07)',
}
const TOOLTIP = {
  backgroundColor: '#ffffff',
  borderColor: 'rgba(16,24,40,0.12)',
  borderWidth: 1,
  textStyle: { color: P.text, fontSize: 13 },
}

// ── Number / date formatting (grouping only, no invented currency symbol) ──────
const GROUP = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const fmtInt = (v) => GROUP.format(Math.round(Number(v) || 0))

function fmtCompact(v) {
  const n = Number(v) || 0
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(Math.round(n))
}

function fmtUpdated(iso) {
  if (!iso) return 'N/A'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString('en-US', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

const PAGE_LABEL = REPORT_PAGES.reduce((m, p) => { m[p.key] = p.label; return m }, {})
const clampSec = (v, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
const arr = (v) => (Array.isArray(v) ? v : [])
const someNonZero = (list) => arr(list).some((n) => Number(n) > 0)

// ── ECharts option builders (light, advanced, reuse the shared palette) ────────

function sparkOption(series, idx) {
  const color = colorAt(idx)
  return {
    backgroundColor: 'transparent',
    grid: { left: 0, right: 0, top: 4, bottom: 0 },
    xAxis: { type: 'category', show: false, data: series.map((_, i) => i) },
    yAxis: { type: 'value', show: false },
    tooltip: { show: false },
    series: [{
      type: 'line', data: series, smooth: true, symbol: 'none',
      lineStyle: { width: 2.5, color },
      areaStyle: { color: withAlpha(color, 0.16) },
    }],
  }
}

function comboOption(labels, spend, accidents) {
  const cSpend = colorAt(0)
  const cAcc = colorAt(3)
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, textStyle: { color: P.subText, fontSize: 14 }, itemGap: 20 },
    grid: { left: 10, right: 12, top: 44, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: labels,
      axisLabel: { color: P.muted, fontSize: 13 },
      axisLine: { lineStyle: { color: P.axisLine } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value', name: 'Spend', nameTextStyle: { color: P.muted, fontSize: 12 },
        axisLabel: { color: P.muted, fontSize: 12, formatter: (v) => fmtCompact(v) },
        splitLine: { lineStyle: { color: P.splitLine } },
      },
      {
        type: 'value', name: 'Accidents', nameTextStyle: { color: P.muted, fontSize: 12 },
        axisLabel: { color: P.muted, fontSize: 12 },
        splitLine: { show: false }, minInterval: 1,
      },
    ],
    series: [
      {
        name: 'Tyre Spend', type: 'bar', data: spend, barMaxWidth: 36,
        itemStyle: { color: cSpend, borderRadius: [5, 5, 0, 0] },
        markPoint: {
          symbol: 'pin', symbolSize: 46,
          data: [{ type: 'max', name: 'Max' }],
          itemStyle: { color: withAlpha(cSpend, 0.9) },
          label: { color: '#ffffff', fontSize: 11, formatter: (d) => fmtCompact(d.value) },
        },
      },
      {
        name: 'Accidents', type: 'line', yAxisIndex: 1, data: accidents,
        smooth: true, symbol: 'circle', symbolSize: 7,
        lineStyle: { width: 3, color: cAcc }, itemStyle: { color: cAcc },
        areaStyle: { color: withAlpha(cAcc, 0.1) },
      },
    ],
  }
}

function claimsOption(labels, claimed, recovered) {
  const c1 = colorAt(4)
  const c2 = colorAt(1)
  const line = (name, data, color) => ({
    name, type: 'line', data, smooth: true, symbol: 'circle', symbolSize: 6,
    lineStyle: { width: 3, color }, itemStyle: { color },
    areaStyle: { color: withAlpha(color, 0.1) },
  })
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...TOOLTIP, trigger: 'axis',
      valueFormatter: (v) => fmtInt(v),
    },
    legend: { top: 0, textStyle: { color: P.subText, fontSize: 14 }, itemGap: 20 },
    grid: { left: 10, right: 14, top: 44, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: labels,
      axisLabel: { color: P.muted, fontSize: 13 },
      axisLine: { lineStyle: { color: P.axisLine } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: P.muted, fontSize: 12, formatter: (v) => fmtCompact(v) },
      splitLine: { lineStyle: { color: P.splitLine } },
    },
    series: [line('Claimed', claimed, c1), line('Recovered', recovered, c2)],
  }
}

function inspectionsOption(labels, data) {
  const color = colorAt(2)
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', valueFormatter: (v) => fmtInt(v) },
    grid: { left: 10, right: 14, top: 20, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: labels,
      axisLabel: { color: P.muted, fontSize: 13 },
      axisLine: { lineStyle: { color: P.axisLine } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value', minInterval: 1,
      axisLabel: { color: P.muted, fontSize: 12 },
      splitLine: { lineStyle: { color: P.splitLine } },
    },
    series: [{
      name: 'Inspections', type: 'line', data, smooth: true,
      symbol: 'circle', symbolSize: 7,
      lineStyle: { width: 3, color }, itemStyle: { color },
      areaStyle: { color: withAlpha(color, 0.14) },
    }],
  }
}

function doughnutOption(items) {
  const colors = categorical(items.length)
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...TOOLTIP, trigger: 'item',
      formatter: (p) => `${p.name}: <b>${fmtInt(p.value)}</b> (${p.percent}%)`,
    },
    legend: { bottom: 0, textStyle: { color: P.subText, fontSize: 13 } },
    series: [{
      type: 'pie', radius: ['44%', '72%'], center: ['50%', '46%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#ffffff', borderWidth: 2, borderRadius: 6 },
      label: { color: P.text, fontSize: 13, formatter: '{b}: {c}' },
      labelLine: { lineStyle: { color: P.axisLine } },
      data: items.map((it, i) => ({ name: it.label, value: it.value, itemStyle: { color: colors[i] } })),
    }],
  }
}

function hbarOption(items) {
  const colors = categorical(items.length)
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => fmtInt(v) },
    grid: { left: 10, right: 28, top: 12, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: P.muted, fontSize: 12, formatter: (v) => fmtCompact(v) },
      splitLine: { lineStyle: { color: P.splitLine } },
    },
    yAxis: {
      type: 'category', data: items.map((i) => i.label),
      axisLabel: { color: P.subText, fontSize: 13 },
      axisLine: { lineStyle: { color: P.axisLine } },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar', barMaxWidth: 28,
      data: items.map((it, i) => ({ value: it.value, itemStyle: { color: colors[i], borderRadius: [0, 6, 6, 0] } })),
      label: { show: true, position: 'right', color: P.subText, fontSize: 12, formatter: (p) => fmtInt(p.value) },
    }],
  }
}

function vbarOption(items) {
  const colors = categorical(items.length)
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => fmtInt(v) },
    grid: { left: 10, right: 14, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: items.map((i) => i.label),
      axisLabel: { color: P.muted, fontSize: 12, interval: 0, rotate: items.length > 6 ? 30 : 0 },
      axisLine: { lineStyle: { color: P.axisLine } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value', minInterval: 1,
      axisLabel: { color: P.muted, fontSize: 12 },
      splitLine: { lineStyle: { color: P.splitLine } },
    },
    series: [{
      type: 'bar', barMaxWidth: 44,
      data: items.map((it, i) => ({ value: it.value, itemStyle: { color: colors[i], borderRadius: [6, 6, 0, 0] } })),
      label: { show: true, position: 'top', color: P.subText, fontSize: 12, formatter: (p) => fmtInt(p.value) },
    }],
  }
}

function treemapOption(items) {
  const colors = categorical(items.length)
  return {
    backgroundColor: 'transparent',
    tooltip: { ...TOOLTIP, formatter: (p) => `${p.name}: <b>${fmtInt(p.value)}</b>` },
    series: [{
      type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false },
      width: '100%', height: '100%', top: 4, left: 4, right: 4, bottom: 4,
      label: { show: true, color: '#ffffff', fontSize: 14, formatter: '{b}\n{c}' },
      itemStyle: { borderColor: '#ffffff', borderWidth: 2, gapWidth: 2 },
      data: items.map((it, i) => ({ name: it.label, value: it.value, itemStyle: { color: colors[i] } })),
    }],
  }
}

// ── Lazy EChart import (this page renders outside the app bundle graph) ─────────
// EChart is the shared wrapper; importing it statically is fine and keeps the
// heavy echarts module dynamically loaded by the wrapper itself.
import EChart from '../components/charts/EChart'

// ── Presentational subcomponents ──────────────────────────────────────────────

const KPI_TILES = [
  { key: 'fleet', label: 'Fleet Vehicles', icon: Car, kind: 'count', spark: null },
  { key: 'tyres', label: 'Tyres Tracked', icon: CircleDot, kind: 'count', spark: null },
  { key: 'tyre_spend', label: 'Tyre Spend', icon: Wallet, kind: 'money', spark: 'tyre_spend', caption: 'spend' },
  { key: 'accidents', label: 'Accidents (12 mo)', icon: ShieldAlert, kind: 'count', spark: 'accidents' },
  { key: 'open_accidents', label: 'Open Accidents', icon: AlertTriangle, kind: 'count', spark: null },
  { key: 'claims_claimed', label: 'Claims Claimed', icon: Wallet, kind: 'money', spark: 'claims_claimed', caption: 'claimed' },
  { key: 'claims_recovered', label: 'Claims Recovered', icon: Wallet, kind: 'money', spark: 'claims_recovered', caption: 'recovered' },
  { key: 'inspections', label: 'Inspections (12 mo)', icon: ClipboardCheck, kind: 'count', spark: 'inspections' },
  { key: 'work_orders_open', label: 'Open Work Orders', icon: Activity, kind: 'count', spark: null },
]

function KpiTile({ tile, value, series, sparkIdx }) {
  const isMoney = tile.kind === 'money'
  const display = isMoney ? fmtInt(value) : fmtInt(value)
  const Icon = tile.icon
  const hasSpark = Array.isArray(series) && series.length > 1 && someNonZero(series)
  return (
    <div className="rs-tile">
      <div className="rs-tile-head">
        <span className="rs-tile-label">{tile.label}</span>
        {Icon && <Icon size={20} className="rs-tile-icon" aria-hidden="true" />}
      </div>
      <div className="rs-tile-value">{display}</div>
      <div className="rs-tile-foot">
        {isMoney
          ? <span className="rs-tile-cap">{tile.caption || 'value'}</span>
          : <span className="rs-tile-cap">count</span>}
        {hasSpark && (
          <div className="rs-tile-spark">
            <EChart option={sparkOption(series, sparkIdx)} ariaLabel={`${tile.label} trend`} style={{ height: 34, minHeight: 34 }} />
          </div>
        )}
      </div>
    </div>
  )
}

function ChartCard({ title, subtitle, icon: Icon, empty, emptyText, height = 360, children, wide }) {
  return (
    <section className={`rs-card ${wide ? 'rs-card-wide' : ''}`}>
      <div className="rs-card-head">
        {Icon && <Icon size={18} className="rs-card-icon" aria-hidden="true" />}
        <div className="rs-card-titles">
          <h3 className="rs-card-title">{title}</h3>
          {subtitle && <p className="rs-card-sub">{subtitle}</p>}
        </div>
      </div>
      {empty ? (
        <div className="rs-empty" style={{ height }}>
          <p>{emptyText || 'No data for this period.'}</p>
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </section>
  )
}

function RotationDots({ pages, active }) {
  if (!pages.length) return null
  return (
    <div className="rs-dots" aria-hidden="true">
      {pages.map((key, i) => (
        <span key={key} className={`rs-dot ${i === active ? 'rs-dot-on' : ''}`} title={PAGE_LABEL[key] || key} />
      ))}
    </div>
  )
}

// ── Full-screen state shells ──────────────────────────────────────────────────

function CenterShell({ children }) {
  return (
    <div className="rs-root rs-center">
      <ScopedStyle />
      <div className="rs-center-box">{children}</div>
    </div>
  )
}

const REASON_COPY = {
  invalid: { title: 'This report link is not available.', body: 'The link may be incorrect. Please request a new share link.' },
  revoked: { title: 'This report link is not available.', body: 'Sharing for this report has been turned off.' },
  expired: { title: 'This report link has expired.', body: 'Please request a new share link to continue viewing.' },
  unavailable: { title: 'Report sharing is not available right now.', body: 'Please try again in a few minutes.' },
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReportShare() {
  const { token } = useParams()

  const [status, setStatus] = useState('loading') // loading | ok | error | password
  const [reason, setReason] = useState('invalid')
  const [snapshot, setSnapshot] = useState(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [isFs, setIsFs] = useState(false)
  const [paused, setPaused] = useState(false)

  // Password screen local state
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const pwRef = useRef(null)        // password that produced the current snapshot
  const loadedRef = useRef(false)   // true once a good snapshot has ever painted

  // ── Initial / password-driven load ──────────────────────────────────────────
  const load = useCallback(async (pw = null) => {
    if (!token) { setStatus('error'); setReason('invalid'); return }
    if (!loadedRef.current) setStatus('loading')
    let res
    try {
      res = await getReportSnapshot(token, pw)
    } catch {
      res = { ok: false, reason: 'unavailable' }
    }
    if (res && res.ok) {
      pwRef.current = pw
      loadedRef.current = true
      setSnapshot(res)
      setPageIndex(0)
      setStatus('ok')
      return true
    }
    const r = res?.reason || 'invalid'
    if (r === 'password') {
      setStatus('password')
      setReason('password')
      return false
    }
    setStatus('error')
    setReason(r)
    return false
  }, [token])

  useEffect(() => { load() }, [load])

  const submitPassword = useCallback(async (e) => {
    e.preventDefault()
    setPwBusy(true)
    setPwError('')
    const ok = await load(pwInput)
    setPwBusy(false)
    if (!ok) setPwError('Incorrect password. Please try again.')
  }, [load, pwInput])

  // ── Rotation ────────────────────────────────────────────────────────────────
  const pages = useMemo(() => arr(snapshot?.pages).filter((k) => PAGE_LABEL[k]), [snapshot])

  useEffect(() => {
    // Keep the active page in range after a silent refresh changes the set.
    if (pages.length > 0 && pageIndex >= pages.length) setPageIndex(0)
  }, [pages, pageIndex])

  useEffect(() => {
    if (status !== 'ok' || pages.length <= 1 || paused) return undefined
    const sec = clampSec(snapshot?.rotate_seconds, 30)
    const id = setInterval(() => {
      setPageIndex((i) => (i + 1) % pages.length)
    }, sec * 1000)
    return () => clearInterval(id)
  }, [status, pages.length, snapshot?.rotate_seconds, paused])

  // ── Silent auto-refresh (keeps last good data on failure) ───────────────────
  useEffect(() => {
    if (status !== 'ok') return undefined
    const sec = clampSec(snapshot?.refresh_seconds, 300)
    const id = setInterval(async () => {
      try {
        const res = await getReportSnapshot(token, pwRef.current)
        if (res && res.ok) setSnapshot(res)
      } catch { /* keep showing the last good snapshot */ }
    }, sec * 1000)
    return () => clearInterval(id)
  }, [status, snapshot?.refresh_seconds, token])

  // ── Fullscreen ──────────────────────────────────────────────────────────────
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

  // ── States: loading ─────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <CenterShell>
        <Loader2 size={40} className="rs-spin" aria-hidden="true" />
        <p className="rs-center-title">Loading report</p>
        <p className="rs-center-body">Preparing the latest snapshot.</p>
      </CenterShell>
    )
  }

  // ── States: password required ───────────────────────────────────────────────
  if (status === 'password') {
    return (
      <CenterShell>
        <KeyRound size={38} className="rs-center-ic" aria-hidden="true" />
        <p className="rs-center-title">This report is protected.</p>
        <p className="rs-center-body">Enter the viewer password to continue.</p>
        <form onSubmit={submitPassword} className="rs-pwform">
          <input
            type="password"
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            placeholder="Viewer password"
            aria-label="Viewer password"
            autoFocus
            className="rs-pwinput"
          />
          <button type="submit" disabled={pwBusy || !pwInput} className="rs-pwbtn">
            {pwBusy ? <Loader2 size={16} className="rs-spin" /> : <Lock size={16} />}
            <span>View report</span>
          </button>
        </form>
        {pwError && <p className="rs-pwerror">{pwError}</p>}
      </CenterShell>
    )
  }

  // ── States: error (by reason) ───────────────────────────────────────────────
  if (status === 'error') {
    const copy = REASON_COPY[reason] || REASON_COPY.invalid
    return (
      <CenterShell>
        <AlertTriangle size={38} className="rs-center-ic" aria-hidden="true" />
        <p className="rs-center-title">{copy.title}</p>
        <p className="rs-center-body">{copy.body}</p>
        {(reason === 'unavailable') && (
          <button type="button" onClick={() => load(pwRef.current)} className="rs-pwbtn rs-retry">
            <RefreshCw size={16} /> <span>Retry</span>
          </button>
        )}
      </CenterShell>
    )
  }

  // ── State: OK (live board) ──────────────────────────────────────────────────
  const activeKey = pages[pageIndex] || pages[0]
  const rotateSec = clampSec(snapshot?.rotate_seconds, 30)

  return (
    <div
      className="rs-root tp-report-paper"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <ScopedStyle />

      {/* Top rotation progress bar */}
      {pages.length > 1 && (
        <div className="rs-progress">
          <div
            key={`${pageIndex}-${snapshot?.generated_at || ''}-${paused ? 'p' : 'r'}`}
            className="rs-progress-fill"
            style={{ animationDuration: `${rotateSec}s`, animationPlayState: paused ? 'paused' : 'running' }}
          />
        </div>
      )}

      {/* Header band */}
      <header className="rs-header">
        <div className="rs-head-left">
          <p className="rs-company">{snapshot?.company || 'Fleet report'}</p>
          <h1 className="rs-name">{snapshot?.name || 'Shared report'}</h1>
        </div>
        <div className="rs-head-mid">
          <span className="rs-page-chip">{PAGE_LABEL[activeKey] || 'Report'}</span>
          <RotationDots pages={pages} active={pageIndex} />
        </div>
        <div className="rs-head-right">
          <span className="rs-updated">
            <Clock size={14} aria-hidden="true" /> Updated {fmtUpdated(snapshot?.generated_at)}
          </span>
          <button type="button" onClick={toggleFs} className="rs-fsbtn" title={isFs ? 'Exit full screen' : 'Full screen'} aria-label={isFs ? 'Exit full screen' : 'Full screen'}>
            {isFs ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </header>

      {/* Rotating page body */}
      <main className="rs-body">
        {activeKey === 'board_kpis' && <KpisPage snapshot={snapshot} />}
        {activeKey === 'fleet_overview' && <FleetOverviewPage snapshot={snapshot} />}
        {activeKey === 'board_trends' && <TrendsPage snapshot={snapshot} />}
        {activeKey === 'spend_trend' && <SpendTrendPage snapshot={snapshot} />}
        {activeKey === 'risk_activity' && <RiskActivityPage snapshot={snapshot} />}
        {activeKey === 'claims_desk' && <ClaimsDeskPage snapshot={snapshot} />}
        {activeKey === 'board_charts' && <ChartsPage snapshot={snapshot} />}
      </main>
    </div>
  )
}

// ── Page: KPIs ────────────────────────────────────────────────────────────────
function KpisPage({ snapshot }) {
  const kpis = snapshot?.kpis || {}
  const trends = snapshot?.trends || {}
  const sparkColor = { tyre_spend: 0, accidents: 3, claims_claimed: 4, claims_recovered: 1, inspections: 2 }
  return (
    <div className="rs-kpi-grid">
      {KPI_TILES.map((tile) => (
        <KpiTile
          key={tile.key}
          tile={tile}
          value={kpis[tile.key] ?? 0}
          series={tile.spark ? arr(trends[tile.spark]) : null}
          sparkIdx={sparkColor[tile.spark] ?? 0}
        />
      ))}
    </div>
  )
}

// ── Page: Trends ──────────────────────────────────────────────────────────────
function TrendsPage({ snapshot }) {
  const labels = arr(snapshot?.labels)
  const t = snapshot?.trends || {}
  const spend = arr(t.tyre_spend)
  const accidents = arr(t.accidents)
  const claimed = arr(t.claims_claimed)
  const recovered = arr(t.claims_recovered)
  const inspections = arr(t.inspections)

  const comboEmpty = !labels.length || (!someNonZero(spend) && !someNonZero(accidents))
  const claimsEmpty = !labels.length || (!someNonZero(claimed) && !someNonZero(recovered))
  const inspEmpty = !labels.length || !someNonZero(inspections)

  return (
    <div className="rs-page">
      <ChartCard
        wide
        title="Tyre spend and accidents"
        subtitle="Monthly tyre spend (bars, left axis) against accident count (line, right axis)"
        icon={TrendingUp}
        empty={comboEmpty}
        height="46vh"
      >
        <EChart option={comboOption(labels, spend, accidents)} ariaLabel="Tyre spend and accidents trend" />
      </ChartCard>

      <div className="rs-page-row">
        <ChartCard
          title="Claims: claimed vs recovered"
          subtitle="Monthly claimed value against recovered value"
          icon={Activity}
          empty={claimsEmpty}
          height="30vh"
        >
          <EChart option={claimsOption(labels, claimed, recovered)} ariaLabel="Claims claimed versus recovered" />
        </ChartCard>
        <ChartCard
          title="Inspections completed"
          subtitle="Monthly inspection volume"
          icon={ClipboardCheck}
          empty={inspEmpty}
          height="30vh"
        >
          <EChart option={inspectionsOption(labels, inspections)} ariaLabel="Inspections completed trend" />
        </ChartCard>
      </div>
    </div>
  )
}

// ── Page: Breakdowns ──────────────────────────────────────────────────────────
function ChartsPage({ snapshot }) {
  const b = snapshot?.breakdowns || {}
  const severity = arr(b.severity)
  const claimStatus = arr(b.claim_status)
  const accidentsBySite = arr(b.accidents_by_site)
  const tyresBySite = arr(b.tyres_by_site)

  return (
    <div className="rs-page rs-grid-2">
      <ChartCard title="Accidents by severity" subtitle="Share of incidents by severity band" icon={PieChart} empty={!severity.length} height="34vh">
        <EChart option={doughnutOption(severity)} ariaLabel="Accidents by severity" />
      </ChartCard>
      <ChartCard title="Claims by status" subtitle="Open and closed claim volume" icon={BarChart3} empty={!claimStatus.length} height="34vh">
        <EChart option={hbarOption(claimStatus)} ariaLabel="Claims by status" />
      </ChartCard>
      <ChartCard title="Accidents by site" subtitle="Incident count across sites" icon={MapPin} empty={!accidentsBySite.length} height="34vh">
        <EChart option={vbarOption(accidentsBySite)} ariaLabel="Accidents by site" />
      </ChartCard>
      <ChartCard title="Tyres by site" subtitle="Tyre volume distribution across sites" icon={LayoutGrid} empty={!tyresBySite.length} height="34vh">
        <EChart option={treemapOption(tyresBySite)} ariaLabel="Tyres by site" />
      </ChartCard>
    </div>
  )
}

// ── Compact KPI tile strip (reused by the board-style pages below) ─────────────
const SPARK_COLOR = { tyre_spend: 0, accidents: 3, claims_claimed: 4, claims_recovered: 1, inspections: 2 }
function TileStrip({ snapshot, keys }) {
  const kpis = snapshot?.kpis || {}
  const trends = snapshot?.trends || {}
  const tiles = keys.map((k) => KPI_TILES.find((t) => t.key === k)).filter(Boolean)
  if (!tiles.length) return null
  return (
    <div className="rs-strip" style={{ gridTemplateColumns: `repeat(${tiles.length},minmax(0,1fr))` }}>
      {tiles.map((tile) => (
        <KpiTile
          key={tile.key}
          tile={tile}
          value={kpis[tile.key] ?? 0}
          series={tile.spark ? arr(trends[tile.spark]) : null}
          sparkIdx={SPARK_COLOR[tile.spark] ?? 0}
        />
      ))}
    </div>
  )
}

// ── Page: Fleet Overview ──────────────────────────────────────────────────────
function FleetOverviewPage({ snapshot }) {
  const labels = arr(snapshot?.labels)
  const inspections = arr(snapshot?.trends?.inspections)
  const tyresBySite = arr(snapshot?.breakdowns?.tyres_by_site)
  const inspEmpty = !labels.length || !someNonZero(inspections)
  return (
    <div className="rs-page">
      <TileStrip snapshot={snapshot} keys={['fleet', 'tyres', 'inspections', 'work_orders_open']} />
      <div className="rs-page-row">
        <ChartCard title="Tyres by site" subtitle="Tyre volume distribution across sites" icon={LayoutGrid} empty={!tyresBySite.length} height="50vh">
          <EChart option={treemapOption(tyresBySite)} ariaLabel="Tyres by site" />
        </ChartCard>
        <ChartCard title="Inspections completed" subtitle="Monthly inspection volume" icon={ClipboardCheck} empty={inspEmpty} height="50vh">
          <EChart option={inspectionsOption(labels, inspections)} ariaLabel="Inspections completed trend" />
        </ChartCard>
      </div>
    </div>
  )
}

// ── Page: Spend Trend ─────────────────────────────────────────────────────────
function SpendTrendPage({ snapshot }) {
  const labels = arr(snapshot?.labels)
  const spend = arr(snapshot?.trends?.tyre_spend)
  const accidents = arr(snapshot?.trends?.accidents)
  const comboEmpty = !labels.length || (!someNonZero(spend) && !someNonZero(accidents))
  return (
    <div className="rs-page">
      <TileStrip snapshot={snapshot} keys={['tyre_spend', 'accidents', 'fleet']} />
      <ChartCard
        wide
        title="Tyre spend and accidents"
        subtitle="Monthly tyre spend (bars, left axis) against accident count (line, right axis)"
        icon={TrendingUp}
        empty={comboEmpty}
        height="56vh"
      >
        <EChart option={comboOption(labels, spend, accidents)} ariaLabel="Tyre spend and accidents trend" />
      </ChartCard>
    </div>
  )
}

// ── Page: Risk & Activity ─────────────────────────────────────────────────────
function RiskActivityPage({ snapshot }) {
  const severity = arr(snapshot?.breakdowns?.severity)
  const accidentsBySite = arr(snapshot?.breakdowns?.accidents_by_site)
  return (
    <div className="rs-page">
      <TileStrip snapshot={snapshot} keys={['accidents', 'open_accidents', 'work_orders_open']} />
      <div className="rs-page-row">
        <ChartCard title="Accidents by severity" subtitle="Share of incidents by severity band" icon={PieChart} empty={!severity.length} height="50vh">
          <EChart option={doughnutOption(severity)} ariaLabel="Accidents by severity" />
        </ChartCard>
        <ChartCard title="Accidents by site" subtitle="Incident count across sites" icon={MapPin} empty={!accidentsBySite.length} height="50vh">
          <EChart option={vbarOption(accidentsBySite)} ariaLabel="Accidents by site" />
        </ChartCard>
      </div>
    </div>
  )
}

// ── Page: Claims Desk ─────────────────────────────────────────────────────────
function ClaimsDeskPage({ snapshot }) {
  const labels = arr(snapshot?.labels)
  const claimed = arr(snapshot?.trends?.claims_claimed)
  const recovered = arr(snapshot?.trends?.claims_recovered)
  const claimStatus = arr(snapshot?.breakdowns?.claim_status)
  const claimsEmpty = !labels.length || (!someNonZero(claimed) && !someNonZero(recovered))
  return (
    <div className="rs-page">
      <TileStrip snapshot={snapshot} keys={['claims_claimed', 'claims_recovered', 'open_accidents']} />
      <div className="rs-page-row">
        <ChartCard title="Claimed vs recovered" subtitle="Monthly claimed value against recovered value" icon={Activity} empty={claimsEmpty} height="50vh">
          <EChart option={claimsOption(labels, claimed, recovered)} ariaLabel="Claims claimed versus recovered" />
        </ChartCard>
        <ChartCard title="Claims by status" subtitle="Open and closed claim volume" icon={BarChart3} empty={!claimStatus.length} height="50vh">
          <EChart option={hbarOption(claimStatus)} ariaLabel="Claims by status" />
        </ChartCard>
      </div>
    </div>
  )
}

// ── Scoped light theme + layout CSS (self-contained, no external stylesheet) ───
function ScopedStyle() {
  return (
    <style>{`
      .rs-root {
        --rs-bg:#f1f5f9; --rs-card:#ffffff; --rs-text:#0f172a; --rs-sub:#334155;
        --rs-muted:#64748b; --rs-border:#e2e8f0; --rs-accent:#6366f1;
        /* Flip shared report vars light so any reused .card / chart shell stays white */
        --surface-0:#ffffff; --surface-1:#f8fafc; --surface-2:#f1f5f9; --surface-3:#e2e8f0;
        --card-from:#ffffff; --card-to:#ffffff; --card-text:#0f172a;
        --border-dim:#e5e7eb; --border-bright:#cbd5e1; --border-brand:#e6e9ee;
        --text-primary:#0f172a; --text-secondary:#334155; --text-muted:#64748b; --text-dim:#94a3b8;
        min-height:100vh; width:100%;
        background:var(--rs-bg); color:var(--rs-text);
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
        display:flex; flex-direction:column;
        box-sizing:border-box; overflow:hidden;
      }
      .rs-root *, .rs-root *::before, .rs-root *::after { box-sizing:border-box; }
      .rs-center { align-items:center; justify-content:center; padding:24px; }
      .rs-center-box {
        background:var(--rs-card); border:1px solid var(--rs-border); border-radius:20px;
        padding:40px 48px; max-width:520px; width:100%; text-align:center;
        box-shadow:0 12px 40px rgba(15,23,42,0.08); color:var(--rs-text);
        display:flex; flex-direction:column; align-items:center; gap:8px;
      }
      .rs-center-ic { color:#94a3b8; margin-bottom:6px; }
      .rs-center-title { font-size:22px; font-weight:700; margin:6px 0 0; }
      .rs-center-body { font-size:15px; color:var(--rs-muted); margin:0; line-height:1.5; }
      .rs-spin { animation:rs-rotate 1s linear infinite; color:var(--rs-accent); }
      @keyframes rs-rotate { to { transform:rotate(360deg); } }

      .rs-pwform { display:flex; gap:10px; width:100%; margin-top:18px; }
      .rs-pwinput {
        flex:1; padding:11px 14px; border:1px solid var(--rs-border); border-radius:12px;
        font-size:15px; color:var(--rs-text); background:#f8fafc; outline:none;
      }
      .rs-pwinput:focus { border-color:var(--rs-accent); box-shadow:0 0 0 3px rgba(99,102,241,0.15); }
      .rs-pwbtn {
        display:inline-flex; align-items:center; gap:8px; padding:11px 18px; border:none;
        border-radius:12px; background:var(--rs-accent); color:#ffffff; font-size:14px;
        font-weight:600; cursor:pointer; transition:opacity .15s;
      }
      .rs-pwbtn:disabled { opacity:.5; cursor:not-allowed; }
      .rs-retry { background:#2563eb; margin-top:18px; }
      .rs-pwerror { color:#dc2626; font-size:14px; margin:12px 0 0; }

      .rs-progress { height:4px; width:100%; background:var(--rs-border); flex:0 0 auto; }
      .rs-progress-fill { height:100%; width:0; background:var(--rs-accent); animation:rs-fill linear forwards; }
      @keyframes rs-fill { from { width:0; } to { width:100%; } }

      .rs-header {
        flex:0 0 auto; display:flex; align-items:center; justify-content:space-between;
        gap:16px; padding:16px 28px; background:var(--rs-card);
        border-bottom:1px solid var(--rs-border);
      }
      .rs-head-left { min-width:0; }
      .rs-company { margin:0; font-size:13px; font-weight:700; letter-spacing:.12em;
        text-transform:uppercase; color:var(--rs-muted); }
      .rs-name { margin:2px 0 0; font-size:26px; font-weight:800; color:var(--rs-text);
        line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:42vw; }
      .rs-head-mid { display:flex; align-items:center; gap:14px; }
      .rs-page-chip {
        font-size:15px; font-weight:700; color:var(--rs-accent);
        background:rgba(99,102,241,0.1); border:1px solid rgba(99,102,241,0.2);
        padding:6px 14px; border-radius:999px; white-space:nowrap;
      }
      .rs-dots { display:flex; align-items:center; gap:7px; }
      .rs-dot { width:9px; height:9px; border-radius:999px; background:var(--rs-border); transition:all .2s; }
      .rs-dot-on { background:var(--rs-accent); width:24px; }
      .rs-head-right { display:flex; align-items:center; gap:14px; }
      .rs-updated { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--rs-muted); white-space:nowrap; }
      .rs-fsbtn {
        display:inline-flex; align-items:center; justify-content:center; width:38px; height:38px;
        border:1px solid var(--rs-border); border-radius:11px; background:#ffffff;
        color:var(--rs-sub); cursor:pointer; transition:all .15s;
      }
      .rs-fsbtn:hover { color:var(--rs-text); border-color:var(--rs-accent); }

      .rs-body { flex:1 1 auto; min-height:0; padding:20px 28px 24px; overflow:hidden; }

      /* KPI page */
      .rs-kpi-grid {
        display:grid; gap:16px; height:100%;
        grid-template-columns:repeat(3,minmax(0,1fr));
        grid-auto-rows:minmax(0,1fr);
      }
      .rs-tile {
        background:var(--rs-card); border:1px solid var(--rs-border); border-radius:16px;
        padding:18px 20px; display:flex; flex-direction:column; justify-content:space-between;
        box-shadow:0 4px 14px rgba(15,23,42,0.05); min-height:0;
      }
      .rs-tile-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
      .rs-tile-label { font-size:13px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--rs-muted); }
      .rs-tile-icon { color:#cbd5e1; flex:0 0 auto; }
      .rs-tile-value { font-size:clamp(30px,4.4vw,56px); font-weight:800; line-height:1; color:var(--rs-text);
        font-variant-numeric:tabular-nums; margin:6px 0; }
      .rs-tile-foot { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; }
      .rs-tile-cap { font-size:12px; color:var(--rs-muted); text-transform:uppercase; letter-spacing:.08em; }
      .rs-tile-spark { width:52%; max-width:180px; }

      /* Compact KPI strip on the board-style pages */
      .rs-strip { display:grid; gap:16px; flex:0 0 auto; }
      .rs-strip .rs-tile { padding:14px 18px; }
      .rs-strip .rs-tile-value { font-size:clamp(26px,3.6vw,46px); margin:4px 0; }

      /* Trends + breakdown pages */
      .rs-page { display:flex; flex-direction:column; gap:16px; height:100%; }
      .rs-page-row { display:grid; grid-template-columns:1fr 1fr; gap:16px; min-height:0; }
      .rs-grid-2 { display:grid; grid-template-columns:1fr 1fr; grid-auto-rows:minmax(0,1fr); gap:16px; }
      .rs-card {
        background:var(--rs-card); border:1px solid var(--rs-border); border-radius:16px;
        padding:16px 18px; box-shadow:0 4px 14px rgba(15,23,42,0.05);
        display:flex; flex-direction:column; min-width:0; min-height:0;
      }
      .rs-card-wide { flex:1 1 auto; }
      .rs-card-head { display:flex; align-items:flex-start; gap:10px; margin-bottom:10px; flex:0 0 auto; }
      .rs-card-icon { color:var(--rs-accent); flex:0 0 auto; margin-top:2px; }
      .rs-card-titles { min-width:0; }
      .rs-card-title { margin:0; font-size:17px; font-weight:700; color:var(--rs-text); }
      .rs-card-sub { margin:2px 0 0; font-size:13px; color:var(--rs-muted); }
      .rs-empty { display:flex; align-items:center; justify-content:center; color:var(--rs-muted); font-size:15px; }

      /* Responsive reflow for laptops / smaller boards */
      @media (max-width:1100px) {
        .rs-kpi-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .rs-name { max-width:32vw; font-size:22px; }
      }
      @media (max-width:720px) {
        .rs-header { flex-wrap:wrap; gap:10px; padding:12px 16px; }
        .rs-head-mid { order:3; width:100%; }
        .rs-name { max-width:60vw; }
        .rs-body { padding:14px 16px 18px; }
        .rs-kpi-grid { grid-template-columns:1fr; }
        .rs-page-row, .rs-grid-2 { grid-template-columns:1fr; }
        .rs-strip { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
      }
    `}</style>
  )
}
