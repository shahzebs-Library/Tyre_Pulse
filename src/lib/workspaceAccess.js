export function moduleAvailable(auth, key) {
  if (!auth.profile || auth.loading || !auth.hasPermission?.(key)) return false
  const status = auth.moduleStatus?.(key) || 'live'
  return auth.isSuperAdmin === true || auth.profile.role === 'Admin' || !['disabled', 'maintenance'].includes(status)
}

export function executiveHomeAllowed(auth) {
  return moduleAvailable(auth, 'dashboard') && (auth.isSuperAdmin === true || auth.profile?.role === 'Admin')
}

export const WORKSPACE_COUNTS = {
  fleet_master: { table: 'vehicle_fleet', label: 'Accessible vehicles' },
  vehicle_washing: { table: 'wash_records', label: 'Accessible wash records' },
  inspections: { table: 'inspections', label: 'Accessible inspections' },
}
