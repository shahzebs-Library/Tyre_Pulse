import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, ClipboardCheck, Bell, Layers, Wrench, BarChart2,
  FileText, ScanLine, Menu,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

/**
 * Mobile bottom navigation for the web PWA.
 *
 * Role-based tab sets mirror the native mobile app's tab bar
 * (`mobile/lib/permissions.ts → TAB_BAR`) so the two experiences stay in
 * lockstep. Each role sees its most-used destinations; everything else is one
 * tap away behind the Menu button (opens the full sidebar).
 */

const T = {
  home:      { to: '/',            label: 'Home',    icon: LayoutDashboard, end: true },
  inspect:   { to: '/inspections', label: 'Inspect', icon: ClipboardCheck },
  records:   { to: '/tyres',       label: 'Records', icon: Layers },
  work:      { to: '/work-orders', label: 'Work',    icon: Wrench },
  alerts:    { to: '/alerts',      label: 'Alerts',  icon: Bell },
  scan:      { to: '/scan',        label: 'Scan',    icon: ScanLine },
  analytics: { to: '/analytics',   label: 'Reports', icon: BarChart2 },
  reports:   { to: '/reports',     label: 'Reports', icon: FileText },
}

// Primary tabs per role (max 4; the 5th slot is always the Menu button).
const ROLE_TABS = {
  Admin:      [T.home, T.inspect, T.work, T.analytics],
  Manager:    [T.home, T.inspect, T.work, T.analytics],
  Director:   [T.home, T.analytics, T.alerts, T.reports],
  Inspector:  [T.home, T.inspect, T.records, T.alerts],
  'Tyre Man': [T.inspect, T.records, T.work, T.scan],
  Reporter:   [T.home, T.reports, T.analytics, T.records],
  Driver:     [T.home, T.inspect, T.alerts],
}

export default function MobileBottomNav({ alertCount, onMenuOpen }) {
  const { profile } = useAuth()
  const tabs = ROLE_TABS[profile?.role] ?? ROLE_TABS.Inspector

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-30 md:hidden"
      style={{
        background: 'var(--panel-deep)',
        borderTop: '1px solid var(--border-brand)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: '0 -4px 30px rgba(0,0,0,0.35)',
      }}
    >
      <div className="flex items-stretch h-[54px]">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            style={({ isActive }) => ({ color: isActive ? 'var(--brand-bright)' : 'var(--text-muted)' })}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-200 active:opacity-70"
          >
            {({ isActive }) => (
              <>
                <div className="relative">
                  <Icon size={20} strokeWidth={isActive ? 2.2 : 1.7} />
                  {to === '/alerts' && alertCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] flex items-center justify-center text-[9px] font-bold bg-red-600 text-white rounded-full px-0.5"
                      style={{ boxShadow: '0 0 8px rgba(239,68,68,0.7)' }}
                    >
                      {alertCount > 9 ? '9+' : alertCount}
                    </span>
                  )}
                </div>
                <span className="text-[9.5px] font-semibold tracking-wide">{label}</span>
              </>
            )}
          </NavLink>
        ))}

        <button
          onClick={onMenuOpen}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors active:opacity-70"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Open menu"
        >
          <Menu size={20} strokeWidth={1.7} />
          <span className="text-[9.5px] font-semibold tracking-wide">Menu</span>
        </button>
      </div>
    </nav>
  )
}
