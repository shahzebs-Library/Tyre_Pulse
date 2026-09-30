import { useState, useEffect, useCallback, Suspense } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Shield, LayoutDashboard, Building2, Users, Settings2,
  ClipboardList, Zap, Megaphone, Lock, LogOut, ChevronDown,
  Globe, Menu, X, AlertTriangle, Layers, Smartphone, Palette, Activity,
  DatabaseBackup, UserCog, History, BellRing, Boxes, HeartPulse, Search, Truck, Trash2, CopyX, FileClock,
  LayoutList, Bug, Wand2, LifeBuoy, Eye, UserX, Brain, ShieldCheck, Sparkles, Scale, GitBranch, Rocket,
  Map, Command, UserCheck, Fingerprint, KeyRound, ClipboardCheck, PackageOpen, Siren, Timer, Network,
  Flag, ChevronRight,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import Console2FAModal from './Console2FAModal'
import ThemeToggle from '../../components/ui/ThemeToggle'
import { getCurrentSupportSession, endSupportSession } from '../../lib/api/supportSessions'
import ConsoleCommandPalette from './ConsoleCommandPalette'
import ConsoleTopBarActions from './ConsoleTopBarActions'

/**
 * The Control Center sidebar: five AREAS (Monitor, Platform, Trust, Runtime,
 * Engineering), each split into SECTIONS by what you came to do. Every console
 * route is listed exactly once; nothing was removed when the areas replaced
 * the old seven flat groups, and every route is unchanged.
 *
 * `section` groups consecutive items under a collapsible sub-heading. Items
 * are still written as plain object literals because the module
 * coverage test reads this file as text to prove every route has an entry.
 */
