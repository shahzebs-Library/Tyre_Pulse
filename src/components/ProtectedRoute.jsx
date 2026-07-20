import { Navigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { governingModuleKey } from '../lib/navAccess'
import { isBuiltInRole } from '../lib/api/customRoles'
import { configBool } from '../lib/api/systemConfig'
import LoadingSpinner from './LoadingSpinner'

/**
 * Pure decision helper (exported for testing): should this account be blocked
 * from the WEB app? True only when web_access is explicitly false AND the user
 * is neither a super-admin nor an Admin. web_access null/undefined/true keeps
 * the account on the web (fail-open) and Admin / super-admin are NEVER blocked
 * (never lock yourself out). Mobile is unaffected by this flag.
 *
 * @param {object|null} profile
 * @returns {boolean}
 */
export function shouldBlockWeb(profile) {
  if (!profile) return false
  const isSuper = profile.is_super_admin === true
  return profile.web_access === false && !isSuper && profile.role !== 'Admin'
}

export default function ProtectedRoute({ children }) {
  const { user, profile, loading, mfaEnabled, isSuperAdmin } = useAuth()
  const { t } = useLanguage()
  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" replace />

  // Defense-in-depth for a locked account (the realtime handler also signs it
  // out): never render the app for a suspended user.
  if (profile && profile.locked === true) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-5"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span className="text-4xl">🔒</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-3">{t('auth.accountSuspendedTitle')}</h2>
          <p className="text-gray-400 text-sm leading-relaxed">{t('auth.login.accessRevokedBanner')}</p>
          <button
            onClick={() => import('../lib/supabase').then(m => m.supabase.auth.signOut())}
            className="mt-6 text-sm text-gray-500 hover:text-green-400 transition-colors">
            {t('common.signOut')}
          </button>
        </div>
      </div>
    )
  }

  // Block unapproved accounts - approved must be explicitly true
  // null / undefined = legacy account treated as approved; false = explicitly pending
  if (profile && profile.approved === false) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-5"
            style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)' }}>
            <span className="text-4xl">⏳</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-3">{t('auth.awaitingApprovalTitle')}</h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-1">
            {t('auth.awaitingApprovalBody')}
          </p>
          <p className="text-gray-500 text-xs leading-relaxed">
            {t('auth.awaitingApprovalContact')}
          </p>
          <button
            onClick={() => import('../lib/supabase').then(m => m.supabase.auth.signOut())}
            className="mt-6 text-sm text-gray-500 hover:text-green-400 transition-colors">
            {t('common.signOut')}
          </button>
        </div>
      </div>
    )
  }

  // Web-only access gate (V278). A mobile-only account (web_access = false) is
  // informed to use the mobile app instead of the web shell. Admin / super-admin
  // are never blocked, so an administrator can never lock themselves out.
  if (shouldBlockWeb(profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-5"
            style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)' }}>
            <span className="text-4xl">📱</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-3">Mobile app only</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            This account is set up for the Tyre Pulse mobile app. Please sign in from the mobile app to continue.
          </p>
          <button
            onClick={() => import('../lib/supabase').then(m => m.supabase.auth.signOut())}
            className="mt-6 text-sm text-gray-500 hover:text-green-400 transition-colors">
            {t('common.signOut')}
          </button>
        </div>
      </div>
    )
  }

  // Mandatory two-factor authentication for administrators (System Configuration
  // `two_factor_required`). An Admin-role or super-admin account that has not
  // enrolled 2FA is blocked from the app until they enrol, but is never hard
  // locked: they can still reach Settings (where enrolment lives) or sign out.
  // Fails SAFE: no-op when the toggle is off, when 2FA is enrolled, or for any
  // non-admin account.
  const require2fa = (() => { try { return configBool('two_factor_required', false) } catch { return false } })()
  const isAdminAccount = !!profile && (profile.role === 'Admin' || isSuperAdmin === true || profile.is_super_admin === true)
  if (require2fa && isAdminAccount && mfaEnabled === false) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-5"
            style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)' }}>
            <span className="text-4xl">🔐</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-3">Two-factor authentication required</h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-1">
            Your organization requires administrators to secure their account with two-factor authentication before continuing.
          </p>
          <p className="text-gray-500 text-xs leading-relaxed">
            Enrol in Settings under Security to unlock access.
          </p>
          <Link
            to="/settings"
            className="mt-6 inline-block text-sm font-semibold text-green-400 hover:text-green-300 transition-colors">
            Go to Settings
          </Link>
          <div>
            <button
              onClick={() => import('../lib/supabase').then(m => m.supabase.auth.signOut())}
              className="mt-4 text-sm text-gray-500 hover:text-green-400 transition-colors">
              {t('common.signOut')}
            </button>
          </div>
        </div>
      </div>
    )
  }
  return children
}

