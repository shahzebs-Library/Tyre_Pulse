import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  DollarSign, Zap, TrendingUp, TrendingDown, AlertCircle, BarChart2,
  RefreshCw, Download, FileText, Search, X, Cpu, AlertTriangle, Scale,
} from 'lucide-react'
import { aiOps } from '../lib/api'
import { toUserMessage } from '../lib/safeError'
import { useSettings } from '../contexts/SettingsContext'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'
import { colorAt } from '../lib/reportColors'
import {
  buildAiCostReport, filterLogs, filterOptions, formatUSD, formatTokens,
  rowCost, isSuccessRow, logExportRows, LOG_EXPORT_COLUMNS,
} from '../lib/aiCostMonitorAnalytics'

const loadExportUtils = () => import('../lib/exportUtils')

const DATE_RANGES = [
  { label: 'Last 7 days',  days: 7   },
  { label: 'Last 30 days', days: 30  },
  { label: 'Last 90 days', days: 90  },
]

const READ_CEILING = 50000

const STATUS_TONE = {
  success: 'bg-emerald-500/15 text-emerald-400',
  error: 'bg-red-500/15 text-red-400',
  rate_limited: 'bg-amber-500/15 text-amber-400',
  blocked: 'bg-orange-500/15 text-orange-400',
}

function StatCard({ label, value, sub, icon: Icon }) {
  return (
    <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-xl p-4 flex items-center gap-3 min-w-0">
      <div className="w-10 h-10 rounded-xl bg-[var(--input-bg)] flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-[var(--text-secondary)]" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-[var(--text-primary)] leading-tight tabular-nums truncate">{value}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{label}</p>
        {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate" title={sub}>{sub}</p>}
      </div>
    </div>
  )
}

// Minimal sparkline rendered as inline SVG - no external chart library needed
function Sparkline({ data, dataKey, color, height = 60, label }) {
  if (!data || data.length < 2) return null
  const vals = data.map(d => d[dataKey] ?? 0)
  const max  = Math.max(...vals, 1)
  const w = 600
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w
    const y = height - (v / max) * (height - 8) - 4
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={label}>
      <polyline fill="none" stroke={color} strokeWidth={2} points={pts} />
    </svg>
  )
}

