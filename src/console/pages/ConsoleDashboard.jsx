import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Building2, Database, AlertTriangle, Zap, Shield,
  TrendingUp, Clock, CheckCircle, XCircle, RefreshCw, DollarSign,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'

export default function ConsoleDashboard() {
  const { activeOrg } = useConsoleAuth()
  const navigate = useNavigate()
  const [stats, setStats]         = useState(null)
  const [loading, setLoading]     = useState(true)
  const [recentActions, setRecentActions] = useState([])
  const [recentUsers, setRecentUsers]     = useState([])
  const [aiTrend, setAiTrend]             = useState([])

  useEffect(() => { loadAll() }, [activeOrg])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadStats(), loadRecentActions(), loadRecentUsers(), loadAiTrend()])
    setLoading(false)
  }

  async function loadStats() {
    const { data } = await supabase.rpc('get_console_stats')
    setStats(data)
  }

  async function loadRecentActions() {
    const { data } = await supabase
      .from('console_sessions')
      .select('action, target_type, details, created_at, admin_id')
      .order('created_at', { ascending: false })
      .limit(8)
    setRecentActions(data ?? [])
  }

  async function loadRecentUsers() {
    let q = supabase
      .from('profiles')
      .select('id, full_name, email, role, site, approved, locked, created_at')
      .order('created_at', { ascending: false })
      .limit(6)
    if (activeOrg) q = q.eq('organisation_id', activeOrg.id)
    const { data } = await q
    setRecentUsers(data ?? [])
  }

  async function loadAiTrend() {
    const { data } = await supabase
      .from('ai_usage_log')
      .select('created_at, total_tokens, cost_usd, model')
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .order('created_at', { ascending: true })
    // Aggregate by day
    const byDay = {}
    ;(data ?? []).forEach(r => {
      const d = r.created_at.slice(0, 10)
      if (!byDay[d]) byDay[d] = { date: d, calls: 0, tokens: 0, cost: 0 }
      byDay[d].calls++
      byDay[d].tokens += r.total_tokens ?? 0
      byDay[d].cost   += parseFloat(r.cost_usd ?? 0)
    })
    setAiTrend(Object.values(byDay))
  }

  const U = stats?.users ?? {}
  const O = stats?.organisations ?? {}
  const A = stats?.assets ?? {}
  const aiStats = {
    calls_today: aiTrend.at(-1)?.calls ?? 0,
    tokens_month: aiTrend.reduce((s, d) => s + d.tokens, 0),
    cost_month:   aiTrend.reduce((s, d) => s + d.cost, 0),
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">System Overview</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeOrg ? `Showing data for: ${activeOrg.name}` : 'All organisations · Live data'}
          </p>
        </div>
        <button onClick={loadAll} disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* ── KPI grid ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Users}      label="Total Users"     value={U.total}       sub={`${U.pending ?? 0} pending approval`}  color="blue"   onClick={() => navigate('/console/users')} />
        <KpiCard icon={Building2}  label="Organisations"   value={O.total}       sub={`${O.active ?? 0} active`}             color="purple" onClick={() => navigate('/console/organisations')} />
        <KpiCard icon={Shield}     label="Locked Accounts" value={U.locked ?? 0} sub="require attention"                     color="red"    onClick={() => navigate('/console/users')} />
        <KpiCard icon={Clock}      label="New This Week"   value={U.new_week}    sub={`${U.new_today ?? 0} new today`}       color="green" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Database}      label="Tyre Records"   value={fmtNum(A.tyres)}        sub="total across all orgs" color="orange" />
        <KpiCard icon={CheckCircle}   label="Inspections"    value={fmtNum(A.inspections)}  sub="all time"              color="green" />
        <KpiCard icon={TrendingUp}    label="Vehicles"       value={fmtNum(A.vehicles)}     sub="registered"            color="blue" />
        <KpiCard icon={Zap}           label="AI Calls"       value={aiStats.calls_today}    sub={`${fmtTokens(aiStats.tokens_month)} tokens (7d)`} color="yellow" onClick={() => navigate('/console/ai-usage')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Recent console actions ── */}
        <div className="lg:col-span-1 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Recent Console Actions</h3>
          {recentActions.length === 0
            ? <p className="text-xs text-gray-600">No recent actions</p>
            : (
              <div className="space-y-2">
                {recentActions.map((a, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                      a.action === 'login' ? 'bg-green-500' :
                      a.action === 'logout' ? 'bg-gray-500' :
                      a.action.includes('lock') ? 'bg-red-500' : 'bg-orange-500'
                    }`} />
                    <div className="min-w-0">
                      <p className="text-xs text-gray-300 font-medium capitalize">{a.action.replace(/_/g, ' ')}</p>
                      <p className="text-[10px] text-gray-600">{new Date(a.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </div>

        {/* ── Pending users ── */}
        <div className="lg:col-span-2 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Recently Registered Users</h3>
            <button onClick={() => navigate('/console/users')} className="text-xs text-orange-400 hover:text-orange-300">View all →</button>
          </div>
          {recentUsers.length === 0
            ? <p className="text-xs text-gray-600">No users yet</p>
            : (
              <div className="space-y-2">
                {recentUsers.map(u => (
                  <div key={u.id} className="flex items-center gap-3 py-1.5">
                    <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 flex-shrink-0">
                      {(u.full_name ?? '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white font-medium truncate">{u.full_name ?? '—'}</p>
                      <p className="text-[10px] text-gray-500 truncate">{u.email ?? u.site ?? '—'}</p>
                    </div>
                    <RoleBadge role={u.role} />
                    {!u.approved && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-300 border border-yellow-700/40">Pending</span>}
                    {u.locked  && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-300 border border-red-700/40">Locked</span>}
                  </div>
                ))}
              </div>
            )
          }
        </div>
      </div>

      {/* ── AI usage 7-day trend ── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <h3 className="text-sm font-semibold text-white mb-4">AI Usage — Last 7 Days</h3>
        {aiTrend.length === 0
          ? <p className="text-xs text-gray-600">No AI usage data yet</p>
          : (
            <div className="grid grid-cols-7 gap-2">
              {aiTrend.map(d => {
                const maxCalls = Math.max(...aiTrend.map(x => x.calls), 1)
                const pct = (d.calls / maxCalls) * 100
                return (
                  <div key={d.date} className="flex flex-col items-center gap-1">
                    <div className="w-full bg-gray-800 rounded-sm relative" style={{ height: 60 }}>
                      <div className="absolute bottom-0 w-full rounded-sm bg-orange-500/70"
                        style={{ height: `${pct}%`, minHeight: d.calls > 0 ? 4 : 0 }} />
                    </div>
                    <p className="text-[10px] text-gray-600">{d.date.slice(5)}</p>
                    <p className="text-[10px] text-gray-400">{d.calls}</p>
                  </div>
                )
              })}
            </div>
          )
        }
        {aiTrend.length > 0 && (
          <div className="flex gap-6 mt-3 pt-3 border-t border-gray-800">
            <div>
              <p className="text-xs text-gray-500">7-day tokens</p>
              <p className="text-sm font-semibold text-white">{fmtTokens(aiStats.tokens_month)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Estimated cost</p>
              <p className="text-sm font-semibold text-orange-300">${aiStats.cost_month.toFixed(4)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, sub, color, onClick }) {
  const colors = {
    blue:   'text-blue-400 bg-blue-900/20 border-blue-800/40',
    purple: 'text-purple-400 bg-purple-900/20 border-purple-800/40',
    red:    'text-red-400 bg-red-900/20 border-red-800/40',
    green:  'text-green-400 bg-green-900/20 border-green-800/40',
    orange: 'text-orange-400 bg-orange-900/20 border-orange-800/40',
    yellow: 'text-yellow-400 bg-yellow-900/10 border-yellow-800/40',
  }
  return (
    <button onClick={onClick}
      className={`rounded-xl border p-4 text-left transition-all ${colors[color]} ${onClick ? 'hover:brightness-110 cursor-pointer' : 'cursor-default'}`}>
      <Icon size={18} className="mb-2 opacity-80" />
      <p className="text-xl font-bold text-white">{value ?? '—'}</p>
      <p className="text-xs font-semibold text-gray-300 mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
    </button>
  )
}

function RoleBadge({ role }) {
  const c = { Admin: 'text-red-300 bg-red-900/30', Manager: 'text-orange-300 bg-orange-900/30',
    Director: 'text-blue-300 bg-blue-900/30', Inspector: 'text-purple-300 bg-purple-900/30',
    'Tyre Man': 'text-teal-300 bg-teal-900/30' }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${c[role] ?? 'text-gray-400 bg-gray-800'}`}>{role}</span>
  )
}

function fmtNum(n)    { return n != null ? Number(n).toLocaleString() : '—' }
function fmtTokens(n) { if (!n) return '0'; const v = Number(n); return v > 1000 ? `${(v/1000).toFixed(1)}k` : v.toString() }
