import { useState, useEffect, useCallback, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSettings, COUNTRIES, COUNTRY_LABEL } from '../contexts/SettingsContext'
import {
  LayoutDashboard, CircleDot, Package, DollarSign,
  ClipboardList, Search, Upload, Settings, LogOut,
  Menu, X, Wand2, BarChart2, Shield, ClipboardCheck,
  Bell, GitBranch, Layers, AlertTriangle, Globe,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { detectAlerts, countAlertsBySeverity } from '../lib/alertEngine'

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { to: '/',      label: 'Dashboard',    icon: LayoutDashboard, end: true },
      { to: '/tyres', label: 'Tyre Records', icon: CircleDot },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/analytics',    label: 'Analytics',          icon: BarChart2 },
      { to: '/brand-perf',   label: 'Brand Performance',  icon: Shield },
      { to: '/site-comp',    label: 'Site Comparison',    icon: Layers },
      { to: '/fleet',        label: 'Fleet Analytics',    icon: GitBranch },
      { to: '/kpi',          label: 'KPI Scorecard',      icon: ClipboardCheck },
      { to: '/country-comp', label: 'Country Comparison', icon: Globe },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/stock',       label: 'Stock',              icon: Package },
      { to: '/budgets',     label: 'Budgets',            icon: DollarSign },
      { to: '/actions',     label: 'Corrective Actions', icon: ClipboardList },
      { to: '/rca',         label: 'Root Cause',         icon: Search },
      { to: '/inspections', label: 'Inspections',        icon: ClipboardCheck },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/alerts',    label: 'Alerts',       icon: Bell },
      { to: '/anomalies', label: 'Anomaly Scan', icon: AlertTriangle },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/cleaning', label: 'Data Cleaning', icon: Wand2 },
      { to: '/upload',   label: 'Upload Data',   icon: Upload },
      { to: '/settings', label: 'Settings',      icon: Settings },
    ],
  },
]

const SEARCH_TABLES = [
  { table: 'tyre_records',       fields: ['serial_no','asset_no','brand','site','description'],  label: 'Tyre',   route: '/tyres' },
  { table: 'corrective_actions', fields: ['title','site','assigned_to','asset_no'],              label: 'Action', route: '/actions' },
  { table: 'rca_records',        fields: ['asset_no','tyre_serial','brand','site','root_cause'], label: 'RCA',    route: '/rca' },
  { table: 'stock_records',      fields: ['site','description'],                                  label: 'Stock',  route: '/stock' },
]

