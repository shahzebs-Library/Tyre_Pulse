import { useState, useEffect, useCallback } from 'react'
import {
  DollarSign, Zap, TrendingUp, AlertCircle, BarChart2,
  ChevronDown, RefreshCw, Calendar, User, Globe,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'

// ── Constants ─────────────────────────────────────────────────────────────────

// Approximate costs per 1K tokens (USD) — update when OpenAI / Anthropic change pricing
const TOKEN_COSTS = {
  'claude-opus-4-8':    { input: 0.015,   output: 0.075   },
  'claude-sonnet-4-6':  { input: 0.003,   output: 0.015   },
  'claude-haiku-4-5':   { input: 0.00025, output: 0.00125 },
  'text-embedding-3-small': { input: 0.00002, output: 0 },
  'text-embedding-3-large': { input: 0.00013, output: 0 },
  default:              { input: 0.003,   output: 0.015   },
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

function estimateCost(row) {
  if (row.cost_usd != null) return Number(row.cost_usd)
  const rates = TOKEN_COSTS[row.model] ?? TOKEN_COSTS.default
  return ((row.prompt_tokens * rates.input) + (row.completion_tokens * rates.output)) / 1000
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
    const day = log.created_at.slice(0, 10)
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

function StatCard({ label, value, sub, icon: Icon, color, bg }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-white leading-tight">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// Minimal sparkline rendered as inline SVG — no external chart library needed
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
  const { profile } = useAuth()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rangeDays, setRangeDays] = useState(30)
  const [filterFeature, setFilterFeature] = useState('all')
  const [filterModel, setFilterModel] = useState('all')

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
      setError(e.message)
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI Cost Monitor"
        subtitle="Token usage, spend tracking, and cost analysis"
        icon={<DollarSign className="w-5 h-5 text-green-400" />}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {DATE_RANGES.map(r => (
          <button
            key={r.days}
            onClick={() => setRangeDays(r.days)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${rangeDays === r.days ? 'bg-green-500 text-white' : 'bg-gray-900 text-gray-400 border border-gray-700 hover:border-gray-500'}`}
          >
            {r.label}
          </button>
        ))}

        {allFeatures.length > 1 && (
          <div className="relative">
            <select
              className="appearance-none bg-gray-900 border border-gray-700 rounded-lg pl-3 pr-8 py-2 text-sm text-white focus:outline-none focus:border-green-500 transition-colors"
              value={filterFeature} onChange={e => setFilterFeature(e.target.value)}
            >
              <option value="all">All Features</option>
              {allFeatures.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
          </div>
        )}

        {allModels.length > 1 && (
          <div className="relative">
            <select
              className="appearance-none bg-gray-900 border border-gray-700 rounded-lg pl-3 pr-8 py-2 text-sm text-white focus:outline-none focus:border-green-500 transition-colors"
              value={filterModel} onChange={e => setFilterModel(e.target.value)}
            >
              <option value="all">All Models</option>
              {allModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
          </div>
        )}

        <button onClick={fetchLogs} className="ml-auto p-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4" />{error}
          {error.includes('does not exist') && (
            <span className="ml-2 text-gray-500">— Apply MIGRATIONS_V44 to create the ai_token_logs table.</span>
          )}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Cost" value={formatUSD(totalCost)} sub={`${DATE_RANGES.find(r => r.days === rangeDays)?.label}`} icon={DollarSign} color="text-green-400" bg="bg-green-400/10" />
        <StatCard label="Total Tokens" value={formatTokens(totalTokens)} sub={`${totalCalls.toLocaleString()} calls`} icon={Zap} color="text-blue-400" bg="bg-blue-400/10" />
        <StatCard label="Avg Cost / Call" value={formatUSD(avgCostPerCall)} sub="across all features" icon={TrendingUp} color="text-purple-400" bg="bg-purple-400/10" />
        <StatCard label="Active Features" value={allFeatures.length || 0} sub={allFeatures.join(', ') || '—'} icon={BarChart2} color="text-yellow-400" bg="bg-yellow-400/10" />
      </div>

      {totalCalls === 0 && !loading ? (
        <div className="text-center py-16 text-gray-500 bg-gray-900 border border-gray-800 rounded-2xl">
          <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-gray-400">No AI usage data yet</p>
          <p className="text-sm mt-1">Token logs will appear here once the chat-ai edge function is updated to write to ai_token_logs.</p>
        </div>
      ) : (
        <>
          {/* Daily token sparkline */}
          {dailyData.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-semibold">Daily Token Usage</h3>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{dailyData[0]?.date?.slice(5)} → {dailyData[dailyData.length - 1]?.date?.slice(5)}</span>
                  <span className="text-green-400 font-medium">{formatTokens(totalTokens)} total</span>
                </div>
              </div>
              <Sparkline data={dailyData} dataKey="tokens" color="#16a34a" height={72} />
              <div className="flex justify-between text-gray-600 text-xs mt-1 px-0.5">
                {dailyData.filter((_, i) => i === 0 || i === Math.floor(dailyData.length / 2) || i === dailyData.length - 1)
                  .map(d => <span key={d.date}>{d.date.slice(5)}</span>)}
              </div>
            </div>
          )}

          {/* Cost by feature + site breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Feature breakdown */}
            {featureData.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4">Cost by Feature</h3>
                <div className="space-y-3">
                  {featureData.map(f => {
                    const pct = totalCost > 0 ? (f.cost / totalCost) * 100 : 0
                    const color = FEATURE_COLORS[f.feature] ?? FEATURE_COLORS.other
                    return (
                      <div key={f.feature}>
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <span className="text-gray-300 font-medium capitalize">{f.feature}</span>
                          <div className="flex items-center gap-3 text-gray-400 text-xs">
                            <span>{formatTokens(f.tokens)} tokens</span>
                            <span className="font-semibold text-white">{formatUSD(f.cost)}</span>
                          </div>
                        </div>
                        <div className="w-full bg-gray-800 rounded-full h-2">
                          <div className="h-2 rounded-full transition-all" style={{ width: `${pct.toFixed(1)}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Top sites by spend — CSS horizontal bars */}
            {topSites.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4">Spend by Site</h3>
                <div className="space-y-3">
                  {topSites.map(s => {
                    const pct = topSites[0].cost > 0 ? (s.cost / topSites[0].cost) * 100 : 0
                    return (
                      <div key={s.site}>
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <span className="text-gray-300 text-xs font-medium truncate max-w-36">{s.site}</span>
                          <span className="text-green-400 text-xs font-semibold">{formatUSD(s.cost)}</span>
                        </div>
                        <div className="w-full bg-gray-800 rounded-full h-2">
                          <div className="h-2 rounded-full bg-green-500 transition-all" style={{ width: `${pct.toFixed(1)}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Recent log table */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-white font-semibold">Recent Usage Log</h3>
              <span className="text-gray-500 text-sm">{logs.length.toLocaleString()} records</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    {['Timestamp', 'Model', 'Feature', 'Prompt', 'Completion', 'Cost', 'Site'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {logs.slice(0, 50).map(log => (
                    <tr key={log.id} className="hover:bg-gray-800/40 transition-colors">
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 text-gray-300 text-xs max-w-32 truncate">{log.model}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: (FEATURE_COLORS[log.feature] ?? FEATURE_COLORS.other) + '20', color: FEATURE_COLORS[log.feature] ?? FEATURE_COLORS.other }}>
                          {log.feature ?? 'unknown'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs text-right">{formatTokens(log.prompt_tokens ?? 0)}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs text-right">{formatTokens(log.completion_tokens ?? 0)}</td>
                      <td className="px-4 py-3 text-green-400 text-xs font-medium text-right">{formatUSD(estimateCost(log))}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{log.site ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs.length > 50 && (
                <div className="px-5 py-3 border-t border-gray-800 text-gray-500 text-xs">
                  Showing 50 of {logs.length.toLocaleString()} records — narrow the date range or filter to see more.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