function ShareBars({ title, rows, labelKey, color }) {
  if (!rows.length) return null
  return (
    <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl p-5">
      <h3 className="text-[var(--text-primary)] font-semibold mb-4">{title}</h3>
      <ul className="space-y-3">
        {rows.map((m, i) => (
          <li key={m[labelKey]}>
            <div className="flex items-center justify-between text-sm mb-1.5 gap-2">
              <span className="text-[var(--text-secondary)] font-medium truncate">{m[labelKey]}</span>
              <div className="flex items-center gap-3 text-[var(--text-muted)] text-xs shrink-0">
                <span>{m.calls} calls</span>
                <span>{formatTokens(m.tokens)} tokens</span>
                <span className="font-semibold text-[var(--text-primary)]">{formatUSD(m.cost)}</span>
                <span>{m.share == null ? 'N/A' : `${m.share.toFixed(1)}%`}</span>
              </div>
            </div>
            <div className="w-full bg-[var(--input-bg)] rounded-full h-2" aria-hidden="true">
              <div className="h-2 rounded-full transition-all" style={{ width: `${(m.share ?? 0).toFixed(1)}%`, backgroundColor: color ?? colorAt(i) }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function AiCostMonitor() {
  const reportMeta = useReportMeta('AI Cost & Usage')
  const { activeCountry } = useSettings()
  const [logs, setLogs] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [pricing, setPricing] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rangeDays, setRangeDays] = useState(30)
  const [filterFeature, setFilterFeature] = useState('all')
  const [filterModel, setFilterModel] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSite, setFilterSite] = useState('all')
  const [search, setSearch] = useState('')

  // Pricing comes from the ai_models catalogue (single source). A failed read
  // keeps stored cost_usd values and prices the rest at 0 rather than guessing.
  useEffect(() => {
    let alive = true
    aiOps.getModelPricing().then((p) => { if (alive && p) setPricing(p) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { rows, truncated: tr } = await aiOps.readTokenLogs({
        days: rangeDays,
        country: activeCountry !== 'All' ? activeCountry : undefined,
        limit: READ_CEILING,
      })
      setLogs(rows ?? [])
      setTruncated(Boolean(tr))
    } catch (e) {
      setLogs([])
      setTruncated(false)
      setError(toUserMessage(e, 'AI usage could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [rangeDays, activeCountry])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const options = useMemo(() => filterOptions(logs), [logs])
  const visible = useMemo(
    () => filterLogs(logs, { feature: filterFeature, model: filterModel, status: filterStatus, site: filterSite, search }),
    [logs, filterFeature, filterModel, filterStatus, filterSite, search],
  )
  const report = useMemo(() => buildAiCostReport(visible, { pricing, days: rangeDays }), [visible, pricing, rangeDays])
  const filtersActive = filterFeature !== 'all' || filterModel !== 'all' || filterStatus !== 'all' || filterSite !== 'all' || Boolean(search)
  const rangeLabel = DATE_RANGES.find(r => r.days === rangeDays)?.label

  function clearFilters() {
    setFilterFeature('all'); setFilterModel('all'); setFilterStatus('all'); setFilterSite('all'); setSearch('')
  }

  async function exportExcel() {
    const { exportToExcel, reportFileName, reportDateLabel } = await loadExportUtils()
    exportToExcel(
      logExportRows(visible, pricing),
      LOG_EXPORT_COLUMNS.map(c => c.key),
      LOG_EXPORT_COLUMNS.map(c => c.header),
      reportFileName('TyrePulse AI Cost', rangeLabel, reportDateLabel()),
    )
  }
  async function exportPdf() {
    const { exportToPdf, reportFileName, reportDateLabel } = await loadExportUtils()
    exportToPdf(
      logExportRows(visible, pricing),
      LOG_EXPORT_COLUMNS,
      'AI Cost and Usage',
      reportFileName('TyrePulse AI Cost', rangeLabel, reportDateLabel()),
      'landscape',
      '',
      { subtitleNote: `${rangeLabel} | ${visible.length} requests${filtersActive ? ' (filtered)' : ''} | total ${formatUSD(report.totalCost)}` },
    )
  }

  const logColumns = useMemo(() => [
    {
      id: 'created_at',
      header: 'Timestamp',
      accessorFn: row => row.created_at || '',
      size: 150,
      cell: ({ row }) => (row.original.created_at
        ? new Date(row.original.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'N/A'),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: row => row.status || 'success',
      size: 110,
      cell: ({ getValue }) => {
        const v = getValue()
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_TONE[v] || STATUS_TONE.error}`}>{v.replace('_', ' ')}</span>
      },
    },
    { id: 'model', header: 'Model', accessorFn: row => row.model ?? 'N/A', size: 160 },
    { id: 'feature', header: 'Feature', accessorFn: row => row.feature ?? 'N/A', size: 110 },
    { id: 'prompt_tokens', header: 'Prompt', accessorFn: row => Number(row.prompt_tokens ?? 0), size: 90, meta: { align: 'right' }, cell: ({ getValue }) => formatTokens(getValue()) },
    { id: 'completion_tokens', header: 'Completion', accessorFn: row => Number(row.completion_tokens ?? 0), size: 100, meta: { align: 'right' }, cell: ({ getValue }) => formatTokens(getValue()) },
    {
      id: 'cost',
      header: 'Cost',
      accessorFn: row => rowCost(row, pricing),
      size: 100,
      meta: { align: 'right' },
      cell: ({ row, getValue }) => (isSuccessRow(row.original)
        ? <span className="text-[var(--text-primary)] font-medium tabular-nums">{formatUSD(getValue())}</span>
        : <span className="text-[var(--text-muted)] text-xs">Not billed</span>),
    },
    { id: 'site', header: 'Site', accessorFn: row => row.site ?? 'N/A', size: 110 },
    {
      id: 'error', header: 'Error', accessorFn: row => row.error ?? '', size: 220,
      cell: ({ getValue }) => <span className="text-xs text-[var(--text-muted)] line-clamp-2">{getValue() || ''}</span>,
    },
  ], [pricing])

  const selectCls = 'bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-lg px-3 min-h-[44px] text-sm text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
  const TrendIcon = report.spendTrendPct != null && report.spendTrendPct < 0 ? TrendingDown : TrendingUp

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI Cost Monitor"
        subtitle="Token usage, spend tracking, failures and cost analysis"
        icon={DollarSign}
        actions={(
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={exportExcel} disabled={!visible.length} className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-40">
              <Download size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={exportPdf} disabled={!visible.length} className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-40">
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
          </div>
        )}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Date range">
          {DATE_RANGES.map(r => (
            <button
              type="button"
              key={r.days}
              onClick={() => setRangeDays(r.days)}
              aria-pressed={rangeDays === r.days}
              className={`px-3 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${rangeDays === r.days ? 'bg-green-600 text-white' : 'bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border-dim)] hover:border-[var(--accent)]'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
          <input className="input pl-8 text-sm min-h-[44px]" placeholder="Search model, feature, site, error" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search AI usage" />
        </div>
        <select className={selectCls} value={filterFeature} onChange={e => setFilterFeature(e.target.value)} aria-label="Filter by feature">
          <option value="all">All features</option>
          {options.features.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className={selectCls} value={filterModel} onChange={e => setFilterModel(e.target.value)} aria-label="Filter by model">
          <option value="all">All models</option>
          {options.models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className={selectCls} value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {options.statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        {options.sites.length > 0 && (
          <select className={selectCls} value={filterSite} onChange={e => setFilterSite(e.target.value)} aria-label="Filter by site">
            <option value="all">All sites</option>
            {options.sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {filtersActive && (
          <button type="button" onClick={clearFilters} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 min-h-[44px] px-2">
            <X size={12} aria-hidden="true" /> Clear
          </button>
        )}
        <button
          type="button"
          onClick={fetchLogs}
          aria-label="Refresh AI usage"
          title="Refresh"
          className="ml-auto min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {truncated && (
        <div role="status" className="flex items-center gap-2 text-amber-400 text-xs bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-2.5">
          <AlertTriangle size={13} aria-hidden="true" />
          Showing the newest {READ_CEILING.toLocaleString('en-US')} requests of this window. Totals cover that set; pick a shorter range for the full picture.
        </div>
      )}

      {error ? (
        <div role="alert" className="text-center py-16 text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-400" aria-hidden="true" />
          <p className="font-medium text-[var(--text-secondary)]">AI usage could not be loaded</p>
          <p className="text-sm mt-1 max-w-md mx-auto">{error}</p>
          <p className="text-xs mt-1">No spend figures are shown until the usage log can be read.</p>
          <button
            type="button"
            onClick={fetchLogs}
            className="mt-3 inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg text-sm font-medium bg-[var(--surface-1)] border border-[var(--border-dim)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Retry
          </button>
        </div>
      ) : loading && logs.length === 0 ? (
        <div className="space-y-3" aria-busy="true">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[84px] rounded-xl bg-[var(--input-bg)] animate-pulse" />)}
          </div>
          <div className="h-40 rounded-2xl bg-[var(--input-bg)] animate-pulse" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatCard label="Total cost" value={formatUSD(report.totalCost)} sub={rangeLabel} icon={DollarSign} />
            <StatCard label="Total tokens" value={formatTokens(report.totalTokens)} sub={`${report.successCalls.toLocaleString()} successful calls`} icon={Zap} />
            <StatCard label="Avg cost per call" value={formatUSD(report.avgCostPerCall)} sub="Successful calls only" icon={Scale} />
            <StatCard label="Cost per 1M tokens" value={formatUSD(report.costPerMillionTokens)} sub={report.topModel ? `Top model: ${report.topModel}` : 'No billed calls'} icon={Cpu} />
            <StatCard
              label="Failure rate"
              value={report.failureRate == null ? 'N/A' : `${report.failureRate.toFixed(1)}%`}
              sub={`${report.failedCalls} of ${report.totalRequests} requests`}
              icon={AlertTriangle}
            />
            <StatCard
              label="Spend trend"
              value={report.spendTrendPct == null ? 'N/A' : `${report.spendTrendPct > 0 ? '+' : ''}${report.spendTrendPct}%`}
              sub={report.spendTrendPct == null ? 'Needs spend in both halves' : 'Second half vs first half'}
              icon={TrendIcon}
            />
          </div>

          {report.totalRequests === 0 ? (
            <div className="text-center py-16 text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl">
              <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-40" aria-hidden="true" />
              <p className="font-medium text-[var(--text-secondary)]">{filtersActive ? 'No AI requests match these filters' : 'No AI usage recorded yet'}</p>
              <p className="text-sm mt-1 max-w-md mx-auto">
                {filtersActive
                  ? 'Clear a filter or widen the date range.'
                  : 'No AI calls were logged in the selected period. Usage appears here automatically as AI features (chat, insights, reports) are used.'}
              </p>
              {filtersActive && (
                <button type="button" onClick={clearFilters} className="mt-3 btn-secondary text-sm px-3 min-h-[44px]">Clear filters</button>
              )}
            </div>
          ) : (
            <>
              {report.byDay.length > 1 && (
                <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h3 className="text-[var(--text-primary)] font-semibold">Daily token usage</h3>
                    <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                      <span>{report.byDay[0]?.date?.slice(5)} to {report.byDay[report.byDay.length - 1]?.date?.slice(5)}</span>
                      <span className="font-medium text-[var(--text-primary)]">{formatTokens(report.totalTokens)} total</span>
                    </div>
                  </div>
                  <Sparkline data={report.byDay} dataKey="tokens" color={colorAt(0)} height={72} label={`Daily tokens over ${report.byDay.length} days`} />
                  <div className="flex justify-between text-[var(--text-muted)] text-xs mt-1 px-0.5">
                    {report.byDay.filter((_, i) => i === 0 || i === Math.floor(report.byDay.length / 2) || i === report.byDay.length - 1)
                      .map(d => <span key={d.date}>{d.date.slice(5)}</span>)}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ShareBars title="Cost by model" rows={report.byModel} labelKey="model" />
                <ShareBars title="Cost by feature" rows={report.byFeature} labelKey="feature" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {report.bySite.length > 0 && (
                  <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl p-5">
                    <h3 className="text-[var(--text-primary)] font-semibold mb-4">Spend by site</h3>
                    <ul className="space-y-3">
                      {report.bySite.slice(0, 8).map((s, i) => {
                        const pct = report.bySite[0].cost > 0 ? (s.cost / report.bySite[0].cost) * 100 : 0
                        return (
                          <li key={s.site}>
                            <div className="flex items-center justify-between text-sm mb-1.5">
                              <span className="text-[var(--text-secondary)] text-xs font-medium truncate max-w-48">{s.site}</span>
                              <span className="text-[var(--text-primary)] text-xs font-semibold">{formatUSD(s.cost)} ({s.calls} calls)</span>
                            </div>
                            <div className="w-full bg-[var(--input-bg)] rounded-full h-2" aria-hidden="true">
                              <div className="h-2 rounded-full transition-all" style={{ width: `${pct.toFixed(1)}%`, backgroundColor: colorAt(i) }} />
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
                <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl p-5">
                  <h3 className="text-[var(--text-primary)] font-semibold mb-4">Failed requests</h3>
                  {report.failureBreakdown.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)]">No failed requests in this set.</p>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {report.failureBreakdown.map(f => (
                        <li key={f.status} className="flex items-center justify-between">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_TONE[f.status] || STATUS_TONE.error}`}>{f.status.replace('_', ' ')}</span>
                          <span className="tabular-nums text-[var(--text-primary)]">{f.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-[var(--text-muted)] mt-3">Failed calls are counted but never priced. Filter the log by status to read the error text.</p>
                </div>
              </div>

              <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-[var(--border-dim)] flex items-center justify-between">
                  <h3 className="text-[var(--text-primary)] font-semibold">Usage log</h3>
                  <span className="text-[var(--text-muted)] text-sm">{visible.length.toLocaleString()} of {logs.length.toLocaleString()} requests</span>
                </div>
                <EnterpriseTable
                  reportMeta={reportMeta}
                  columns={logColumns}
                  data={visible}
                  loading={loading}
                  enableGlobalFilter={false}
                  enableColumnFilters={false}
                  enableSorting={true}
                  enableExport={false}
                  initialPageSize={25}
                  pageSizeOptions={[25, 50, 100]}
                  resetPageKey={`${filterFeature}|${filterModel}|${filterStatus}|${filterSite}|${search}|${rangeDays}`}
                  emptyMessage="No logs match your filters"
                  skeletonRows={8}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
