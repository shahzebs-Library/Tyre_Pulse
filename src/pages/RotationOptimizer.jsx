/**
 * RotationOptimizer (route /rotation-optimizer) — advanced maintenance-planning
 * tool. For every vehicle it analyses the tyres currently fitted and recommends
 * rotations/swaps that even out tread wear and extend overall tyre life.
 *
 * Runs entirely on the existing `tyre_records` table (in-service tyres, i.e.
 * removal_date IS NULL) — no new data required. All optimisation logic lives in
 * the pure, unit-tested `src/lib/rotationOptimizer.js`; this page only fetches,
 * filters, and presents. Honest empty/error/loading states — no mock data.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  RotateCcw, AlertTriangle, Truck, Search, X, Filter,
  FileSpreadsheet, FileText, ChevronRight, ArrowRightLeft, CheckCircle2, Info,
  ShieldAlert, ShieldCheck, Zap, ArrowRight, Scale, BarChart3,
} from 'lucide-react'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip as ChartTooltip, Legend,
} from 'chart.js'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { listInServiceTyres } from '../lib/api/rotationOptimizer'
import {
  optimizeFleet, serialOf, positionOf, treadOf, DEFAULT_ROTATION_OPTS,
} from '../lib/rotationOptimizer'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, ChartTooltip, Legend)

// Overall-status badge styling (from the deepened engine).
const STATUS_META = {
  critical: { label: 'Critical', cls: 'bg-red-900/40 text-red-300 border border-red-700/50', bar: '#f87171' },
  warning: { label: 'Warning', cls: 'bg-orange-900/40 text-orange-300 border border-orange-700/50', bar: '#fb923c' },
  advisory: { label: 'Advisory', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50', bar: '#fbbf24' },
  good: { label: 'Good', cls: 'bg-green-900/40 text-green-300 border border-green-700/50', bar: '#34d399' },
}
const URGENCY_BAR = { critical: '#f87171', warning: '#fb923c', advisory: '#38bdf8' }

const fmt = (n) => (n == null ? '—' : n)
const treadTone = (mm) =>
  mm == null ? 'text-[var(--text-muted)]' : mm < 1.6 ? 'text-red-400' : mm < 4 ? 'text-amber-400' : 'text-emerald-400'

/** Compact wear-balance ring (SVG). */
function BalanceRing({ score }) {
  const r = 20
  const c = 2 * Math.PI * r
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score))
  const color = score == null ? '#64748b' : pct >= 75 ? '#34d399' : pct >= 50 ? '#fbbf24' : '#f87171'
  const dash = (pct / 100) * c
  return (
    <div className="relative w-14 h-14 shrink-0" title="Wear-balance score (0–100)">
      <svg viewBox="0 0 56 56" className="w-full h-full -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--input-border)" strokeWidth="6" />
        {score != null && (
          <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${dash} ${c - dash}`} />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold text-[var(--text-primary)]">{score == null ? '—' : score}</span>
      </div>
    </div>
  )
}

export default function RotationOptimizer() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [priorityFilter, setPriorityFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listInServiceTyres({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load tyre records.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Attach the site to each analysed asset (dominant site among its tyres) so the
  // page can filter by site without re-reading the raw rows.
  const siteByAsset = useMemo(() => {
    const m = new Map()
    for (const r of rows || []) {
      if (r?.asset_no == null || !r.site) continue
      if (!m.has(r.asset_no)) m.set(r.asset_no, r.site)
    }
    return m
  }, [rows])

  const tyresByAsset = useMemo(() => {
    const m = new Map()
    for (const r of rows || []) {
      if (r?.asset_no == null || r.asset_no === '') continue
      if (!m.has(r.asset_no)) m.set(r.asset_no, [])
      m.get(r.asset_no).push(r)
    }
    return m
  }, [rows])

  const { assets, summary } = useMemo(
    () => optimizeFleet(rows || [], DEFAULT_ROTATION_OPTS),
    [rows],
  )

  const enriched = useMemo(
    () => assets.map((a) => ({
      ...a,
      site: siteByAsset.get(a.asset_no) || null,
      priorityKey: a.priority || 'balanced',
    })),
    [assets, siteByAsset],
  )

  const siteOptions = useMemo(
    () => [...new Set(enriched.map((a) => a.site).filter(Boolean))].sort(),
    [enriched],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter((a) => {
      if (priorityFilter === 'needs' && !a.eligible) return false
      if (priorityFilter !== 'all' && priorityFilter !== 'needs' && a.priorityKey !== priorityFilter) return false
      if (siteFilter && a.site !== siteFilter) return false
      if (q && !String(a.asset_no || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [enriched, priorityFilter, siteFilter, search])

  const toggle = (assetNo) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(assetNo)) next.delete(assetNo)
    else next.add(assetNo)
    return next
  })

  const kpis = [
    { label: 'Assets analysed', value: summary.assetsAnalyzed, icon: Truck, tone: 'text-[var(--text-primary)]' },
    { label: 'Need rotation', value: summary.assetsNeedingRotation, icon: RotateCcw, tone: 'text-amber-400' },
    { label: 'Critical (safety)', value: summary.criticalAssets ?? 0, icon: ShieldAlert, tone: 'text-red-400' },
    { label: 'Avg wear balance', value: summary.avgWearBalance == null ? '—' : `${summary.avgWearBalance}/100`, icon: Scale, tone: 'text-[var(--text-primary)]' },
  ]

  // Top imbalanced assets for the fleet chart (highest tread spread first).
  const chart = useMemo(() => {
    const top = [...filtered]
      .filter((a) => a.spread != null)
      .sort((x, y) => (y.spread ?? 0) - (x.spread ?? 0))
      .slice(0, 12)
    if (!top.length) return null
    return {
      data: {
        labels: top.map((a) => String(a.asset_no)),
        datasets: [{
          label: 'Tread spread (mm)',
          data: top.map((a) => a.spread),
          backgroundColor: top.map((a) => URGENCY_BAR[a.urgency] || '#38bdf8'),
          borderRadius: 4,
          maxBarThickness: 34,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y}mm spread` } } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.12)' }, ticks: { color: '#94a3b8' }, title: { display: true, text: 'mm', color: '#94a3b8' } },
          x: { grid: { display: false }, ticks: { color: '#94a3b8', maxRotation: 60, minRotation: 0, autoSkip: false } },
        },
      },
    }
  }, [filtered])

  // One export row per recommended swap (flattened), respecting current filters.
  // Assets with no swap still emit a summary row so the export is complete.
  const EXPORT_COLS = ['asset_no', 'site', 'status', 'score', 'spread', 'from', 'to', 'tyre', 'delta', 'benefit_km', 'impact', 'action']
  const EXPORT_HEADERS = ['Asset', 'Site', 'Status', 'Balance', 'Spread (mm)', 'From', 'To', 'Tyre', 'Δ Tread (mm)', 'Benefit (km)', 'Impact', 'Action / Note']
  const exportRows = filtered.flatMap((a) => {
    const base = {
      asset_no: a.asset_no || '',
      site: a.site || '',
      status: (STATUS_META[a.overallStatus] || {}).label || a.overallStatus || '',
      score: a.wearBalanceScore ?? '',
      spread: a.spread ?? '',
    }
    if (a.swaps && a.swaps.length) {
      return a.swaps.map((s) => ({
        ...base,
        from: s.from_position || '',
        to: s.to_position || '',
        tyre: s.tyre || '',
        delta: s.tread_delta_mm ?? '',
        benefit_km: s.expected_benefit_km ?? '',
        impact: s.impact_score ?? '',
        action: s.reason || '',
      }))
    }
    return [{ ...base, from: '', to: '', tyre: '', delta: '', benefit_km: '', impact: '', action: a.narrative || 'No rotation required — wear is balanced.' }]
  })

  const clearFilters = () => { setPriorityFilter('all'); setSiteFilter(''); setSearch('') }
  const hasFilters = priorityFilter !== 'all' || siteFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rotation Optimizer"
        subtitle="Analyses each vehicle's fitted tyres and recommends rotations to even out tread wear and extend tyre life."
        icon={RotateCcw}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'rotation_optimizer')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!exportRows.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Rotation Optimizer', 'rotation_optimizer', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!exportRows.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load tyre records.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Honest limitation note — axle role is inferred from free-text positions. */}
      <div className="card border border-[var(--input-border)] flex items-start gap-2.5 py-2.5">
        <Info size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Axle roles (steer / drive / trailer) are <span className="text-[var(--text-secondary)]">inferred from each tyre's free-text position label</span> — this dataset has no per-axle, side, or inner/outer wheel data and a single tread value per tyre. Steer-imbalance checks are therefore <span className="text-[var(--text-secondary)]">heuristic</span>; the <span className="text-red-300">below-legal-minimum ({'<'}1.6mm)</span> check is exact. No values are estimated where a signal is missing.
        </p>
      </div>

      {/* Fleet imbalance chart */}
      {rows !== null && chart && (
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><BarChart3 size={15} /> Most imbalanced assets</h3>
          <p className="text-xs text-[var(--text-muted)] mb-4">Tread spread (max − min) across each vehicle's fitted tyres. Bar colour reflects urgency.</p>
          <div className="h-64"><Bar data={chart.data} options={chart.options} /></div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset / vehicle…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Priority">
            <option value="all">All assets</option>
            <option value="needs">Needs rotation</option>
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="balanced">Balanced</option>
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.assetsAnalyzed}</span>
        </div>
      </div>

      {/* Asset list */}
      <div className="space-y-3">
        {rows === null ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="card"><div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" /></div>)
        ) : enriched.length === 0 ? (
          <div className="card py-14 text-center text-[var(--text-muted)]">
            <Truck size={28} className="mx-auto mb-3 opacity-60" />
            <p className="font-medium text-[var(--text-secondary)]">No assets to analyse.</p>
            <p className="text-sm mt-1">Rotation analysis needs at least two fitted tyres with tread readings on a vehicle.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card py-12 text-center text-[var(--text-muted)]">
            <Filter size={22} className="mx-auto mb-2 opacity-60" />No assets match these filters.
          </div>
        ) : (
          filtered.map((a) => {
            const isOpen = expanded.has(a.asset_no)
            const tyres = (tyresByAsset.get(a.asset_no) || [])
              .slice()
              .sort((x, y) => (treadOf(x) ?? Infinity) - (treadOf(y) ?? Infinity))
            return (
              <div key={a.asset_no} className="card !p-0 overflow-hidden">
                <button
                  onClick={() => toggle(a.asset_no)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--input-bg)]/40 transition-colors"
                  aria-expanded={isOpen}
                >
                  <ChevronRight size={16} className={`text-[var(--text-muted)] shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <BalanceRing score={a.wearBalanceScore} />
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-primary)] truncate flex items-center gap-1.5"><Truck size={13} className="text-[var(--text-muted)]" /> {a.asset_no}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {a.site || 'Unassigned site'} · {a.stats.count} tyres
                      {a.swaps.length > 0 && <span className="text-brand-bright"> · {a.swaps.length} swap{a.swaps.length > 1 ? 's' : ''}</span>}
                      {a.violations.length > 0 && <span className="text-red-400"> · {a.violations.length} issue{a.violations.length > 1 ? 's' : ''}</span>}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-4">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-[var(--text-muted)]">spread</p>
                      <p className={`text-sm font-semibold ${a.urgency === 'critical' ? 'text-red-400' : a.urgency === 'warning' ? 'text-orange-400' : 'text-[var(--text-secondary)]'}`}>{fmt(a.spread)}mm</p>
                    </div>
                    <div className="text-right hidden md:block">
                      <p className="text-xs text-[var(--text-muted)]">range</p>
                      <p className="text-sm text-[var(--text-secondary)]">{fmt(a.stats.min)}–{fmt(a.stats.max)}mm</p>
                    </div>
                    <span className={`badge text-[11px] px-2 py-0.5 rounded shrink-0 inline-flex items-center gap-1 ${(STATUS_META[a.overallStatus] || STATUS_META.good).cls}`}>
                      {a.overallStatus === 'critical' ? <ShieldAlert size={11} /> : a.overallStatus === 'good' ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
                      {(STATUS_META[a.overallStatus] || STATUS_META.good).label}
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-[var(--input-border)] px-4 py-4 space-y-4">
                    {/* Deterministic narrative */}
                    <div className="flex items-start gap-2 text-sm bg-[var(--input-bg)]/40 border border-[var(--input-border)] rounded-lg px-3 py-2.5">
                      {a.overallStatus === 'good'
                        ? <CheckCircle2 size={15} className="text-green-400 mt-0.5 shrink-0" />
                        : <Info size={15} className="text-brand-bright mt-0.5 shrink-0" />}
                      <span className="text-[var(--text-secondary)]">{a.narrative}</span>
                    </div>

                    {/* Violations (safety / compliance) */}
                    {a.violations.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-red-300/90 flex items-center gap-1.5"><ShieldAlert size={13} /> Compliance & safety ({a.violations.length})</p>
                        {a.violations.map((v, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm text-red-200 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                            <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
                            <span>
                              {v.message}
                              {v.heuristic && <span className="ml-1.5 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/50">heuristic</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Structured swaps */}
                    {a.swaps.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5"><ArrowRightLeft size={13} /> Recommended swaps ({a.swaps.length})</p>
                        {a.swaps.map((s, i) => (
                          <div key={i} className="bg-[var(--input-bg)]/50 border border-[var(--input-border)] rounded-lg px-3 py-2.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs text-[var(--text-primary)] bg-[var(--input-bg)] px-1.5 py-0.5 rounded">{s.tyre || 'unknown'}</span>
                              <span className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                                <span>{s.from_position || 'unknown position'}</span>
                                <span className={`font-semibold ${treadTone(s.from_tread_mm)}`}>{s.from_tread_mm}mm</span>
                                <ArrowRight size={14} className="text-brand-bright" />
                                <span>{s.to_position || 'unknown position'}</span>
                                <span className={`font-semibold ${treadTone(s.to_tread_mm)}`}>{s.to_tread_mm}mm</span>
                              </span>
                              <div className="ml-auto flex items-center gap-1.5">
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-300 border border-emerald-800/50">+{s.tread_delta_mm}mm · ~{Number(s.expected_benefit_km).toLocaleString()} km</span>
                                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-indigo-900/30 text-indigo-300 border border-indigo-800/50" title="Impact score (0–100)"><Zap size={11} /> {s.impact_score}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : a.overallStatus !== 'critical' && (
                      <div className="flex items-center gap-2 text-sm text-green-300">
                        <CheckCircle2 size={15} /> {a.reason || 'Wear is balanced — no rotation required.'}
                      </div>
                    )}

                    {/* Fitted tyres */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 flex items-center gap-1.5"><Info size={13} /> Fitted tyres ({tyres.length})</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                              {['Serial', 'Position', 'Brand / Size', 'Tread', 'Total km'].map((h) => <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {tyres.map((t) => {
                              const tr = treadOf(t)
                              const isMin = tr != null && tr === a.stats.min
                              const isMax = tr != null && tr === a.stats.max
                              return (
                                <tr key={t.id} className="border-b border-[var(--input-border)]/50">
                                  <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)]">{serialOf(t) || '—'}</td>
                                  <td className="px-3 py-2 text-[var(--text-secondary)]">{positionOf(t) || '—'}</td>
                                  <td className="px-3 py-2 text-[var(--text-secondary)]">{t.brand || '—'}{t.size ? ` · ${t.size}` : ''}</td>
                                  <td className="px-3 py-2">
                                    <span className={isMin ? 'text-red-400 font-semibold' : isMax ? 'text-green-400 font-semibold' : 'text-[var(--text-secondary)]'}>
                                      {tr == null ? '—' : `${tr}mm`}{isMin ? ' ▼' : isMax ? ' ▲' : ''}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-[var(--text-secondary)]">{t.total_km != null ? Number(t.total_km).toLocaleString() : '—'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
