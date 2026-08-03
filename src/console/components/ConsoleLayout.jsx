import { useState, useEffect, useCallback, Suspense } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Shield, LayoutDashboard, Building2, Users, Settings2,
  ClipboardList, Zap, Megaphone, Lock, LogOut, ChevronDown,
  Globe, Menu, X, AlertTriangle, Layers, Smartphone, Palette, Activity,
  DatabaseBackup, UserCog, History, BellRing, Boxes, HeartPulse, Search, Truck, Trash2, CopyX, FileClock,
  LayoutList, Bug, Wand2, LifeBuoy, Eye, UserX, Brain, ShieldCheck, Sparkles,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import Console2FAModal from './Console2FAModal'
import ThemeToggle from '../../components/ui/ThemeToggle'
import { getCurrentSupportSession, endSupportSession } from '../../lib/api/supportSessions'

/**
 * Grouped, because a flat list of thirty-three links is a list nobody reads.
 * The groups are by WHAT YOU CAME TO DO, not by which table the page reads:
 * someone chasing a bad import does not care that Material Master and Import
 * History are different subsystems.
 *
 * Order is deliberate - the first group is what a console visit is usually for.
 */
const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { to: '/console',               label: 'Dashboard',      icon: LayoutDashboard, end: true },
      { to: '/console/control-center', label: 'Data Trust & Control', icon: ShieldCheck },
      { to: '/console/health',        label: 'System Health',  icon: Activity },
      { to: '/console/crash-reports', label: 'Crash Reports',  icon: Bug },
    ],
  },
  {
    label: 'Data and imports',
    items: [
      { to: '/console/data-ops',        label: 'Data Operations',  icon: Layers },
      { to: '/console/import-history',  label: 'Import History',   icon: FileClock },
      { to: '/console/smart-import',    label: 'Smart Import',     icon: Wand2 },
      { to: '/console/material-master', label: 'Material Master',  icon: Boxes },
      { to: '/console/classification-learning', label: 'Teach the Classifier', icon: Brain },
      { to: '/console/data-learning', label: 'Data Learning', icon: Sparkles },
      { to: '/console/metric-catalogue', label: 'Metric Catalogue', icon: LayoutList },
      { to: '/console/duplicates',      label: 'Duplicate Control', icon: CopyX },
      { to: '/console/data-browser',    label: 'Data Browser',     icon: Search },
      { to: '/console/data-cleanup',    label: 'Data Cleanup',     icon: Trash2 },
      { to: '/console/backups',         label: 'Backups',          icon: DatabaseBackup },
    ],
  },
  {
    label: 'People and access',
    items: [
      { to: '/console/users',             label: 'Users',            icon: Users },
      { to: '/console/access',            label: 'Access Control',   icon: Lock },
      { to: '/console/admin-roles',       label: 'Admin Roles',      icon: UserCog },
      { to: '/console/organisations',     label: 'Organisations',    icon: Building2 },
      { to: '/console/sessions',          label: 'Sessions & Devices', icon: Smartphone },
      { to: '/console/support-sessions',  label: 'Support Sessions', icon: LifeBuoy },
      { to: '/console/account-deletions', label: 'Account Deletions', icon: UserX },
    ],
  },
  {
    label: 'Automation and alerts',
    items: [
      { to: '/console/alert-rules',  label: 'Alert Rules',       icon: BellRing },
      { to: '/console/automation',   label: 'Automation Health', icon: Activity },
      { to: '/console/delivery',     label: 'Delivery & Alerts', icon: BellRing },
      { to: '/console/self-healing', label: 'Self-Healing',      icon: HeartPulse },
      { to: '/console/announcements', label: 'Announcements',    icon: Megaphone },
    ],
  },
  {
    label: 'AI',
    items: [
      { to: '/console/ai-usage', label: 'AI Usage', icon: Zap },
      { to: '/console/ai-admin', label: 'AI Admin', icon: Zap },
    ],
  },
  {
    label: 'Audit and security',
    items: [
      { to: '/console/audit-trail', label: 'Audit Trail', icon: History },
      { to: '/console/audit',       label: 'Audit Log',   icon: ClipboardList },
      { to: '/console/security',    label: 'Security',    icon: AlertTriangle },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { to: '/console/config',           label: 'System Config',    icon: Settings2 },
      { to: '/console/system',           label: 'System',           icon: Settings2 },
      { to: '/console/module-control',   label: 'Module Control',   icon: Boxes },
      { to: '/console/navigation',       label: 'Navigation',       icon: LayoutList },
      { to: '/console/appearance',       label: 'Report Colors',    icon: Palette },
      { to: '/console/vehicle-designer', label: 'Vehicle Designer', icon: Truck },
    ],
  },
]

/** Filter the groups by a typed term, dropping groups that end up empty. */
function filterGroups(groups, term) {
  const q = String(term || '').trim().toLowerCase()
  if (!q) return groups
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length)
}