export const NAV_GROUPS = [
  {
    label: 'Monitor',
    items: [
      { to: '/console',               label: 'Overview',        icon: LayoutDashboard, end: true, section: 'Overview' },
      { to: '/console/health',        label: 'System Health',   icon: Activity,        section: 'Overview' },
      { to: '/console/platform-map',  label: 'Platform Map',    icon: Map,             section: 'Overview' },
      { to: '/console/incidents',     label: 'Incidents',       icon: Siren,           section: 'Alert Center' },
      { to: '/console/alert-rules',   label: 'Alert Rules',     icon: BellRing,        section: 'Alert Center' },
      { to: '/console/trust-alerts',  label: 'Trust Alerts',    icon: BellRing,        section: 'Alert Center' },
      { to: '/console/self-healing',  label: 'Self-Healing',    icon: HeartPulse,      section: 'Alert Center' },
      { to: '/console/ai-usage',      label: 'AI Usage',        icon: Zap,             section: 'Analytics' },
      { to: '/console/metric-catalogue', label: 'Metric Catalogue', icon: LayoutList,  section: 'Analytics' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/console/users',             label: 'Users',              icon: Users,       section: 'Users' },
      { to: '/console/sessions',          label: 'Sessions & Devices', icon: Smartphone,  section: 'Users' },
      { to: '/console/support-sessions',  label: 'Support Sessions',   icon: LifeBuoy,    section: 'Users' },
      { to: '/console/account-deletions', label: 'Account Deletions',  icon: UserX,       section: 'Users' },
      { to: '/console/organisations',     label: 'Organizations',      icon: Building2,   section: 'Organizations' },
      { to: '/console/tenant-export',     label: 'Tenant Export',      icon: PackageOpen, section: 'Organizations' },
      { to: '/console/data-ops',          label: 'Data Operations',    icon: Layers,      section: 'Operations' },
      { to: '/console/import-history',    label: 'Import History',     icon: FileClock,   section: 'Operations' },
      { to: '/console/smart-import',      label: 'Smart Import',       icon: Wand2,       section: 'Operations' },
      { to: '/console/material-master',   label: 'Material Master',    icon: Boxes,       section: 'Operations' },
      { to: '/console/classification-learning', label: 'Teach the Classifier', icon: Brain, section: 'Operations' },
      { to: '/console/data-learning',     label: 'Data Learning',      icon: Sparkles,    section: 'Operations' },
      { to: '/console/duplicates',        label: 'Duplicate Control',  icon: CopyX,       section: 'Operations' },
      { to: '/console/data-cleanup',      label: 'Data Cleanup',       icon: Trash2,      section: 'Operations' },
    ],
  },
  {
    label: 'Trust',
    items: [
      { to: '/console/access',            label: 'Access Control',   icon: Lock,           section: 'Access Control' },
      { to: '/console/access-reviews',    label: 'Access Reviews',   icon: UserCheck,      section: 'Access Control' },
      { to: '/console/jit-elevation',     label: 'JIT Elevation',    icon: Timer,          section: 'Access Control' },
      { to: '/console/access-policies',   label: 'Access Policies',  icon: Network,        section: 'Access Control' },
      { to: '/console/approvals',         label: 'Approvals',        icon: Scale,          section: 'Access Control' },
      { to: '/console/security-audit',    label: 'Security Audit',   icon: ShieldCheck,    section: 'Security' },
      { to: '/console/security',          label: 'Sign-in & SSO',    icon: AlertTriangle,  section: 'Security' },
      { to: '/console/compliance',        label: 'Compliance',       icon: ClipboardCheck, section: 'Security' },
      { to: '/console/audit-trail',       label: 'Audit Trail',      icon: History,        section: 'Audit Logs' },
      { to: '/console/audit-integrity',   label: 'Audit Integrity',  icon: Fingerprint,    section: 'Audit Logs' },
    ],
  },
  {
    label: 'Runtime',
    items: [
      { to: '/console/delivery',          label: 'Delivery & Alerts', icon: BellRing,       section: 'Notifications' },
      { to: '/console/announcements',     label: 'Announcements',     icon: Megaphone,      section: 'Notifications' },
      { to: '/console/api-keys',          label: 'API Monitor',       icon: KeyRound,       section: 'API Monitor' },
      { to: '/console/data-browser',      label: 'Data Browser',      icon: Search,         section: 'Database' },
      { to: '/console/backups',           label: 'Backups',           icon: DatabaseBackup, section: 'Database' },
      { to: '/console/control-center',    label: 'Data Trust & Control', icon: ShieldCheck, section: 'Database' },
      { to: '/console/data-quality',      label: 'Data Quality',      icon: ShieldCheck,    section: 'Database' },
      { to: '/console/reconciliation',    label: 'Reconciliation',    icon: Scale,          section: 'Database' },
      { to: '/console/correction-center', label: 'Correction Center', icon: ClipboardList,  section: 'Database' },
      { to: '/console/lineage',           label: 'Lineage Explorer',  icon: GitBranch,      section: 'Database' },
      { to: '/console/crash-reports',     label: 'Error Center',      icon: Bug,            section: 'Error Center' },
    ],
  },
  {
    label: 'Engineering',
    items: [
      { to: '/console/mobile-app',        label: 'Mobile App',        icon: Smartphone, section: 'Developer' },
      { to: '/console/ai-admin',          label: 'AI Admin',          icon: Zap,        section: 'Developer' },
      { to: '/console/automation',        label: 'Automation Health', icon: Activity,   section: 'Developer' },
      { to: '/console/pipeline-monitor',  label: 'Pipeline Monitor',  icon: Activity,   section: 'Developer' },
      { to: '/console/releases',          label: 'Releases',          icon: Rocket,     section: 'Releases' },
      { to: '/console/module-control',    label: 'Feature Flags',     icon: Flag,       section: 'Feature Flags' },
      { to: '/console/config',            label: 'System Config',     icon: Settings2,  section: 'System Settings' },
      { to: '/console/navigation',        label: 'Navigation',        icon: LayoutList, section: 'System Settings' },
      { to: '/console/appearance',        label: 'Report Colors',     icon: Palette,    section: 'System Settings' },
      { to: '/console/vehicle-designer',  label: 'Vehicle Designer',  icon: Truck,      section: 'System Settings' },
    ],
  },
]

/**
 * Split an area's items into consecutive sections. A section holding one item
 * whose label equals the section name renders as a plain link; the rest get a
 * collapsible sub-heading.
 */
export function sectionsOf(items = []) {
  const out = []
  for (const it of items) {
    const name = it.section || it.label
    const last = out[out.length - 1]
    if (last && last.name === name) last.items.push(it)
    else out.push({ name, items: [it] })
  }
  return out
}

// Icon-free descriptor of the console nav for the Platform Map page. Derived
// from NAV_GROUPS so the map can never drift from the real sidebar - a page
// added here automatically appears on the map (and its missing description
// fails the platformMap coverage test until one is written).
export const CONSOLE_NAV = NAV_GROUPS.map((g) => ({
  label: g.label,
  items: g.items.map((it) => ({ to: it.to, label: it.label, section: it.section || null })),
}))

/** Filter the groups by a typed term, dropping groups that end up empty. */
function filterGroups(groups, term) {
  const q = String(term || '').trim().toLowerCase()
  if (!q) return groups
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => `${i.label} ${i.section || ''}`.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length)
}


