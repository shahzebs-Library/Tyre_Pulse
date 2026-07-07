import { NavLink } from 'react-router-dom'
import { DollarSign, CalendarClock, Layers } from 'lucide-react'

/**
 * BudgetTabs — shared sub-navigation for the consolidated "Budgets & Cost"
 * area. The three previously-separate pages (Budgets, Budget Planner, Cost
 * Center) now live under one nav entry and cross-link via this strip, so their
 * features are reachable as tabs of a single area instead of duplicate nav
 * items. Each route still exists independently; this only unifies the UX.
 */
const TABS = [
  { to: '/budgets',        label: 'Budgets',        icon: DollarSign },
  { to: '/budget-planner', label: 'Budget Planner', icon: CalendarClock },
  { to: '/cost-center',    label: 'Cost Center',    icon: Layers },
]

export default function BudgetTabs() {
  return (
    <div className="flex flex-wrap gap-2 border-b border-[var(--border-bright)] pb-3">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            `inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-emerald-600 text-white'
                : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`
          }
        >
          <Icon size={15} /> {label}
        </NavLink>
      ))}
    </div>
  )
}
