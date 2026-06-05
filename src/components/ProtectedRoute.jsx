import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import LoadingSpinner from './LoadingSpinner'

export default function ProtectedRoute({ children }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" replace />
  // Show pending approval screen for unapproved accounts (approved column added in V10)
  if (profile && profile.approved === false) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-5"
            style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)' }}>
            <span className="text-4xl">⏳</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-3">Awaiting Admin Approval</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            Your account is pending approval. An administrator will review and activate your account shortly.
            Please sign in again later or contact your administrator.
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
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center px-4">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-white mb-2">Access Restricted</h2>
        <p className="text-gray-400 text-sm max-w-sm">
          This section is only available to {allowed.join(' or ')} accounts.
          Contact your administrator if you need access.
        </p>
      </div>
    )
  }
  return children
}
