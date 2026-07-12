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
  RotateCcw, AlertTriangle, Truck, Gauge, Search, X, Filter,
  FileSpreadsheet, FileText, ChevronRight, ArrowRightLeft, CheckCircle2, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { listInServiceTyres } from '../lib/api/rotationOptimizer'
import {
  optimizeFleet, serialOf, positionOf, treadOf, DEFAULT_ROTATION_OPTS,
} from '../lib/rotationOptimizer'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const PRIORITY_STYLES = {
  high: 'bg-red-900/40 text-red-300 border border-red-700/50',
  medium: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  balanced: 'bg-green-900/40 text-green-300 border border-green-700/50',
}
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', balanced: 'Balanced' }

const fmt = (n) => (n == null ? '—' : n)

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
      setError(err?.message || 'Could not load tyre records.')
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
    { label: 'High priority', value: summary.highPriority, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'Avg tread spread', value: summary.avgSpread == null ? '—' : `${summary.avgSpread}mm`, icon: Gauge, tone: 'text-[var(--text-primary)]' },
  ]

  // One export row per recommendation (flattened), respecting current filters.
  const EXPORT_COLS = ['asset_no', 'site', 'priority', 'spread', 'min', 'max', 'avg', 'recommendation']
  const EXPORT_HEADERS = ['Asset', 'Site', 'Priority', 'Spread (mm)', 'Min (mm)', 'Max (mm)', 'Avg (mm)', 'Recommendation']
  const exportRows = filtered.flatMap((a) => {
    const recs = a.recommendations.length ? a.recommendations : ['No rotation required — wear is balanced.']
    return recs.map((rec) => ({
      asset_no: a.asset_no || '',
      site: a.site || '',
      priority: PRIORITY_LABEL[a.priorityKey],
      spread: a.spread ?? '',
      min: a.stats.min ?? '',
      max: a.stats.max ?? '',
      avg: a.stats.avg ?? '',
      recommendation: rec,
    }))
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
                  <Truck size={16} className="text-[var(--text-muted)] shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-primary)] truncate">{a.asset_no}</p>
                    <p className="text-xs text-[var(--text-muted)]">{a.site || 'Unassigned site'} · {a.stats.count} tyres</p>
                  </div>
                  <div className="ml-auto flex items-center gap-4">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-[var(--text-muted)]">spread</p>
                      <p className={`text-sm font-semibold ${a.priority === 'high' ? 'text-red-400' : a.priority === 'medium' ? 'text-amber-400' : 'text-[var(--text-secondary)]'}`}>{fmt(a.spread)}mm</p>
                    </div>
                    <div className="text-right hidden md:block">
                      <p className="text-xs text-[var(--text-muted)]">range</p>
                      <p className="text-sm text-[var(--text-secondary)]">{fmt(a.stats.min)}–{fmt(a.stats.max)}mm</p>
                    </div>
                    <span className={`badge text-[11px] px-2 py-0.5 rounded shrink-0 ${PRIORITY_STYLES[a.priorityKey]}`}>{PRIORITY_LABEL[a.priorityKey]}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-[var(--input-border)] px-4 py-4 space-y-4">
                    {/* Recommendations */}
                    {a.recommendations.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5"><ArrowRightLeft size={13} /> Recommended rotations</p>
                        {a.recommendations.map((rec, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm text-[var(--text-secondary)] bg-[var(--input-bg)]/50 border border-[var(--input-border)] rounded-lg px-3 py-2">
                            <RotateCcw size={14} className="text-brand-bright mt-0.5 shrink-0" />
                            <span>{rec}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
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
