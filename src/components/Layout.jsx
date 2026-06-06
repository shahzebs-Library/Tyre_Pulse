import { useState, useEffect, useCallback, useRef } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { useSettings, COUNTRIES, COUNTRY_LABEL } from '../contexts/SettingsContext'
import { useTheme } from '../contexts/ThemeContext'
import {
  LayoutDashboard, CircleDot, Package, DollarSign,
  ClipboardList, Search, Upload, Settings, LogOut,
  Menu, X, Wand2, BarChart2, Shield, ClipboardCheck,
  Bell, GitBranch, Layers, AlertTriangle, Globe, Car, Users, Sparkles,
  Sun, Moon, Truck, AlertOctagon, FileText, ShieldCheck, ScanLine, GitCompare,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { detectAlerts, countAlertsBySeverity } from '../lib/alertEngine'
import TpLogo from '../assets/logo.svg'

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
      { to: '/comparison',   label: 'Comparison',         icon: GitCompare },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/fleet-master', label: 'Fleet Master',       icon: Truck },
      { to: '/stock',        label: 'Stock',              icon: Package },
      { to: '/budgets',      label: 'Budgets',            icon: DollarSign },
      { to: '/actions',      label: 'Corrective Actions', icon: ClipboardList },
      { to: '/accidents',    label: 'Accidents',          icon: AlertOctagon },
      { to: '/rca',          label: 'Root Cause',         icon: Search },
      { to: '/inspections',  label: 'Inspections',        icon: ClipboardCheck },
      { to: '/gate-pass',    label: 'Gate Pass',          icon: ShieldCheck },
      { to: '/reports',      label: 'Reports',            icon: FileText },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/alerts',          label: 'Alerts',           icon: Bell },
      { to: '/anomalies',       label: 'Anomaly Scan',     icon: AlertTriangle, adminOnly: true },
      { to: '/vehicle-history', label: 'Vehicle History',  icon: Car,           adminOnly: true },
      { to: '/serial-tracker',  label: 'Serial Tracker',   icon: ScanLine },
      { to: '/ai',              label: 'Smart Analytics',  icon: Sparkles,      adminOnly: true },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/cleaning', label: 'Data Cleaning', icon: Wand2,        adminOnly: true },
      { to: '/upload',   label: 'Upload Data',   icon: Upload },
      { to: '/audit',    label: 'Audit Trail',   icon: ClipboardList, adminOnly: true },
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
  const { theme, toggleTheme }              = useTheme()
  const navigate     = useNavigate()
  const location     = useLocation()
  const [sidebarOpen, setSidebarOpen]       = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const [searchOpen, setSearchOpen]         = useState(false)
  const [query, setQuery]                   = useState('')
  const [results, setResults]               = useState([])
  const [searching, setSearching]           = useState(false)
  const [alertCount, setAlertCount]         = useState(0)

  function toggleGroup(label) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) { next.delete(label) } else { next.add(label) }
      return next
    })
  }
  const searchRef   = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (location.pathname === '/upload') {
      setSidebarOpen(false)
    } else if (window.innerWidth >= 1024) {
      setSidebarOpen(true)
    }
  }, [location.pathname])

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
      <motion.aside
        className="flex-shrink-0 flex flex-col"
        animate={{ width: sidebarOpen ? 236 : 52 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        style={{ overflow: 'hidden' }}
      >

        {/* Logo */}
        <div className={`flex items-center h-13 px-3 py-3 border-b flex-shrink-0 ${!sidebarOpen ? 'justify-center' : ''}`}
          style={{ borderBottomColor: 'rgba(22,163,74,0.1)' }}>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', boxShadow: '0 0 14px rgba(22,163,74,0.5)' }}>
              <img src={TpLogo} alt="" style={{ width: 16, height: 16, filter: 'brightness(0) invert(1)' }} />
            </div>
            <AnimatePresence>
              {sidebarOpen && (
                <motion.span
                  className="font-extrabold text-white tracking-tight text-sm whitespace-nowrap"
                  style={{ background: 'linear-gradient(135deg,#fff 30%,#4ade80)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.18 }}
                >
                  TyrePulse
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            className="text-gray-700 hover:text-green-400 transition-colors flex-shrink-0 p-1 rounded-md hover:bg-green-400/10"
          >
            {sidebarOpen ? <X size={14} /> : <Menu size={14} />}
          </button>
        </div>

        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden' }}
            >
              {/* Search */}
              <div className="px-2.5 pt-2.5 pb-1">
                <button
                  onClick={() => setSearchOpen(true)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-gray-600 hover:text-green-400 transition-all text-xs group"
                  style={{ background: 'rgba(22,163,74,0.04)', border: '1px solid rgba(22,163,74,0.1)' }}
                >
                  <Search size={12} className="group-hover:text-green-400 transition-colors" />
                  <span className="flex-1 text-left">Search</span>
                  <kbd className="text-[10px] px-1.5 py-0.5 rounded text-gray-700 font-mono"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    ⌘K
                  </kbd>
                </button>
              </div>

              {/* Country selector */}
              <div className="px-2.5 pt-1 pb-1">
                <p className="nav-section px-0.5 pt-1.5 pb-1">Country</p>
                <div className="flex gap-0.5 rounded-lg p-0.5"
                  style={{ background: 'rgba(22,163,74,0.04)', border: '1px solid rgba(22,163,74,0.1)' }}>
                  <button className={pillClass('All')} style={pillStyle('All')} onClick={() => setActiveCountry('All')}>All</button>
                  {COUNTRIES.map(c => (
                    <button key={c} className={pillClass(c)} style={pillStyle(c)} onClick={() => setActiveCountry(c)}>
                      {COUNTRY_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-1 px-2">
          {NAV_GROUPS.map(({ label, items }) => {
            const visibleItems = items
              .filter(item => !item.adminOnly || profile?.role === 'Admin')
              .filter(item => {
                if (profile?.role === 'Inspector') {
                  return item.to === '/inspections' || item.to === '/settings'
                }
                return true
              })
            if (visibleItems.length === 0) return null
            const isCollapsed = collapsedGroups.has(label)
            return (
              <div key={label} className="mb-0.5">
                {sidebarOpen && (
                  <button
                    onClick={() => toggleGroup(label)}
                    className="w-full flex items-center justify-between px-2.5 pt-2.5 pb-1 group/section cursor-pointer"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-700 group-hover/section:text-gray-500 transition-colors">
                      {label}
                    </p>
                    {isCollapsed
                      ? <ChevronRight size={10} className="text-gray-700 group-hover/section:text-gray-500 transition-colors flex-shrink-0" />
                      : <ChevronDown size={10} className="text-gray-700 group-hover/section:text-gray-500 transition-colors flex-shrink-0" />
                    }
                  </button>
                )}
                <AnimatePresence initial={false}>
                  {(!isCollapsed || !sidebarOpen) && (
                    <motion.div
                      key={label + '-items'}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      {visibleItems.map(({ to, label: lbl, icon: Icon, end }) => (
                        <NavLink
                          key={to} to={to} end={end}
                          title={!sidebarOpen ? lbl : undefined}
                          className={({ isActive }) =>
                            `relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] font-medium transition-all duration-150 mb-0.5 group ${
                              !sidebarOpen ? 'justify-center' : ''
                            } ${
                              isActive
                                ? 'text-green-300'
                                : 'text-gray-600 hover:text-gray-300'
                            }`
                          }
                          style={({ isActive }) => isActive ? {
                            background: 'linear-gradient(135deg, rgba(22,163,74,0.14) 0%, rgba(22,163,74,0.07) 100%)',
                            border: '1px solid rgba(22,163,74,0.22)',
                            boxShadow: '0 0 14px rgba(22,163,74,0.1)'
                          } : {
                            border: '1px solid transparent',
                          }}
                        >
                          {({ isActive }) => (
                            <>
                              {/* active left bar */}
                              {isActive && (
                                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[55%] rounded-r-full"
                                  style={{ background: 'linear-gradient(180deg,#4ade80,#16a34a)', boxShadow: '0 0 8px rgba(74,222,128,0.8)' }} />
                              )}
                              <Icon size={14} className={`flex-shrink-0 transition-colors ${isActive ? 'text-green-400' : 'text-gray-600 group-hover:text-gray-300'}`} />
                              {sidebarOpen && <span className="truncate">{lbl}</span>}
                              {to === '/alerts' && alertCount > 0 && (
                                <span className={`${sidebarOpen ? 'ml-auto' : 'absolute -top-0.5 -right-0.5'} text-[10px] bg-red-600 text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 font-bold`}
                                  style={{ boxShadow: '0 0 8px rgba(239,68,68,0.6)' }}>
                                  {alertCount > 9 ? '9+' : alertCount}
                                </span>
                              )}
                            </>
                          )}
                        </NavLink>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}

          {/* Admin-only group */}
          {profile?.role === 'Admin' && (() => {
            const adminCollapsed = collapsedGroups.has('Admin')
            return (
              <div className="mb-0.5">
                {sidebarOpen && (
                  <button
                    onClick={() => toggleGroup('Admin')}
                    className="w-full flex items-center justify-between px-2.5 pt-2.5 pb-1 group/section cursor-pointer"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-700 group-hover/section:text-gray-500 transition-colors">
                      Admin
                    </p>
                    {adminCollapsed
                      ? <ChevronRight size={10} className="text-gray-700 group-hover/section:text-gray-500 transition-colors flex-shrink-0" />
                      : <ChevronDown size={10} className="text-gray-700 group-hover/section:text-gray-500 transition-colors flex-shrink-0" />
                    }
                  </button>
                )}
                <AnimatePresence initial={false}>
                  {(!adminCollapsed || !sidebarOpen) && (
                    <motion.div
                      key="admin-items"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <NavLink
                        to="/users"
                        title={!sidebarOpen ? 'User Management' : undefined}
                        className={({ isActive }) =>
                          `relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] font-medium transition-all duration-150 mb-0.5 group ${
                            !sidebarOpen ? 'justify-center' : ''
                          } ${isActive ? 'text-green-300' : 'text-gray-600 hover:text-gray-300'}`
                        }
                        style={({ isActive }) => isActive ? {
                          background: 'linear-gradient(135deg, rgba(22,163,74,0.14) 0%, rgba(22,163,74,0.07) 100%)',
                          border: '1px solid rgba(22,163,74,0.22)',
                          boxShadow: '0 0 14px rgba(22,163,74,0.1)'
                        } : { border: '1px solid transparent' }}
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[55%] rounded-r-full"
                                style={{ background: 'linear-gradient(180deg,#4ade80,#16a34a)', boxShadow: '0 0 8px rgba(74,222,128,0.8)' }} />
                            )}
                            <Users size={14} className={`flex-shrink-0 ${isActive ? 'text-green-400' : 'text-gray-600 group-hover:text-gray-300'}`} />
                            {sidebarOpen && <span className="truncate">User Management</span>}
                          </>
                        )}
                      </NavLink>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })()}
        </nav>

        {/* User footer */}
        <div className="flex-shrink-0 p-3" style={{ borderTop: '1px solid rgba(22,163,74,0.1)' }}>
          <div className={`flex items-center gap-2.5 ${!sidebarOpen ? 'flex-col' : ''}`}>
            {/* avatar */}
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', boxShadow: '0 0 10px rgba(22,163,74,0.4)' }}
            >
              {profile?.full_name?.[0]?.toUpperCase() ?? profile?.username?.[0]?.toUpperCase() ?? 'U'}
            </div>

            <AnimatePresence>
              {sidebarOpen && (
                <motion.div
                  className="flex-1 min-w-0"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <p className="text-xs font-semibold text-gray-300 truncate leading-none">
                    {profile?.full_name ?? profile?.username ?? 'User'}
                  </p>
                  <p className="text-[11px] mt-0.5 truncate leading-none"
                    style={{ color: 'rgba(22,163,74,0.7)' }}>
                    {profile?.role ?? 'Reporter'}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              className="text-gray-700 hover:text-green-400 transition-colors flex-shrink-0 p-1 rounded-md hover:bg-green-400/10"
            >
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            </button>
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="text-gray-700 hover:text-red-400 transition-colors flex-shrink-0 p-1 rounded-md hover:bg-red-400/10"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-5 max-w-screen-2xl mx-auto">
          {children}
        </div>
      </main>

      {/* Search palette */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4"
            style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => { setSearchOpen(false); setQuery('') }}
          >
            <motion.div
              className="w-full max-w-xl overflow-hidden"
              style={{
                background: 'linear-gradient(145deg, rgba(8,15,10,0.99) 0%, rgba(5,11,7,0.99) 100%)',
                border: '1px solid rgba(22,163,74,0.25)',
                borderRadius: 16,
                boxShadow: '0 0 60px rgba(22,163,74,0.14), 0 24px 80px rgba(0,0,0,0.8)',
              }}
              initial={{ scale: 0.96, y: -12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: -12 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              onClick={e => e.stopPropagation()}
            >
              {/* top edge glow */}
              <div className="h-px" style={{ background: 'linear-gradient(90deg,transparent,rgba(22,163,74,0.6),transparent)' }} />

              {/* input row */}
              <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid rgba(22,163,74,0.1)' }}>
                <Search size={15} className="text-green-600 flex-shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  className="flex-1 bg-transparent text-white placeholder-gray-600 focus:outline-none text-sm"
                  placeholder="Search tyres, actions, RCA, stock..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
                {searching && <span className="text-[11px] text-gray-600 animate-pulse">Searching</span>}
                <kbd
                  className="text-[11px] text-gray-600 px-1.5 py-0.5 rounded cursor-pointer font-mono"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                  onClick={() => { setSearchOpen(false); setQuery('') }}
                >ESC</kbd>
              </div>

              <div className="max-h-72 overflow-y-auto">
                {query.length >= 2 && results.length === 0 && !searching && (
                  <p className="text-gray-600 text-sm text-center py-10">No results for &ldquo;{query}&rdquo;</p>
                )}
                {query.length < 2 && (
                  <p className="text-gray-700 text-xs text-center py-6">Type at least 2 characters to search</p>
                )}
                {results.map((r, i) => (
                  <motion.button
                    key={`${r.id}-${i}`}
                    onClick={() => { navigate(r.route); setSearchOpen(false); setQuery('') }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all"
                    style={{ borderBottom: '1px solid rgba(22,163,74,0.06)' }}
                    whileHover={{ background: 'rgba(22,163,74,0.05)' }}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <span className="text-[11px] font-semibold rounded-md px-2 py-0.5 flex-shrink-0 min-w-[44px] text-center"
                      style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)', color: '#4ade80' }}>
                      {r.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-200 text-sm font-medium truncate">{r.primary}</p>
                      {r.secondary && <p className="text-gray-600 text-xs truncate mt-0.5">{r.secondary}</p>}
                    </div>
                  </motion.button>
                ))}
              </div>

              <div className="px-4 py-2 flex gap-4 text-[11px] text-gray-700" style={{ borderTop: '1px solid rgba(22,163,74,0.06)' }}>
                <span>↩ navigate</span>
                <span>Esc close</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
