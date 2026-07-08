// commandSearch.js - pure helpers for the global command palette (Ctrl/Cmd+K).
//
// Contains no React and no Supabase client so every rule is unit-testable:
//   - COMMAND registry built from the app route table (App.jsx) carrying the
//     SAME RBAC metadata the sidebar nav uses (Layout.jsx shouldShowNavItem)
//     plus the ModuleRoute moduleKey gates from App.jsx.
//   - visibility filtering (role + module permission)
//   - query ranking for commands
//   - ilike or-clause building + record-row mapping for the universal search.

import { sanitizeSearchTerm } from './searchFilter'

// Mirrors ANALYTICS_ROLES in Layout.jsx
export const ANALYTICS_ROLES = ['Admin', 'Manager', 'Director']

// ── Command registry ─────────────────────────────────────────────────────────
// access flags copied 1:1 from Layout.jsx NAV_GROUPS (adminOnly / roles) and
// App.jsx ModuleRoute wrappers (moduleKey). Routes without a nav entry or gate
// are open to every authenticated role except Inspector (see isCommandVisible).
export const NAV_COMMANDS = [
  // Overview
  { id: 'dashboard',      label: 'Dashboard',            path: '/',            icon: 'LayoutDashboard' },
  { id: 'tyres',          label: 'Tyre Records',         path: '/tyres',       icon: 'CircleDot' },
  // Operations
  { id: 'fleet-master',   label: 'Fleet Master',         path: '/fleet-master', icon: 'Truck' },
  { id: 'assets',         label: 'Asset Management',     path: '/assets',      icon: 'LayoutGrid' },
  { id: 'actions',        label: 'Corrective Actions',   path: '/actions',     icon: 'ClipboardList' },
  { id: 'rca',            label: 'Root Cause',           path: '/rca',         icon: 'Search' },
  { id: 'daily-ops',      label: 'Daily Ops',            path: '/daily-ops',   icon: 'Calendar',      adminOnly: true },
  { id: 'live-fleet',     label: 'Live Fleet Status',    path: '/live-fleet',  icon: 'Radio',         adminOnly: true },
  { id: 'serial-tracker', label: 'Serial Tracker',       path: '/serial-tracker', icon: 'QrCode',     adminOnly: true },
  { id: 'qr-labels',      label: 'QR Labels',            path: '/qr-labels',   icon: 'Tag',           adminOnly: true },
  { id: 'vehicle-history', label: 'Vehicle History',     path: '/vehicle-history', icon: 'History',   adminOnly: true, moduleKey: 'fleet_master' },
  { id: 'anomalies',      label: 'Anomaly Scan',         path: '/anomalies',   icon: 'AlertTriangle', adminOnly: true, moduleKey: 'tyre_records' },
  { id: 'maintenance-calendar', label: 'Maintenance Calendar', path: '/maintenance-calendar', icon: 'Calendar', adminOnly: true },
  { id: 'erp-sync',       label: 'ERP Sync',             path: '/erp-sync',    icon: 'RefreshCw',     adminOnly: true, moduleKey: 'erp_sync' },
  // Tyre Performance
  { id: 'analytics',      label: 'Analytics',            path: '/analytics',    icon: 'BarChart2',  roles: ANALYTICS_ROLES, moduleKey: 'analytics' },
  { id: 'brand-perf',     label: 'Brand Performance',    path: '/brand-perf',   icon: 'TrendingUp', roles: ANALYTICS_ROLES, moduleKey: 'brand_performance' },
  { id: 'site-comp',      label: 'Site Comparison',      path: '/site-comp',    icon: 'GitCompare', roles: ANALYTICS_ROLES, moduleKey: 'site_comparison' },
  { id: 'fleet',          label: 'Fleet Analytics',      path: '/fleet',        icon: 'Activity',   roles: ANALYTICS_ROLES, moduleKey: 'fleet_analytics' },
  { id: 'kpi',            label: 'KPI Scorecard',        path: '/kpi',          icon: 'Target',     roles: ANALYTICS_ROLES, moduleKey: 'kpi_scorecard' },
  { id: 'country-comp',   label: 'Country Comparison',   path: '/country-comp', icon: 'GitCompare', roles: ANALYTICS_ROLES, moduleKey: 'country_comparison' },
  { id: 'comparison',     label: 'Comparison',           path: '/comparison',   icon: 'GitCompare', roles: ANALYTICS_ROLES, moduleKey: 'analytics' },
  { id: 'kpi-engine',     label: 'Engineering KPIs',     path: '/kpi-engine',   icon: 'Cpu',        adminOnly: true, moduleKey: 'kpi_scorecard' },
  { id: 'kpi-command',    label: 'KPI Command Center',   path: '/kpi-command',  icon: 'LayoutGrid', adminOnly: true, moduleKey: 'kpi_scorecard' },
  { id: 'position-intelligence', label: 'Position Intelligence', path: '/position-intelligence', icon: 'MapPin', adminOnly: true, moduleKey: 'position_intelligence' },
  { id: 'pressure-intel', label: 'Pressure Intelligence', path: '/pressure-intel', icon: 'Gauge',   adminOnly: true, moduleKey: 'pressure_intelligence' },
  { id: 'predictive-maintenance', label: 'Predictive Maintenance', path: '/predictive-maintenance', icon: 'Zap', adminOnly: true, moduleKey: 'predictive_maintenance' },
  { id: 'fleet-intelligence', label: 'Fleet Intelligence', path: '/fleet-intelligence', icon: 'Activity', adminOnly: true, moduleKey: 'fleet_intelligence' },
  { id: 'fleet-health',   label: 'Fleet Health Board',   path: '/fleet-health', icon: 'Heart',      adminOnly: true, moduleKey: 'fleet_intelligence' },
  { id: 'advanced-analytics', label: 'Advanced Analytics', path: '/advanced-analytics', icon: 'BarChart2', adminOnly: true, moduleKey: 'analytics' },
  { id: 'benchmark',      label: 'Performance Benchmark', path: '/benchmark',   icon: 'Target',     adminOnly: true, moduleKey: 'analytics' },
  { id: 'tyre-size',      label: 'Size Optimizer',       path: '/tyre-size',    icon: 'CircleDot',  adminOnly: true, moduleKey: 'tyre_records' },
  { id: 'tyre-lifecycle', label: 'Tyre Lifecycle',       path: '/tyre-lifecycle', icon: 'RefreshCw', adminOnly: true, moduleKey: 'tyre_records' },
  { id: 'tyre-exchange',  label: 'Tyre Exchange',        path: '/tyre-exchange', icon: 'ArrowLeftRight', adminOnly: true },
  { id: 'tyre-specs',     label: 'Tyre Specifications',  path: '/tyre-specs',   icon: 'FileText',   adminOnly: true },
  { id: 'rotation',       label: 'Rotation Schedule',    path: '/rotation',     icon: 'RefreshCcw', adminOnly: true },
  { id: 'root-cause',     label: 'Root Cause Engine',    path: '/root-cause',   icon: 'Search',     adminOnly: true, moduleKey: 'root_cause_engine' },
  { id: 'ai',             label: 'Smart Analytics',      path: '/ai',           icon: 'Cpu',        adminOnly: true, moduleKey: 'ai_analytics' },
  // Workshop & Downtime
  { id: 'work-orders',    label: 'Work Orders',          path: '/work-orders',  icon: 'Wrench' },
  { id: 'gate-pass',      label: 'Gate Pass',            path: '/gate-pass',    icon: 'ClipboardCheck' },
  { id: 'workshop',       label: 'Workshop Management',  path: '/workshop',     icon: 'Building2',  adminOnly: true, moduleKey: 'work_orders' },
  { id: 'downtime',       label: 'Downtime Tracker',     path: '/downtime',     icon: 'Clock',      adminOnly: true, moduleKey: 'fleet_analytics' },
  { id: 'fuel-efficiency', label: 'Fuel Efficiency',     path: '/fuel-efficiency', icon: 'Gauge',   adminOnly: true, moduleKey: 'fleet_analytics' },
  // Stock & Procurement
  { id: 'stock',          label: 'Stock Management',     path: '/stock',        icon: 'Package' },
  { id: 'stock-replenishment', label: 'Stock Replenishment', path: '/stock-replenishment', icon: 'Package' },
  { id: 'scrap',          label: 'Scrap Management',     path: '/scrap',        icon: 'Trash2' },
  { id: 'budgets',        label: 'Budgets',              path: '/budgets',      icon: 'FileText' },
  { id: 'procurement',    label: 'Procurement',          path: '/procurement',  icon: 'ShoppingCart', adminOnly: true, moduleKey: 'stock' },
  { id: 'suppliers',      label: 'Supplier Management',  path: '/suppliers',    icon: 'Users',      adminOnly: true, moduleKey: 'stock' },
  { id: 'vendor-intelligence', label: 'Vendor Intelligence', path: '/vendor-intelligence', icon: 'TrendingUp', adminOnly: true, moduleKey: 'vendor_intelligence' },
  { id: 'budget-planner', label: 'Budget Planner',       path: '/budget-planner', icon: 'FileText', adminOnly: true, moduleKey: 'budgets' },
  { id: 'cost-center',    label: 'Cost Center',          path: '/cost-center',  icon: 'FileText',   adminOnly: true, moduleKey: 'budgets' },
  { id: 'forecasting',    label: 'Forecasting Engine',   path: '/forecasting',  icon: 'TrendingUp', adminOnly: true, moduleKey: 'forecasting' },
  // Safety & Compliance
  { id: 'inspections',    label: 'Inspections',          path: '/inspections',  icon: 'ClipboardCheck' },
  { id: 'inspection-planner', label: 'Inspection Planner', path: '/inspection-planner', icon: 'CalendarCheck' },
  { id: 'inspection-intelligence', label: 'Inspection Intelligence', path: '/inspection-intelligence', icon: 'Activity', adminOnly: true, moduleKey: 'inspections' },
  { id: 'safety-compliance', label: 'Safety & Compliance', path: '/safety-compliance', icon: 'Shield', adminOnly: true },
  { id: 'compliance',     label: 'Compliance Dashboard', path: '/compliance',   icon: 'Shield',     adminOnly: true },
  { id: 'alerts',         label: 'Alerts',               path: '/alerts',       icon: 'Bell',       adminOnly: true },
  { id: 'driver-management', label: 'Driver Intelligence', path: '/driver-management', icon: 'Users', adminOnly: true, moduleKey: 'fleet_master' },
  { id: 'retread',        label: 'Retread Management',   path: '/retread',      icon: 'RefreshCw',  adminOnly: true },
  // Accident & Insurance
  { id: 'accidents',      label: 'Accidents',            path: '/accidents',    icon: 'AlertTriangle' },
  { id: 'warranty',       label: 'Warranty Tracker',     path: '/warranty',     icon: 'Shield' },
  { id: 'recall-tracker', label: 'Recall Tracker',       path: '/recall-tracker', icon: 'AlertCircle', adminOnly: true },
  // Reports & Executive
  { id: 'reports',        label: 'Reports',              path: '/reports',      icon: 'FileText' },
  { id: 'report-center',  label: 'Report Center',        path: '/report-center', icon: 'FileText' },
  { id: 'scheduled-reports', label: 'Scheduled Reports', path: '/scheduled-reports', icon: 'CalendarCheck' },
  { id: 'executive-report', label: 'Executive Report',   path: '/executive-report', icon: 'Presentation', adminOnly: true, moduleKey: 'executive_report' },
  { id: 'ai-command-center', label: 'AI Command Center', path: '/ai-command-center', icon: 'Cpu',    adminOnly: true, moduleKey: 'ai_command_center' },
  { id: 'knowledge-base', label: 'Knowledge Base',       path: '/knowledge-base', icon: 'FileText', adminOnly: true },
  { id: 'ai-cost-monitor', label: 'AI Cost Monitor',     path: '/ai-cost-monitor', icon: 'BarChart2', adminOnly: true },
  { id: 'continuous-improvement', label: 'Continuous Improvement', path: '/continuous-improvement', icon: 'Zap', adminOnly: true, moduleKey: 'analytics' },
  // Administration & Data
  { id: 'cleaning',       label: 'Data Cleaning',        path: '/cleaning',     icon: 'Trash2',     adminOnly: true, moduleKey: 'data_cleaning' },
  { id: 'data-intake',    label: 'Data Intake Center',   path: '/data-intake',  icon: 'Upload', keywords: ['upload', 'import', 'excel', 'csv', 'file'] },
  { id: 'upload-approvals', label: 'Upload Approvals',   path: '/upload-approvals', icon: 'ClipboardCheck', adminOnly: true },
  { id: 'custom-data',    label: 'Custom Data',          path: '/custom-data',  icon: 'FileText' },
  { id: 'audit',          label: 'Audit Trail',          path: '/audit',        icon: 'History',    adminOnly: true, moduleKey: 'audit_trail' },
  { id: 'users',          label: 'User Management',      path: '/users',        icon: 'UserCog',    adminOnly: true, moduleKey: 'user_management' },
  { id: 'settings',       label: 'Settings',             path: '/settings',     icon: 'Settings' },
  { id: 'scan',           label: 'Tyre Scan (QR)',       path: '/scan',         icon: 'QrCode' },
  // Platform (roadmap tranche)
  { id: 'report-builder',    label: 'Report Builder',      path: '/report-builder',    icon: 'FileText',   keywords: ['custom report', 'export', 'build'] },
  { id: 'dashboard-builder', label: 'Dashboard Builder',   path: '/dashboard-builder', icon: 'LayoutGrid', keywords: ['widgets', 'layout', 'custom dashboard'] },
  { id: 'executive-analytics', label: 'Executive Analytics', path: '/executive-analytics', icon: 'BarChart2', roles: ANALYTICS_ROLES, keywords: ['echarts', 'heatmap', 'sankey', 'treemap'] },
  { id: 'tv-display',        label: 'TV Display Mode',     path: '/display',           icon: 'Radio',      adminOnly: true, keywords: ['tv', 'board', 'screen', 'wall'] },
  { id: 'security-center',   label: 'Security Center',     path: '/security-center',   icon: 'Settings',   keywords: ['login history', 'session', 'mfa', 'password'] },
  { id: 'permission-matrix', label: 'Permission Matrix',   path: '/permission-matrix', icon: 'UserCog',    adminOnly: true, keywords: ['roles', 'rbac', 'access'] },
  { id: 'system-health',     label: 'System Health',       path: '/system-health',     icon: 'Activity',   adminOnly: true, keywords: ['status', 'uptime', 'monitoring'] },
  { id: 'tenant-health',     label: 'Usage & Adoption',    path: '/tenant-health',     icon: 'BarChart2',  adminOnly: true, keywords: ['tenant', 'usage', 'ai cost', 'adoption'] },
]

