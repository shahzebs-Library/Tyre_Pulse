/**
 * ConsoleSystem — thin super-admin System hub.
 *
 * The route (/console/system in App.jsx) is bridge-wrapped so the main-app
 * useAuth() resolves to a super-admin value here; it also lives inside the
 * ConsoleAuthProvider, so useConsoleAuth() works too. This page does NOT
 * re-implement any operational screen. It surfaces honest environment/app info
 * and labelled navigation cards into the existing operational surfaces:
 *   - System Health   (/system-health)   fleet/system health monitors
 *   - Tenant Health   (/tenant-health)   per-organisation health
 *   - System Config   (/console/config)  global settings + feature flags
 *   - Announcements   (/console/announcements)
 *
 * Real counts (organisations, users) are read live with full loading/empty/error
 * states. No metric is fabricated.
 */
import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Server, Activity, HeartPulse, SlidersHorizontal, Megaphone,
  Globe, ChevronRight, RefreshCw, Building2, Users, AlertTriangle,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/safeError'

const LINKS = [
  { to: '/system-health',          label: 'System Health',  desc: 'Live platform, database and job health monitors.', icon: Activity,          external: true },
  { to: '/tenant-health',          label: 'Tenant Health',  desc: 'Per-organisation health, usage and risk signals.',  icon: HeartPulse,        external: true },
  { to: '/console/config',         label: 'System Config',  desc: 'Global settings and feature flags for the platform.', icon: SlidersHorizontal, external: false },
  { to: '/console/announcements',  label: 'Announcements',  desc: 'Broadcast maintenance notices and product updates.', icon: Megaphone,         external: false },
]

function supabaseHost() {
  try {
    const url = import.meta.env?.VITE_SUPABASE_URL
    return url ? new URL(url).host : 'N/A'
  } catch {
    return 'N/A'
  }
}

export default function ConsoleSystem() {
  const [stats, setStats]     = useState({ orgs: null, users: null })
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const env = import.meta.env ?? {}
  const ENV_INFO = [
    { label: 'Environment', value: env.PROD ? 'Production' : env.DEV ? 'Development' : (env.MODE || 'N/A') },
    { label: 'Build Mode',  value: env.MODE || 'N/A' },
    { label: 'App Version', value: env.VITE_APP_VERSION || 'N/A' },
    { label: 'Data Host',   value: supabaseHost() },
  ]

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [orgRes, userRes] = await Promise.all([
        supabase.from('organisations').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
      ])
      if (orgRes.error) throw orgRes.error
      if (userRes.error) throw userRes.error
      setStats({ orgs: orgRes.count ?? 0, users: userRes.count ?? 0 })
    } catch (e) {
      setError(toUserMessage(e, 'Could not load system counts.'))
      setStats({ orgs: null, users: null })
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-orange-900/30 border border-orange-800/40 flex items-center justify-center">
            <Server size={17} className="text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">System</h1>
            <p className="text-sm text-gray-500 mt-0.5">Platform environment, health and configuration</p>
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-950/40 border border-red-800/50">
          <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Live counts */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={Building2} label="Organisations" value={stats.orgs} loading={loading} />
        <StatCard icon={Users} label="Users" value={stats.users} loading={loading} />
      </div>

      {/* Environment / app info */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800/60">
          <Globe size={14} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-white">Environment</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-800/60">
          {ENV_INFO.map(i => (
            <div key={i.label} className="px-5 py-4">
              <p className="text-[10px] text-gray-600 uppercase tracking-wider">{i.label}</p>
              <p className="text-sm font-semibold text-gray-200 mt-1 truncate" title={i.value}>{i.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Operational links */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Operational surfaces</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {LINKS.map(l => {
            const Icon = l.icon
            return (
              <Link key={l.to} to={l.to}
                className="group flex items-center gap-3 px-4 py-4 rounded-xl border border-gray-800 bg-gray-900/40 hover:bg-gray-800/50 hover:border-gray-700 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0">
                  <Icon size={16} className="text-orange-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-200">{l.label}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{l.desc}</p>
                </div>
                <ChevronRight size={16} className="text-gray-600 group-hover:text-gray-300 transition-colors flex-shrink-0" />
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, loading }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0">
        <Icon size={18} className="text-gray-300" />
      </div>
      <div>
        <p className="text-[10px] text-gray-600 uppercase tracking-wider">{label}</p>
        {loading
          ? <div className="mt-1 h-5 w-12 rounded bg-gray-800 animate-pulse" />
          : <p className="text-lg font-bold text-white">{value == null ? 'N/A' : value.toLocaleString()}</p>}
      </div>
    </div>
  )
}