export default function ConsoleLayout() {
  const { admin, signOut, activeOrg, setActiveOrg, orgs } = useConsoleAuth()
  const navigate  = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [navFilter, setNavFilter]     = useState('')
  // A collapsed sidebar has no filter box, so it must never render a filtered set.
  const visibleGroups = sidebarOpen ? filterGroups(NAV_GROUPS, navFilter) : NAV_GROUPS
  const [orgOpen, setOrgOpen]         = useState(false)
  const [show2FA, setShow2FA]         = useState(false)
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
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className={`${sidebarOpen ? 'w-56' : 'w-14'} flex-shrink-0 flex flex-col border-r border-gray-800/80 transition-all duration-200 bg-gray-950`}>
        {/* Logo */}
        <div className="h-14 flex items-center px-3 border-b border-gray-800/80 gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.3)' }}>
            <Shield size={16} className="text-orange-400" />
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">System Console</p>
              <p className="text-[10px] text-orange-400 font-semibold">RESTRICTED</p>
            </div>
          )}
          <button onClick={() => setSidebarOpen(s => !s)} className="ml-auto text-gray-600 hover:text-gray-300 flex-shrink-0">
            {sidebarOpen ? <X size={14} /> : <Menu size={14} />}
          </button>
        </div>

        {/* Org picker */}
        {sidebarOpen && (
          <div className="px-3 py-2 border-b border-gray-800/80">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Viewing</p>
            <button onClick={() => setOrgOpen(o => !o)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-800/60 hover:bg-gray-800 transition-colors text-left">
              <Globe size={12} className="text-orange-400 flex-shrink-0" />
              <span className="text-xs text-gray-200 flex-1 truncate">{activeOrg?.name ?? 'All Organisations'}</span>
              <ChevronDown size={11} className={`text-gray-500 transition-transform ${orgOpen ? 'rotate-180' : ''}`} />
            </button>
            {orgOpen && (
              <div className="mt-1 rounded-lg bg-gray-800 border border-gray-700 overflow-hidden shadow-xl">
                <button onClick={() => { setActiveOrg(null); setOrgOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-700 transition-colors ${!activeOrg ? 'text-orange-300 font-semibold' : 'text-gray-300'}`}>
                  All Organisations
                </button>
                {orgs.map(o => (
                  <button key={o.id} onClick={() => { setActiveOrg(o); setOrgOpen(false) }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-700 transition-colors truncate ${activeOrg?.id === o.id ? 'text-orange-300 font-semibold' : 'text-gray-300'}`}>
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
                className="w-full pl-7 pr-6 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-[11px] text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none"
              />
              {navFilter && (
                <button onClick={() => setNavFilter('')} title="Clear"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300">
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
        )}
        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {visibleGroups.length === 0 && sidebarOpen && (
            <p className="text-[11px] text-gray-600 px-2 py-4 text-center">No page matches that.</p>
          )}
          {visibleGroups.map(group => (
            <div key={group.label} className="mb-3 last:mb-0">
              {sidebarOpen && (
                <p className="px-2.5 pb-1 text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const Icon = item.icon
                  return (
                    <NavLink key={item.to} to={item.to} end={item.end} title={item.label}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all text-xs font-medium group ${
                          isActive
                            ? 'bg-orange-950/60 text-orange-300 border border-orange-800/40'
                            : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/60'
                        }`
                      }>
                      <Icon size={15} className="flex-shrink-0" />
                      {sidebarOpen && <span className="truncate">{item.label}</span>}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Admin info + sign out */}
        <div className="border-t border-gray-800/80 p-3">
          {sidebarOpen ? (
            <div className="mb-2 px-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-300 font-medium truncate">{admin?.full_name ?? 'Super Admin'}</p>
                <p className="text-[10px] text-gray-600 truncate">{admin?.email ?? ''}</p>
              </div>
              <ThemeToggle size={15} className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-500 hover:text-orange-400 hover:bg-orange-400/10 transition-colors flex-shrink-0" />
            </div>
          ) : (
            <div className="mb-1 flex justify-center">
              <ThemeToggle size={15} className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-500 hover:text-orange-400 hover:bg-orange-400/10 transition-colors" />
            </div>
          )}
          <button onClick={() => setShow2FA(true)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-blue-400 hover:bg-blue-950/20 transition-colors mb-0.5"
            title="Two-Factor Authentication">
            <Smartphone size={14} className="flex-shrink-0" />
            {sidebarOpen && '2FA Security'}
          </button>
          <button onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-red-950/20 transition-colors">
            <LogOut size={14} className="flex-shrink-0" />
            {sidebarOpen && 'Sign Out'}
          </button>
        </div>
      </aside>
      {show2FA && <Console2FAModal onClose={() => setShow2FA(false)} />}

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 flex-shrink-0 border-b border-gray-800/80 flex items-center px-6 gap-4 bg-gray-950/50">
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
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </div>
          </div>
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
            <button onClick={handleEndSupport} disabled={endingSupport}
              className="ml-auto px-2 py-0.5 rounded-md text-[11px] font-semibold text-white bg-red-600/80 hover:bg-red-600 disabled:opacity-40">
              {endingSupport ? 'Ending...' : 'End'}
            </button>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