// Quick actions - same RBAC descriptors as their target routes.
export const ACTION_COMMANDS = [
  { id: 'action-new-inspection', label: 'New Inspection',       path: '/inspections', icon: 'ClipboardCheck', keywords: ['create', 'add'] },
  { id: 'action-data-intake',    label: 'Upload / Import Data',  path: '/data-intake', icon: 'Upload',         keywords: ['import', 'excel', 'upload', 'file', 'csv'] },
  { id: 'action-scan',           label: 'Scan a Tyre QR Code',  path: '/scan',        icon: 'QrCode',         keywords: ['camera'] },
  { id: 'action-alerts',         label: 'View Active Alerts',   path: '/alerts',      icon: 'Bell',           adminOnly: true },
  { id: 'action-settings',       label: 'Open Settings',        path: '/settings',    icon: 'Settings',       keywords: ['preferences', 'theme'] },
]

// ── RBAC visibility ──────────────────────────────────────────────────────────
// Mirrors Layout.jsx shouldShowNavItem exactly, then additionally enforces the
// App.jsx ModuleRoute permission gate so the palette never surfaces a route
// the user's role cannot open.
export function isCommandVisible(cmd, profile, hasPermission) {
  const role = profile?.role
  if (!role) return false
  if (role === 'Inspector') {
    return cmd.path === '/inspections' || cmd.path === '/settings'
  }
  if (cmd.adminOnly && role !== 'Admin') return false
  if (cmd.roles && !cmd.roles.includes(role)) return false
  if (cmd.moduleKey && typeof hasPermission === 'function' && !hasPermission(cmd.moduleKey)) return false
  return true
}

