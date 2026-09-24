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
  Layers, ScrollText, Fingerprint, Wand2, SlidersHorizontal, Repeat2,
} from 'lucide-react'
import { Segmented, LoadingState } from '../components/ui'

import PermissionMatrix from '../../pages/PermissionMatrix'
import CustomRolesManager from '../../pages/CustomRolesManager'
import AccessGrantsManager from '../../pages/AccessGrantsManager'
import SecurityCenter from '../../pages/SecurityCenter'

// New console-only viewers are code-split so a heavy tab never blocks the host.
const AccessManager = lazy(() => import('./access/AccessManager'))
const EffectivePermissions = lazy(() => import('./access/EffectivePermissions'))
const AccessPreviewOverride = lazy(() => import('./access/AccessPreviewOverride'))
const CountryScope = lazy(() => import('./access/CountryScope'))
const BulkOperations = lazy(() => import('./access/BulkOperations'))
const AccessAudit = lazy(() => import('./access/AccessAudit'))
const ApprovalDelegations = lazy(() => import('../../pages/ApprovalDelegations'))

const TABS = [
  { key: 'manager',   label: 'Access Manager',   icon: Wand2,       desc: 'Easy on/off editor for every module and tab, per role or user', Component: AccessManager, lazy: true },
  { key: 'roles',     label: 'Role Permissions', icon: KeyRound,    desc: 'Role by module by capability grid',       Component: PermissionMatrix,     lazy: false },
  { key: 'custom',    label: 'Custom Roles',     icon: UserCog,     desc: 'Create your own roles and grant access',  Component: CustomRolesManager,   lazy: false },
  { key: 'grants',    label: 'Per-User Grants',  icon: UserCheck,   desc: 'Give one user more or less than a role',  Component: AccessGrantsManager,  lazy: false },
  { key: 'effective', label: 'Effective Access', icon: Eye,         desc: 'What a user can actually do, and why',    Component: EffectivePermissions, lazy: true  },
  { key: 'preview',   label: 'Preview & Override', icon: SlidersHorizontal, desc: 'Preview a role or user, then allow or deny any module', Component: AccessPreviewOverride, lazy: true },
  { key: 'country',   label: 'Country Scope',    icon: Globe,       desc: 'Which countries a user can see',          Component: CountryScope,         lazy: true  },
  { key: 'bulk',      label: 'Bulk Operations',  icon: Layers,      desc: 'Change role or capability for many users', Component: BulkOperations,       lazy: true  },
  { key: 'delegation', label: 'Delegations',      icon: Repeat2,     desc: 'Temporary approval authority with start and expiry dates', Component: ApprovalDelegations, lazy: true },
  { key: 'audit',     label: 'Access Audit',     icon: ScrollText,  desc: 'Immutable trail of every access change',  Component: AccessAudit,          lazy: true  },
  { key: 'security',  label: 'Security',         icon: Fingerprint, desc: 'Sessions, login history, security events', Component: SecurityCenter,       lazy: false },
]

const DEFAULT_TAB = 'manager'

function TabFallback() {
  return <LoadingState label="Loading section" rows={4} />
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

  const tabOptions = useMemo(
    () => TABS.map((t) => {
      const Icon = t.icon
      return {
        key: t.key,
        hint: t.desc,
        label: <><Icon size={13} aria-hidden="true" />{t.label}</>,
      }
    }),
    [],
  )

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>
            <ShieldCheck size={18} className="text-orange-400" /> Access Control
          </h1>
          <p className="text-xs text-gray-500 mt-1 max-w-3xl">
            One home for role permissions, custom roles, per-user grants, effective access, country scope, bulk
            changes, the access audit trail and account security. Super Admin controls apply platform wide.
          </p>
        </div>
      </header>

      <nav aria-label="Access Control sections" className="space-y-2">
        <Segmented options={tabOptions} value={active} onChange={selectTab} />
        <p className="text-xs text-gray-500">{activeTab.desc}</p>
      </nav>

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