export default function Layout({ children }) {
  const { profile, signOut }                = useAuth()
  const { activeCountry, setActiveCountry } = useSettings()
  const navigate     = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchOpen, setSearchOpen]   = useState(false)
  const [query, setQuery]             = useState('')
  const [results, setResults]         = useState([])
  const [searching, setSearching]     = useState(false)
  const [alertCount, setAlertCount]   = useState(0)
  const searchRef   = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    async function fetchAlertCount() {
      try {
        const country = activeCountry !== 'All' ? activeCountry : null
        const found = await detectAlerts(supabase, country)
        const dismissed = (() => {
          try { return new Set(JSON.parse(localStorage.getItem('tp_dismissed_alerts') || '[]')) }
          catch { return new Set() }
        })()
        const counts = countAlertsBySeverity(found.filter(a => !dismissed.has(a.id)))
        setAlertCount(counts.critical + counts.high)
      } catch { /* ignore */ }
    }
    fetchAlertCount()
    const iv = setInterval(fetchAlertCount, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [activeCountry])

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v) }
      if (e.key === 'Escape') { setSearchOpen(false); setQuery('') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (searchOpen && searchRef.current) setTimeout(() => searchRef.current?.focus(), 50)
  }, [searchOpen])

  const doSearch = useCallback(async (q) => {
    if (!q.trim() || q.length < 2) { setResults([]); return }
    setSearching(true)
    const allResults = []
    await Promise.all(SEARCH_TABLES.map(async ({ table, fields, label, route }) => {
      const orClause = fields.map(f => `${f}.ilike.%${q}%`).join(',')
      const { data } = await supabase.from(table).select(fields.join(',') + ',id').or(orClause).limit(5)
      if (data) {
        data.forEach(row => {
          const primary   = row[fields[0]] || row[fields[1]] || 'Unknown'
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

  async function handleSignOut() { await signOut(); navigate('/login') }

  const pillClass = (c) =>
    `flex-1 py-1 text-[11px] font-semibold rounded transition-colors ${
      activeCountry === c ? 'text-white' : 'text-gray-600 hover:text-gray-400'
    }`

  const pillStyle = (c) => activeCountry === c ? { backgroundColor: '#15803d' } : {}

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'transparent' }}>

      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-60' : 'w-14'} flex-shrink-0 flex flex-col transition-all duration-200`}>

        {/* Logo */}
        <div className={`flex items-center h-13 px-3 py-3 border-b border-white/5 flex-shrink-0 ${!sidebarOpen ? 'justify-center' : ''}`}>
          {sidebarOpen && <div className="w-7 h-7 rounded-md flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ backgroundColor: '#15803d' }}>T</div>}
          {sidebarOpen && <span className="ml-2.5 font-bold text-white tracking-tight">TyrePulse</span>}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            className={`${sidebarOpen ? 'ml-auto' : ''} text-gray-700 hover:text-gray-400 transition-colors`}
          >
            {sidebarOpen ? <X size={15} /> : <Menu size={15} />}
          </button>
        </div>

        {sidebarOpen && (
          <>
            {/* Search */}
            <div className="px-2.5 pt-2.5 pb-1">
              <button
                onClick={() => setSearchOpen(true)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-gray-600 hover:text-gray-400 transition-colors text-xs"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <Search size={12} />
                <span className="flex-1 text-left">Search</span>
                <kbd className="text-[10px] px-1 rounded text-gray-700" style={{ background: 'rgba(255,255,255,0.06)' }}>K</kbd>
              </button>
            </div>

            {/* Country selector */}
            <div className="px-2.5 pt-1.5 pb-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-700 px-0.5 mb-1">Country</p>
              <div className="flex gap-0.5 rounded-md p-0.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <button className={pillClass('All')} style={pillStyle('All')} onClick={() => setActiveCountry('All')}>All</button>
                {COUNTRIES.map(c => (
                  <button key={c} className={pillClass(c)} style={pillStyle(c)} onClick={() => setActiveCountry(c)}>
                    {COUNTRY_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-1 px-2">
          {NAV_GROUPS.map(({ label, items }) => (
            <div key={label} className="mb-0.5">
              {sidebarOpen && (
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-700 px-2.5 pt-2.5 pb-1">{label}</p>
              )}
              {items.map(({ to, label: lbl, icon: Icon, end }) => (
                <NavLink
                  key={to} to={to} end={end}
                  title={!sidebarOpen ? lbl : undefined}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors relative mb-0.5 ${
                      !sidebarOpen ? 'justify-center' : ''
                    } ${
                      isActive
                        ? 'text-green-400 border border-green-600/20'
                        : 'text-gray-600 hover:text-gray-300 border border-transparent'
                    }`
                  }
                  style={({ isActive }) => isActive ? { backgroundColor: 'rgba(22,163,74,0.10)' } : {}}
                >
                  <Icon size={14} className="flex-shrink-0" />
                  {sidebarOpen && <span className="truncate">{lbl}</span>}
                  {to === '/alerts' && alertCount > 0 && (
                    <span className={`${sidebarOpen ? 'ml-auto' : 'absolute -top-0.5 -right-0.5'} text-[10px] bg-red-600 text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 font-bold`}>
                      {alertCount > 9 ? '9+' : alertCount}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-white/5 p-3 flex-shrink-0">
          <div className={`flex items-center gap-2.5 ${!sidebarOpen ? 'flex-col' : ''}`}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: '#15803d' }}>
              {profile?.full_name?.[0] ?? profile?.username?.[0] ?? 'U'}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-300 truncate">{profile?.full_name ?? profile?.username ?? 'User'}</p>
                <p className="text-[11px] text-gray-600 truncate">{profile?.role ?? 'Reporter'}</p>
              </div>
            )}
            <button onClick={handleSignOut} title="Sign out" className="text-gray-700 hover:text-red-400 transition-colors flex-shrink-0">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-5 max-w-screen-2xl mx-auto">
          {children}
        </div>
      </main>

      {/* Search palette */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => { setSearchOpen(false); setQuery('') }}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-lg"
            style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 16px 60px rgba(0,0,0,0.7)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <Search size={15} className="text-gray-600 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                className="flex-1 bg-transparent text-white placeholder-gray-600 focus:outline-none text-sm"
                placeholder="Search tyres, actions, RCA, stock..."
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              {searching && <span className="text-[11px] text-gray-600">Searching</span>}
              <kbd
                className="text-[11px] text-gray-600 px-1.5 py-0.5 rounded cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.06)' }}
                onClick={() => { setSearchOpen(false); setQuery('') }}
              >ESC</kbd>
            </div>

            <div className="max-h-72 overflow-y-auto">
              {query.length >= 2 && results.length === 0 && !searching && (
                <p className="text-gray-600 text-sm text-center py-8">No results for &ldquo;{query}&rdquo;</p>
              )}
              {query.length < 2 && (
                <p className="text-gray-700 text-xs text-center py-5">Type at least 2 characters</p>
              )}
              {results.map((r, i) => (
                <button
                  key={`${r.id}-${i}`}
                  onClick={() => { navigate(r.route); setSearchOpen(false); setQuery('') }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/3 transition-colors"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <span className="text-[11px] text-gray-600 rounded px-1.5 py-0.5 flex-shrink-0 min-w-[44px] text-center" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                    {r.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-200 text-sm font-medium truncate">{r.primary}</p>
                    {r.secondary && <p className="text-gray-600 text-xs truncate">{r.secondary}</p>}
                  </div>
                </button>
              ))}
            </div>

            <div className="px-4 py-1.5 flex gap-4 text-[11px] text-gray-700" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <span>Enter to navigate</span>
              <span>Esc to close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
