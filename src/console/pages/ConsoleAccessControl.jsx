/**
 * ConsoleAccessControl.jsx - the unified Access Control host for the System
 * Console (route /console/access, rendered inside <ConsoleAuthBridge> so the
 * main-app useAuth() resolves to a verified super-admin here).
 *
 * This is a single tabbed home over every access-control surface. It does NOT
 * re-implement any logic: the first three and last tab render the existing
 * main-app admin pages verbatim (PermissionMatrix, CustomRolesManager,
 * AccessGrantsManager, SecurityCenter), and the four middle tabs render the new
 * console-only viewers (Effective Permissions, Country Scope, Bulk Operations,
 * Access Audit) that read super-admin data through src/lib/api/adminAccess.js.
 *
 * The active tab is reflected in ?tab= (useSearchParams) so every tab is
 * deep-linkable and browser back/forward works. The redirect routes
 * /permission-matrix -> ?tab=roles and /security-center -> ?tab=security land
 * on the matching panel.
 */
import { Suspense, lazy, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ShieldCheck, KeyRound, UserCog, UserCheck, Eye, Globe,
  Layers, ScrollText, Fingerprint, Loader2,
} from 'lucide-react'

import PermissionMatrix from '../../pages/PermissionMatrix'
import CustomRolesManager from '../../pages/CustomRolesManager'
import AccessGrantsManager from '../../pages/AccessGrantsManager'
import SecurityCenter from '../../pages/SecurityCenter'

// New console-only viewers are code-split so a heavy tab never blocks the host.
const EffectivePermissions = lazy(() => import('./access/EffectivePermissions'))
const CountryScope = lazy(() => import('./access/CountryScope'))
const BulkOperations = lazy(() => import('./access/BulkOperations'))
const AccessAudit = lazy(() => import('./access/AccessAudit'))

const TABS = [
  { key: 'roles',     label: 'Role Permissions', icon: KeyRound,    desc: 'Role by module by capability grid',       Component: PermissionMatrix,     lazy: false },
  { key: 'custom',    label: 'Custom Roles',     icon: UserCog,     desc: 'Create your own roles and grant access',  Component: CustomRolesManager,   lazy: false },
  { key: 'grants',    label: 'Per-User Grants',  icon: UserCheck,   desc: 'Give one user more or less than a role',  Component: AccessGrantsManager,  lazy: false },
  { key: 'effective', label: 'Effective Access', icon: Eye,         desc: 'What a user can actually do, and why',    Component: EffectivePermissions, lazy: true  },
  { key: 'country',   label: 'Country Scope',    icon: Globe,       desc: 'Which countries a user can see',          Component: CountryScope,         lazy: true  },
  { key: 'bulk',      label: 'Bulk Operations',  icon: Layers,      desc: 'Change role or capability for many users', Component: BulkOperations,       lazy: true  },
  { key: 'audit',     label: 'Access Audit',     icon: ScrollText,  desc: 'Immutable trail of every access change',  Component: AccessAudit,          lazy: true  },
  { key: 'security',  label: 'Security',         icon: Fingerprint, desc: 'Sessions, login history, security events', Component: SecurityCenter,       lazy: false },
]

const DEFAULT_TAB = 'effective'

function TabFallback() {
  return (
    <div className="card flex items-center justify-center py-16">
      <Loader2 size={22} className="animate-spin text-[var(--brand-bright)]" />
      <span className="ml-2 text-sm text-[var(--text-muted)]">Loading section...</span>
    </div>
  )
}

export default function ConsoleAccessControl() {
  const [params, setParams] = useSearchParams()

  const requested = params.get('tab')
  const active = useMemo(
    () => (TABS.some((t) => t.key === requested) ? requested : DEFAULT_TAB),
    [requested],
  )

  const activeTab = TABS.find((t) => t.key === active) || TABS[0]
  const ActiveComponent = activeTab.Component

  function selectTab(key) {
    const next = new URLSearchParams(params)
    next.set('tab', key)
    setParams(next, { replace: true })
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--brand-subtle,rgba(34,197,94,0.12))] shrink-0">
          <ShieldCheck size={20} className="text-[var(--brand-bright)]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-h2">Access Control</h1>
          <p className="text-xs text-[var(--text-muted)]">
            One home for role permissions, custom roles, per-user grants, effective access,
            country scope, bulk changes, the access audit trail and account security. Super
            Admin controls apply platform wide.
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-[var(--surface-1)] w-fit max-w-full overflow-x-auto"
        style={{ border: '1px solid var(--border-dim)' }}
        role="tablist"
        aria-label="Access Control sections"
      >
        {TABS.map((t) => {
          const Icon = t.icon
          const on = t.key === active
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => selectTab(t.key)}
              title={t.desc}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                on
                  ? 'bg-[var(--surface-3)] text-[var(--brand-bright)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--brand-bright)]'
              }`}
              style={on ? { border: '1px solid var(--border-bright)' } : { border: '1px solid transparent' }}
            >
              <Icon size={15} />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Active panel */}
      <div role="tabpanel" aria-label={activeTab.label}>
        {activeTab.lazy ? (
          <Suspense fallback={<TabFallback />}>
            <ActiveComponent />
          </Suspense>
        ) : (
          <ActiveComponent />
        )}
      </div>
    </div>
  )
}
