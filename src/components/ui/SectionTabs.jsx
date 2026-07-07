import { NavLink } from 'react-router-dom'
import {
  ClipboardCheck, Cpu, LayoutGrid, BarChart2, Microscope, BarChartBig,
  GitBranch, HeartPulse, Search, GitMerge,
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
export default function SectionTabs({ tabs = [] }) {
  if (!tabs.length) return null
  return (
    <div className="flex flex-wrap gap-2 border-b border-[var(--border-bright)] pb-3">
      {tabs.map(({ to, label, icon: Icon, end = true }) => (
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

export const ANALYTICS_TABS = [
  { to: '/analytics',           label: 'Analytics', icon: BarChart2 },
  { to: '/advanced-analytics',  label: 'Advanced',  icon: Microscope },
  { to: '/executive-analytics', label: 'Executive', icon: BarChartBig },
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
