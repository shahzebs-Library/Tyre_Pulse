/**
 * MasterAccessControl.jsx — unified "Master Access Control" area (enterprise plan §5).
 *
 * Consolidates the two previously separate access surfaces into ONE tabbed home
 * WITHOUT rewriting or duplicating their logic:
 *   • Tab "Role Permissions"     → the full PermissionMatrix page (role × module × capability RBAC editor)
 *   • Tab "Security & Sessions"  → the full SecurityCenter page (session, login history, security events, checklist)
 *
 * The existing pages are rendered verbatim inside tab panels, so every feature,
 * state and enforcement path is preserved. Their original routes
 * (/permission-matrix, /security-center) remain live and unchanged; this page adds
 * a single admin home at /master-access-control. The active tab is reflected in the
 * URL (?tab=permissions|security) so tabs are deep-linkable and back/forward works.
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ShieldCheck, KeyRound, Fingerprint } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import PermissionMatrix from './PermissionMatrix'
import SecurityCenter from './SecurityCenter'

const TABS = [
  {
    key: 'permissions',
    label: 'Role Permissions',
    icon: KeyRound,
    desc: 'Role × module × capability grid',
    Component: PermissionMatrix,
  },
  {
    key: 'security',
    label: 'Security & Sessions',
    icon: Fingerprint,
    desc: 'Sessions, login history, security events',
    Component: SecurityCenter,
  },
]

const DEFAULT_TAB = 'permissions'

export default function MasterAccessControl() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'Admin'
  const [params, setParams] = useSearchParams()

  const requested = params.get('tab')
  const active = useMemo(
    () => (TABS.some((t) => t.key === requested) ? requested : DEFAULT_TAB),
    [requested],
  )

  const ActiveComponent = TABS.find((t) => t.key === active)?.Component ?? PermissionMatrix

  function selectTab(key) {
    const next = new URLSearchParams(params)
    next.set('tab', key)
    setParams(next, { replace: true })
  }

  return (
    <div className="space-y-5">
      {/* Unified header */}
      <div className="flex items-start gap-2.5">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-brand-subtle shrink-0">
          <ShieldCheck size={20} className="text-brand-bright" />
        </div>
        <div>
          <h1 className="text-h2">Master Access Control</h1>
          <p className="text-xs text-muted">
            One home for role permissions and account security.
            {isAdmin ? ' Admin controls apply org-wide.' : ' Your session and security posture.'}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-surface-1 w-fit"
        style={{ border: '1px solid var(--border-dim)' }}
        role="tablist"
        aria-label="Master Access Control sections"
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
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                on ? 'bg-surface-3 text-brand-bright' : 'text-secondary hover:text-brand-bright'
              }`}
              style={on ? { border: '1px solid var(--border-bright)' } : { border: '1px solid transparent' }}
            >
              <Icon size={15} />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Active panel — renders the existing page verbatim (logic untouched) */}
      <div role="tabpanel">
        <ActiveComponent />
      </div>
    </div>
  )
}
