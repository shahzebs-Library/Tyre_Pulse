import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, ClipboardCheck, Bell, Upload, BarChart2, Menu,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const ROLE_TABS = {
  Admin: [
    { to: '/',            label: 'Home',    icon: LayoutDashboard, end: true },
    { to: '/inspections', label: 'Inspect', icon: ClipboardCheck },
    { to: '/alerts',      label: 'Alerts',  icon: Bell },
    { to: '/analytics',   label: 'Reports', icon: BarChart2 },
  ],
  Manager: [
    { to: '/',            label: 'Home',    icon: LayoutDashboard, end: true },
    { to: '/inspections', label: 'Inspect', icon: ClipboardCheck },
    { to: '/alerts',      label: 'Alerts',  icon: Bell },
    { to: '/analytics',   label: 'Reports', icon: BarChart2 },
  ],
  Director: [
    { to: '/',            label: 'Home',    icon: LayoutDashboard, end: true },
    { to: '/inspections', label: 'Inspect', icon: ClipboardCheck },
    { to: '/alerts',      label: 'Alerts',  icon: Bell },
    { to: '/analytics',   label: 'Reports', icon: BarChart2 },
  ],
  Inspector: [
    { to: '/',            label: 'Home',    icon: LayoutDashboard, end: true },
    { to: '/inspections', label: 'Inspect', icon: ClipboardCheck },
    { to: '/alerts',      label: 'Alerts',  icon: Bell },
    { to: '/upload',      label: 'Upload',  icon: Upload },
  ],
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
        borderTop: '1px solid rgba(22,163,74,0.14)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: '0 -4px 30px rgba(0,0,0,0.6)',
      }}
    >
      <div className="flex items-stretch h-[54px]">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-200 active:opacity-70
               ${isActive ? 'text-green-400' : 'text-gray-600'}`
            }
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
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-gray-600 active:text-green-400 transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} strokeWidth={1.7} />
          <span className="text-[9.5px] font-semibold tracking-wide">Menu</span>
        </button>
      </div>
    </nav>
  )
}
