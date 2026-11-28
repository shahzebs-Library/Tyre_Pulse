import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Truck, CheckCircle2, AlertTriangle, AlertOctagon, FileText, ShieldCheck, ArrowUp, ArrowDown,
  ArrowRight, ChevronRight, Plus, Minus, Wrench, Info, Flame, FileWarning, ClipboardCheck,
  Receipt, Settings2, Hammer, Disc3, Scissors, Target, ClipboardList,
} from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'
import { useLanguage } from '../../contexts/LanguageContext'
import {
  greeting, timeAgo, fleetStats, tyreHealth, actionBuckets, maintenanceDue, workStatus,
  utilizationByMonth, monthLabel, changePct, compact, COUNTRY_POINTS,
} from '../../lib/commandCenter'
import * as cc from '../../lib/api/commandCenter'
import { WORLD_LAND_PATH, WORLD_W, WORLD_H, project } from './worldLand'
import { useCard, Card, ViewAll, CardState, Tabs, Kpi, fmtInt, fmtPct } from './kit'
import CaseTeamInbox from '../accidents/CaseTeamInbox'

/**
 * Translation helpers for this page. The engine in lib/commandCenter keeps its
 * English outputs (its tests pin them); display text is translated here.
 */
function useCC() {
  const { t, language } = useLanguage()
  const p = (k, v) => t(`dashboard.commandCenter.${k}`, v)
  const GREETING = { 'Good morning': 'greeting.morning', 'Good afternoon': 'greeting.afternoon', 'Good evening': 'greeting.evening' }
  const hello = () => { const g = greeting(); return GREETING[g] ? t(`dashboard.${GREETING[g]}`) : g }
  const ago = (v) => {
    const s = timeAgo(v)
    const m = s && /^(\d+)(mo|m|h|d) ago$/.exec(s)
    return m ? p(`time.${m[2]}`, { n: m[1] }) : s
  }
  const month = (ym) => {
    if (language === 'en') return monthLabel(ym)
    const [y, mo] = String(ym).split('-').map(Number)
    if (!y || !mo) return monthLabel(ym)
    try { return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString(language, { month: 'short', timeZone: 'UTC' }) } catch { return monthLabel(ym) }
  }
  const na = p('na')
  return { t, p, hello, ago, month, na }
}

/* ── hero ─────────────────────────────────────────────────────────────── */
function Hero({ fleet }) {
  const { p, hello } = useCC()
  const f = fleet.data
  return (
    <div className="cc-hero">
      <div className="cc-hero-img cc-hero-dark" style={{ backgroundImage: 'url(/dashboard/hero-dark.webp)' }} aria-hidden="true" />
      <div className="cc-hero-img cc-hero-light" style={{ backgroundImage: 'url(/dashboard/hero-light.webp)' }} aria-hidden="true" />
      <div className="cc-hero-copy">
        <p className="cc-hero-hello">{p('hero.hello', { greeting: hello() })}</p>
        <h1>{p('hero.title')}</h1>
        <p className="cc-hero-lead">{p('hero.lead')}</p>
      </div>
      {f && (
        <div className="cc-hero-stat">
          <b>{fmtInt(f.total)}</b>
          <span>{p('hero.vehiclesAcross')}<br />{f.sites === 1 ? p('hero.siteOne', { n: f.sites }) : p('hero.siteMany', { n: f.sites })}<br />{f.countries === 1 ? p('hero.countryOne', { n: f.countries }) : p('hero.countryMany', { n: f.countries })}</span>
          <i aria-hidden="true" />
        </div>
      )}
    </div>
  )
}