export function RoleRoute({ allowed, moduleKey, children }) {
  const { profile, isSuperAdmin, hasPermission, grantedModules, loading } = useAuth()
  const location = useLocation()
  if (loading) return <RouteLoading />

  // Super admins are never locked out of a role-gated route (break-glass).
  if (isSuperAdmin) return children
  if (!profile) return <AccessDenied role={undefined} allowed={allowed} />

  // Primary path: the account's built-in role is on the allow list.
  if (allowed.includes(profile.role)) return children

  // Additive fallback (never removes access, never WIDENS a built-in role):
  // admit ONLY on POSITIVE, explicit access -
  //   (a) a CUSTOM (non built-in) role whose governing module is enabled in the
  //       matrix (hasPermission for a custom role is deny-by-default - it has no
  //       ROLE_DEFAULTS entry, so it is true only when explicitly granted), OR
  //   (b) any account (built-in included) with an explicit per-user GRANT for it.
  // We must NOT fall back to hasPermission for a built-in role: ROLE_DEFAULTS make
  // Manager/Director permissive (allow-all-except-four), which would silently let
  // them onto Admin-only pages. A built-in role's page access is fully expressed
  // by `allowed`; only an explicit grant may extend it.
  const govKey = moduleKey || governingModuleKey(location?.pathname)
  const explicitGrant = govKey && typeof grantedModules?.has === 'function' && grantedModules.has(govKey)
  const customRoleAllowed = govKey && !isBuiltInRole(profile.role)
    && typeof hasPermission === 'function' && hasPermission(govKey)
  if (explicitGrant || customRoleAllowed) return children

  return <AccessDenied role={profile.role} allowed={allowed} />
}

export function ModuleRoute({ moduleKey, children }) {
  const { profile, hasPermission, loading, isSuperAdmin, moduleStatus, moduleMaintenance } = useAuth()
  if (loading) return <RouteLoading />

  if (!profile || !hasPermission(moduleKey)) {
    return <AccessDenied role={profile?.role} moduleKey={moduleKey} />
  }

  // Module Control status enforcement (V275). A module put into Maintenance or
  // taken Off is unavailable to regular users, but Admin / Super Admin always
  // pass (they administer and verify it). Unknown key / unreadable registry ->
  // moduleStatus returns 'live' so this NEVER locks anyone out by accident.
  const status = typeof moduleStatus === 'function' ? moduleStatus(moduleKey) : 'live'
  if ((status === 'maintenance' || status === 'disabled')
      && !isSuperAdmin && profile.role !== 'Admin') {
    const window = typeof moduleMaintenance === 'function'
      ? moduleMaintenance(moduleKey)
      : { until: null, note: null }
    return <ModuleUnavailable status={status} until={window?.until} note={window?.note} />
  }
  return children
}

// Gates a route to Super Admins only (profiles.is_super_admin). Renders the same
// AccessDenied UI as the sibling guards (no redirect, to avoid guard loops).
export function SuperAdminRoute({ children }) {
  const { profile, isSuperAdmin, loading } = useAuth()
  if (loading) return <RouteLoading />

  if (!isSuperAdmin) {
    return <AccessDenied role={profile?.role} />
  }
  return children
}

// Calm full-screen state shown when a module is in Maintenance or turned Off for
// regular users (Module Control). Mirrors the AccessDenied layout; plain English,
// no raw status codes or technical detail. When a maintenance window (V278) is
// set, shows the expected return time and any note.
function ModuleUnavailable({ status, until, note }) {
  const maintenance = status === 'maintenance'
  let etaLabel = null
  if (maintenance && until) {
    const d = new Date(until)
    if (!Number.isNaN(d.getTime())) etaLabel = d.toLocaleString()
  }
  return (
    <div className="flex flex-col items-center justify-center h-96 text-center px-4">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4"
        style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)' }}>
        <span className="text-3xl">{maintenance ? '🛠️' : '🚧'}</span>
      </div>
      <h2 className="text-xl font-bold text-white mb-2">
        {maintenance ? 'Under maintenance' : 'Module unavailable'}
      </h2>
      <p className="text-gray-400 text-sm max-w-sm">
        {maintenance
          ? 'This module is temporarily under maintenance. Please check back shortly.'
          : 'This module is currently turned off. Please contact your administrator if you need access.'}
      </p>
      {maintenance && etaLabel && (
        <p className="text-amber-300 text-sm font-semibold mt-3">
          Expected back by {etaLabel}
        </p>
      )}
      {maintenance && note && (
        <p className="text-gray-500 text-xs max-w-sm mt-2 leading-relaxed">{note}</p>
      )}
    </div>
  )
}

function RouteLoading() {
  const { t } = useLanguage()
  return (
    <div className="flex items-center justify-center h-64 text-gray-400">{t('common.loading')}</div>
  )
}

function AccessDenied({ role, allowed, moduleKey }) {
  const { t } = useLanguage()
  const roleNames = allowed?.map(r => t(`roles.${r}`)).join(' / ')
  return (
    <div className="flex flex-col items-center justify-center h-96 text-center px-4">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4"
        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
        <span className="text-3xl">🔒</span>
      </div>
      <h2 className="text-xl font-bold text-white mb-2">{t('auth.accessRestrictedTitle')}</h2>
      <p className="text-gray-400 text-sm max-w-sm">
        {allowed
          ? t('auth.accessRequiresRole', { roles: roleNames })
          : t('auth.accessNoPermission')}
        {' '}{t('auth.contactAdmin')}
      </p>
      <p className="text-gray-600 text-xs mt-3">
        {t('auth.currentRole')} <span className="text-gray-400 font-semibold">{role ? t(`roles.${role}`) : t('auth.unknown')}</span>
      </p>
    </div>
  )
}