/** Per-viewer sidebar state (collapsed areas, open sections). Never required. */
function readNavState(key) {
  try { const v = JSON.parse(window.localStorage.getItem(key) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
function writeNavState(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable: state stays in memory */ }
}

function NavItem({ item, sidebarOpen, compact = false }) {
  const Icon = item.icon
  return (
    <NavLink to={item.to} end={item.end} title={item.label}
      aria-label={sidebarOpen ? undefined : item.label}
      className={({ isActive }) =>
        `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 flex items-center gap-2.5 px-2.5 ${compact ? 'py-1.5' : 'py-2'} rounded-lg transition-all text-xs font-medium group ${
          isActive
            ? 'bg-orange-950/60 text-orange-300 border border-orange-800/40'
            : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/60'
        }`
      }>
      {!compact && <Icon size={15} className="flex-shrink-0" aria-hidden="true" />}
      {sidebarOpen && <span className="truncate">{item.label}</span>}
    </NavLink>
  )
}

export default function ConsoleLayout() {
  const { admin, signOut, activeOrg, setActiveOrg, orgs } = useConsoleAuth()
  const navigate  = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [navFilter, setNavFilter]     = useState('')
  // A collapsed sidebar has no filter box, so it must never render a filtered set.
  const visibleGroups = sidebarOpen ? filterGroups(NAV_GROUPS, navFilter) : NAV_GROUPS
  const filtering = sidebarOpen && navFilter.trim() !== ''
  const location = useLocation()
  const [collapsedAreas, setCollapsedAreas] = useState(() => readNavState('tp_console_nav_areas'))
  const [openSections, setOpenSections]     = useState(() => readNavState('tp_console_nav_sections'))
  const isActiveRoute = useCallback((item) => (item.end
    ? location.pathname === item.to || location.pathname === `${item.to}/`
    : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)), [location.pathname])
  const toggleArea = (label) => setCollapsedAreas((prev) => {
    const next = { ...prev, [label]: !prev[label] }
    writeNavState('tp_console_nav_areas', next)
    return next
  })
  const toggleSection = (key, currentlyOpen) => setOpenSections((prev) => {
    const next = { ...prev, [key]: !currentlyOpen }
    writeNavState('tp_console_nav_sections', next)
    return next
  })
  const [orgOpen, setOrgOpen]         = useState(false)
  const [show2FA, setShow2FA]         = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [support, setSupport]         = useState(null)   // active support session
  const [supportNow, setSupportNow]   = useState(() => Date.now())
  const [endingSupport, setEndingSupport] = useState(false)

  const refreshSupport = useCallback(async () => {
    const s = await getCurrentSupportSession()
    setSupport(s)
    setSupportNow(Date.now())
  }, [])

  // Keep the always-visible banner in sync: poll while active, tick the
  // countdown, and re-check when the tab regains focus.
  useEffect(() => {
    refreshSupport()
    const poll = setInterval(refreshSupport, 60000)
    const tick = setInterval(() => setSupportNow(Date.now()), 30000)
    const onFocus = () => refreshSupport()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(poll); clearInterval(tick); window.removeEventListener('focus', onFocus) }
  }, [refreshSupport])

  useEffect(() => {
    const openPalette = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', openPalette)
    return () => window.removeEventListener('keydown', openPalette)
  }, [])

  const supportOrgName = support
    ? (orgs?.find(o => o.id === support.target_org_id)?.name || support.target_org_id)
    : null
  const supportMinsLeft = (() => {
    if (!support?.expires_at) return null
    const t = new Date(support.expires_at).getTime()
    return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - supportNow) / 60000))
  })()

  async function handleEndSupport() {
    if (!support?.id) return
    setEndingSupport(true)
    try { await endSupportSession(support.id) } catch { /* keep banner; page surfaces errors */ }
    setEndingSupport(false)
    refreshSupport()
  }

  async function handleSignOut() {
    await signOut()
    navigate('/console/login', { replace: true })
  }

  return (
    <div className="console-root flex h-screen bg-[#0a0a0f] text-white overflow-hidden">
      <a href="#console-main"
        onClick={(e) => { e.preventDefault(); document.getElementById('console-main')?.focus() }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:px-3 focus:py-2 focus:rounded-lg focus:bg-orange-500 focus:text-black focus:text-xs focus:font-semibold">
        Skip to content
      </a>
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside aria-label="Console navigation" className={`${sidebarOpen ? 'w-56' : 'w-14'} flex-shrink-0 flex flex-col border-r border-gray-800/80 transition-all duration-200 bg-gray-950`}>
        {/* Logo */}
        <div className="h-14 flex items-center px-3 border-b border-gray-800/80 gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.3)' }}>
            <Shield size={16} className="text-orange-400" />
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">Tyre Pulse</p>
              <p className="text-[10px] text-orange-400 font-semibold">CONTROL CENTER</p>
            </div>
          )}
          <button type="button" onClick={() => setSidebarOpen(s => !s)}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} aria-expanded={sidebarOpen}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            className={`ml-auto rounded text-gray-500 hover:text-gray-300 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500`}>
            {sidebarOpen ? <X size={14} aria-hidden="true" /> : <Menu size={14} aria-hidden="true" />}
          </button>
        </div>

        {/* Org picker */}
        {sidebarOpen && (
          <div className="px-3 py-2 border-b border-gray-800/80">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Viewing</p>
            <button type="button" onClick={() => setOrgOpen(o => !o)} aria-expanded={orgOpen} aria-haspopup="listbox"
              aria-label={`Viewing organisation: ${activeOrg?.name ?? 'All Organisations'}`}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-800/60 hover:bg-gray-800 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
              <Globe size={12} className="text-orange-400 flex-shrink-0" />
              <span className="text-xs text-gray-200 flex-1 truncate">{activeOrg?.name ?? 'All Organisations'}</span>
              <ChevronDown size={11} className={`text-gray-500 transition-transform ${orgOpen ? 'rotate-180' : ''}`} />
            </button>
            {orgOpen && (
              <div className="mt-1 rounded-lg bg-gray-800 border border-gray-700 overflow-hidden shadow-xl">
                <button type="button" onClick={() => { setActiveOrg(null); setOrgOpen(false) }} aria-pressed={!activeOrg}
                  className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 w-full text-left px-3 py-2 text-xs hover:bg-gray-700 transition-colors ${!activeOrg ? 'text-orange-300 font-semibold' : 'text-gray-300'}`}>
                  All Organisations
                </button>
                {orgs.map(o => (
                  <button type="button" key={o.id} onClick={() => { setActiveOrg(o); setOrgOpen(false) }} aria-pressed={activeOrg?.id === o.id} title={o.name}
                    className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 w-full text-left px-3 py-2 text-xs hover:bg-gray-700 transition-colors truncate ${activeOrg?.id === o.id ? 'text-orange-300 font-semibold' : 'text-gray-300'}`}>
                    {o.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Nav. Collapsed sidebar drops the group headers and the filter - there
            is no room for either, and the icons stay in the same order. */}
        {sidebarOpen && (
          <div className="px-2 pt-3 pb-1">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
              <input
                value={navFilter}
                onChange={(e) => setNavFilter(e.target.value)}
                placeholder="Find a page"
                aria-label="Find a console page"
                className="w-full pl-7 pr-6 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-[11px] text-gray-200 placeholder-gray-500 focus:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              />
              {navFilter && (
                <button type="button" onClick={() => setNavFilter('')} title="Clear" aria-label="Clear page filter"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded text-gray-500 hover:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
        )}
        <nav aria-label="Console pages" className="flex-1 overflow-y-auto py-2 px-2">
          {visibleGroups.length === 0 && sidebarOpen && (
            <p className="text-[11px] text-gray-500 px-2 py-4 text-center" role="status">No page matches that.</p>
          )}
          {visibleGroups.map(group => {
            const areaOpen = filtering || !collapsedAreas[group.label]
            return (
              <div key={group.label} className="mb-2 last:mb-0">
                {sidebarOpen && (
                  <button type="button" onClick={() => toggleArea(group.label)} aria-expanded={areaOpen}
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 w-full flex items-center gap-1 px-2.5 pb-1 pt-1 rounded text-[10px] uppercase tracking-wider text-gray-500 font-semibold hover:text-gray-300">
                    <span className="flex-1 text-left">{group.label}</span>
                    <ChevronDown size={11} className={`transition-transform ${areaOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
                  </button>
                )}
                {(areaOpen || !sidebarOpen) && (
                  <div className="space-y-0.5">
                    {sidebarOpen ? sectionsOf(group.items).map((sec) => {
                      const single = sec.items.length === 1 && sec.items[0].label === sec.name
                      if (single) return <NavItem key={sec.name} item={sec.items[0]} sidebarOpen />
                      const secKey = `${group.label}/${sec.name}`
                      const hasActive = sec.items.some((i) => isActiveRoute(i))
                      const secOpen = filtering || (openSections[secKey] ?? hasActive)
                      const SecIcon = sec.items[0].icon
                      return (
                        <div key={secKey}>
                          <button type="button" onClick={() => toggleSection(secKey, secOpen)} aria-expanded={secOpen}
                            className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all ${hasActive ? 'text-gray-200' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/60'}`}>
                            <SecIcon size={15} className="flex-shrink-0" aria-hidden="true" />
                            <span className="flex-1 text-left truncate">{sec.name}</span>
                            <span className="text-[10px] text-gray-600 tabular-nums">{sec.items.length}</span>
                            <ChevronRight size={11} className={`transition-transform ${secOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
                          </button>
                          {secOpen && (
                            <div className="ml-4 pl-2 border-l border-gray-800 space-y-0.5 my-0.5">
                              {sec.items.map((item) => <NavItem key={item.to} item={item} sidebarOpen compact />)}
                            </div>
                          )}
                        </div>
                      )
                    }) : group.items.map((item) => <NavItem key={item.to} item={item} sidebarOpen={false} />)}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Admin info + sign out */}
        <div className="border-t border-gray-800/80 p-3">
          {sidebarOpen ? (
            <div className="mb-2 px-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-300 font-medium truncate">{admin?.full_name ?? 'Super Admin'}</p>
                <p className="text-[10px] text-gray-500 truncate" title={admin?.email ?? ''}>{admin?.email ?? ''}</p>
              </div>
              <ThemeToggle size={15} className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-500 hover:text-orange-400 hover:bg-orange-400/10 transition-colors flex-shrink-0" />
            </div>
          ) : (
            <div className="mb-1 flex justify-center">
              <ThemeToggle size={15} className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-500 hover:text-orange-400 hover:bg-orange-400/10 transition-colors" />
            </div>
          )}
          <button type="button" onClick={() => setShow2FA(true)} aria-label={sidebarOpen ? undefined : "Two-Factor Authentication"}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-blue-400 hover:bg-blue-950/20 transition-colors mb-0.5"
            title="Two-Factor Authentication">
            <Smartphone size={14} className="flex-shrink-0" />
            {sidebarOpen && '2FA Security'}
          </button>
          <button type="button" onClick={handleSignOut} aria-label={sidebarOpen ? undefined : "Sign Out"} title="Sign Out"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-red-950/20 transition-colors">
            <LogOut size={14} className="flex-shrink-0" />
            {sidebarOpen && 'Sign Out'}
          </button>
        </div>
      </aside>
      {show2FA && <Console2FAModal onClose={() => setShow2FA(false)} />}
      <ConsoleCommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} groups={NAV_GROUPS} />

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 flex-shrink-0 border-b border-gray-800/80 flex items-center px-3 sm:px-6 gap-2 sm:gap-4 bg-gray-950/50">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30 tracking-wider">CONSOLE</span>
            {activeOrg && (
              <>
                <span className="text-gray-700">/</span>
                <span className="text-xs text-gray-400">{activeOrg.name}</span>
                {activeOrg.locked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-800/40">LOCKED</span>}
              </>
            )}
          </div>
          <button type="button" onClick={() => setCommandOpen(true)}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ml-auto flex min-w-0 sm:min-w-52 items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-1.5 text-xs text-gray-500 hover:border-orange-700/50 hover:text-gray-200"
            aria-label="Open Super Admin command palette">
            <Command size={13} className="text-orange-400" />
            <span className="flex-1 text-left truncate hidden sm:inline">Search all capabilities</span>
            <kbd className="rounded border border-gray-700 px-1.5 py-0.5 text-[9px] text-gray-500">Ctrl K</kbd>
          </button>
          <ConsoleTopBarActions />
        </header>

        {/* Active support-session banner (always visible while a session is open) */}
        {support && (
          <div className="flex-shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 px-6 py-2 bg-orange-600/15 border-b border-orange-700/40 text-xs">
            <Eye size={13} className="text-orange-400 flex-shrink-0" />
            <span className="text-orange-200 font-semibold">Support session active</span>
            <span className="text-orange-300/70">inspecting</span>
            <span className="text-white font-medium">{supportOrgName}</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold border border-orange-700/50 text-orange-200 bg-orange-900/30">
              {support.mode === 'edit' ? 'EDIT' : 'READ ONLY'}
            </span>
            {supportMinsLeft != null && (
              <span className="text-orange-300/70">{supportMinsLeft === 0 ? 'expired' : `ends in ${supportMinsLeft}m`}</span>
            )}
            <button type="button" onClick={handleEndSupport} disabled={endingSupport} aria-label="End support session"
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ml-auto px-2 py-0.5 rounded-md text-[11px] font-semibold text-white bg-red-600/80 hover:bg-red-600 disabled:opacity-40">
              {endingSupport ? 'Ending...' : 'End'}
            </button>
          </div>
        )}

        {/* Page content */}
        <main id="console-main" tabIndex={-1} className="flex-1 overflow-y-auto p-3 sm:p-6 focus:outline-none">
          <Suspense fallback={<div className="p-8 text-sm text-gray-400" role="status">Loading</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
