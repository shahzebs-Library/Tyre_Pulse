import { useEffect, useState, useCallback } from 'react'
import { Zap, RefreshCw, DollarSign, TrendingUp, Calendar, Filter } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'

const RANGES = [
  { label: '7 days',  days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
]

export default function ConsoleAIUsage() {
  const { activeOrg } = useConsoleAuth()
  const [logs, setLogs]     = useState([])
  const [loading, setLoading] = useState(true)
  const [range, setRange]   = useState(30)
  const [filterModel, setFilterModel] = useState('')
  const [filterOrg, setFilterOrg]     = useState(activeOrg?.id ?? '')
  const [orgs, setOrgs]     = useState([])
  const [page, setPage]     = useState(0)
  const [total, setTotal]   = useState(0)
  const PAGE_SIZE = 50

  useEffect(() => {
    supabase.from('organisations').select('id, name').order('name')
      .then(({ data }) => setOrgs(data ?? []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const since = new Date(Date.now() - range * 86400000).toISOString()
    let q = supabase
      .from('ai_usage_log')
      .select('id, created_at, user_id, organisation_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, feature, latency_ms', { count: 'exact' })
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (filterOrg)   q = q.eq('organisation_id', filterOrg)
    if (filterModel) q = q.eq('model', filterModel)

    const { data, count } = await q
    setLogs(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [range, filterOrg, filterModel, page])

  useEffect(() => { load() }, [load])

  // Compute aggregates from current page data + totals query
  const [agg, setAgg] = useState({ calls: 0, tokens: 0, cost: 0, models: {} })

  useEffect(() => {
    async function loadAgg() {
      const since = new Date(Date.now() - range * 86400000).toISOString()
      let q = supabase.from('ai_usage_log')
        .select('model, total_tokens, cost_usd, created_at')
        .gte('created_at', since)
      if (filterOrg)   q = q.eq('organisation_id', filterOrg)
      if (filterModel) q = q.eq('model', filterModel)
      const { data } = await q
      const models = {}
      let tokens = 0, cost = 0
      ;(data ?? []).forEach(r => {
        tokens += r.total_tokens ?? 0
        cost   += parseFloat(r.cost_usd ?? 0)
        if (!models[r.model]) models[r.model] = { calls: 0, tokens: 0, cost: 0 }
        models[r.model].calls++
        models[r.model].tokens += r.total_tokens ?? 0
        models[r.model].cost   += parseFloat(r.cost_usd ?? 0)
      })
      setAgg({ calls: data?.length ?? 0, tokens, cost, models })
    }
    loadAgg()
  }, [range, filterOrg, filterModel])

  // Day-by-day trend
  const [trend, setTrend] = useState([])
  useEffect(() => {
    const byDay = {}
    logs.forEach(r => {
      const d = r.created_at.slice(0, 10)
      if (!byDay[d]) byDay[d] = { date: d, calls: 0, tokens: 0, cost: 0 }
      byDay[d].calls++
      byDay[d].tokens += r.total_tokens ?? 0
      byDay[d].cost   += parseFloat(r.cost_usd ?? 0)
    })
    setTrend(Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)))
  }, [logs])

  const uniqueModels = [...new Set(logs.map(l => l.model).filter(Boolean))]

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">AI Usage & Cost</h1>
          <p className="text-sm text-gray-500 mt-0.5">Token consumption and cost tracking across all AI features</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 disabled:opacity-50 transition-colors">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-xl">
          {RANGES.map(r => (
            <button key={r.days} onClick={() => { setRange(r.days); setPage(0) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                range === r.days ? 'bg-orange-900/60 text-orange-300 border border-orange-700/40' : 'text-gray-400 hover:text-white'
              }`}>{r.label}</button>
          ))}
        </div>
        {!activeOrg && (
          <select value={filterOrg} onChange={e => { setFilterOrg(e.target.value); setPage(0) }}
            className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500">
            <option value="">All Orgs</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        <select value={filterModel} onChange={e => { setFilterModel(e.target.value); setPage(0) }}
          className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500">
          <option value="">All Models</option>
          {uniqueModels.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <AiKpi icon={Zap}         label="Total Calls"   value={agg.calls.toLocaleString()}                      color="yellow" />
        <AiKpi icon={TrendingUp}  label="Total Tokens"  value={fmtTokens(agg.tokens)}                           color="blue" />
        <AiKpi icon={DollarSign}  label="Total Cost"    value={`$${Number(agg.cost).toFixed(4)}`}               color="orange" />
        <AiKpi icon={Calendar}    label="Avg per Day"   value={`$${(agg.cost / Math.max(range, 1)).toFixed(4)}`} color="purple" />
      </div>

      {/* Model breakdown */}
      {Object.keys(agg.models).length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">By Model</h3>
          <div className="space-y-2">
            {Object.entries(agg.models).sort((a, b) => b[1].cost - a[1].cost).map(([model, s]) => (
              <div key={model} className="flex items-center gap-3">
                <span className="text-xs text-gray-300 w-48 truncate font-mono">{model}</span>
                <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-500/70 rounded-full transition-all"
                    style={{ width: `${(s.cost / agg.cost) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-400 w-20 text-right">{s.calls.toLocaleString()} calls</span>
                <span className="text-xs text-orange-300 w-24 text-right font-semibold">${s.cost.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trend chart */}
      {trend.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <h3 className="text-sm font-semibold text-white mb-4">Daily Trend — Cost ($)</h3>
          <div className="flex items-end gap-1 h-24">
            {trend.map(d => {
              const maxCost = Math.max(...trend.map(x => x.cost), 0.0001)
              const pct = (d.cost / maxCost) * 100
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative" title={`${d.date}: $${d.cost.toFixed(4)} (${d.calls} calls)`}>
                  <div className="w-full bg-gray-800 rounded-sm relative flex-1">
                    <div className="absolute bottom-0 w-full rounded-sm bg-orange-500/70 transition-all"
                      style={{ height: `${pct}%`, minHeight: d.cost > 0 ? 3 : 0 }} />
                  </div>
                  <p className="text-[9px] text-gray-600">{d.date.slice(5)}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Logs table */}
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/60">
          <h3 className="text-sm font-semibold text-white">Request Log</h3>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-600">
            <Zap size={24} className="mb-2 opacity-30" />
            <p className="text-xs">No AI requests found</p>
          </div>
        ) : (
          <>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800/60 text-gray-500">
                  <th className="text-left px-4 py-2.5 font-semibold uppercase tracking-wider">Time</th>
                  <th className="text-left px-4 py-2.5 font-semibold uppercase tracking-wider">Feature</th>
                  <th className="text-left px-4 py-2.5 font-semibold uppercase tracking-wider">Model</th>
                  <th className="text-right px-4 py-2.5 font-semibold uppercase tracking-wider">Prompt</th>
                  <th className="text-right px-4 py-2.5 font-semibold uppercase tracking-wider">Completion</th>
                  <th className="text-right px-4 py-2.5 font-semibold uppercase tracking-wider">Total</th>
                  <th className="text-right px-4 py-2.5 font-semibold uppercase tracking-wider">Cost</th>
                  <th className="text-right px-4 py-2.5 font-semibold uppercase tracking-wider">Latency</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors">
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-gray-300 capitalize">{log.feature ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-gray-400 text-[10px]">{log.model ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">{(log.prompt_tokens ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">{(log.completion_tokens ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-white font-semibold">{(log.total_tokens ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-orange-300 font-semibold">
                      ${Number(log.cost_usd ?? 0).toFixed(5)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500">
                      {log.latency_ms ? `${log.latency_ms}ms` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 bg-gray-900/30">
                <p className="text-xs text-gray-500">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                    className="px-3 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 border border-gray-700">← Prev</button>
                  <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}
                    className="px-3 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 border border-gray-700">Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function AiKpi({ icon: Icon, label, value, color }) {
  const c = {
    yellow: 'text-yellow-400 bg-yellow-900/10 border-yellow-800/40',
    blue:   'text-blue-400 bg-blue-900/20 border-blue-800/40',
    orange: 'text-orange-400 bg-orange-900/20 border-orange-800/40',
    purple: 'text-purple-400 bg-purple-900/20 border-purple-800/40',
  }
  return (
    <div className={`rounded-xl border p-4 ${c[color]}`}>
      <Icon size={18} className="mb-2 opacity-80" />
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  )
}

function fmtTokens(n) {
  if (!n) return '0'
  const v = Number(n)
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return v.toString()
}
