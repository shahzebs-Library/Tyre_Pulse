import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, ClipboardCheck, Bell, Layers, Wrench, BarChart2,
  FileText, ScanLine, Menu,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'

/**
 * Mobile bottom navigation for the web PWA.
 *
 * Role-based tab sets mirror the native mobile app's tab bar
 * (`mobile/lib/permissions.ts → TAB_BAR`) so the two experiences stay in
 * lockstep. Each role sees its most-used destinations; everything else is one
 * tap away behind the Menu button (opens the full sidebar).
 */

const T = {
  home:      { to: '/',            tk: 'home',     label: 'Home',    icon: LayoutDashboard, end: true },
  inspect:   { to: '/inspections', tk: 'inspect',  label: 'Inspect', icon: ClipboardCheck },
  records:   { to: '/tyres',       tk: 'records',  label: 'Records', icon: Layers },
  work:      { to: '/work-orders', tk: 'work',     label: 'Work',    icon: Wrench },
  alerts:    { to: '/alerts',      tk: 'alerts',   label: 'Alerts',  icon: Bell },
  scan:      { to: '/scan',        tk: 'scan',     label: 'Scan',    icon: ScanLine },
  analytics: { to: '/analytics',   tk: 'analytics',label: 'Reports', icon: BarChart2 },
  reports:   { to: '/reports',     tk: 'reports',  label: 'Reports', icon: FileText },
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
  const { t } = useLanguage()
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
        {tabs.map(({ to, label, tk, icon: Icon, end }) => (
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
                <span className="text-[9.5px] font-semibold tracking-wide">{tk ? t(`shell.tabs.${tk}`) : label}</span>
              </>
            )}
          </NavLink>
        ))}

        <button
          onClick={onMenuOpen}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors active:opacity-70"
          style={{ color: 'var(--text-muted)' }}
          aria-label={t('shell.openMenu')}
        >
          <Menu size={20} strokeWidth={1.7} />
          <span className="text-[9.5px] font-semibold tracking-wide">{t('shell.menu')}</span>
        </button>
      </div>
    </nav>
  )
}
