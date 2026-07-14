import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  DollarSign, Zap, TrendingUp, AlertCircle, BarChart2,
  ChevronDown, RefreshCw,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { aiOps } from '../lib/api'
import { toUserMessage } from '../lib/safeError'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'

// ── Constants ─────────────────────────────────────────────────────────────────

// Fallback pricing (USD per 1M tokens) used only until the ai_models catalogue
// loads. The single source of truth is the ai_models table (seeded in V236);
// live pricing is fetched via aiOps.getModelPricing and passed to estimateCost.
const FALLBACK_PRICING = {
  'claude-opus-4-8':        { input: 15,  output: 75 },
  'claude-sonnet-5':        { input: 3,   output: 15 },
  'claude-haiku-4-5':       { input: 1,   output: 5 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
}

const DATE_RANGES = [
  { label: 'Last 7 days',  days: 7   },
  { label: 'Last 30 days', days: 30  },
  { label: 'Last 90 days', days: 90  },
]

const FEATURE_COLORS = {
  chat:      '#16a34a',
  embedding: '#3b82f6',
  report:    '#7c3aed',
  other:     '#64748b',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Live per-1M pricing from ai_models (the single source), set when the catalogue
// loads. Falls back to FALLBACK_PRICING until then.
let LIVE_PRICING = { ...FALLBACK_PRICING }

function estimateCost(row) {
  if (row.cost_usd != null && row.cost_usd !== '') return Number(row.cost_usd)
  const rates = LIVE_PRICING[row.model] ?? FALLBACK_PRICING[row.model] ?? { input: 3, output: 15 }
  return ((row.prompt_tokens * rates.input) + (row.completion_tokens * rates.output)) / 1_000_000
}

function formatUSD(n) {
  if (n === null || n === undefined) return '$0.000'
  return `$${Number(n).toFixed(4)}`
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function groupByDay(logs) {
  const map = {}
  for (const log of logs) {
    // Defensive: created_at should always be present, but never let a bad row
    // crash the whole page (a thrown render error blanks the screen).
    const day = typeof log.created_at === 'string' ? log.created_at.slice(0, 10) : ''
    if (!day) continue
    if (!map[day]) map[day] = { date: day, tokens: 0, cost: 0, calls: 0 }
    map[day].tokens += (log.prompt_tokens ?? 0) + (log.completion_tokens ?? 0)
    map[day].cost   += estimateCost(log)
    map[day].calls  += 1
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
}

function groupByFeature(logs) {
  const map = {}
  for (const log of logs) {
    const f = log.feature ?? 'other'
    if (!map[f]) map[f] = { feature: f, tokens: 0, cost: 0, calls: 0 }
    map[f].tokens += (log.prompt_tokens ?? 0) + (log.completion_tokens ?? 0)
    map[f].cost   += estimateCost(log)
    map[f].calls  += 1
  }
  return Object.values(map).sort((a, b) => b.cost - a.cost)
}

function groupByModel(logs) {
  const map = {}
  for (const log of logs) {
    const m = log.model ?? 'unknown'
    if (!map[m]) map[m] = { model: m, tokens: 0, cost: 0, calls: 0 }
    map[m].tokens += (log.prompt_tokens ?? 0) + (log.completion_tokens ?? 0)
    map[m].cost   += estimateCost(log)
    map[m].calls  += 1
  }
  return Object.values(map).sort((a, b) => b.cost - a.cost)
}

function StatCard({ label, value, sub, icon: Icon, color, bg }) {
  return (
    <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-xl p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-[var(--text-primary)] leading-tight">{value}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{label}</p>
        {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// Minimal sparkline rendered as inline SVG - no external chart library needed
function Sparkline({ data, dataKey, color = '#16a34a', height = 60 }) {
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
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polyline fill="none" stroke={color} strokeWidth={2} points={pts} />
    </svg>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AiCostMonitor() {
  const reportMeta = useReportMeta('AI Cost & Usage')
  const { profile } = useAuth()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rangeDays, setRangeDays] = useState(30)
  const [filterFeature, setFilterFeature] = useState('all')
  const [filterModel, setFilterModel] = useState('all')

  // Load the single-source pricing catalogue once so cost estimates match the
  // admin-managed ai_models table rather than a hardcoded rate card.
  useEffect(() => {
    let alive = true
    aiOps.getModelPricing().then((p) => {
      if (alive && p && Object.keys(p).length) LIVE_PRICING = { ...FALLBACK_PRICING, ...p }
    }).catch(() => { /* keep fallback pricing */ })
    return () => { alive = false }
  }, [])

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const since = new Date(Date.now() - rangeDays * 86_400_000).toISOString()
      let q = supabase
        .from('ai_token_logs')
        .select('id, model, feature, prompt_tokens, completion_tokens, cost_usd, site, country, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5000)

      if (filterFeature !== 'all') q = q.eq('feature', filterFeature)
      if (filterModel   !== 'all') q = q.eq('model',   filterModel)

      const { data, error: err } = await q
      if (err) throw err
      setLogs(data ?? [])
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setLoading(false)
    }
  }, [rangeDays, filterFeature, filterModel])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  // Derived stats
  const totalCost   = logs.reduce((s, l) => s + estimateCost(l), 0)
  const totalTokens = logs.reduce((s, l) => s + (l.prompt_tokens ?? 0) + (l.completion_tokens ?? 0), 0)
  const totalCalls  = logs.length
  const avgCostPerCall = totalCalls > 0 ? totalCost / totalCalls : 0

  const dailyData   = groupByDay(logs)
  const featureData = groupByFeature(logs)
  const modelData   = groupByModel(logs)

  const allModels   = [...new Set(logs.map(l => l.model).filter(Boolean))]
  const allFeatures = [...new Set(logs.map(l => l.feature).filter(Boolean))]

  // Top users by spend
  const userMap = {}
  for (const log of logs) {
    const key = log.site ?? 'Unknown'
    if (!userMap[key]) userMap[key] = { site: key, cost: 0, calls: 0, tokens: 0 }
    userMap[key].cost   += estimateCost(log)
    userMap[key].calls  += 1
    userMap[key].tokens += (log.prompt_tokens ?? 0) + (log.completion_tokens ?? 0)
  }
  const topSites = Object.values(userMap).sort((a, b) => b.cost - a.cost).slice(0, 8)

  // EnterpriseTable columns for the log table
  const logColumns = useMemo(() => [
    {
      id: 'created_at',
      header: 'Timestamp',
      accessorFn: row => new Date(row.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      size: 140,
    },
    {
      id: 'model',
      header: 'Model',
      accessorFn: row => row.model ?? '-',
      size: 150,
      meta: { filterVariant: 'select' },
    },
    {
      id: 'feature',
      header: 'Feature',
      accessorFn: row => row.feature ?? 'unknown',
      size: 100,
      meta: {
        filterVariant: 'select',
        exportValue: row => row.feature ?? 'unknown',
      },
      cell: ({ getValue }) => {
        const val = getValue()
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: (FEATURE_COLORS[val] ?? FEATURE_COLORS.other) + '20', color: FEATURE_COLORS[val] ?? FEATURE_COLORS.other }}>
            {val}
          </span>
        )
      },
    },
    {
      id: 'prompt_tokens',
      header: 'Prompt',
      accessorFn: row => formatTokens(row.prompt_tokens ?? 0),
      size: 80,
      meta: { align: 'right' },
    },
    {
      id: 'completion_tokens',
      header: 'Completion',
      accessorFn: row => formatTokens(row.completion_tokens ?? 0),
      size: 100,
      meta: { align: 'right' },
    },
    {
      id: 'cost',
      header: 'Cost',
      accessorFn: row => estimateCost(row),
      size: 90,
      meta: { align: 'right' },
      cell: ({ getValue }) => <span className="text-green-400 font-medium">{formatUSD(getValue())}</span>,
      sortingFn: (a, b) => estimateCost(a.original) - estimateCost(b.original),
    },
    {
      id: 'site',
      header: 'Site',
      accessorFn: row => row.site ?? '-',
      size: 100,
    },
  ], [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI Cost Monitor"
        subtitle="Token usage, spend tracking, and cost analysis"
        icon={DollarSign}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {DATE_RANGES.map(r => (
          <button
            key={r.days}
            onClick={() => setRangeDays(r.days)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${rangeDays === r.days ? 'bg-green-500 text-white' : 'bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border-dim)] hover:border-[var(--accent)]'}`}
          >
            {r.label}
          </button>
        ))}

        {allFeatures.length > 1 && (
          <div className="relative">
            <select
              className="appearance-none bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-lg pl-3 pr-8 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              value={filterFeature} onChange={e => setFilterFeature(e.target.value)}
            >
              <option value="all">All Features</option>
              {allFeatures.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
          </div>
        )}

        {allModels.length > 1 && (
          <div className="relative">
            <select
              className="appearance-none bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-lg pl-3 pr-8 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              value={filterModel} onChange={e => setFilterModel(e.target.value)}
            >
              <option value="all">All Models</option>
              {allModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
          </div>
        )}

        <button onClick={fetchLogs} className="ml-auto p-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border-dim)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4" />{error}
          {error.includes('does not exist') && (
            <span className="ml-2 text-[var(--text-muted)]">- Apply MIGRATIONS_V44 to create the ai_token_logs table.</span>
          )}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Cost" value={formatUSD(totalCost)} sub={`${DATE_RANGES.find(r => r.days === rangeDays)?.label}`} icon={DollarSign} color="text-green-400" bg="bg-green-400/10" />
        <StatCard label="Total Tokens" value={formatTokens(totalTokens)} sub={`${totalCalls.toLocaleString()} calls`} icon={Zap} color="text-blue-400" bg="bg-blue-400/10" />
        <StatCard label="Avg Cost / Call" value={formatUSD(avgCostPerCall)} sub="across all features" icon={TrendingUp} color="text-purple-400" bg="bg-purple-400/10" />
        <StatCard label="Active Features" value={allFeatures.length || 0} sub={allFeatures.join(', ') || '-'} icon={BarChart2} color="text-yellow-400" bg="bg-yellow-400/10" />
      </div>

      {totalCalls === 0 && !loading && !error ? (
        <div className="text-center py-16 text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl">
          <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-[var(--text-secondary)]">No AI usage recorded yet</p>
          <p className="text-sm mt-1 max-w-md mx-auto">
            No AI calls were logged in the selected period. Usage appears here automatically as AI
            features (chat, insights, reports) are used. Try widening the date range or clearing the
            filters above.
          </p>
          <p className="text-xs mt-2 opacity-80">Only Admin, Manager and Director roles can view AI usage.</p>
        </div>
      ) : totalCalls === 0 && !loading && error ? (
        <div className="text-center py-16 text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30 text-red-400" />
          <p className="font-medium text-[var(--text-secondary)]">AI usage could not be loaded</p>
          <p className="text-sm mt-1 max-w-md mx-auto">{error}</p>
          <button
            onClick={fetchLogs}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--surface-1)] border border-[var(--border-dim)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      ) : (
        <>
          {/* Daily token sparkline */}
          {dailyData.length > 0 && (
            <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[var(--text-primary)] font-semibold">Daily Token Usage</h3>
                <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                  <span>{dailyData[0]?.date?.slice(5)} to {dailyData[dailyData.length - 1]?.date?.slice(5)}</span>
                  <span className="text-green-400 font-medium">{formatTokens(totalTokens)} total</span>
                </div>
              </div>
              <Sparkline data={dailyData} dataKey="tokens" color="#16a34a" height={72} />
              <div className="flex justify-between text-[var(--text-muted)] text-xs mt-1 px-0.5">
                {dailyData.filter((_, i) => i === 0 || i === Math.floor(dailyData.length / 2) || i === dailyData.length - 1)
                  .map(d => <span key={d.date}>{d.date.slice(5)}</span>)}
              </div>
            </div>
          )}

          {/* Cost by model */}
          {modelData.length > 0 && (
            <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl p-5">
              <h3 className="text-[var(--text-primary)] font-semibold mb-4">Cost by Model</h3>
              <div className="space-y-3">
                {modelData.map(m => {
                  const pct = totalCost > 0 ? (m.cost / totalCost) * 100 : 0
                  return (
                    <div key={m.model}>
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <span className="text-[var(--text-secondary)] font-medium">{m.model}</span>
                        <div className="flex items-center gap-3 text-[var(--text-muted)] text-xs">
                          <span>{m.calls} calls</span>
                          <span>{formatTokens(m.tokens)} tokens</span>
                          <span className="font-semibold text-[var(--text-primary)]">{formatUSD(m.cost)}</span>
                        </div>
                      </div>
                      <div className="w-full bg-[var(--input-bg)] rounded-full h-2">
                        <div className="h-2 rounded-full bg-purple-500 transition-all" style={{ width: `${pct.toFixed(1)}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Cost by feature + site breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {featureData.length > 0 && (
              <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl p-5">
                <h3 className="text-[var(--text-primary)] font-semibold mb-4">Cost by Feature</h3>
                <div className="space-y-3">
                  {featureData.map(f => {
                    const pct = totalCost > 0 ? (f.cost / totalCost) * 100 : 0
                    const color = FEATURE_COLORS[f.feature] ?? FEATURE_COLORS.other
                    return (
                      <div key={f.feature}>
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <span className="text-[var(--text-secondary)] font-medium capitalize">{f.feature}</span>
                          <div className="flex items-center gap-3 text-[var(--text-muted)] text-xs">
                            <span>{formatTokens(f.tokens)} tokens</span>
                            <span className="font-semibold text-[var(--text-primary)]">{formatUSD(f.cost)}</span>
                          </div>
                        </div>
                        <div className="w-full bg-[var(--input-bg)] rounded-full h-2">
                          <div className="h-2 rounded-full transition-all" style={{ width: `${pct.toFixed(1)}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {topSites.length > 0 && (
              <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl p-5">
                <h3 className="text-[var(--text-primary)] font-semibold mb-4">Spend by Site</h3>
                <div className="space-y-3">
                  {topSites.map(s => {
                    const pct = topSites[0].cost > 0 ? (s.cost / topSites[0].cost) * 100 : 0
                    return (
                      <div key={s.site}>
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <span className="text-[var(--text-secondary)] text-xs font-medium truncate max-w-36">{s.site}</span>
                          <span className="text-green-400 text-xs font-semibold">{formatUSD(s.cost)}</span>
                        </div>
                        <div className="w-full bg-[var(--input-bg)] rounded-full h-2">
                          <div className="h-2 rounded-full bg-green-500 transition-all" style={{ width: `${pct.toFixed(1)}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Recent usage log - EnterpriseTable */}
          <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border-dim)] flex items-center justify-between">
              <h3 className="text-[var(--text-primary)] font-semibold">Recent Usage Log</h3>
              <span className="text-[var(--text-muted)] text-sm">{logs.length.toLocaleString()} records</span>
            </div>
            <EnterpriseTable
              reportMeta={reportMeta}
              columns={logColumns}
              data={logs}
              loading={loading}
              error={error}
              onRetry={fetchLogs}
              enableGlobalFilter={true}
              searchPlaceholder="Search logs"
              enableColumnFilters={true}
              enableSorting={true}
              enableExport={true}
              exportFileName="ai_cost_logs"
              initialPageSize={25}
              pageSizeOptions={[25, 50, 100]}
              emptyMessage="No logs match your filters"
              skeletonRows={8}
            />
          </div>
        </>
      )}
    </div>
  )
}