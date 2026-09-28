import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Truck, CheckCircle2, AlertTriangle, AlertOctagon, FileText, ShieldCheck, ArrowUp, ArrowDown,
  ArrowRight, ChevronRight, Plus, Minus, Wrench, Info, Flame, FileWarning, ClipboardCheck,
  Receipt, Settings2, Hammer, Disc3, Scissors, Target, ClipboardList,
} from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import {
  greeting, timeAgo, fleetStats, tyreHealth, actionBuckets, maintenanceDue, workStatus,
  utilizationByMonth, monthLabel, changePct, compact, COUNTRY_POINTS,
} from '../../lib/commandCenter'
import * as cc from '../../lib/api/commandCenter'
import { WORLD_LAND_PATH, WORLD_W, WORLD_H, project } from './worldLand'
import './commandCenter.css'

/* ── data hook: one per card, so each card fails and retries on its own ───── */
function useCard(loader, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const seq = useRef(0)
  const run = useCallback(() => {
    const id = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.resolve().then(loader).then(
      (data) => { if (id === seq.current) setState({ loading: false, data, error: null }) },
      (e) => { if (id === seq.current) setState({ loading: false, data: null, error: toUserMessage(e, 'Could not load this section.') }) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { run() }, [run])
  return { ...state, retry: run }
}

function Card({ area, title, sub, action, children, className = '' }) {
  return (
    <section className={`cc-card ${area || ''} ${className}`} aria-label={title}>
      {(title || action) && (
        <div className="cc-card-head">
          <div>
            {title && <h2 className="cc-card-title">{title}</h2>}
            {sub && <p className="cc-card-sub">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

function ViewAll({ to, label = 'View all' }) {
  return <Link className="cc-link" to={to}>{label} <ArrowRight size={13} aria-hidden="true" /></Link>
}

function CardState({ state, empty, lines = 4, children }) {
  if (state.loading && !state.data) {
    return <div style={{ display: 'grid', gap: 10 }}>{Array.from({ length: lines }, (_, i) => <div key={i} className="cc-skel" style={{ height: 30 }} />)}</div>
  }
  if (state.error) {
    return <div className="cc-empty" role="alert"><div>{state.error}<br /><button className="cc-btn" onClick={state.retry}>Try again</button></div></div>
  }
  if (empty) return <div className="cc-empty">{empty}</div>
  return children
}

function Tabs({ tabs, value, onChange, label }) {
  return (
    <div className="cc-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" className="cc-tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>
          {t.label}{t.count != null && <span className={`cc-count ${t.countTone || ''}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

const fmtInt = (n) => (n == null ? 'N/A' : Number(n).toLocaleString('en-US'))
const fmtPct = (n) => (n == null ? 'N/A' : `${Math.round(n)}%`)

/* ── hero ─────────────────────────────────────────────────────────────── */
function Hero({ fleet }) {
  const f = fleet.data
  return (
    <div className="cc-hero">
      <div className="cc-hero-img cc-hero-dark" style={{ backgroundImage: 'url(/dashboard/hero-dark.webp)' }} aria-hidden="true" />
      <div className="cc-hero-img cc-hero-light" style={{ backgroundImage: 'url(/dashboard/hero-light.webp)' }} aria-hidden="true" />
      <div className="cc-hero-copy">
        <p className="cc-hero-hello">{greeting()},</p>
        <h1>Your Fleet. Safer. Smarter. Longer.</h1>
        <p className="cc-hero-lead">Real-time tyre, asset and maintenance intelligence across all operations.</p>
      </div>
      {f && (
        <div className="cc-hero-stat">
          <b>{fmtInt(f.total)}</b>
          <span>Vehicles across<br />{f.sites} {f.sites === 1 ? 'site' : 'sites'}<br />{f.countries} {f.countries === 1 ? 'country' : 'countries'}</span>
          <i aria-hidden="true" />
        </div>
      )}
    </div>
  )
}

/* ── KPI strip ────────────────────────────────────────────────────────── */
function Trend({ value, goodWhenUp = true }) {
  if (value == null) return null
  if (value === 0) return <span className="cc-kpi-trend flat"><ArrowRight size={12} aria-hidden="true" /> 0%</span>
  const up = value > 0
  const cls = up === goodWhenUp ? (up ? 'up-good' : 'down-good') : (up ? 'up-bad' : 'down-bad')
  return (
    <span className={`cc-kpi-trend ${cls}`} title="Change over the last 30 days">
      {up ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}{Math.abs(value)}%
    </span>
  )
}

function Kpi({ icon: Icon, tone, value, label, to, trend, goodWhenUp, loading }) {
  return (
    <Link to={to} className="cc-card cc-kpi">
      <span className={`cc-kpi-icon ${tone}`}><Icon size={21} aria-hidden="true" /></span>
      <div className="cc-kpi-body">
        <div className="cc-kpi-val" style={tone === 't-red' ? { color: 'var(--cc-red)' } : undefined}>{loading ? '...' : fmtInt(value)}</div>
        <div className="cc-kpi-label">{label}</div>
      </div>
      <Trend value={trend} goodWhenUp={goodWhenUp} />
    </Link>
  )
}

/* ── fleet map ────────────────────────────────────────────────────────── */
function FleetMap({ fleet, maint, tyres, country, onCountry }) {
  const [zoom, setZoom] = useState(1)
  const f = fleet.data
  const points = useMemo(() => (f?.byCountry || [])
    .map((c) => ({ ...c, xy: COUNTRY_POINTS[c.country] ? project(...COUNTRY_POINTS[c.country]) : null }))
    .filter((c) => c.xy), [f])
  // Frame the countries the fleet actually operates in, never the empty oceans.
  const view = useMemo(() => {
    if (!points.length) return [0, 0, WORLD_W, WORLD_H]
    const xs = points.map((p) => p.xy[0]); const ys = points.map((p) => p.xy[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2; const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const w = Math.max(420, (Math.max(...xs) - Math.min(...xs)) * 4) / zoom
    const h = w * 0.52
    return [cx - w / 2, cy - h / 2, w, h]
  }, [points, zoom])
  const max = Math.max(1, ...points.map((p) => p.total))
  const countries = ['All', ...(f?.byCountry || []).map((c) => c.country).filter((c) => c !== 'Unassigned')]
  return (
    <Card area="cc-a-loc" title="Fleet Location" sub="Live vehicle distribution by country and site"
      action={(
        <select className="cc-select" aria-label="Country" value={country || 'All'} onChange={(e) => onCountry(e.target.value)}>
          {countries.map((c) => <option key={c} value={c}>{c === 'All' ? 'All countries' : c}</option>)}
        </select>
      )}>
      <CardState state={fleet} empty={f && !f.total ? 'No vehicles registered yet.' : null} lines={6}>
        <div className="cc-map">
          <svg viewBox={view.join(' ')} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Vehicles by country: ${points.map((p) => `${p.country} ${p.total}`).join(', ')}`}>
            <path d={WORLD_LAND_PATH} fill="var(--cc-land)" stroke="var(--cc-land-stroke)" strokeWidth={0.4 / zoom} vectorEffect="non-scaling-stroke" />
            {points.map((p) => {
              const r = (7 + 9 * Math.sqrt(p.total / max)) * view[2] / 520
              return (
                <g key={p.country}>
                  <circle cx={p.xy[0]} cy={p.xy[1]} r={r * 1.7} fill="var(--cc-green)" opacity="0.16" />
                  <circle cx={p.xy[0]} cy={p.xy[1]} r={r} fill="var(--cc-green-strong)" stroke="var(--cc-green)" strokeWidth={r * 0.18} />
                  <text x={p.xy[0]} y={p.xy[1]} dy="0.35em" textAnchor="middle" fontSize={r * 0.95} fontWeight="700" fill="#fff">{p.total}</text>
                  <title>{`${p.country}: ${p.total} vehicles, ${p.active} active`}</title>
                </g>
              )
            })}
          </svg>
          <div className="cc-map-zoom">
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z * 1.4))}><Plus size={14} /></button>
            <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.35, z / 1.4))}><Minus size={14} /></button>
          </div>
          <div className="cc-map-legend">
            <b>Vehicle Status</b>
            <div><span className="cc-dot" style={{ background: 'var(--cc-green)' }} />Active<span>{fmtInt(f?.active)}</span></div>
            <div><span className="cc-dot" style={{ background: '#9ca3af' }} />Inactive<span>{fmtInt(f?.inactive)}</span></div>
            <div><span className="cc-dot" style={{ background: 'var(--cc-amber)' }} />Maintenance Due<span>{maint.data ? fmtInt(maint.data.total) : 'N/A'}</span></div>
            <div><span className="cc-dot" style={{ background: 'var(--cc-red)' }} />Critical<span>{tyres.data ? fmtInt(tyres.data.bands.find((b) => b.key === 'critical')?.count) : 'N/A'}</span></div>
          </div>
        </div>
      </CardState>
    </Card>
  )
}

/* ── tyre health donut ────────────────────────────────────────────────── */
function Donut({ bands, size = 170, stroke = 22 }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const total = bands.reduce((s, b) => s + b.count, 0)
  let offset = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--cc-track)" strokeWidth={stroke} />
      {total > 0 && bands.map((b) => {
        const len = (b.count / total) * c
        const el = (
          <circle key={b.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={b.color} strokeWidth={stroke}
            strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        )
        offset += len
        return el
      })}
    </svg>
  )
}

function TyreHealthCard({ tyres }) {
  const t = tyres.data
  return (
    <Card area="cc-a-tyre" title="Tyre Health" action={<ViewAll to="/tyre-lifecycle" label="View all tyres" />}>
      <CardState state={tyres} empty={t && !t.measured ? 'No fitted tyres with a measurable life yet.' : null} lines={5}>
        {t && (
          <div className="cc-donut-wrap">
            <div style={{ position: 'relative' }}>
              <Donut bands={t.bands} />
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                <div><div style={{ fontSize: 30, fontWeight: 800 }}>{fmtPct(t.goodPct)}</div><div style={{ fontSize: 11.5, color: 'var(--cc-ink-2)' }}>Good Condition</div></div>
              </div>
            </div>
            <div className="cc-legend">
              {t.bands.map((b) => (
                <div key={b.key} className="cc-legend-row">
                  <span className="cc-square" style={{ background: b.color }} />
                  <span>{b.label}</span><b>{fmtPct(b.pct)}</b><span>{fmtInt(b.count)}</span>
                </div>
              ))}
              {t.unmeasured > 0 && <p className="cc-card-sub" style={{ margin: 0 }}>{fmtInt(t.unmeasured)} tyres have no meter reading to judge yet.</p>}
            </div>
          </div>
        )}
      </CardState>
    </Card>
  )
}

/* ── action center ────────────────────────────────────────────────────── */
const ACTION_ICON = { critical: [Flame, 't-red'], maintenance: [Wrench, 't-amber'], info: [Info, 't-blue'] }

function ActionCard({ actions }) {
  const [tab, setTab] = useState('all')
  const b = actions.data
  const rows = (b?.[tab] || []).slice(0, 5)
  return (
    <Card area="cc-a-act" title="Action Center" action={<ViewAll to="/action-center" />}>
      <Tabs label="Action filter" value={tab} onChange={setTab} tabs={[
        { key: 'all', label: 'All', count: b?.all.length ?? 0, countTone: 'green' },
        { key: 'critical', label: 'Critical', count: b?.critical.length ?? 0, countTone: 'red' },
        { key: 'maintenance', label: 'Maintenance', count: b?.maintenance.length ?? 0 },
        { key: 'info', label: 'Info', count: b?.info.length ?? 0 },
      ]} />
      <CardState state={actions} empty={b && !rows.length ? 'Nothing needs attention here.' : null}>
        <div className="cc-list">
          {rows.map((a) => {
            const [Icon, tone] = ACTION_ICON[a.tone]
            return (
              <Link key={a.id} to="/action-center" className="cc-row">
                <span className={`cc-row-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span>
                <div className="cc-row-main">
                  <div className="cc-row-title">{a.title || 'Action'}</div>
                  <div className="cc-row-meta">{[a.asset_no, a.site || a.source].filter(Boolean).join(' • ')}</div>
                </div>
                <span className="cc-row-time">{timeAgo(a.created_at)}</span>
                <ChevronRight size={15} className="cc-chev" aria-hidden="true" />
              </Link>
            )
          })}
        </div>
      </CardState>
    </Card>
  )
}

/* ── workshop activity ────────────────────────────────────────────────── */
const WORK_ICON = [
  [/tyre|tire|rotat/i, Disc3, 't-green'], [/inspect/i, ClipboardCheck, 't-purple'],
  [/align/i, Scissors, 't-orange'], [/service|preventive|pm/i, Settings2, 't-green'],
  [/emergency|breakdown/i, AlertTriangle, 't-red'], [/.*/, Hammer, 't-blue'],
]

function WorkshopCard({ work }) {
  const [tab, setTab] = useState('today')
  const d = work.data
  const since = useMemo(() => {
    const now = new Date(); const s = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (tab === 'week') s.setDate(s.getDate() - s.getDay())
    if (tab === 'month') s.setDate(1)
    return s.getTime()
  }, [tab])
  const rows = (d?.recent || []).filter((r) => new Date(r.opened_at).getTime() >= since).slice(0, 5)
  const label = { today: 'today', week: 'this week', month: 'this month' }[tab]
  return (
    <Card area="cc-a-work" title="Workshop Activity" sub="Live service and maintenance activity">
      <Tabs label="Workshop window" value={tab} onChange={setTab} tabs={[
        { key: 'today', label: 'Today', count: d?.counts.today ?? 0, countTone: 'green' },
        { key: 'week', label: 'This Week', count: d?.counts.week ?? 0 },
        { key: 'month', label: 'This Month', count: d?.counts.month ?? 0 },
      ]} />
      <CardState state={work} lines={5} empty={d && !rows.length ? `No work orders opened ${label}.` : null}>
        <div className="cc-list">
          {rows.map((r) => {
            const text = `${r.work_type || ''} ${r.description || ''}`
            const [, Icon, tone] = WORK_ICON.find(([re]) => re.test(text))
            const st = workStatus(r.status)
            return (
              <Link key={r.id} to="/work-orders" className="cc-row">
                <span className={`cc-row-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span>
                <div className="cc-row-main">
                  <div className="cc-row-title">{r.description || r.work_type || r.work_order_no}</div>
                  <div className="cc-row-meta">{[r.asset_no, r.site].filter(Boolean).join(' • ')}</div>
                </div>
                <span className="cc-row-side">
                  <span className={`cc-pill ${st.tone}`}>{st.label}</span>
                  <span className="cc-row-time">{timeAgo(r.opened_at)}</span>
                </span>
                <ChevronRight size={15} className="cc-chev" aria-hidden="true" />
              </Link>
            )
          })}
        </div>
      </CardState>
      <Link to="/work-orders" className="cc-link" style={{ marginTop: 'auto', paddingTop: 10 }}>Open work orders <ArrowRight size={13} aria-hidden="true" /></Link>
    </Card>
  )
}

/* ── maintenance due ──────────────────────────────────────────────────── */
const MAINT_ICON = { inspection: ClipboardList, service: Settings2, replacement: Disc3, regroove: Wrench, general: Wrench }

function MaintenanceCard({ maint }) {
  const m = maint.data
  return (
    <Card area="cc-a-mnt" title="Maintenance Due" sub="Assets requiring service, inspection or tyre attention" action={<ViewAll to="/pm-programs" />}>
      <CardState state={maint} lines={5}>
        {m && (
          <div className="cc-bars">
            {m.groups.map((g) => {
              const Icon = MAINT_ICON[g.key]
              return (
                <Link key={g.key} to="/pm-programs" className="cc-bar-row">
                  <Icon size={15} aria-hidden="true" style={{ color: 'var(--cc-ink-2)' }} />
                  <span>{g.label}</span>
                  <b style={{ color: g.color }}>{g.count}</b>
                  <span className="cc-bar-track"><i style={{ width: `${Math.round(g.ratio * 100)}%`, background: g.color }} /></span>
                  <ChevronRight size={14} className="cc-chev" aria-hidden="true" />
                </Link>
              )
            })}
            {!m.total && <p className="cc-card-sub" style={{ margin: 0 }}>No preventive plans are due or overdue.</p>}
          </div>
        )}
      </CardState>
    </Card>
  )
}

/* ── compliance overview ──────────────────────────────────────────────── */
function Ring({ value }) {
  const size = 34; const s = 4; const r = (size - s) / 2; const c = 2 * Math.PI * r
  const v = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <svg width={size} height={size} aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--cc-track)" strokeWidth={s} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--cc-green)" strokeWidth={s} strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {value != null && <path d={`M${size / 2 - 5} ${size / 2} l3.5 3.5 l6.5 -7`} fill="none" stroke="var(--cc-green)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

function ComplianceCard({ comp, fleet }) {
  const c = comp.data; const f = fleet.data
  const ratio = (a, b) => (a == null || !b ? null : (a / b) * 100)
  const tiles = [
    { label: 'Insurance Policies', value: ratio(c?.polActive, c?.polTotal), note: 'In force', to: '/insurance-policies' },
    { label: 'Regulatory Checks', value: ratio(c?.certValid, c?.certTotal), note: 'Compliant', to: '/certifications' },
    { label: 'Safety Inspections', value: c?.inspectedAssets == null || !f?.active ? null : Math.min(100, ratio(c.inspectedAssets, f.active)), note: 'Last 30 days', to: '/inspections' },
    { label: 'Data Completeness', value: f?.completenessPct ?? null, note: 'Complete', to: '/data-reconciliation' },
  ]
  return (
    <Card area="cc-a-cmp" title="Compliance Overview" action={<ViewAll to="/compliance" />}>
      <CardState state={comp.loading || fleet.loading ? { loading: true } : comp} lines={4}>
        <div className="cc-cmp-grid">
          {tiles.map((t) => (
            <Link key={t.label} to={t.to} className="cc-cmp">
              <div className="cc-cmp-top"><span>{t.label}</span><ChevronRight size={13} className="cc-chev" aria-hidden="true" /></div>
              <div className="cc-cmp-body"><Ring value={t.value} /><div><b>{t.value == null ? 'N/A' : `${Math.round(t.value)}%`}</b><small>{t.value == null ? 'Not measured' : t.note}</small></div></div>
            </Link>
          ))}
        </div>
      </CardState>
    </Card>
  )
}

/* ── fleet age & utilisation ──────────────────────────────────────────── */
function LineChart({ series }) {
  const W = 300; const H = 110; const pad = { l: 30, r: 6, t: 8, b: 18 }
  const x = (i) => pad.l + (series.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (series.length - 1))
  const y = (v) => pad.t + (1 - v / 100) * (H - pad.t - pad.b)
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ')
  const area = series.length > 1 ? `${d} L${x(series.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : ''
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={series.map((p) => `${monthLabel(p.month)} ${p.value}%`).join(', ')}>
      <defs><linearGradient id="ccUtil" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--cc-green)" stopOpacity="0.35" /><stop offset="1" stopColor="var(--cc-green)" stopOpacity="0" /></linearGradient></defs>
      {[0, 50, 100].map((v) => (
        <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--cc-track)" /><text className="cc-axis" x={pad.l - 6} y={y(v)} dy="0.35em" textAnchor="end">{v}%</text></g>
      ))}
      {area && <path d={area} fill="url(#ccUtil)" />}
      {series.length > 1 && <path d={d} fill="none" stroke="var(--cc-green)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      {series.map((p, i) => <circle key={p.month} cx={x(i)} cy={y(p.value)} r="3" fill="var(--cc-green)" />)}
      {series.map((p, i) => <text key={`l${p.month}`} className="cc-axis" x={x(i)} y={H - 4} textAnchor="middle">{monthLabel(p.month)}</text>)}
    </svg>
  )
}

function UtilizationCard({ util }) {
  const u = util.data
  return (
    <Card area="cc-a-age" title="Fleet Age & Utilization" action={<span className="cc-select" style={{ backgroundImage: 'none', paddingRight: 10 }}>Last 6 months</span>}>
      <CardState state={util} lines={4} empty={u && u.average == null ? 'No telematics utilisation readings yet.' : null}>
        {u && (
          <>
            <div className="cc-headline"><b>{fmtPct(u.average)}</b><span>Avg. Fleet Utilization</span></div>
            <div className="cc-chart"><LineChart series={u.series} /></div>
          </>
        )}
      </CardState>
    </Card>
  )
}

/* ── fleet spend ──────────────────────────────────────────────────────── */
const SPEND_KEYS = [
  { key: 'tyre', label: 'Tyres', color: '#22c55e' },
  { key: 'spare', label: 'Spare Parts', color: '#facc15' },
  { key: 'oil', label: 'Oil & Lubricants', color: '#3b82f6' },
]

function SpendBars({ monthly }) {
  const W = 180; const H = 110; const pad = { l: 26, b: 16, t: 4 }
  const max = Math.max(1, ...monthly.map((m) => m.tyre + m.spare + m.oil))
  const bw = (W - pad.l) / Math.max(monthly.length, 1)
  const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Monthly spend by category">
      {[0, 0.5, 1].map((f) => <text key={f} className="cc-axis" x={pad.l - 4} y={y(max * f)} dy="0.35em" textAnchor="end">{compact(max * f)}</text>)}
      {monthly.map((m, i) => {
        let base = 0
        return (
          <g key={m.month}>
            {SPEND_KEYS.map((k) => {
              const v = m[k.key]; const top = y(base + v); const h = y(base) - top; base += v
              return <rect key={k.key} x={pad.l + i * bw + bw * 0.18} width={bw * 0.64} y={top} height={Math.max(0, h)} fill={k.color} rx="1" />
            })}
            <text className="cc-axis" x={pad.l + i * bw + bw / 2} y={H - 3} textAnchor="middle">{monthLabel(m.month)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function SpendCard({ spend }) {
  const s = spend.data
  const monthly = (s?.monthly || []).filter((m) => m.month >= `${new Date().getFullYear()}-01`).slice(-6)
  const total = s?.totals?.total?.amount
  const delta = changePct(total, s?.previous?.total?.amount)
  const cur = s?.currency
  return (
    <Card area="cc-a-spd" title="Fleet Spend Overview" action={<span className="cc-select" style={{ backgroundImage: 'none', paddingRight: 10 }}>This Year</span>}>
      <CardState state={spend} lines={4} empty={s && !s.ok ? 'No expense data for this scope yet.' : null}>
        {s && s.blended ? (
          <div>
            <p className="cc-card-sub" style={{ marginTop: 0 }}>Each country reports in its own currency, so spend is shown per country.</p>
            <div className="cc-spend-legend">
              {(s.byCountry || []).map((c) => (
                <div key={c.country}><span className="cc-square" style={{ background: 'var(--cc-green)' }} /><span>{c.country}</span><b>{c.currency} {compact(c.total?.amount ?? c.total)}</b><span /></div>
              ))}
            </div>
          </div>
        ) : s && (
          <>
            <div className="cc-headline">
              <b style={{ color: 'var(--cc-ink)' }}>{cur} {Number(total || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</b>
              {delta != null && (
                <span className={`cc-delta ${delta > 0 ? 't-red' : 't-green'}`} title="Against the same span last year">
                  {delta > 0 ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />}{Math.abs(delta)}%
                </span>
              )}
            </div>
            <p className="cc-card-sub" style={{ margin: '0 0 8px' }}>Total fleet and tyre spend</p>
            <div className="cc-spend">
              <div className="cc-chart"><SpendBars monthly={monthly} /></div>
              <div className="cc-spend-legend">
                {SPEND_KEYS.map((k) => {
                  const v = s.totals?.[k.key]?.amount ?? 0
                  return <div key={k.key}><span className="cc-square" style={{ background: k.color }} /><span>{k.label}</span><b>{compact(v)}</b><span>{total ? `${Math.round((v / total) * 100)}%` : ''}</span></div>
                })}
              </div>
            </div>
          </>
        )}
      </CardState>
    </Card>
  )
}

/* ── recent approvals ─────────────────────────────────────────────────── */
const APPROVAL_ICON = { inspection: [Target, 't-green'], checklist: [FileText, 't-blue'], accident: [Receipt, 't-orange'] }

function ApprovalsCard({ pending, decided }) {
  const [tab, setTab] = useState('pending')
  const state = tab === 'pending' ? pending : decided
  const rows = tab === 'pending' ? (pending.data || []) : (decided.data || []).filter((r) => r.status === tab)
  return (
    <Card area="cc-a-apr" title="Recent Approvals" action={<ViewAll to="/approvals" />}>
      <Tabs label="Approval status" value={tab} onChange={setTab} tabs={[
        { key: 'pending', label: 'Pending', count: pending.data?.length ?? 0, countTone: 'green' },
        { key: 'approved', label: 'Approved' },
        { key: 'rejected', label: 'Rejected' },
      ]} />
      <CardState state={state} lines={4} empty={state.data && !rows.length ? `No ${tab} approvals.` : null}>
        <div className="cc-list">
          {rows.slice(0, 5).map((r) => {
            const [Icon, tone] = APPROVAL_ICON[r.kind] || [ClipboardCheck, 't-green']
            return (
              <div key={r.id} className="cc-row">
                <span className={`cc-row-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span>
                <div className="cc-row-main">
                  <div className="cc-row-title">{r.title}</div>
                  <div className="cc-row-meta">{[r.asset, timeAgo(r.at)].filter(Boolean).join(' • ')}</div>
                </div>
                <span className="cc-row-side">
                  {r.amount != null && <span style={{ fontSize: 12.5, fontWeight: 700 }}>{compact(r.amount)}</span>}
                {tab === 'pending'
                  ? <Link to="/approvals" className="cc-btn">Review</Link>
                  : <span className={`cc-pill ${r.status === 'approved' ? 'good' : 'warn'}`}>{r.status === 'approved' ? 'Approved' : 'Rejected'}</span>}
                </span>
              </div>
            )
          })}
        </div>
      </CardState>
    </Card>
  )
}

