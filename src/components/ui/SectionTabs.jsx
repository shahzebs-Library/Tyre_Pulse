import { NavLink } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  ClipboardCheck, Cpu, LayoutGrid, BarChart2, Microscope, BarChartBig,
  GitBranch, HeartPulse, Search, GitMerge, FileText, Download, Wand2,
} from 'lucide-react'

/**
 * SectionTabs — shared sub-navigation for consolidated areas.
 *
 * Several formerly-separate pages that do overlapping jobs now sit under ONE
 * top-level nav entry and cross-link via this strip, so their features live as
 * tabs of a single area instead of duplicate nav items. Every route still
 * exists independently; this only unifies the UX. Pass one of the exported tab
 * groups (or any `[{ to, label, icon? }]`).
 */
/**
 * The tabs this user may open. A tab with no access rule is shown to everyone
 * (its route guard still decides). A tab that names a rule is shown only when
 * the user passes it, so the strip never offers a page that would refuse them:
 *   moduleKey          - the access matrix / per-user grants (hasPermission)
 *   roles (+ grantKey) - built-in roles, super admin, or an explicit grant
 */
export function visibleTabs(tabs = [], auth) {
  const a = auth || {}
  return tabs.filter((tab) => {
    if (tab.moduleKey) return typeof a.hasPermission === 'function' && a.hasPermission(tab.moduleKey) === true
    if (tab.roles) {
      if (a.isSuperAdmin === true) return true
      if (tab.roles.includes(a.profile?.role)) return true
      return !!(tab.grantKey && a.grantedModules && typeof a.grantedModules.has === 'function' && a.grantedModules.has(tab.grantKey))
    }
    return true
  })
}

export default function SectionTabs({ tabs = [] }) {
  const auth = useAuth()
  const shown = visibleTabs(tabs, auth)
  // One tab is not a choice: with a single reachable page the strip is left out.
  if (shown.length < 2) return null
  return (
    <div className="flex flex-wrap gap-2 border-b border-[var(--border-bright)] pb-3">
      {shown.map(({ to, label, icon: Icon, end = true }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-emerald-600 text-white'
                : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`
          }
        >
          {Icon && <Icon size={15} />} {label}
        </NavLink>
      ))}
    </div>
  )
}

export const KPI_TABS = [
  { to: '/kpi',         label: 'Scorecard',       icon: ClipboardCheck },
  { to: '/kpi-engine',  label: 'Engineering KPIs', icon: Cpu },
  { to: '/kpi-command', label: 'Command Center',  icon: LayoutGrid },
]

// (ANALYTICS_TABS was retired: /analytics is the Overview tab inside Advanced
// Analytics and Executive Analytics sits under the Executive entry.)

// One "Executive" menu entry; each tab keeps the access rule of its own route:
// Executive Report follows the executive_report module, Executive Analytics is
// for Admin, Manager and Director (or an explicit grant).
export const EXECUTIVE_TABS = [
  { to: '/executive-report',    label: 'Executive Report',    icon: FileText,    moduleKey: 'executive_report' },
  { to: '/executive-analytics', label: 'Executive Analytics', icon: BarChartBig, roles: ['Admin', 'Manager', 'Director'], grantKey: 'executive-analytics' },
]

export const FLEET_TABS = [
  { to: '/fleet',              label: 'Fleet Analytics', icon: BarChart2 },
  { to: '/fleet-intelligence', label: 'Intelligence',    icon: GitBranch },
  { to: '/fleet-health',       label: 'Health Board',    icon: HeartPulse },
]

export const RCA_TABS = [
  { to: '/rca',        label: 'RCA Records',       icon: Search },
  { to: '/root-cause', label: 'Root Cause Engine', icon: GitMerge },
]

export const REPORTS_TABS = [
  { to: '/reports',        label: 'Reports',        icon: FileText },
  { to: '/report-center',  label: 'Report Center',  icon: Download },
  { to: '/report-builder', label: 'Report Builder', icon: Wand2 },
]
