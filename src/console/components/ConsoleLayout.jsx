import { useState, Suspense } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Shield, LayoutDashboard, Building2, Users, Settings2,
  ClipboardList, Zap, Megaphone, Lock, LogOut, ChevronDown,
  Globe, Menu, X, AlertTriangle, Layers, Smartphone, Palette, Activity,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import Console2FAModal from './Console2FAModal'

const NAV = [
  { to: '/console',              label: 'Dashboard',      icon: LayoutDashboard, end: true },
  { to: '/console/health',       label: 'System Health',  icon: Activity },
  { to: '/console/organisations', label: 'Organisations',  icon: Building2 },
  { to: '/console/users',        label: 'Users',          icon: Users },
  { to: '/console/permissions',  label: 'Permissions',    icon: Layers },
  { to: '/console/access',       label: 'Access Control', icon: Lock },
  { to: '/console/ai-usage',     label: 'AI Usage',       icon: Zap },
  { to: '/console/ai-admin',     label: 'AI Admin',       icon: Zap },
  { to: '/console/audit',        label: 'Audit Log',      icon: ClipboardList },
  { to: '/console/announcements',label: 'Announcements',  icon: Megaphone },
  { to: '/console/security',     label: 'Security',       icon: AlertTriangle },
  { to: '/console/system',       label: 'System',         icon: Settings2 },
  { to: '/console/config',       label: 'System Config',  icon: Settings2 },
  { to: '/console/appearance',   label: 'Report Colors',  icon: Palette },
]

export default function ConsoleLayout() {
  const { admin, signOut, activeOrg, setActiveOrg, orgs } = useConsoleAuth()
  const navigate  = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [orgOpen, setOrgOpen]         = useState(false)
  const [show2FA, setShow2FA]         = useState(false)

  async function handleSignOut() {
    await signOut()
    navigate('/console/login', { replace: true })
  }

  return (
    <div className="flex h-screen bg-[#0a0a0f] text-white overflow-hidden">
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

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
          {NAV.map(item => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={item.end}
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
        </nav>

        {/* Admin info + sign out */}
        <div className="border-t border-gray-800/80 p-3">
          {sidebarOpen && (
            <div className="mb-2 px-2">
              <p className="text-xs text-gray-300 font-medium truncate">{admin?.full_name ?? 'Super Admin'}</p>
              <p className="text-[10px] text-gray-600 truncate">{admin?.email ?? ''}</p>
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
