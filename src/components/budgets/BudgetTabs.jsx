import { NavLink } from 'react-router-dom'
import { DollarSign, CalendarClock, Layers } from 'lucide-react'
import './financeWorkspace.css'

/**
 * BudgetTabs — shared sub-navigation for the consolidated "Budgets & Cost"
 * area. The three previously-separate pages (Budgets, Budget Planner, Cost
 * Center) now live under one nav entry and cross-link via this strip, so their
 * features are reachable as tabs of a single area instead of duplicate nav
 * items. Each route still exists independently; this only unifies the UX.
 */
const TABS = [
  { to: '/cost-center', label: 'Cost Center', description: 'Actual costs & fleet efficiency', icon: Layers },
  { to: '/budget-planner', label: 'Budget Planner', description: 'Annual plans & spending scenarios', icon: CalendarClock },
  { to: '/budgets', label: 'Budgets', description: 'Site allocations & utilisation', icon: DollarSign },
]

export default function BudgetTabs() {
  return (
    <nav className="finance-nav" aria-label="Budgets and cost pages">
      {TABS.map(({ to, label, description, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            `finance-nav-link${isActive ? ' is-active' : ''}`
          }
        >
          <span className="finance-nav-icon"><Icon size={20} aria-hidden="true" /></span>
          <span><strong>{label}</strong><small>{description}</small></span>
        </NavLink>
      ))}
    </nav>
  )
}
