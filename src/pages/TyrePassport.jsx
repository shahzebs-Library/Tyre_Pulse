/**
 * TyrePassport (routes /tyre-passport and /tyre-passport/:serial). A per-tyre
 * whole-life "passport": look up a serial and see that physical tyre's complete
 * lifecycle assembled from tyre_records plus service events, warranty claims,
 * status marks and retread claims:
 *   - identity + spec + lifetime totals (km / cost / CPK),
 *   - a composite Health Score (0 to 100) with weighted sub-scores + risk band,
 *   - Wear Intelligence + a tread-over-time curve,
 *   - a cross-vehicle Journey of fitment stints (per-stint km / cost / CPK),
 *   - cost breakdown + honest predictions,
 *   - service and repair history, warranty history,
 *   - an honest data-quality audit.
 * All engines live in src/lib/tyrePassport.js and degrade honestly where a
 * signal has no source in this dataset (labelled "no data" or "N/A", never
 * fabricated). Exports a passport summary PDF and an Excel journey workbook.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ScanLine, Search, Truck, MapPin, Gauge, DollarSign, Calendar,
  AlertTriangle, ArrowLeft, CircleDot, Loader2, Package, Activity,
  HeartPulse, TrendingDown, Layers, BarChart3, Wrench, ShieldCheck,
  ClipboardCheck, CheckCircle2, FileDown, Sheet, RefreshCw, Recycle, Clock, Milestone,
} from 'lucide-react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip as ChartTooltip, Legend, Filler,
} from 'chart.js'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact, formatCurrency, formatDate } from '../lib/formatters'
import { getPassportBundle, searchSerials } from '../lib/api/tyrePassport'
import { buildPassport } from '../lib/tyrePassport'
import { toUserMessage } from '../lib/safeError'
import { colorAt, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, ChartTooltip, Legend, Filler)

const NA = 'N/A'

const STATUS_TONE = (s) => {
  const v = String(s || '').toLowerCase()
  if (/scrap|remov|write.?off/.test(v)) return 'bg-red-900/40 text-red-300 border border-red-700/50'
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

const SEV_TONE = {
  high: 'text-red-300 border-red-500/40 bg-red-500/10',
  medium: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  low: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
}

const EVENT_TONE = (t) => {
  const v = String(t || '').toLowerCase()
  if (v === 'repair') return 'bg-orange-500/15 text-orange-300 border border-orange-500/30'
  if (v === 'rotation') return 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
  if (v === 'retread') return 'bg-violet-500/15 text-violet-300 border border-violet-500/30'
  if (v === 'inflation') return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
  if (v === 'replacement') return 'bg-red-500/15 text-red-300 border border-red-500/30'
  return 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]'
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
        <span className="text-3xl font-bold text-[var(--text-primary)]">{score ?? NA}</span>
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
          placeholder="Search a tyre serial number"
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
              <span className="text-xs text-[var(--text-muted)] truncate">{[r.brand, r.size, r.asset_no].filter(Boolean).join(' / ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Empty({ icon: Icon, title, sub }) {
  return (
    <div className="py-12 text-center text-[var(--text-muted)]">
      <Icon size={26} className="mx-auto mb-2 opacity-60" />
      <p className="text-sm text-[var(--text-secondary)]">{title}</p>
      {sub && <p className="text-xs mt-1">{sub}</p>}
    </div>
  )
}

const TABS = [
  { key: 'overview', label: 'Overview', icon: HeartPulse },
  { key: 'journey', label: 'Journey', icon: Milestone },
  { key: 'wear', label: 'Wear curve', icon: BarChart3 },
  { key: 'service', label: 'Service & repairs', icon: Wrench },
  { key: 'warranty', label: 'Warranty', icon: ShieldCheck },
  { key: 'quality', label: 'Data quality', icon: ClipboardCheck },
]

export default function TyrePassport() {
  const { serial } = useParams()
  const navigate = useNavigate()
  const { activeCountry, activeCurrency } = useSettings()
  const [bundle, setBundle] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('overview')

  const load = useCallback(async (sn) => {
    if (!sn) { setBundle(null); return }
    setLoading(true); setError('')
    try {
      setBundle(await getPassportBundle(sn, { country: activeCountry }))
    } catch (err) {
      setError(toUserMessage(err, 'Could not load this tyre.')); setBundle({ records: [] })
    } finally { setLoading(false) }
  }, [activeCountry])

  useEffect(() => { if (serial) load(serial) }, [serial, load])
  useEffect(() => { setTab('overview') }, [serial])

  const passport = useMemo(() => {
    if (!bundle) return null
    return buildPassport(bundle.records || [], {
      serviceEvents: bundle.serviceEvents,
      warrantyClaims: bundle.warrantyClaims,
      statusMarks: bundle.statusMarks,
      retreadClaims: bundle.retreadClaims,
    })
  }, [bundle])

  const money = (v) => (v == null ? NA : formatCurrencyCompact(v, activeCurrency))
  const moneyFull = (v) => (v == null ? NA : formatCurrency(v, activeCurrency))
  const kmTxt = (v) => (v == null ? NA : Number(v).toLocaleString())
  const dateTxt = (v) => (v ? formatDate(v) : NA)

  const wearChart = useMemo(() => {
    const series = passport?.treadSeries?.length ? passport.treadSeries : []
    if (!series.length) return null
    const line = colorAt(0)
    return {
      data: {
        labels: series.map((p) => formatDate(p.date)),
        datasets: [{
          label: 'Tread depth (mm)',
          data: series.map((p) => p.tread),
          borderColor: line,
          backgroundColor: withAlpha(line, 0.14),
          fill: true,
          tension: 0.25,
          pointRadius: 3,
          pointBackgroundColor: series.map((p) => (p.source === 'service' ? colorAt(2) : line)),
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)' }, title: { display: true, text: 'mm', color: 'var(--text-muted)' } },
          x: { grid: { display: false }, ticks: { color: 'var(--text-muted)', maxRotation: 0, autoSkip: true } },
        },
      },
    }
  }, [passport])

  const exportPdf = useCallback(async () => {
    if (!passport) return
    const rows = passport.journey.map((s) => ({
      asset_no: s.asset_no || NA,
      position: s.position || NA,
      fitted: dateTxt(s.fitted),
      removed: s.removed ? dateTxt(s.removed) : 'Current',
      km_run: s.km_run == null ? NA : Number(s.km_run).toLocaleString(),
      cost: s.cost == null ? NA : moneyFull(s.cost),
      cpk: s.cpk == null ? NA : String(s.cpk),
      reason: s.reason || NA,
    }))
    const headers = ['Asset', 'Position', 'Fitted', 'Removed', 'Km run', 'Cost', 'CPK', 'Reason']
    const keys = ['asset_no', 'position', 'fitted', 'removed', 'km_run', 'cost', 'cpk', 'reason']
    await exportToPdf(
      rows,
      keys.map((k, i) => ({ key: k, header: headers[i] })),
      `Tyre Passport ${passport.serial}`,
      reportFileName('Tyre Passport', passport.serial),
      'landscape',
    )
  }, [passport])

  const exportExcel = useCallback(async () => {
    if (!passport) return
    const rows = passport.journey.map((s) => ({
      asset_no: s.asset_no || '',
      position: s.position || '',
      fitted: s.fitted || '',
      removed: s.removed || 'Current',
      km_run: s.km_run ?? '',
      cost: s.cost ?? '',
      cpk: s.cpk ?? '',
      reason: s.reason || '',
    }))
    const keys = ['asset_no', 'position', 'fitted', 'removed', 'km_run', 'cost', 'cpk', 'reason']
    const headers = ['Asset', 'Position', 'Fitted', 'Removed', 'Km run', 'Cost', 'CPK', 'Reason']
    await exportToExcel(rows, keys, headers, reportFileName('Tyre Passport', passport.serial), 'Journey', {
      title: `Tyre Passport ${passport.serial}`, currency: activeCurrency,
    })
  }, [passport, activeCurrency])

  const kpis = passport ? [
    { label: 'Lifetime km', value: passport.totals.km ? passport.totals.km.toLocaleString() : NA, icon: Gauge },
    { label: 'Lifetime cost', value: money(passport.costBreakdown.lifetime), icon: DollarSign },
    { label: 'CPK', value: passport.totals.cpk == null ? NA : String(passport.totals.cpk), icon: Activity },
    { label: 'Vehicles', value: passport.distinctVehicles || NA, icon: Truck },
    { label: 'Retreads', value: passport.retreadCount, icon: Recycle },
    { label: 'Records', value: passport.recordCount, icon: Package },
  ] : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Passport"
        subtitle="Look up any tyre serial for its full whole-life record: health, wear, cost/CPK, cross-vehicle journey, service, warranty and data quality."
        icon={ScanLine}
        actions={serial ? (
          <div className="flex items-center gap-2">
            {passport && (
              <>
                <button onClick={exportPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5"><FileDown size={14} /> PDF</button>
                <button onClick={exportExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5"><Sheet size={14} /> Excel</button>
                <button onClick={() => load(serial)} className="btn-secondary text-sm inline-flex items-center gap-1.5" title="Refresh"><RefreshCw size={14} /></button>
              </>
            )}
            <button onClick={() => navigate('/tyre-passport')} className="btn-secondary text-sm inline-flex items-center gap-1.5"><ArrowLeft size={14} /> New search</button>
          </div>
        ) : null}
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
              <div><p className="text-red-300 font-medium">Could not load this tyre.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
            </div>
          ) : !passport ? (
            <div className="card text-center py-12 space-y-2">
              <Package size={30} className="mx-auto text-[var(--text-muted)]" />
              <p className="text-[var(--text-primary)] font-semibold">No records for {serial}.</p>
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
                      <p className="text-2xl font-bold font-mono text-[var(--text-primary)]">{passport.serial || NA}</p>
                      <p className="text-sm text-[var(--text-muted)] mt-1">{[passport.brand, passport.size, passport.supplier].filter(Boolean).join(' / ') || 'No brand/size on record'}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${(RISK_META[passport.health.risk] || RISK_META.unknown).cls}`}>{(RISK_META[passport.health.risk] || RISK_META.unknown).label}</span>
                        <span className={`text-xs px-2.5 py-1 rounded ${STATUS_TONE(passport.status)}`}>{String(passport.status || 'unknown').replace(/_/g, ' ')}</span>
                        {passport.statusMarks.map((m) => (
                          <span key={m} className="text-xs px-2 py-0.5 rounded-full border border-red-500/40 bg-red-500/10 text-red-300">{String(m).replace(/_/g, ' ')}</span>
                        ))}
                      </div>
                      <div className="flex items-center gap-x-4 gap-y-1 mt-2 text-xs text-[var(--text-muted)] flex-wrap">
                        <span className="flex items-center gap-1"><Calendar size={12} /> First fitted {dateTxt(passport.firstFittedDate)}</span>
                        <span className="flex items-center gap-1"><Clock size={12} /> Age {passport.ageDays == null ? NA : `${passport.ageDays.toLocaleString()} days`}</span>
                        {passport.currentAssetNo ? (
                          <span className="flex items-center gap-1">
                            <Truck size={12} /> On
                            <Link to={`/assets/${encodeURIComponent(passport.currentAssetNo)}`} className="font-mono text-[var(--brand-bright)] hover:underline">{passport.currentAssetNo}</Link>
                            {passport.currentPosition && <span>pos {passport.currentPosition}</span>}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1"><MapPin size={12} /> Not currently fitted</span>
                        )}
                        <span className="flex items-center gap-1"><Recycle size={12} /> {passport.rotationCount} rotation(s)</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 min-w-[220px]">
                    {kpis.map((k) => {
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
                    {passport.assets.map((a) => (
                      <Link key={a} to={`/assets/${encodeURIComponent(a)}`} className="font-mono text-[var(--text-secondary)] hover:text-[var(--brand-bright)] hover:underline">{a}</Link>
                    ))}
                  </p>
                )}
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-[var(--input-border)] overflow-x-auto">
                {TABS.map((t) => {
                  const Icon = t.icon
                  const active = tab === t.key
                  const badge = t.key === 'service' ? passport.serviceEvents.length
                    : t.key === 'warranty' ? passport.warranty.length
                    : t.key === 'quality' ? passport.dataQuality.length : 0
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${active ? 'border-[var(--brand-bright)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                    >
                      <Icon size={14} /> {t.label}
                      {badge > 0 && <span className={`ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${t.key === 'quality' ? 'bg-amber-500/20 text-amber-300' : 'bg-[var(--input-bg)] text-[var(--text-muted)]'}`}>{badge}</span>}
                    </button>
                  )
                })}
              </div>

              {/* Overview */}
              {tab === 'overview' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="card">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><HeartPulse size={15} /> Health breakdown</h3>
                    <p className="text-xs text-[var(--text-muted)] mb-4">Weighted 0 to 100 score. Signals without a source in this dataset are shown as "no data" and use a neutral baseline.</p>
                    <div className="space-y-3">
                      {Object.entries(passport.health.components).map(([key, c]) => (
                        <ScoreBar key={key} label={COMPONENT_LABELS[key] || key} score={c.score} hasData={c.hasData} />
                      ))}
                    </div>
                  </div>

                  <div className="card">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2"><TrendingDown size={15} /> Wear intelligence</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Tread remaining', value: passport.wear.treadRemainingPct == null ? NA : `${passport.wear.treadRemainingPct}%` },
                        { label: 'Current tread', value: passport.wear.currentTread == null ? NA : `${passport.wear.currentTread} mm` },
                        { label: 'Wear rate', value: passport.wear.wearRatePer1000Km == null ? NA : `${passport.wear.wearRatePer1000Km} mm/1000km` },
                        { label: 'Readings', value: passport.wear.readingCount },
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

                  {/* Predictions */}
                  <div className="card">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2"><Activity size={15} /> Predictions</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Projected life left', value: passport.predictions.projectedRemainingKm == null ? NA : `${passport.predictions.projectedRemainingKm.toLocaleString()} km` },
                        { label: 'Projected replacement', value: dateTxt(passport.predictions.projectedReplacementDate) },
                      ].map((m) => (
                        <div key={m.label} className="rounded-lg bg-[var(--input-bg)]/50 p-3">
                          <p className="text-xs text-[var(--text-muted)]">{m.label}</p>
                          <p className="text-base font-bold text-[var(--text-primary)] mt-0.5">{m.value}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] mt-3">
                      {passport.scrapped
                        ? 'This tyre is removed / scrapped, so no forward projection is made.'
                        : 'Projections are computed only from the observed wear rate and average daily distance; they are omitted (N/A) when not derivable.'}
                    </p>
                  </div>

                  {/* Cost breakdown */}
                  <div className="card">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2"><DollarSign size={15} /> Cost breakdown</h3>
                    <div className="space-y-2 text-sm">
                      {[
                        ['Purchase', passport.costBreakdown.purchase],
                        ['Service and repairs', passport.costBreakdown.service],
                        ['Recovered (warranty / retread)', passport.costBreakdown.recovered == null ? null : -passport.costBreakdown.recovered],
                      ].map(([label, v]) => (
                        <div key={label} className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">{label}</span>
                          <span className={`font-medium ${typeof v === 'number' && v < 0 ? 'text-emerald-400' : 'text-[var(--text-primary)]'}`}>{v == null ? NA : moneyFull(v)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between border-t border-[var(--input-border)] pt-2 mt-1">
                        <span className="text-[var(--text-primary)] font-semibold">Net lifetime cost</span>
                        <span className="text-[var(--text-primary)] font-bold">{moneyFull(passport.costBreakdown.netLifetime)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--text-secondary)]">Net CPK</span>
                        <span className="text-[var(--text-primary)] font-medium">{passport.costBreakdown.netCpk == null ? NA : passport.costBreakdown.netCpk}</span>
                      </div>
                    </div>
                  </div>

                  {/* Lifecycle statistics */}
                  <div className="card lg:col-span-2">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2"><Layers size={15} /> Lifecycle statistics</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                      {[
                        { label: 'Records', value: passport.stats.recordCount, icon: Package },
                        { label: 'Vehicles', value: passport.distinctVehicles, icon: Truck },
                        { label: 'Positions', value: passport.stats.positionsServed, icon: MapPin },
                        { label: 'Km earned', value: kmTxt(passport.stats.kmEarned || null), icon: Gauge },
                        { label: 'Repairs', value: passport.stats.repairCount, icon: Wrench },
                        { label: 'Last pressure', value: passport.stats.lastPressure == null ? NA : `${passport.stats.lastPressure} psi`, icon: Gauge },
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

              {/* Journey */}
              {tab === 'journey' && (
                <div className="card overflow-hidden !p-0">
                  <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
                    <Milestone size={15} className="text-[var(--text-muted)]" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Cross-vehicle journey</h3>
                    <span className="text-xs text-[var(--text-muted)]">{passport.journey.length} stint(s) across {passport.distinctVehicles} vehicle(s)</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                          {['Asset', 'Position', 'Site', 'Fitted', 'Removed', 'Km run', 'Cost', 'CPK', 'Removal reason'].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {passport.journey.length === 0 ? (
                          <tr><td colSpan={9} className="px-4 py-10 text-center text-[var(--text-muted)]">No stint history on record.</td></tr>
                        ) : passport.journey.map((e, i) => (
                          <tr key={e.id ?? i} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                            <td className="px-4 py-2.5 font-mono">
                              {e.asset_no ? <Link to={`/assets/${encodeURIComponent(e.asset_no)}`} className="text-[var(--brand-bright)] hover:underline">{e.asset_no}</Link> : <span className="text-[var(--text-muted)]">{NA}</span>}
                            </td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.position || NA}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.site || NA}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{dateTxt(e.fitted)}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.removed ? dateTxt(e.removed) : <span className="text-emerald-400">Current</span>}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{kmTxt(e.km_run)}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.cost == null ? NA : money(e.cost)}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.cpk == null ? NA : e.cpk}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.reason || NA}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Wear curve */}
              {tab === 'wear' && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><BarChart3 size={15} /> Tread depth over time</h3>
                  <p className="text-xs text-[var(--text-muted)] mb-4">Combines tread readings from fitment records and service events.</p>
                  {wearChart ? (
                    <div className="h-72"><Line data={wearChart.data} options={wearChart.options} /></div>
                  ) : (
                    <Empty icon={BarChart3} title="No tread readings recorded for this tyre yet." />
                  )}
                </div>
              )}

              {/* Service & repairs */}
              {tab === 'service' && (
                <div className="card overflow-hidden !p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                          {['Date', 'Type', 'Asset', 'Position', 'Tread', 'Pressure', 'Cost', 'Technician', 'Notes'].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {passport.serviceEvents.length === 0 ? (
                          <tr><td colSpan={9} className="px-4 py-10 text-center text-[var(--text-muted)]">No service or repair events recorded for this tyre.</td></tr>
                        ) : passport.serviceEvents.map((e, i) => (
                          <tr key={e.id ?? i} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                            <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{dateTxt(e.date)}</td>
                            <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded ${EVENT_TONE(e.type)}`}>{e.type}</span></td>
                            <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">{e.asset_no || NA}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.position || NA}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.tread == null ? NA : `${e.tread} mm`}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.pressure == null ? NA : `${e.pressure} psi`}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.cost == null ? NA : money(e.cost)}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{e.technician || NA}</td>
                            <td className="px-4 py-2.5 text-[var(--text-muted)] max-w-[220px] truncate" title={e.notes || ''}>{e.notes || NA}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Warranty */}
              {tab === 'warranty' && (
                <div className="space-y-6">
                  <div className="card overflow-hidden !p-0">
                    <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
                      <ShieldCheck size={15} className="text-[var(--text-muted)]" />
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Warranty claims</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                            {['Claim no', 'Status', 'Failure type', 'Supplier', 'Km run', 'Credit', 'Credit date'].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {passport.warranty.length === 0 ? (
                            <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--text-muted)]">No warranty claims recorded for this tyre.</td></tr>
                          ) : passport.warranty.map((c, i) => (
                            <tr key={c.id ?? i} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                              <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">{c.claim_no || NA}</td>
                              <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded ${STATUS_TONE(c.status)}`}>{c.status || NA}</span></td>
                              <td className="px-4 py-2.5 text-[var(--text-secondary)]">{c.failure_type || NA}</td>
                              <td className="px-4 py-2.5 text-[var(--text-secondary)]">{c.supplier || NA}</td>
                              <td className="px-4 py-2.5 text-[var(--text-secondary)]">{kmTxt(c.km_run)}</td>
                              <td className="px-4 py-2.5 text-emerald-400">{c.credit_amount == null ? NA : money(c.credit_amount)}</td>
                              <td className="px-4 py-2.5 text-[var(--text-secondary)]">{dateTxt(c.credit_date)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {passport.retreadClaims.length > 0 && (
                    <div className="card overflow-hidden !p-0">
                      <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
                        <Recycle size={15} className="text-[var(--text-muted)]" />
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Retread claims</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                              {['Claim no', 'Vendor', 'Status', 'Reason', 'Cost', 'Recovered', 'Date'].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {passport.retreadClaims.map((c, i) => (
                              <tr key={c.id ?? i} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                                <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">{c.claim_no || NA}</td>
                                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{c.vendor || NA}</td>
                                <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded ${STATUS_TONE(c.status)}`}>{c.status || NA}</span></td>
                                <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[220px] truncate" title={c.reason || ''}>{c.reason || NA}</td>
                                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{c.cost == null ? NA : money(c.cost)}</td>
                                <td className="px-4 py-2.5 text-emerald-400">{c.amount_recovered == null ? NA : money(c.amount_recovered)}</td>
                                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{dateTxt(c.claim_date)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Data quality */}
              {tab === 'quality' && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2"><ClipboardCheck size={15} /> Data quality audit</h3>
                  {passport.dataQuality.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                      <CheckCircle2 size={16} /> All checks passed. No data-quality issues detected for this tyre.
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {passport.dataQuality.map((w, i) => (
                        <li key={i} className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${SEV_TONE[w.severity] || SEV_TONE.low}`}>
                          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                          <div>
                            <p className="font-medium capitalize">{String(w.severity)} severity</p>
                            <p className="opacity-90 mt-0.5">{w.message}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-[var(--text-muted)] mt-4">Checks: impossible cross-vehicle date overlap, tread readings that increase over time, and stints missing fitment or removal odometer.</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
