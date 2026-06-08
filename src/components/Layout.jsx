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
  Cpu, MapPin, Activity, GitMerge, CalendarClock, Trophy, BarChartBig, Microscope, Bot,
  TrendingUp, BookOpen, Zap, Database, Wrench, Calendar,
  Target, ShoppingCart, HeartPulse, RefreshCw, Clock, Gauge, Fuel,
  RotateCcw, AlertCircle, ArrowLeftRight, FileWarning, LayoutGrid, Coffee,
  Recycle, Radio, PackagePlus,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { detectAlerts, countAlertsBySeverity } from '../lib/alertEngine'
import TpLogo from '../assets/logo.svg'
import InstallPwaPrompt from './InstallPwaPrompt'
import NotificationCenter from './NotificationCenter'
import GlobalSearch from './GlobalSearch'

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
      { to: '/fleet-master',        label: 'Fleet Master',        icon: Truck },
      { to: '/assets',              label: 'Asset Management',    icon: LayoutGrid },
      { to: '/stock',               label: 'Stock',               icon: Package },
      { to: '/budgets',             label: 'Budgets',             icon: DollarSign },
      { to: '/actions',             label: 'Corrective Actions',  icon: ClipboardList },
      { to: '/accidents',           label: 'Accidents',           icon: AlertOctagon },
      { to: '/rca',                 label: 'Root Cause',          icon: Search },
      { to: '/inspections',         label: 'Inspections',         icon: ClipboardCheck },
      { to: '/inspection-planner',  label: 'Inspection Planner',  icon: CalendarClock },
      { to: '/warranty',            label: 'Warranty Tracker',    icon: ShieldCheck },
      { to: '/work-orders',         label: 'Work Orders',         icon: Wrench },
      { to: '/gate-pass',           label: 'Gate Pass',           icon: ShieldCheck },
      { to: '/scrap',               label: 'Scrap Management',    icon: FileWarning },
      { to: '/stock-replenishment', label: 'Stock Replenishment', icon: PackagePlus },
      { to: '/reports',             label: 'Reports',             icon: FileText },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/kpi-engine',              label: 'Engineering KPIs',        icon: Cpu },
      { to: '/kpi-command',            label: 'KPI Command Center',      icon: LayoutGrid },
      { to: '/position-intelligence',   label: 'Position Intelligence',   icon: MapPin },
      { to: '/pressure-intel',          label: 'Pressure Intelligence',   icon: Gauge },
      { to: '/inspection-intelligence', label: 'Inspection Intelligence', icon: Activity },
      { to: '/root-cause',              label: 'Root Cause Engine',       icon: GitMerge },
      { to: '/predictive-maintenance',  label: 'Predictive Maintenance',  icon: CalendarClock },
      { to: '/vendor-intelligence',     label: 'Vendor Intelligence',     icon: Trophy },
      { to: '/driver-management',       label: 'Driver Intelligence',     icon: Users },
      { to: '/fleet-intelligence',      label: 'Fleet Intelligence',      icon: BarChartBig },
      { to: '/fleet-health',            label: 'Fleet Health Board',      icon: HeartPulse },
      { to: '/advanced-analytics',      label: 'Advanced Analytics',      icon: Microscope },
      { to: '/ai-command-center',       label: 'AI Command Center',       icon: Bot },
      { to: '/executive-report',        label: 'Executive Report',        icon: BookOpen },
      { to: '/forecasting',             label: 'Forecasting Engine',      icon: TrendingUp },
      { to: '/cost-center',             label: 'Cost Center',             icon: DollarSign },
      { to: '/benchmark',               label: 'Performance Benchmark',   icon: Target },
      { to: '/procurement',             label: 'Procurement',             icon: ShoppingCart },
      { to: '/suppliers',               label: 'Supplier Management',     icon: Users },
      { to: '/tyre-size',               label: 'Size Optimizer',          icon: Layers },
      { to: '/tyre-lifecycle',          label: 'Tyre Lifecycle',          icon: RefreshCw },
      { to: '/tyre-exchange',           label: 'Tyre Exchange',           icon: ArrowLeftRight },
      { to: '/tyre-specs',              label: 'Tyre Specifications',     icon: FileWarning },
      { to: '/rotation',                label: 'Rotation Schedule',       icon: RotateCcw },
      { to: '/recall-tracker',          label: 'Recall Tracker',          icon: AlertCircle },
      { to: '/fuel-efficiency',         label: 'Fuel Efficiency',         icon: Fuel },
      { to: '/workshop',                label: 'Workshop Management',     icon: Wrench },
      { to: '/downtime',                label: 'Downtime Tracker',        icon: Clock },
      { to: '/budget-planner',          label: 'Budget Planner',          icon: DollarSign },
      { to: '/daily-ops',               label: 'Daily Ops',               icon: Coffee },
      { to: '/continuous-improvement',  label: 'Continuous Improvement',  icon: Zap },
      { to: '/erp-sync',                label: 'ERP Sync',                icon: Database },
      { to: '/maintenance-calendar',    label: 'Maintenance Calendar',    icon: Calendar },
      { to: '/safety-compliance',       label: 'Safety & Compliance',     icon: ShieldCheck },
      { to: '/live-fleet',              label: 'Live Fleet Status',       icon: Radio },
      { to: '/compliance',              label: 'Compliance Dashboard',    icon: Shield },
      { to: '/retread',                 label: 'Retread Management',      icon: Recycle },
      { to: '/alerts',          label: 'Alerts',          icon: Bell },
      { to: '/anomalies',       label: 'Anomaly Scan',    icon: AlertTriangle, adminOnly: true },
      { to: '/vehicle-history', label: 'Vehicle History', icon: Car,           adminOnly: true },
      { to: '/serial-tracker',  label: 'Serial Tracker',  icon: ScanLine },
      { to: '/ai',              label: 'Smart Analytics', icon: Sparkles,      adminOnly: true },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/cleaning', label: 'Data Cleaning', icon: Wand2,         adminOnly: true },
      { to: '/upload',   label: 'Upload Data',   icon: Upload },
      { to: '/audit',    label: 'Audit Trail',   icon: ClipboardList, adminOnly: true },
      { to: '/settings', label: 'Settings',      icon: Settings },
    ],
  },
]