export function visibleCommands(commands, profile, hasPermission) {
  return commands.filter((c) => isCommandVisible(c, profile, hasPermission))
}

// ── Command ranking ──────────────────────────────────────────────────────────
export function scoreCommand(cmd, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return 0
  const label = cmd.label.toLowerCase()
  const path = (cmd.path || '').toLowerCase()
  if (label === q) return 120
  if (label.startsWith(q)) return 100
  if (label.split(/[\s/&()-]+/).some((w) => w.startsWith(q))) return 80
  if (label.includes(q)) return 60
  if (path.includes(q)) return 40
  if (Array.isArray(cmd.keywords) && cmd.keywords.some((k) => k.toLowerCase().includes(q))) return 30
  return 0
}

export function rankCommands(commands, query, limit = 8) {
  return commands
    .map((cmd, i) => ({ cmd, score: scoreCommand(cmd, query), i }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((e) => e.cmd)
}

// ── Record search (Supabase) config ─────────────────────────────────────────
// One entry per searchable entity. `fields` feed the ilike or-clause, `select`
// is the column list, `access` reuses the command RBAC descriptor of the page
// the result navigates to. `toResult` maps a row to a palette item (pure).
export const RECORD_SOURCES = [
  {
    id: 'vehicles',
    label: 'Vehicles',
    table: 'vehicle_fleet',
    select: 'id,asset_no,make,model,site',
    fields: ['asset_no', 'make', 'model'],
    access: { path: '/fleet-master' },
    toResult: (row) => ({
      id: `vehicles-${row.id}`,
      label: row.asset_no || 'Unknown asset',
      sub: [row.make, row.model, row.site].filter(Boolean).join(' · '),
      path: row.asset_no ? `/vehicle/${encodeURIComponent(row.asset_no)}` : '/fleet-master',
      icon: 'Truck',
    }),
  },
  {
    id: 'tyres',
    label: 'Tyre Records',
    table: 'tyre_records',
    select: 'id,serial_no,asset_no,brand',
    fields: ['serial_no', 'asset_no', 'brand'],
    access: { path: '/tyres' },
    toResult: (row) => ({
      id: `tyres-${row.id}`,
      label: row.serial_no || row.asset_no || 'Tyre',
      sub: [row.asset_no, row.brand].filter(Boolean).join(' · '),
      // Deep link: TyreRecords pre-filters from ?search= (serial jumps straight to the record)
      path: row.serial_no ? `/tyres?search=${encodeURIComponent(row.serial_no)}` : '/tyres',
      icon: 'CircleDot',
    }),
  },
  {
    id: 'suppliers',
    label: 'Suppliers',
    table: 'suppliers',
    select: 'id,supplier_name,supplier_code',
    fields: ['supplier_name', 'supplier_code'],
    access: { path: '/suppliers', adminOnly: true, moduleKey: 'stock' },
    toResult: (row) => ({
      id: `suppliers-${row.id}`,
      label: row.supplier_name || 'Supplier',
      sub: row.supplier_code || '',
      path: '/suppliers',
      icon: 'Users',
    }),
  },
  {
    id: 'drivers',
    label: 'Drivers',
    table: 'drivers',
    select: 'id,driver_id,driver_name',
    fields: ['driver_id', 'driver_name'],
    access: { path: '/driver-management', adminOnly: true, moduleKey: 'fleet_master' },
    toResult: (row) => ({
      id: `drivers-${row.id}`,
      label: row.driver_name || row.driver_id || 'Driver',
      sub: row.driver_name ? (row.driver_id || '') : '',
      path: '/driver-management',
      icon: 'Users',
    }),
  },
  {
    id: 'inspections',
    label: 'Inspections',
    table: 'inspections',
    select: 'id,asset_no,inspector,inspection_date,site',
    fields: ['asset_no', 'inspector'],
    access: { path: '/inspections' },
    toResult: (row) => ({
      id: `inspections-${row.id}`,
      label: row.asset_no || 'Inspection',
      sub: [row.inspector, row.inspection_date, row.site].filter(Boolean).join(' · '),
      path: '/inspections',
      icon: 'ClipboardCheck',
    }),
  },
]

export function visibleRecordSources(sources, profile, hasPermission) {
  return sources.filter((s) => isCommandVisible(s.access, profile, hasPermission))
}

// Builds the PostgREST `.or()` clause. Returns null when the sanitized term is
// too short to search (caller should skip the query entirely).
export function buildOrClause(fields, term) {
  const q = sanitizeSearchTerm(term)
  if (q.length < 2) return null
  return fields.map((f) => `${f}.ilike.%${q}%`).join(',')
}

export function mapRecordRows(source, rows) {
  return (rows || []).map((row) => source.toResult(row))
}
