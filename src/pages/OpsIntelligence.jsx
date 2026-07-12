/**
 * OpsIntelligence (route /ops-intelligence) — the Exception Command Center. A
 * fleet-wide operational-exception engine: it scans the existing tyre_records
 * and work_orders data and surfaces everything that needs action now — each
 * exception carrying a severity, a category, the affected asset/tyre, a plain
 * detail line, and a deep-link into the module that resolves it.
 *
 * All exceptions are REAL — derived from live data by the pure, unit-tested
 * `src/lib/opsIntelligence.js`. No mock rows: when the fleet is clean the board
 * shows an honest "all clear" empty state. The heavy read lives behind
 * `src/lib/api/opsIntelligence.js`; banding for tyre age is shared with the Tyre
 * Age Compliance module.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  Siren, AlertTriangle, AlertOctagon, ShieldAlert, Info, Search, X, Filter,
  FileSpreadsheet, FileText, ArrowUpRight, CheckCircle2, Building2, Layers,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { loadOpsData } from '../lib/api/opsIntelligence'
import {
  buildExceptions, summarizeExceptions, SEVERITY_META, CATEGORY_META, CATEGORIES,
} from '../lib/opsIntelligence'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

// ── Severity styling (dark-card palette, WCAG-safe) ─────────────────────────────
const SEVERITY_STYLES = {
  high: 'bg-red-900/40 text-red-300 border border-red-700/50',
  medium: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  low: 'bg-slate-800/60 text-slate-300 border border-slate-600/50',
}
const SEVERITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#64748b' }
const CATEGORY_COLOR = {
  aged_tyre: '#ef4444',
  low_tread: '#f97316',
  high_cpk: '#8b5cf6',
  recent_failure: '#ec4899',
  open_work_order: '#3b82f6',
}

export default function OpsIntelligence() {
  const { activeCountry } = useSettings()
  const navigate = useNavigate()

  const [data, setData] = useState(null) // { tyres, workOrders } | null
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [severityFilter, setSeverityFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const res = await loadOpsData({ country: activeCountry })
      setData(res)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || 'Could not load fleet data.')
      setData({ tyres: [], workOrders: [] })
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Build the exception feed against a live clock (the lib stays pure).
  const exceptions = useMemo(
    () => (data ? buildExceptions(data, { now: Date.now() }) : []),
    [data],
  )
  const summary = useMemo(() => summarizeExceptions(exceptions), [exceptions])

  const siteOptions = useMemo(
    () => [...new Set(exceptions.map((e) => e.site).filter(Boolean))].sort(),
    [exceptions],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return exceptions.filter((e) => {
      if (severityFilter !== 'all' && e.severity !== severityFilter) return false
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false
      if (siteFilter && e.site !== siteFilter) return false
      if (q) {
        const hay = `${e.title} ${e.asset_no || ''} ${e.serial || ''} ${e.site || ''} ${e.detail}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [exceptions, severityFilter, categoryFilter, siteFilter, search])

  // ── Charts ────────────────────────────────────────────────────────────────
  const chartText = typeof document !== 'undefined'
    ? (getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af')
    : '#9ca3af'

  const severityData = {
    labels: ['High', 'Medium', 'Low'],
    datasets: [{
      data: [summary.bySeverity.high, summary.bySeverity.medium, summary.bySeverity.low],
      backgroundColor: [SEVERITY_COLOR.high, SEVERITY_COLOR.medium, SEVERITY_COLOR.low],
      borderWidth: 0,
    }],
  }
  const activeCats = CATEGORIES.filter((c) => summary.byCategory[c] > 0)
  const categoryData = {
    labels: activeCats.map((c) => CATEGORY_META[c].label),
    datasets: [{
      label: 'Exceptions',
      data: activeCats.map((c) => summary.byCategory[c]),
      backgroundColor: activeCats.map((c) => CATEGORY_COLOR[c]),
      borderRadius: 4,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
  }
  const barOpts = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: chartText, precision: 0 }, grid: { color: 'rgba(148,163,184,0.12)' }, beginAtZero: true },
      y: { ticks: { color: chartText }, grid: { display: false } },
    },
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['severity', 'category', 'title', 'asset_no', 'serial', 'site', 'detail']
  const EXPORT_HEADERS = ['Severity', 'Category', 'Title', 'Asset', 'Serial', 'Site', 'Detail']
  const exportRows = filtered.map((e) => ({
    severity: SEVERITY_META[e.severity]?.label || e.severity,
    category: CATEGORY_META[e.category]?.label || e.category,
    title: e.title,
    asset_no: e.asset_no || '',
    serial: e.serial || '',
    site: e.site || '',
    detail: e.detail,
  }))

  const kpis = [
    { label: 'Open exceptions', value: summary.total, icon: Siren, tone: 'text-[var(--text-primary)]' },
    { label: 'High severity', value: summary.bySeverity.high, icon: AlertOctagon, tone: 'text-red-400' },
    { label: 'Medium severity', value: summary.bySeverity.medium, icon: AlertTriangle, tone: 'text-amber-400' },
    { label: 'Assets affected', value: summary.affectedAssets, icon: Building2, tone: 'text-blue-400' },
  ]

  const clearFilters = () => { setSeverityFilter('all'); setCategoryFilter('all'); setSiteFilter(''); setSearch('') }
  const hasFilters = severityFilter !== 'all' || categoryFilter !== 'all' || siteFilter || search
  const loading = data === null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ops Intelligence"
        subtitle="Exception Command Center — a live, cross-cutting scan of the fleet surfacing every tyre and work-order issue that needs action now, ranked by severity."
        icon={Siren}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'ops_intelligence_exceptions')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS, 'Ops Intelligence — Exception Command Center', 'ops_intelligence_exceptions', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load fleet data.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{loading ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><ShieldAlert size={15} className="text-red-400" /> By severity</h3>
          <div className="h-64">{!loading && summary.total ? <Doughnut data={severityData} options={donutOpts} /> : <EmptyChart loading={loading} empty="No open exceptions." />}</div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><Layers size={15} className="text-blue-400" /> By category</h3>
          <div className="h-64">{!loading && activeCats.length ? <Bar data={categoryData} options={barOpts} /> : <EmptyChart loading={loading} empty="No open exceptions." />}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search title, asset, serial, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
            <option value="all">All severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Severity', 'Category', 'Exception', 'Asset', 'Site', 'Detail', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[var(--text-muted)]">
                  {summary.total === 0 ? (
                    <><CheckCircle2 size={26} className="mx-auto mb-2 text-green-400 opacity-80" />All clear — no open exceptions across the fleet.</>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No exceptions match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((e) => (
                  <tr key={e.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${SEVERITY_STYLES[e.severity]}`}>{SEVERITY_META[e.severity]?.label}</span></td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CATEGORY_COLOR[e.category] }} />
                        {CATEGORY_META[e.category]?.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium max-w-[260px] truncate" title={e.title}>{e.title}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{e.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{e.site || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs max-w-[340px]">{e.detail}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right">
                      <button onClick={() => navigate(e.link)} className="btn-secondary text-xs inline-flex items-center gap-1 px-2.5 py-1" title={`Open in ${CATEGORY_META[e.category]?.module}`}>
                        Open <ArrowUpRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)] flex items-center gap-1.5"><Info size={12} /> Showing first 500 — refine filters or export for the full set.</p>}
      </div>
    </div>
  )
}

function EmptyChart({ loading, empty = 'No data.' }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
      {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : empty}
    </div>
  )
}