/* ── page ─────────────────────────────────────────────────────────────── */
export default function CommandCenter() {
  const { activeCountry, setActiveCountry } = useSettings()
  const country = activeCountry && activeCountry !== 'All' ? activeCountry : null
  const deps = [country]

  const fleetRaw = useCard(() => cc.loadFleetRows({ country }), deps)
  const fleet = useMemo(() => ({ ...fleetRaw, data: fleetRaw.data ? fleetStats(fleetRaw.data) : null }), [fleetRaw])
  const tyresRaw = useCard(() => cc.loadTyreLife({ country }), deps)
  const tyres = useMemo(() => ({ ...tyresRaw, data: tyresRaw.data ? tyreHealth(tyresRaw.data) : null }), [tyresRaw])
  const actionsRaw = useCard(() => cc.loadActions({ country }), deps)
  const actions = useMemo(() => ({ ...actionsRaw, data: actionsRaw.data ? actionBuckets(actionsRaw.data) : null }), [actionsRaw])
  const maintRaw = useCard(() => cc.loadMaintenance({ country }), deps)
  const maint = useMemo(() => ({ ...maintRaw, data: maintRaw.data ? maintenanceDue(maintRaw.data) : null }), [maintRaw])
  const work = useCard(() => cc.loadWorkshop({ country }), deps)
  const comp = useCard(() => cc.loadCompliance({ country }), deps)
  const utilRaw = useCard(() => cc.loadUtilization({ country }), deps)
  const util = useMemo(() => ({ ...utilRaw, data: utilRaw.data ? utilizationByMonth(utilRaw.data) : null }), [utilRaw])
  const spend = useCard(() => cc.loadSpend({ country }), deps)
  const pending = useCard(() => cc.loadApprovals({ country }), deps)
  const decided = useCard(() => cc.loadDecided({ country }), deps)

  const f = fleet.data
  const critical = tyres.data?.bands.find((b) => b.key === 'critical')?.count
  return (
    <div className="cc">
      <Hero fleet={fleet} />
      <div className="cc-kpis">
        <Kpi icon={Truck} tone="t-green" value={f?.total} label="Total Vehicles" to="/fleet-master" trend={f?.trend.total} loading={fleet.loading} />
        <Kpi icon={CheckCircle2} tone="t-green" value={f?.active} label="Active Vehicles" to="/fleet-master" trend={f?.trend.active} loading={fleet.loading} />
        <Kpi icon={AlertTriangle} tone="t-amber" value={maint.data?.total} label="Maintenance Due" to="/pm-programs" loading={maint.loading} />
        <Kpi icon={AlertOctagon} tone="t-red" value={critical} label="Critical Tyre Issues" to="/tyre-lifecycle" loading={tyres.loading} />
        <Kpi icon={FileWarning} tone="t-green" value={f?.missingSpecs} label="Missing Specs" to="/fleet-master" loading={fleet.loading} />
        <Kpi icon={ShieldCheck} tone="t-green" value={f?.noPolicy} label="No Policy Set" to="/fleet-master" loading={fleet.loading} />
      </div>
      <div className="cc-grid">
        <FleetMap fleet={fleet} maint={maint} tyres={tyres} country={activeCountry} onCountry={(c) => setActiveCountry?.(c)} />
        <TyreHealthCard tyres={tyres} />
        <ActionCard actions={actions} />
        <WorkshopCard work={work} />
        <MaintenanceCard maint={maint} />
        <ComplianceCard comp={comp} fleet={fleet} />
        <UtilizationCard util={util} />
        <SpendCard spend={spend} />
        <ApprovalsCard pending={pending} decided={decided} />
      </div>
    </div>
  )
}
