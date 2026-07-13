/**
 * TyrePassport (routes /tyre-passport and /tyre-passport/:serial) — ported +
 * deepened from tyre_saas. A per-tyre "passport": look up a serial and see that
 * physical tyre's complete lifecycle from `tyre_records`:
 *   • identity + lifetime totals (km / hours / cost / CPK),
 *   • a composite Health Score (0–100) with weighted sub-scores + risk band,
 *   • Wear Intelligence (tread-remaining %, wear rate, projected scrap km),
 *   • a tread-over-time wear curve,
 *   • per-stint position history with km earned,
 *   • a chronological lifecycle timeline.
 * All engines live in `src/lib/tyrePassport.js` and degrade honestly where a
 * signal has no source in this dataset (labelled "no data", never fabricated).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ScanLine, Search, Truck, MapPin, Gauge, DollarSign, Calendar,
  AlertTriangle, ArrowLeft, CircleDot, Loader2, Package, Activity,
  HeartPulse, TrendingDown, Layers, BarChart3, ListTree, Wrench,
} from 'lucide-react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip as ChartTooltip, Legend, Filler,
} from 'chart.js'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact, formatDate } from '../lib/formatters'
import { getPassportRecords, searchSerials } from '../lib/api/tyrePassport'
import { buildPassport } from '../lib/tyrePassport'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, ChartTooltip, Legend, Filler)

const STATUS_TONE = (s) => {
  const v = String(s || '').toLowerCase()
  if (/scrap|remov/.test(v)) return 'bg-red-900/40 text-red-300 border border-red-700/50'
  if (/service|fit|active|in_service/.test(v)) return 'bg-green-900/40 text-green-300 border border-green-700/50'
  return 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]'
}

const RISK_META = {
  low: { label: 'Low risk', cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10', ring: '#34d399' },
  medium: { label: 'Medium risk', cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10', ring: '#fbbf24' },
  high: { label: 'High risk', cls: 'text-orange-300 border-orange-500/40 bg-orange-500/10', ring: '#fb923c' },
  critical: { label: 'Critical', cls: 'text-red-300 border-red-500/40 bg-red-500/10', ring: '#f87171' },
  unknown: { label: 'Unknown', cls: 'text-[var(--text-muted)] border-[var(--input-border)]', ring: '#94a3b8' },
}

const COMPONENT_LABELS = {
  tread: 'Tread', pressure: 'Pressure', age: 'Age', alerts: 'Alerts', history: 'Repair history',
}

/** Circular health gauge (SVG). */
function HealthRing({ score, risk }) {
  const meta = RISK_META[risk] || RISK_META.unknown
  const r = 46
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score ?? 0))
  const dash = (pct / 100) * c
  return (
    <div className="relative w-32 h-32 shrink-0">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--input-border)" strokeWidth="10" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke={meta.ring} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-[var(--text-primary)]">{score ?? '—'}</span>
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Health</span>
      </div>
    </div>
  )
}

function ScoreBar({ label, score, hasData }) {
  const pct = Math.max(0, Math.min(100, score))
  const tone = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : pct >= 40 ? 'bg-orange-500' : 'bg-red-500'
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-[var(--text-secondary)]">{label}</span>
        {hasData
          ? <span className="text-[var(--text-primary)] font-medium">{score}</span>
          : <span className="text-[var(--text-muted)] italic">no data</span>}
      </div>
      <div className="h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
        <div className={`h-full rounded-full ${hasData ? tone : 'bg-[var(--input-border)]'}`} style={{ width: `${hasData ? pct : 100}%`, opacity: hasData ? 1 : 0.35 }} />
      </div>
    </div>
  )
}