/* ── fleet map ────────────────────────────────────────────────────────── */
function FleetMap({ fleet, maint, tyres, country, onCountry }) {
  const { t, p, na } = useCC()
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
    <Card area="cc-a-loc" title={p('map.title')} sub={p('map.sub')}
      action={(
        <select className="cc-select" aria-label={p('map.country')} value={country || 'All'} onChange={(e) => onCountry(e.target.value)}>
          {countries.map((c) => <option key={c} value={c}>{c === 'All' ? p('map.allCountries') : c}</option>)}
        </select>
      )}>
      <CardState state={fleet} empty={f && !f.total ? p('map.empty') : null} lines={6}>
        <div className="cc-map">
          <svg viewBox={view.join(' ')} preserveAspectRatio="xMidYMid slice" role="img" aria-label={p('map.aria', { list: points.map((pt) => `${pt.country} ${pt.total}`).join(', ') })}>
            <path d={WORLD_LAND_PATH} fill="var(--cc-land)" stroke="var(--cc-land-stroke)" strokeWidth={0.4 / zoom} vectorEffect="non-scaling-stroke" />
            {points.map((p) => {
              const r = (7 + 9 * Math.sqrt(p.total / max)) * view[2] / 520
              return (
                <g key={p.country}>
                  <circle cx={p.xy[0]} cy={p.xy[1]} r={r * 1.7} fill="var(--cc-green)" opacity="0.16" />
                  <circle cx={p.xy[0]} cy={p.xy[1]} r={r} fill="var(--cc-green-strong)" stroke="var(--cc-green)" strokeWidth={r * 0.18} />
                  <text x={p.xy[0]} y={p.xy[1]} dy="0.35em" textAnchor="middle" fontSize={r * 0.95} fontWeight="700" fill="#fff">{p.total}</text>
                  <title>{t('dashboard.commandCenter.map.pointTitle', { country: p.country, total: p.total, active: p.active })}</title>
                </g>
              )
            })}
          </svg>
          <div className="cc-map-zoom">
            <button type="button" aria-label={p('map.zoomIn')} onClick={() => setZoom((z) => Math.min(4, z * 1.4))}><Plus size={14} /></button>
            <button type="button" aria-label={p('map.zoomOut')} onClick={() => setZoom((z) => Math.max(0.35, z / 1.4))}><Minus size={14} /></button>
          </div>
          <div className="cc-map-legend">
            <b>{p('map.legendTitle')}</b>
            <div><span className="cc-dot" style={{ background: 'var(--cc-green)' }} />{p('map.active')}<span>{fmtInt(f?.active)}</span></div>
            <div><span className="cc-dot" style={{ background: '#9ca3af' }} />{p('map.inactive')}<span>{fmtInt(f?.inactive)}</span></div>
            <div><span className="cc-dot" style={{ background: 'var(--cc-amber)' }} />{p('map.maintenanceDue')}<span>{maint.data ? fmtInt(maint.data.total) : na}</span></div>
            <div><span className="cc-dot" style={{ background: 'var(--cc-red)' }} />{p('map.critical')}<span>{tyres.data ? fmtInt(tyres.data.bands.find((b) => b.key === 'critical')?.count) : na}</span></div>
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
  const { p } = useCC()
  const t = tyres.data
  return (
    <Card area="cc-a-tyre" title={p('tyre.title')} action={<ViewAll to="/tyre-lifecycle" label={p('tyre.viewAll')} />}>
      <CardState state={tyres} empty={t && !t.measured ? p('tyre.empty') : null} lines={5}>
        {t && (
          <div className="cc-donut-wrap">
            <div style={{ position: 'relative' }}>
              <Donut bands={t.bands} />
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                <div><div style={{ fontSize: 30, fontWeight: 800 }}>{fmtPct(t.goodPct)}</div><div style={{ fontSize: 11.5, color: 'var(--cc-ink-2)' }}>{p('tyre.goodCondition')}</div></div>
              </div>
            </div>
            <div className="cc-legend">
              {t.bands.map((b) => (
                <div key={b.key} className="cc-legend-row">
                  <span className="cc-square" style={{ background: b.color }} />
                  <span>{p(`tyre.bands.${b.key}`)}</span><b>{fmtPct(b.pct)}</b><span>{fmtInt(b.count)}</span>
                </div>
              ))}
              {t.unmeasured > 0 && <p className="cc-card-sub" style={{ margin: 0 }}>{p('tyre.unmeasured', { n: fmtInt(t.unmeasured) })}</p>}
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
  const { p, ago } = useCC()
  const [tab, setTab] = useState('all')
  const b = actions.data
  const rows = (b?.[tab] || []).slice(0, 5)
  return (
    <Card area="cc-a-act" title={p('action.title')} action={<ViewAll to="/action-center" />}>
      <Tabs label={p('action.filterLabel')} value={tab} onChange={setTab} tabs={[
        { key: 'all', label: p('action.all'), count: b?.all.length ?? 0, countTone: 'green' },
        { key: 'critical', label: p('action.critical'), count: b?.critical.length ?? 0, countTone: 'red' },
        { key: 'maintenance', label: p('action.maintenance'), count: b?.maintenance.length ?? 0 },
        { key: 'info', label: p('action.info'), count: b?.info.length ?? 0 },
      ]} />
      <CardState state={actions} empty={b && !rows.length ? p('action.empty') : null}>
        <div className="cc-list">
          {rows.map((a) => {
            const [Icon, tone] = ACTION_ICON[a.tone]
            return (
              <Link key={a.id} to="/action-center" className="cc-row">
                <span className={`cc-row-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span>
                <div className="cc-row-main">
                  <div className="cc-row-title">{a.title || p('action.fallbackTitle')}</div>
                  <div className="cc-row-meta">{[a.asset_no, a.site || a.source].filter(Boolean).join(' • ')}</div>
                </div>
                <span className="cc-row-time">{ago(a.created_at)}</span>
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

const WORK_STATUS_KEY = { Completed: 'completed', Cancelled: 'cancelled', Waiting: 'waiting', 'In Progress': 'inProgress', Open: 'open' }

function WorkshopCard({ work }) {
  const { p, ago } = useCC()
  const [tab, setTab] = useState('today')
  const d = work.data
  const since = useMemo(() => {
    const now = new Date(); const s = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (tab === 'week') s.setDate(s.getDate() - s.getDay())
    if (tab === 'month') s.setDate(1)
    return s.getTime()
  }, [tab])
  const rows = (d?.recent || []).filter((r) => new Date(r.opened_at).getTime() >= since).slice(0, 5)
  const emptyKey = { today: 'work.emptyToday', week: 'work.emptyWeek', month: 'work.emptyMonth' }[tab]
  return (
    <Card area="cc-a-work" title={p('work.title')} sub={p('work.sub')}>
      <Tabs label={p('work.windowLabel')} value={tab} onChange={setTab} tabs={[
        { key: 'today', label: p('work.today'), count: d?.counts.today ?? 0, countTone: 'green' },
        { key: 'week', label: p('work.week'), count: d?.counts.week ?? 0 },
        { key: 'month', label: p('work.month'), count: d?.counts.month ?? 0 },
      ]} />
      <CardState state={work} lines={5} empty={d && !rows.length ? p(emptyKey) : null}>
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
                  <span className={`cc-pill ${st.tone}`}>{p(`work.status.${WORK_STATUS_KEY[st.label] || 'open'}`)}</span>
                  <span className="cc-row-time">{ago(r.opened_at)}</span>
                </span>
                <ChevronRight size={15} className="cc-chev" aria-hidden="true" />
              </Link>
            )
          })}
        </div>
      </CardState>
      <Link to="/work-orders" className="cc-link" style={{ marginTop: 'auto', paddingTop: 10 }}>{p('work.openAll')} <ArrowRight size={13} aria-hidden="true" /></Link>
    </Card>
  )
}

/* ── maintenance due ──────────────────────────────────────────────────── */
const MAINT_ICON = { inspection: ClipboardList, service: Settings2, replacement: Disc3, regroove: Wrench, general: Wrench }

function MaintenanceCard({ maint }) {
  const { p } = useCC()
  const m = maint.data
  return (
    <Card area="cc-a-mnt" title={p('maint.title')} sub={p('maint.sub')} action={<ViewAll to="/pm-programs" />}>
      <CardState state={maint} lines={5}>
        {m && (
          <div className="cc-bars">
            {m.groups.map((g) => {
              const Icon = MAINT_ICON[g.key]
              return (
                <Link key={g.key} to="/pm-programs" className="cc-bar-row">
                  <Icon size={15} aria-hidden="true" style={{ color: 'var(--cc-ink-2)' }} />
                  <span>{p(`maint.types.${g.key}`)}</span>
                  <b style={{ color: g.color }}>{g.count}</b>
                  <span className="cc-bar-track"><i style={{ width: `${Math.round(g.ratio * 100)}%`, background: g.color }} /></span>
                  <ChevronRight size={14} className="cc-chev" aria-hidden="true" />
                </Link>
              )
            })}
            {!m.total && <p className="cc-card-sub" style={{ margin: 0 }}>{p('maint.empty')}</p>}
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
  const { p, na } = useCC()
  const c = comp.data; const f = fleet.data
  const ratio = (a, b) => (a == null || !b ? null : (a / b) * 100)
  const tiles = [
    { key: 'insurance', label: p('compliance.insurance'), value: ratio(c?.polActive, c?.polTotal), note: p('compliance.inForce'), to: '/insurance-policies' },
    { key: 'regulatory', label: p('compliance.regulatory'), value: ratio(c?.certValid, c?.certTotal), note: p('compliance.compliant'), to: '/certifications' },
    { key: 'safety', label: p('compliance.safety'), value: c?.inspectedAssets == null || !f?.active ? null : Math.min(100, ratio(c.inspectedAssets, f.active)), note: p('compliance.last30'), to: '/inspections' },
    { key: 'data', label: p('compliance.data'), value: f?.completenessPct ?? null, note: p('compliance.complete'), to: '/data-reconciliation' },
  ]
  return (
    <Card area="cc-a-cmp" title={p('compliance.title')} action={<ViewAll to="/compliance" />}>
      <CardState state={comp.loading || fleet.loading ? { loading: true } : comp} lines={4}>
        <div className="cc-cmp-grid">
          {tiles.map((t) => (
            <Link key={t.key} to={t.to} className="cc-cmp">
              <div className="cc-cmp-top"><span>{t.label}</span><ChevronRight size={13} className="cc-chev" aria-hidden="true" /></div>
              <div className="cc-cmp-body"><Ring value={t.value} /><div><b>{t.value == null ? na : `${Math.round(t.value)}%`}</b><small>{t.value == null ? p('compliance.notMeasured') : t.note}</small></div></div>
            </Link>
          ))}
        </div>
      </CardState>
    </Card>
  )
}

/* ── fleet age & utilisation ──────────────────────────────────────────── */
function LineChart({ series }) {
  const { month } = useCC()
  const W = 300; const H = 110; const pad = { l: 30, r: 6, t: 8, b: 18 }
  const x = (i) => pad.l + (series.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (series.length - 1))
  const y = (v) => pad.t + (1 - v / 100) * (H - pad.t - pad.b)
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ')
  const area = series.length > 1 ? `${d} L${x(series.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : ''
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={series.map((p) => `${month(p.month)} ${p.value}%`).join(', ')}>
      <defs><linearGradient id="ccUtil" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--cc-green)" stopOpacity="0.35" /><stop offset="1" stopColor="var(--cc-green)" stopOpacity="0" /></linearGradient></defs>
      {[0, 50, 100].map((v) => (
        <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--cc-track)" /><text className="cc-axis" x={pad.l - 6} y={y(v)} dy="0.35em" textAnchor="end">{v}%</text></g>
      ))}
      {area && <path d={area} fill="url(#ccUtil)" />}
      {series.length > 1 && <path d={d} fill="none" stroke="var(--cc-green)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      {series.map((p, i) => <circle key={p.month} cx={x(i)} cy={y(p.value)} r="3" fill="var(--cc-green)" />)}
      {series.map((p, i) => <text key={`l${p.month}`} className="cc-axis" x={x(i)} y={H - 4} textAnchor="middle">{month(p.month)}</text>)}
    </svg>
  )
}

function UtilizationCard({ util }) {
  const { p } = useCC()
  const u = util.data
  return (
    <Card area="cc-a-age" title={p('util.title')} action={<span className="cc-select" style={{ backgroundImage: 'none', paddingRight: 10 }}>{p('util.period')}</span>}>
      <CardState state={util} lines={4} empty={u && u.average == null ? p('util.empty') : null}>
        {u && (
          <>
            <div className="cc-headline"><b>{fmtPct(u.average)}</b><span>{p('util.avg')}</span></div>
            <div className="cc-chart"><LineChart series={u.series} /></div>
          </>
        )}
      </CardState>
    </Card>
  )
}

/* ── fleet spend ──────────────────────────────────────────────────────── */
const SPEND_KEYS = [
  { key: 'tyre', color: '#22c55e' },
  { key: 'spare', color: '#facc15' },
  { key: 'oil', color: '#3b82f6' },
]

function SpendBars({ monthly }) {
  const { p, month } = useCC()
  const W = 180; const H = 110; const pad = { l: 26, b: 16, t: 4 }
  const max = Math.max(1, ...monthly.map((m) => m.tyre + m.spare + m.oil))
  const bw = (W - pad.l) / Math.max(monthly.length, 1)
  const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={p('spend.chartAria')}>
      {[0, 0.5, 1].map((f) => <text key={f} className="cc-axis" x={pad.l - 4} y={y(max * f)} dy="0.35em" textAnchor="end">{compact(max * f)}</text>)}
      {monthly.map((m, i) => {
        let base = 0
        return (
          <g key={m.month}>
            {SPEND_KEYS.map((k) => {
              const v = m[k.key]; const top = y(base + v); const h = y(base) - top; base += v
              return <rect key={k.key} x={pad.l + i * bw + bw * 0.18} width={bw * 0.64} y={top} height={Math.max(0, h)} fill={k.color} rx="1" />
            })}
            <text className="cc-axis" x={pad.l + i * bw + bw / 2} y={H - 3} textAnchor="middle">{month(m.month)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function SpendCard({ spend }) {
  const { p } = useCC()
  const s = spend.data
  const monthly = (s?.monthly || []).filter((m) => m.month >= `${new Date().getFullYear()}-01`).slice(-6)
  const total = s?.totals?.total?.amount
  const delta = changePct(total, s?.previous?.total?.amount)
  const cur = s?.currency
  return (
    <Card area="cc-a-spd" title={p('spend.title')} action={<span className="cc-select" style={{ backgroundImage: 'none', paddingRight: 10 }}>{p('spend.period')}</span>}>
      <CardState state={spend} lines={4} empty={s && !s.ok ? p('spend.empty') : null}>
        {s && s.blended ? (
          <div>
            <p className="cc-card-sub" style={{ marginTop: 0 }}>{p('spend.perCountry')}</p>
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
                <span className={`cc-delta ${delta > 0 ? 't-red' : 't-green'}`} title={p('spend.vsLastYear')}>
                  {delta > 0 ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />}{Math.abs(delta)}%
                </span>
              )}
            </div>
            <p className="cc-card-sub" style={{ margin: '0 0 8px' }}>{p('spend.totalLabel')}</p>
            <div className="cc-spend">
              <div className="cc-chart"><SpendBars monthly={monthly} /></div>
              <div className="cc-spend-legend">
                {SPEND_KEYS.map((k) => {
                  const v = s.totals?.[k.key]?.amount ?? 0
                  return <div key={k.key}><span className="cc-square" style={{ background: k.color }} /><span>{p(`spend.keys.${k.key}`)}</span><b>{compact(v)}</b><span>{total ? `${Math.round((v / total) * 100)}%` : ''}</span></div>
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

const APPROVAL_EMPTY = { pending: 'approvals.emptyPending', approved: 'approvals.emptyApproved', rejected: 'approvals.emptyRejected' }
// Fallback titles the service fills in when a row has no title of its own.
const APPROVAL_FALLBACK = { Inspection: 'approvals.kinds.inspection', Checklist: 'approvals.kinds.checklist', 'Accident closure': 'approvals.kinds.accidentClosure' }

function ApprovalsCard({ pending, decided }) {
  const { p, ago } = useCC()
  const [tab, setTab] = useState('pending')
  const state = tab === 'pending' ? pending : decided
  const rows = tab === 'pending' ? (pending.data || []) : (decided.data || []).filter((r) => r.status === tab)
  return (
    <Card area="cc-a-apr" title={p('approvals.title')} action={<ViewAll to="/approvals" />}>
      <Tabs label={p('approvals.statusLabel')} value={tab} onChange={setTab} tabs={[
        { key: 'pending', label: p('approvals.pending'), count: pending.data?.length ?? 0, countTone: 'green' },
        { key: 'approved', label: p('approvals.approved') },
        { key: 'rejected', label: p('approvals.rejected') },
      ]} />
      <CardState state={state} lines={4} empty={state.data && !rows.length ? p(APPROVAL_EMPTY[tab]) : null}>
        <div className="cc-list">
          {rows.slice(0, 5).map((r) => {
            const [Icon, tone] = APPROVAL_ICON[r.kind] || [ClipboardCheck, 't-green']
            return (
              <div key={r.id} className="cc-row">
                <span className={`cc-row-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span>
                <div className="cc-row-main">
                  <div className="cc-row-title">{APPROVAL_FALLBACK[r.title] ? p(APPROVAL_FALLBACK[r.title]) : r.title}</div>
                  <div className="cc-row-meta">{[r.asset, ago(r.at)].filter(Boolean).join(' • ')}</div>
                </div>
                <span className="cc-row-side">
                  {r.amount != null && <span style={{ fontSize: 12.5, fontWeight: 700 }}>{compact(r.amount)}</span>}
                {tab === 'pending'
                  ? <Link to="/approvals" className="cc-btn">{p('approvals.review')}</Link>
                  : <span className={`cc-pill ${r.status === 'approved' ? 'good' : 'warn'}`}>{r.status === 'approved' ? p('approvals.approved') : p('approvals.rejected')}</span>}
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
  const { p } = useCC()
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
        <Kpi icon={Truck} tone="t-green" value={f?.total} label={p('kpi.total')} to="/fleet-master" trend={f?.trend.total} loading={fleet.loading} />
        <Kpi icon={CheckCircle2} tone="t-green" value={f?.active} label={p('kpi.active')} to="/fleet-master" trend={f?.trend.active} loading={fleet.loading} />
        <Kpi icon={AlertTriangle} tone="t-amber" value={maint.data?.total} label={p('kpi.maintenanceDue')} to="/pm-programs" loading={maint.loading} />
        <Kpi icon={AlertOctagon} tone="t-red" danger value={critical} label={p('kpi.criticalTyres')} to="/tyre-lifecycle" loading={tyres.loading} />
        <Kpi icon={FileWarning} tone="t-green" value={f?.missingSpecs} label={p('kpi.missingSpecs')} to="/fleet-master" loading={fleet.loading} />
        <Kpi icon={ShieldCheck} tone="t-green" value={f?.noPolicy} label={p('kpi.noPolicy')} to="/fleet-master" loading={fleet.loading} />
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
      {/* Accident steps owned by me or my role (accident_my_tasks); shows its own
          empty / not-switched-on state, so it never adds noise. */}
      <div className="cc-accident-tasks" style={{ marginTop: 16 }}>
        <CaseTeamInbox compact />
      </div>
    </div>
  )
}
