import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import LoadingSpinner from './LoadingSpinner'

export default function ProtectedRoute({ children }) {
  const { user, profile, loading } = useAuth()
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
  return children
}

export function RoleRoute({ allowed, children }) {
  const { profile, isSuperAdmin, loading } = useAuth()
  if (loading) return <RouteLoading />

  // Super admins are never locked out of a role-gated route (break-glass).
  if (isSuperAdmin) return children

  if (!profile || !allowed.includes(profile.role)) {
    return <AccessDenied role={profile?.role} allowed={allowed} />
  }
  return children
}

export function ModuleRoute({ moduleKey, children }) {
  const { profile, hasPermission, loading, isSuperAdmin, moduleStatus } = useAuth()
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
    return <ModuleUnavailable status={status} />
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
// no raw status codes or technical detail.
function ModuleUnavailable({ status }) {
  const maintenance = status === 'maintenance'
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
