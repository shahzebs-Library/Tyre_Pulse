/**
 * ConsolePermissions (retired) — the canonical role x module x capability matrix
 * now lives at /console/access?tab=roles (PermissionMatrix). To avoid two
 * divergent matrices this page no longer renders its own grid; it redirects to
 * the single source of truth. The file is intentionally kept (the console nav +
 * route in App.jsx import it).
 */
import { Navigate } from 'react-router-dom'
import { Layers } from 'lucide-react'

export default function ConsolePermissions() {
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm text-gray-400">
        <Layers size={14} className="text-orange-400" />
        Module permissions moved to Access Control. Redirecting to Role Permissions...
      </p>
      <Navigate to="/console/access?tab=roles" replace />
    </div>
  )
}
