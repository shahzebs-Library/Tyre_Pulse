import { useState, useEffect, useCallback, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  LayoutDashboard, CircleDot, Package, DollarSign,
  ClipboardList, Search, Upload, Settings, LogOut,
  Menu, X, Wand2, BarChart2, Shield, ClipboardCheck,
  Bell, GitBranch, Layers,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { detectAlerts, countAlertsBySeverity } from '../lib/alertEngine'

const navItems = [
  { to: '/',            label: 'Dashboard',        icon: LayoutDashboard, end: true },
  { to: '/tyres',       label: 'Tyre Records',      icon: CircleDot },
  { to: '/analytics',   label: 'Analytics',         icon: BarChart2 },
  { to: '/brand-perf',  label: 'Brand Performance', icon: Shield },
  { to: '/site-comp',   label: 'Site Comparison',   icon: Layers },
  { to: '/fleet',       label: 'Fleet Analytics',   icon: GitBranch },
  { to: '/kpi',         label: 'KPI Scorecard',     icon: ClipboardCheck },
  { to: '/stock',       label: 'Stock',             icon: Package },
  { to: '/budgets',     label: 'Budgets',           icon: DollarSign },
  { to: '/actions',     label: 'Corrective Actions',icon: ClipboardList },
  { to: '/rca',         label: 'Root Cause Analysis',icon: Search },
  { to: '/inspections', label: 'Inspections',       icon: ClipboardCheck },
  { to: '/alerts',      label: 'Alerts',            icon: Bell },
  { to: '/cleaning',    label: 'Data Cleaning',     icon: Wand2 },
  { to: '/upload',      label: 'Upload Data',       icon: Upload },
  { to: '/settings',    label: 'Settings',          icon: Settings },
]

const SEARCH_TABLES = [
  { table: 'tyre_records',       fields: ['serial_no','asset_no','brand','site','description'],  label: 'Tyre', route: '/tyres' },
  { table: 'corrective_actions', fields: ['title','site','assigned_to','asset_no'],              label: 'Action', route: '/actions' },
  { table: 'rca_records',        fields: ['asset_no','tyre_serial','brand','site','root_cause'], label: 'RCA', route: '/rca' },
  { table: 'stock_records',      fields: ['site','description'],                                  label: 'Stock', route: '/stock' },
]

export default function Layout({ children }) {
  const { profile, signOut } = useAuth()
  const navigate     = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchOpen, setSearchOpen]   = useState(false)
  const [query, setQuery]             = useState('')
  const [results, setResults]         = useState([])
  const [searching, setSearching]     = useState(false)
  const [alertCount, setAlertCount]   = useState(0)
  const searchRef  = useRef(null)
  const debounceRef = useRef(null)

  // Fetch alert count on mount + every 5 minutes
  useEffect(() => {
    async function fetchAlertCount() {
      try {
        const found = await detectAlerts(supabase)
        const dismissed = (() => {
          try { return new Set(JSON.parse(localStorage.getItem('tp_dismissed_alerts') || '[]')) }
          catch { return new Set() }
        })()
        const active = found.filter(a => !dismissed.has(a.id))
        const counts = countAlertsBySeverity(active)
        setAlertCount(counts.critical + counts.high)
      } catch { /* network error — ignore */ }
    }
    fetchAlertCount()
    const interval = setInterval(fetchAlertCount, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Global keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(v => !v)
      }
      if (e.key === 'Escape') { setSearchOpen(false); setQuery('') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Auto-focus search input
  useEffect(() => {
    if (searchOpen && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [searchOpen])

  // Debounced cross-table search
  const doSearch = useCallback(async (q) => {
    if (!q.trim() || q.length < 2) { setResults([]); return }
    setSearching(true)
    const allResults = []

    await Promise.all(SEARCH_TABLES.map(async ({ table, fields, label, route }) => {
      // Search using ilike on each field (OR)
      const orClause = fields.map(f => `${f}.ilike.%${q}%`).join(',')
      const { data } = await supabase
        .from(table)
        .select(fields.join(',') + ',id')
        .or(orClause)
        .limit(5)

      if (data) {
        data.forEach(row => {
          const primary = row[fields[0]] || row[fields[1]] || 'Unknown'
          const secondary = fields.slice(1, 3).map(f => row[f]).filter(Boolean).join(' · ')
          allResults.push({ id: row.id, label, table, primary, secondary, route })
        })
      }
    }))

    setResults(allResults.slice(0, 15))
    setSearching(false)
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(query), 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, doSearch])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-16'} flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col transition-all duration-200`}>
        {/* Logo */}
        <div className="flex items-center h-16 px-4 border-b border-gray-800 flex-shrink-0">
          <span className="text-2xl">🔄</span>
          {sidebarOpen && (
            <span className="ml-3 font-bold text-white text-lg tracking-tight">TyrePulse</span>
          )}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="ml-auto text-gray-400 hover:text-white transition-colors">
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Search trigger */}
        {sidebarOpen && (
          <div className="px-3 pt-3 pb-1">
            <button
              onClick={() => setSearchOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 transition-colors text-sm"
            >
              <Search size={14} />
              <span className="flex-1 text-left text-xs">Search…</span>
              <kbd className="text-[10px] bg-gray-700 px-1.5 py-0.5 rounded text-gray-500">⌘K</kbd>
            </button>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              <Icon size={17} className="flex-shrink-0" />
              {sidebarOpen && <span>{label}</span>}
              {/* Alert badge on Alerts nav item */}
              {to === '/alerts' && alertCount > 0 && (
                <span className={`${sidebarOpen ? 'ml-auto' : 'absolute -top-1 -right-1'} text-[10px] bg-red-600 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 font-bold`}>
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-gray-800 p-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {profile?.full_name?.[0] ?? profile?.username?.[0] ?? 'U'}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{profile?.full_name ?? profile?.username ?? 'User'}</p>
                <p className="text-xs text-gray-500 truncate">{profile?.role ?? 'Reporter'}</p>
              </div>
            )}
            <button onClick={handleSignOut} title="Sign out" className="text-gray-500 hover:text-red-400 transition-colors flex-shrink-0">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">
          {children}
        </div>
      </main>

      {/* Global Search Palette */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/70 backdrop-blur-sm"
          onClick={() => { setSearchOpen(false); setQuery('') }}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
              <Search size={18} className="text-gray-400 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none text-base"
                placeholder="Search tyres, actions, RCA, stock…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              {searching && <span className="text-xs text-gray-500">Searching…</span>}
              <kbd className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded cursor-pointer" onClick={() => { setSearchOpen(false); setQuery('') }}>ESC</kbd>
            </div>

            {/* Results */}
            <div className="max-h-96 overflow-y-auto">
              {query.length >= 2 && results.length === 0 && !searching && (
                <p className="text-gray-500 text-sm text-center py-8">No results for "{query}"</p>
              )}
              {query.length < 2 && (
                <p className="text-gray-600 text-xs text-center py-6">Type at least 2 characters to search</p>
              )}
              {results.map((r, i) => (
                <button
                  key={`${r.id}-${i}`}
                  onClick={() => { navigate(r.route); setSearchOpen(false); setQuery('') }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800 transition-colors text-left border-b border-gray-800/50 last:border-0"
                >
                  <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 rounded px-2 py-0.5 flex-shrink-0 min-w-[52px] text-center">
                    {r.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{r.primary}</p>
                    {r.secondary && <p className="text-gray-500 text-xs truncate">{r.secondary}</p>}
                  </div>
                  <span className="text-gray-600 text-xs flex-shrink-0">→</span>
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-gray-800 flex gap-4 text-xs text-gray-600">
              <span>↵ Navigate</span>
              <span>ESC Close</span>
              <span>⌘K Toggle</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
