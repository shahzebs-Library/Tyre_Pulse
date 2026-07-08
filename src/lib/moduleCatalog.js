/**
 * Module catalog — the canonical list of access-controlled modules, grouped into
 * the 8 product workspaces used by the sidebar. Drives the Access Control matrix
 * (role × module) in User Management. Keys match `module_permissions.module_key`
 * and the `moduleKey` props on <ModuleRoute> in App.jsx.
 */

/** @type {{ group: string, modules: { key: string, label: string }[] }[]} */
export const MODULE_GROUPS = [
  {
    group: 'Overview',
    modules: [
      { key: 'dashboard', label: 'Dashboard' },
      { key: 'daily_ops', label: 'Daily Operations' },
      { key: 'alerts', label: 'Alerts' },
    ],
  },
  {
    group: 'Tyres & Inspections',
    modules: [
      { key: 'tyre_records', label: 'Tyre Records' },
      { key: 'inspections', label: 'Inspections' },
      { key: 'gate_pass', label: 'Gate Pass' },
      { key: 'rca', label: 'Root Cause (RCA)' },
    ],
  },
  {
    group: 'Fleet & Assets',
    modules: [
      { key: 'fleet_master', label: 'Fleet Master' },
      { key: 'fleet_analytics', label: 'Fleet Analytics' },
      { key: 'fleet_intelligence', label: 'Fleet Intelligence' },
    ],
  },
  {
    group: 'Workshop & Stock',
    modules: [
      { key: 'work_orders', label: 'Work Orders' },
      { key: 'stock', label: 'Stock' },
      { key: 'maintenance_calendar', label: 'Maintenance Calendar' },
      { key: 'corrective_actions', label: 'Corrective Actions' },
      { key: 'accidents', label: 'Accidents' },
    ],
  },
  {
    group: 'Procurement & Vendors',
    modules: [
      { key: 'budgets', label: 'Budgets' },
      { key: 'vendor_intelligence', label: 'Vendor Intelligence' },
    ],
  },
  {
    group: 'Analytics & KPIs',
    modules: [
      { key: 'analytics', label: 'Analytics' },
      { key: 'kpi_scorecard', label: 'KPI Scorecard' },
      { key: 'brand_performance', label: 'Brand Performance' },
      { key: 'site_comparison', label: 'Site Comparison' },
      { key: 'country_comparison', label: 'Country Comparison' },
      { key: 'position_intelligence', label: 'Position Intelligence' },
      { key: 'pressure_intelligence', label: 'Pressure Intelligence' },
      { key: 'predictive_maintenance', label: 'Predictive Maintenance' },
      { key: 'root_cause_engine', label: 'Root Cause Engine' },
      { key: 'forecasting', label: 'Forecasting' },
    ],
  },
  {
    group: 'Reports & AI',
    modules: [
      { key: 'reports', label: 'Reports' },
      { key: 'executive_report', label: 'Executive Report' },
      { key: 'ai_analytics', label: 'AI Analytics' },
      { key: 'ai_command_center', label: 'AI Command Center' },
    ],
  },
  {
    group: 'Data & Administration',
    modules: [
      { key: 'upload_data', label: 'Upload Data' },
      { key: 'custom_data', label: 'Custom Data / Intake' },
      { key: 'data_cleaning', label: 'Data Cleaning' },
      { key: 'erp_sync', label: 'ERP Sync' },
      { key: 'audit_trail', label: 'Audit Trail' },
      { key: 'user_management', label: 'User Management' },
    ],
  },
]

/** Roles that appear as columns in the access matrix. Admin is always full. */
export const ACCESS_ROLES = [
  'Admin', 'Manager', 'Director', 'Reporter', 'Inspector', 'Tyre Man', 'Driver',
  'Integration Admin', 'Data Engineer', 'Automation',
]

/** Flat [{key,label,group}] for lookups. */
export const ALL_MODULES = MODULE_GROUPS.flatMap((g) =>
  g.modules.map((m) => ({ ...m, group: g.group })),
)

export const MODULE_LABEL = Object.fromEntries(ALL_MODULES.map((m) => [m.key, m.label]))
