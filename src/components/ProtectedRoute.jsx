import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import LoadingSpinner from './LoadingSpinner'

export default function ProtectedRoute({ children }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" replace />

  // Block unapproved accounts — approved must be explicitly true
  // null / undefined = legacy account treated as approved; false = explicitly pending
  if (profile && profile.approved === false) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-5"
            style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)' }}>
            <span className="text-4xl">⏳</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-3">Awaiting Admin Approval</h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-1">
            Your account is pending approval. An administrator will review and activate your account shortly.
          </p>
          <p className="text-gray-500 text-xs leading-relaxed">
            Please contact your administrator if this takes longer than expected.
          </p>
          <button
            onClick={() => import('../lib/supabase').then(m => m.supabase.auth.signOut())}
            className="mt-6 text-sm text-gray-500 hover:text-green-400 transition-colors">
            Sign out
          </button>
        </div>
      </div>
    )
  }
  return children
}

export function RoleRoute({ allowed, children }) {
  const { profile, loading } = useAuth()
  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
  )
  if (!profile || !allowed.includes(profile.role)) {
    return <AccessDenied role={profile?.role} allowed={allowed} />
  }
  return children
}

export function ModuleRoute({ moduleKey, children }) {
  const { profile, hasPermission, loading } = useAuth()
  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
  )
  if (!profile || !hasPermission(moduleKey)) {
    return <AccessDenied role={profile?.role} moduleKey={moduleKey} />
  }
  return children
}

function AccessDenied({ role, allowed, moduleKey }) {
  return (
    <div className="flex flex-col items-center justify-center h-96 text-center px-4">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4"
        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
        <span className="text-3xl">🔒</span>
      </div>
      <h2 className="text-xl font-bold text-white mb-2">Access Restricted</h2>
      <p className="text-gray-400 text-sm max-w-sm">
        {allowed
          ? `This section requires ${allowed.join(' or ')} access.`
          : `Your role does not have permission to access this module.`}
        {' '}Contact your administrator to request access.
      </p>
      <p className="text-gray-600 text-xs mt-3">
        Your current role: <span className="text-gray-400 font-semibold">{role || 'Unknown'}</span>
      </p>
    </div>
  )
}