function shouldShowNavItem(item, profile) {
  if (profile?.role === 'Inspector') {
    return item.to === '/inspections' || item.to === '/settings'
  }
  if (item.adminOnly) return profile?.role === 'Admin'
  return true
}

function roleBadgeClass(role) {
  switch (role) {
    case 'Admin':     return 'bg-red-900/40 text-red-300 border border-red-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    case 'Manager':   return 'bg-orange-900/40 text-orange-300 border border-orange-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    case 'Inspector': return 'bg-purple-900/40 text-purple-300 border border-purple-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    case 'Director':  return 'bg-blue-900/40 text-blue-300 border border-blue-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    case 'Tyre Man':  return 'bg-teal-900/40 text-teal-300 border border-teal-700/30 text-[10px] px-2 py-0.5 rounded-full font-semibold'
    default:          return 'bg-gray-800/60 text-gray-400 text-[10px] px-2 py-0.5 rounded-full font-semibold'
  }
}

function TyreManShell({ children }) {
  const { signOut, profile } = useAuth()
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>
      <header className="border-b px-4 py-3 flex items-center justify-between backdrop-blur-xl"
        style={{
          background: 'rgba(3,8,5,0.95)',
          borderBottomColor: 'rgba(22,163,74,0.12)',
          boxShadow: '0 1px 20px rgba(0,0,0,0.4)',
        }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.25)' }}>
            <img src={TpLogo} alt="" className="w-4 h-4" />
          </div>
          <span className="font-bold text-white text-sm tracking-tight">TyrePulse</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{profile?.full_name}</span>
          <button onClick={signOut} className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10">
            Sign out
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-auto p-4">{children}</main>
    </div>
  )
}