function SearchBox({ country, onPick }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (q.trim().length < 2) { setResults([]); return undefined }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try { setResults(await searchSerials(q, { country })); setOpen(true) }
      catch { setResults([]) }
      finally { setLoading(false) }
    }, 250)
    return () => timer.current && clearTimeout(timer.current)
  }, [q, country])

  return (
    <div className="relative max-w-xl">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          className="input pl-9 w-full"
          placeholder="Search a tyre serial number…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) onPick(q.trim()) }}
        />
        {loading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--text-muted)]" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-[var(--input-border)] bg-[var(--surface-2)] shadow-xl py-1">
          {results.map((r) => (
            <button
              key={r.serial}
              type="button"
              onClick={() => { setOpen(false); onPick(r.serial) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-1)]"
            >
              <CircleDot size={14} className="text-[var(--text-muted)] shrink-0" />
              <span className="font-mono text-[var(--text-primary)]">{r.serial}</span>
              <span className="text-xs text-[var(--text-muted)] truncate">{[r.brand, r.size, r.asset_no].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const TABS = [
  { key: 'overview', label: 'Overview', icon: HeartPulse },
  { key: 'wear', label: 'Wear curve', icon: BarChart3 },
  { key: 'positions', label: 'Positions', icon: ListTree },
  { key: 'timeline', label: 'Timeline', icon: Layers },
]

export default function TyrePassport() {
  const { serial } = useParams()
  const navigate = useNavigate()
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('overview')

  const load = useCallback(async (sn) => {
    if (!sn) { setRecords(null); return }
    setLoading(true); setError('')
    try {
      setRecords(await getPassportRecords(sn, { country: activeCountry }))
    } catch (err) {
      setError(err?.message || 'Could not load this tyre.'); setRecords([])
    } finally { setLoading(false) }
  }, [activeCountry])

  useEffect(() => { if (serial) load(serial) }, [serial, load])
  useEffect(() => { setTab('overview') }, [serial])

  const passport = useMemo(() => buildPassport(records || []), [records])
  const money = (v) => (v == null ? '—' : formatCurrencyCompact(v, activeCurrency))

  const wearChart = useMemo(() => {
    if (!passport?.wearCurve?.length) return null
    return {
      data: {
        labels: passport.wearCurve.map((p) => formatDate(p.date)),
        datasets: [{
          label: 'Tread depth (mm)',
          data: passport.wearCurve.map((p) => p.tread),
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56,189,248,0.12)',
          fill: true,
          tension: 0.25,
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.12)' }, ticks: { color: '#94a3b8' }, title: { display: true, text: 'mm', color: '#94a3b8' } },
          x: { grid: { display: false }, ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true } },
        },
      },
    }
  }, [passport])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Passport"
        subtitle="Look up any tyre serial for its full lifecycle — health, wear, cost/CPK, positions and history."
        icon={ScanLine}
        actions={serial ? <button onClick={() => navigate('/tyre-passport')} className="btn-secondary text-sm inline-flex items-center gap-1.5"><ArrowLeft size={14} /> New search</button> : null}
      />

      {!serial && (
        <div className="card space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">Enter a serial number to open its passport.</p>
          <SearchBox country={activeCountry} onPick={(sn) => navigate(`/tyre-passport/${encodeURIComponent(sn)}`)} />
        </div>
      )}

      {serial && (
        <>
          <div className="card"><SearchBox country={activeCountry} onPick={(sn) => navigate(`/tyre-passport/${encodeURIComponent(sn)}`)} /></div>

          {loading ? (
            <div className="card animate-pulse h-40" />
          ) : error ? (
            <div className="card border border-red-800/50 flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
              <div><p className="text-red-300 font-medium">Couldn't load this tyre.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
            </div>
          ) : !passport ? (
            <div className="card text-center py-12 space-y-2">
              <Package size={30} className="mx-auto text-[var(--text-muted)]" />
              <p className="text-[var(--text-primary)] font-semibold">No records for “{serial}”.</p>
              <p className="text-sm text-[var(--text-muted)]">Check the serial or try a different one.</p>
            </div>
          ) : (
            <>
              {/* Identity + health header */}
              <div className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-5">
                    <HealthRing score={passport.health.overall} risk={passport.health.risk} />
                    <div>
                      <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Serial</p>
                      <p className="text-2xl font-bold font-mono text-[var(--text-primary)]">{passport.serial || '—'}</p>
                      <p className="text-sm text-[var(--text-muted)] mt-1">{[passport.brand, passport.size, passport.supplier].filter(Boolean).join(' · ') || 'No brand/size on record'}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${(RISK_META[passport.health.risk] || RISK_META.unknown).cls}`}>{(RISK_META[passport.health.risk] || RISK_META.unknown).label}</span>
                        <span className={`text-xs px-2.5 py-1 rounded ${STATUS_TONE(passport.status)}`}>{String(passport.status || 'unknown').replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 min-w-[220px]">
                    {[
                      { label: 'Lifetime km', value: passport.totals.km ? passport.totals.km.toLocaleString() : '—', icon: Gauge },
                      { label: 'Lifetime cost', value: money(passport.totals.cost), icon: DollarSign },
                      { label: 'CPK', value: passport.totals.cpk == null ? '—' : money(passport.totals.cpk), icon: Activity },
                      { label: 'Records', value: passport.recordCount, icon: Package },
                    ].map((k) => {
                      const Icon = k.icon
                      return (
                        <div key={k.label} className="rounded-lg bg-[var(--input-bg)]/50 p-3">
                          <div className="flex items-center justify-between"><span className="text-xs text-[var(--text-muted)]">{k.label}</span><Icon size={14} className="text-[var(--text-muted)]" /></div>
                          <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5">{k.value}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {passport.assets.length > 0 && (
                  <p className="text-xs text-[var(--text-muted)] mt-3 flex items-center gap-1.5 flex-wrap">
                    <Truck size={12} /> Ran on:
                    {passport.assets.map((a) => <span key={a} className="font-mono text-[var(--text-secondary)]">{a}</span>)}
                  </p>
                )}
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-[var(--input-border)] overflow-x-auto">
                {TABS.map((t) => {
                  const Icon = t.icon
                  const active = tab === t.key
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${active ? 'border-[var(--brand-bright)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                    >
                      <Icon size={14} /> {t.label}
                    </button>
                  )
                })}
              </div>

              {/* Overview */}
              {tab === 'overview' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Health breakdown */}
                  <div className="card">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><HeartPulse size={15} /> Health breakdown</h3>
                    <p className="text-xs text-[var(--text-muted)] mb-4">Weighted 0–100 score. Signals without a source in this dataset are shown as “no data” and use a neutral baseline.</p>
                    <div className="space-y-3">
                      {Object.entries(passport.health.components).map(([key, c]) => (
                        <ScoreBar key={key} label={COMPONENT_LABELS[key] || key} score={c.score} hasData={c.hasData} />
                      ))}
                    </div>
                  </div>

                  {/* Wear intelligence */}
                  <div className="card">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2"><TrendingDown size={15} /> Wear intelligence</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Tread remaining', value: passport.wear.treadRemainingPct == null ? '—' : `${passport.wear.treadRemainingPct}%` },
                        { label: 'Current tread', value: passport.wear.currentTread == null ? '—' : `${passport.wear.currentTread} mm` },
                        { label: 'Wear rate', value: passport.wear.wearRatePer1000Km == null ? '—' : `${passport.wear.wearRatePer1000Km} mm/1000km` },
                        { label: 'Projected life left', value: passport.wear.projectedRemainingKm == null ? '—' : `${passport.wear.projectedRemainingKm.toLocaleString()} km` },
                      ].map((m) => (
                        <div key={m.label} className="rounded-lg bg-[var(--input-bg)]/50 p-3">
                          <p className="text-xs text-[var(--text-muted)]">{m.label}</p>
                          <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5">{m.value}</p>
                        </div>
                      ))}
                    </div>
                    {passport.wear.readingCount <= 1 && (
                      <p className="text-[11px] text-[var(--text-muted)] mt-3">Wear rate needs at least two tread readings over distance; only {passport.wear.readingCount} reading available.</p>
                    )}
                  </div>

                  {/* Statistics strip */}
                  <div className="card lg:col-span-2">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2"><Activity size={15} /> Lifecycle statistics</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                      {[
                        { label: 'Records', value: passport.stats.recordCount, icon: Package },
                        { label: 'Assets served', value: passport.stats.assetsServed, icon: Truck },
                        { label: 'Positions', value: passport.stats.positionsServed, icon: MapPin },
                        { label: 'Km earned', value: passport.stats.kmEarned ? passport.stats.kmEarned.toLocaleString() : '—', icon: Gauge },
                        { label: 'Repairs', value: passport.stats.repairCount, icon: Wrench },
                        { label: 'Last pressure', value: passport.stats.lastPressure == null ? '—' : `${passport.stats.lastPressure} psi`, icon: Gauge },
                      ].map((s) => {
                        const Icon = s.icon
                        return (
                          <div key={s.label} className="rounded-lg bg-[var(--input-bg)]/50 p-3">
                            <div className="flex items-center justify-between"><span className="text-xs text-[var(--text-muted)]">{s.label}</span><Icon size={13} className="text-[var(--text-muted)]" /></div>
                            <p className="text-base font-bold text-[var(--text-primary)] mt-0.5">{s.value}</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Wear curve */}
              {tab === 'wear' && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2"><BarChart3 size={15} /> Tread depth over time</h3>
                  {wearChart ? (
                    <div className="h-72"><Line data={wearChart.data} options={wearChart.options} /></div>
                  ) : (
                    <div className="py-12 text-center text-[var(--text-muted)]">
                      <BarChart3 size={26} className="mx-auto mb-2 opacity-60" />
                      <p className="text-sm">No tread readings recorded for this tyre yet.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Positions */}
              {tab === 'positions' && (
                <div className="card overflow-hidden !p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                          {['Asset', 'Position', 'Site', 'Fitted', 'Removed', 'Km earned', 'Cost'].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {passport.positions.length === 0 ? (
                          <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--text-muted)]">No position history on record.</td></tr>
                        ) : passport.positions.map((e, i) => (
                          <tr key={e.id ?? i} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                            <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">{e.asset_no || '—'}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.position || '—'}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.site || '—'}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.fitment_date ? formatDate(e.fitment_date) : '—'}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.removal_date ? formatDate(e.removal_date) : <span className="text-emerald-400">current</span>}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.kmEarned != null ? e.kmEarned.toLocaleString() : '—'}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.cost != null ? money(e.cost) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Timeline */}
              {tab === 'timeline' && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Lifecycle timeline</h3>
                  <ol className="relative border-l border-[var(--input-border)] ml-2 space-y-5">
                    {passport.events.map((e, i) => (
                      <li key={e.id ?? i} className="ml-4">
                        <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-[var(--brand-bright)] border-2 border-[var(--surface-1)]" />
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                            <Calendar size={12} className="text-[var(--text-muted)]" />
                            {e.fitment_date ? `Fitted ${formatDate(e.fitment_date)}` : e.date ? formatDate(e.date) : 'Undated'}
                            {e.removal_date && <span className="text-[var(--text-muted)]">→ removed {formatDate(e.removal_date)}</span>}
                          </p>
                          {e.status && <span className={`text-[10px] px-2 py-0.5 rounded ${STATUS_TONE(e.status)}`}>{String(e.status).replace(/_/g, ' ')}</span>}
                        </div>
                        <div className="text-xs text-[var(--text-muted)] mt-1 flex flex-wrap gap-x-4 gap-y-1">
                          {e.asset_no && <span className="flex items-center gap-1"><Truck size={11} /> {e.asset_no}</span>}
                          {e.position && <span>Pos: {e.position}</span>}
                          {e.site && <span className="flex items-center gap-1"><MapPin size={11} /> {e.site}</span>}
                          {e.tread_depth != null && <span className="flex items-center gap-1"><TrendingDown size={11} /> {e.tread_depth} mm</span>}
                          {e.km != null && <span className="flex items-center gap-1"><Gauge size={11} /> {e.km.toLocaleString()} km</span>}
                          {e.cost != null && <span className="flex items-center gap-1"><DollarSign size={11} /> {money(e.cost)}</span>}
                          {e.reason && <span className="text-amber-400/90">Reason: {e.reason}</span>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
