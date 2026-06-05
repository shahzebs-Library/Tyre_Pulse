import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import LoadingSpinner from './LoadingSpinner'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" replace />
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