const SEARCH_TABLES = [
  { table: 'tyre_records',       fields: ['serial_no','asset_no','brand','site','description'],  label: 'Tyre',   route: '/tyres' },
  { table: 'corrective_actions', fields: ['title','site','assigned_to','asset_no'],              label: 'Action', route: '/actions' },
  { table: 'rca_records',        fields: ['asset_no','tyre_serial','brand','site','root_cause'], label: 'RCA',    route: '/rca' },
  { table: 'stock_records',      fields: ['site','description'],                                  label: 'Stock',  route: '/stock' },
]

const SIDEBAR_EXPANDED = 240
const SIDEBAR_COLLAPSED = 54

export default function Layout({ children }) {
  const { profile, signOut }                = useAuth()
  const { activeCountry, setActiveCountry } = useSettings()
  const { theme, toggleTheme }              = useTheme()
  const navigate     = useNavigate()
  const location     = useLocation()
  const [sidebarOpen, setSidebarOpen]         = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const [searchOpen, setSearchOpen]           = useState(false)
  const [query, setQuery]                     = useState('')
  const [results, setResults]                 = useState([])
  const [searching, setSearching]             = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [alertCount, setAlertCount]           = useState(0)
  const [hoveredItem, setHoveredItem]         = useState(null)

  function toggleGroup(label) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const searchRef   = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (window.innerWidth >= 1024) setSidebarOpen(true)
  }, [location.pathname])

  useEffect(() => {
    async function fetchAlertCount() {
      try {
        const country = activeCountry !== 'All' ? activeCountry : null
        const found   = await detectAlerts(supabase, country)
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setGlobalSearchOpen(v => !v) }
      if (e.key === 'Escape') { setGlobalSearchOpen(false); setSearchOpen(false); setQuery('') }
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
    `flex-1 py-1 text-[10px] font-bold rounded-md transition-all duration-200 ${
      activeCountry === c
        ? 'text-white shadow-sm'
        : 'text-gray-600 hover:text-gray-400'
    }`
  const pillStyle = (c) => activeCountry === c
    ? { background: 'linear-gradient(135deg, #15803d, #16a34a)', boxShadow: '0 0 12px rgba(22,163,74,0.35)' }
    : {}

  if (profile?.role === 'Tyre Man') {
    return <TyreManShell>{children}</TyreManShell>
  }

  const navItemVariants = {
    hidden: { opacity: 0, x: -8 },
    visible: { opacity: 1, x: 0 },
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'transparent' }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <motion.aside
        className="flex-shrink-0 flex flex-col relative z-20"
        animate={{ width: sidebarOpen ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        style={{ overflow: 'hidden' }}
      >
        {/* subtle inner glow at bottom of sidebar */}
        <div className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
          style={{ background: 'linear-gradient(0deg, rgba(22,163,74,0.04) 0%, transparent 100%)' }} />

        {/* ── Logo row ──────────────────────────────────────────────────────── */}
        <div
          className={`flex items-center h-[52px] px-3 flex-shrink-0 ${!sidebarOpen ? 'justify-center' : ''}`}
          style={{ borderBottom: '1px solid rgba(22,163,74,0.1)' }}
        >
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {/* logo mark */}
            <div
              className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center relative"
              style={{
                background: 'linear-gradient(135deg, rgba(22,163,74,0.18) 0%, rgba(22,163,74,0.08) 100%)',
                border: '1px solid rgba(22,163,74,0.3)',
                boxShadow: '0 0 20px rgba(22,163,74,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
              }}
            >
              <img src={TpLogo} alt="" style={{ width: 18, height: 18 }} />
              {/* pulse ring */}
              <div className="absolute inset-0 rounded-xl animate-ping-green opacity-0 group-hover:opacity-100"
                style={{ background: 'rgba(22,163,74,0.15)' }} />
            </div>

            <AnimatePresence>
              {sidebarOpen && (
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="min-w-0"
                >
                  <span
                    className="font-extrabold text-[15px] tracking-tight whitespace-nowrap leading-none block"
                    style={{
                      background: 'linear-gradient(135deg, #ffffff 25%, #86efac 75%, #4ade80 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                    }}
                  >
                    TyrePulse
                  </span>
                  <span className="text-[9px] text-gray-600 tracking-[0.12em] uppercase font-medium">
                    Fleet Intelligence
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-gray-600 hover:text-green-400 transition-all duration-200 hover:bg-green-400/10"
          >
            <motion.div animate={{ rotate: sidebarOpen ? 0 : 180 }} transition={{ duration: 0.22 }}>
              {sidebarOpen ? <X size={13} /> : <Menu size={13} />}
            </motion.div>
          </button>
        </div>

        {/* ── Search + Country ───────────────────────────────────────────────── */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              style={{ overflow: 'hidden' }}
            >
              {/* Search */}
              <div className="px-2.5 pt-3 pb-1">
                <button
                  onClick={() => setGlobalSearchOpen(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-gray-500 hover:text-green-400 transition-all duration-200 text-xs group"
                  style={{
                    background: 'rgba(22,163,74,0.04)',
                    border: '1px solid rgba(22,163,74,0.1)',
                  }}
                >
                  <Search size={11} className="flex-shrink-0 group-hover:text-green-400 transition-colors" />
                  <span className="flex-1 text-left font-medium">Search…</span>
                  <kbd className="text-[9px] px-1.5 py-0.5 rounded-md font-mono text-gray-600"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    ⌘K
                  </kbd>
                </button>
              </div>

              {/* Country selector */}
              {(profile?.role === 'Admin' || !profile?.country || profile.country.length === 0) && (
                <div className="px-2.5 pb-1">
                  <p className="nav-section px-0.5 pt-2 pb-1.5">Country</p>
                  <div className="flex gap-0.5 rounded-xl p-0.5"
                    style={{ background: 'rgba(22,163,74,0.04)', border: '1px solid rgba(22,163,74,0.09)' }}>
                    <button className={pillClass('All')} style={pillStyle('All')} onClick={() => setActiveCountry('All')}>All</button>
                    {COUNTRIES.map(c => (
                      <button key={c} className={pillClass(c)} style={pillStyle(c)} onClick={() => setActiveCountry(c)}>
                        {COUNTRY_LABEL[c]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Nav ────────────────────────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto py-1.5 px-2" style={{ scrollbarWidth: 'thin' }}>
          {NAV_GROUPS.map(({ label, items }) => {
            const visibleItems = items.filter(item => shouldShowNavItem(item, profile))
            if (visibleItems.length === 0) return null
            const isCollapsed = collapsedGroups.has(label)
            return (
              <div key={label} className="mb-0.5">
                {sidebarOpen && (
                  <button
                    onClick={() => toggleGroup(label)}
                    className="w-full flex items-center justify-between px-2.5 pt-3 pb-1.5 group/sec cursor-pointer"
                  >
                    <span className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-gray-700 group-hover/sec:text-gray-500 transition-colors">
                      {label}
                    </span>
                    <motion.div
                      animate={{ rotate: isCollapsed ? -90 : 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      <ChevronDown size={9} className="text-gray-700 group-hover/sec:text-gray-500 transition-colors" />
                    </motion.div>
                  </button>
                )}

                <AnimatePresence initial={false}>
                  {(!isCollapsed || !sidebarOpen) && (
                    <motion.div
                      key={label + '-items'}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      {visibleItems.map(({ to, label: lbl, icon: Icon, end }) => (
                        <NavLink
                          key={to}
                          to={to}
                          end={end}
                          title={!sidebarOpen ? lbl : undefined}
                          onMouseEnter={() => setHoveredItem(to)}
                          onMouseLeave={() => setHoveredItem(null)}
                          className={({ isActive }) =>
                            `relative flex items-center gap-2.5 px-2.5 py-[6.5px] rounded-xl text-[12.5px] font-medium
                             transition-all duration-150 mb-px group
                             ${!sidebarOpen ? 'justify-center' : ''}
                             ${isActive ? 'text-green-300' : 'text-gray-600 hover:text-gray-200'}`
                          }
                          style={({ isActive }) => isActive ? {
                            background: 'linear-gradient(135deg, rgba(22,163,74,0.16) 0%, rgba(22,163,74,0.07) 100%)',
                            border: '1px solid rgba(22,163,74,0.24)',
                            boxShadow: '0 0 18px rgba(22,163,74,0.1), inset 0 1px 0 rgba(22,163,74,0.05)',
                          } : {
                            border: '1px solid transparent',
                          }}
                        >
                          {({ isActive }) => (
                            <>
                              {/* active indicator bar */}
                              {isActive && (
                                <motion.span
                                  layoutId="activeBar"
                                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[52%] rounded-r-full"
                                  style={{
                                    background: 'linear-gradient(180deg, #86efac, #22c55e, #15803d)',
                                    boxShadow: '0 0 10px rgba(74,222,128,0.8)',
                                  }}
                                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                                />
                              )}

                              <Icon
                                size={13.5}
                                strokeWidth={isActive ? 2.2 : 1.8}
                                className={`flex-shrink-0 transition-colors duration-150 ${
                                  isActive
                                    ? 'text-green-400'
                                    : 'text-gray-600 group-hover:text-gray-300'
                                }`}
                              />

                              {sidebarOpen && (
                                <span className="truncate leading-none">{lbl}</span>
                              )}

                              {to === '/alerts' && alertCount > 0 && (
                                <span
                                  className={`${sidebarOpen ? 'ml-auto' : 'absolute -top-0.5 -right-0.5'} text-[9.5px] font-bold bg-red-600 text-white rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-1`}
                                  style={{ boxShadow: '0 0 10px rgba(239,68,68,0.7)' }}
                                >
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

          {/* Admin group */}
          {profile?.role === 'Admin' && (() => {
            const adminCollapsed = collapsedGroups.has('Admin')
            return (
              <div className="mb-0.5">
                {sidebarOpen && (
                  <button
                    onClick={() => toggleGroup('Admin')}
                    className="w-full flex items-center justify-between px-2.5 pt-3 pb-1.5 group/sec cursor-pointer"
                  >
                    <span className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-gray-700 group-hover/sec:text-gray-500 transition-colors">
                      Admin
                    </span>
                    <motion.div animate={{ rotate: adminCollapsed ? -90 : 0 }} transition={{ duration: 0.18 }}>
                      <ChevronDown size={9} className="text-gray-700 group-hover/sec:text-gray-500 transition-colors" />
                    </motion.div>
                  </button>
                )}
                <AnimatePresence initial={false}>
                  {(!adminCollapsed || !sidebarOpen) && (
                    <motion.div
                      key="admin-items"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <NavLink
                        to="/users"
                        title={!sidebarOpen ? 'User Management' : undefined}
                        className={({ isActive }) =>
                          `relative flex items-center gap-2.5 px-2.5 py-[6.5px] rounded-xl text-[12.5px] font-medium
                           transition-all duration-150 mb-px group
                           ${!sidebarOpen ? 'justify-center' : ''}
                           ${isActive ? 'text-green-300' : 'text-gray-600 hover:text-gray-200'}`
                        }
                        style={({ isActive }) => isActive ? {
                          background: 'linear-gradient(135deg, rgba(22,163,74,0.16) 0%, rgba(22,163,74,0.07) 100%)',
                          border: '1px solid rgba(22,163,74,0.24)',
                          boxShadow: '0 0 18px rgba(22,163,74,0.1)',
                        } : { border: '1px solid transparent' }}
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[52%] rounded-r-full"
                                style={{ background: 'linear-gradient(180deg,#86efac,#22c55e)', boxShadow: '0 0 10px rgba(74,222,128,0.8)' }} />
                            )}
                            <Users size={13.5} strokeWidth={isActive ? 2.2 : 1.8}
                              className={`flex-shrink-0 ${isActive ? 'text-green-400' : 'text-gray-600 group-hover:text-gray-300'}`} />
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

        {/* ── User footer ────────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 p-2.5"
          style={{ borderTop: '1px solid rgba(22,163,74,0.09)' }}
        >
          <div className={`flex items-center gap-2 ${!sidebarOpen ? 'flex-col' : ''}`}>
            {/* avatar */}
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0 cursor-default"
              style={{
                background: 'linear-gradient(135deg, #16a34a, #15803d)',
                boxShadow: '0 0 14px rgba(22,163,74,0.45)',
                border: '1px solid rgba(22,163,74,0.4)',
              }}
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
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <p className="text-[11.5px] font-semibold text-gray-300 truncate leading-none">
                      {profile?.full_name ?? profile?.username ?? 'User'}
                    </p>
                    {profile?.role && (
                      <span className={`flex-shrink-0 leading-none ${roleBadgeClass(profile.role)}`}>
                        {profile.role}
                      </span>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* actions */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-600 hover:text-green-400 transition-all duration-200 hover:bg-green-400/10"
              >
                {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
              </button>
              <NotificationCenter />
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-600 hover:text-red-400 transition-all duration-200 hover:bg-red-400/10"
              >
                <LogOut size={13} />
              </button>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="p-5 max-w-screen-2xl mx-auto"
        >
          {children}
        </motion.div>
      </main>

      {/* PWA */}
      <InstallPwaPrompt />

      {/* Global search */}
      <GlobalSearch isOpen={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />

      {/* ── Search palette ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => { setSearchOpen(false); setQuery('') }}
          >
            <motion.div
              className="w-full max-w-xl overflow-hidden"
              style={{
                background: 'linear-gradient(145deg, rgba(6,13,8,0.99) 0%, rgba(3,8,5,0.99) 100%)',
                border: '1px solid rgba(22,163,74,0.28)',
                borderRadius: 20,
                boxShadow: '0 0 80px rgba(22,163,74,0.16), 0 32px 100px rgba(0,0,0,0.85)',
              }}
              initial={{ scale: 0.95, y: -16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: -16 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              onClick={e => e.stopPropagation()}
            >
              {/* top glow line */}
              <div className="h-px" style={{ background: 'linear-gradient(90deg,transparent,rgba(22,163,74,0.65) 40%,rgba(74,222,128,0.8) 50%,rgba(22,163,74,0.65) 60%,transparent)' }} />

              {/* input */}
              <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid rgba(22,163,74,0.1)' }}>
                <Search size={14} className="text-green-600 flex-shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  className="flex-1 bg-transparent text-white placeholder-gray-600 focus:outline-none text-sm font-medium"
                  placeholder="Search tyres, actions, RCA, stock…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
                {searching && <span className="text-[11px] text-gray-600 animate-pulse font-medium">Searching</span>}
                <kbd
                  className="text-[11px] text-gray-600 px-1.5 py-0.5 rounded-md cursor-pointer font-mono"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                  onClick={() => { setSearchOpen(false); setQuery('') }}
                >ESC</kbd>
              </div>

              <div className="max-h-72 overflow-y-auto">
                {query.length >= 2 && results.length === 0 && !searching && (
                  <p className="text-gray-600 text-sm text-center py-10">No results for &ldquo;{query}&rdquo;</p>
                )}
                {query.length < 2 && (
                  <p className="text-gray-700 text-xs text-center py-7 font-medium">Type at least 2 characters to search</p>
                )}
                {results.map((r, i) => (
                  <motion.button
                    key={`${r.id}-${i}`}
                    onClick={() => { navigate(r.route); setSearchOpen(false); setQuery('') }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                    style={{ borderBottom: '1px solid rgba(22,163,74,0.05)' }}
                    whileHover={{ background: 'rgba(22,163,74,0.06)' }}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.025 }}
                  >
                    <span className="text-[10px] font-bold rounded-lg px-2 py-0.5 flex-shrink-0 min-w-[44px] text-center"
                      style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.22)', color: '#4ade80' }}>
                      {r.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-200 text-sm font-medium truncate">{r.primary}</p>
                      {r.secondary && <p className="text-gray-600 text-xs truncate mt-0.5">{r.secondary}</p>}
                    </div>
                  </motion.button>
                ))}
              </div>

              <div className="px-4 py-2.5 flex gap-4 text-[10px] text-gray-700 font-medium" style={{ borderTop: '1px solid rgba(22,163,74,0.06)' }}>
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
