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
  { id: 'erp-import',     label: 'ERP Data Import',      path: '/erp-import',   icon: 'Upload', keywords: ['erp', 'import', 'template', 'asset', 'tyre change', 'expense', 'm3', 'production'] },
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
  // ── Auto-added: full nav coverage (kept complete by commandSearchCoverage.test.js) ──
  { id: 'sites', label: 'Site Management', path: '/sites', icon: 'MapPin' },
  { id: 'rfid', label: 'RFID Registry', path: '/rfid', icon: 'Radio', adminOnly: true },
  { id: 'geofencing', label: 'Geofencing', path: '/geofencing', icon: 'MapPin', adminOnly: true },
  { id: 'journeys', label: 'Journey Log', path: '/journeys', icon: 'Navigation', adminOnly: true },
  { id: 'vehicle-checkinout', label: 'Vehicle Check In/Out', path: '/vehicle-checkinout', icon: 'ArrowLeftRight', adminOnly: true },
  { id: 'combinations', label: 'Combinations', path: '/combinations', icon: 'Combine', adminOnly: true },
  { id: 'dispatch', label: 'Dispatch Planning', path: '/dispatch', icon: 'Truck', adminOnly: true },
  { id: 'batteries', label: 'Battery Lifecycle', path: '/batteries', icon: 'BatteryCharging', adminOnly: true },
  { id: 'telematics-devices', label: 'Telematics Devices', path: '/telematics-devices', icon: 'Router', adminOnly: true },
  { id: 'shifts', label: 'Shift Scheduling', path: '/shifts', icon: 'CalendarClock', adminOnly: true },
  { id: 'speed-limiter', label: 'Speed Limiter', path: '/speed-limiter', icon: 'Gauge', adminOnly: true },
  { id: 'engine-hours', label: 'Engine Hours', path: '/engine-hours', icon: 'Gauge', adminOnly: true },
  { id: 'odometer-logs', label: 'Odometer Logs', path: '/odometer-logs', icon: 'Activity', adminOnly: true },
  { id: 'trips', label: 'Trip History', path: '/trips', icon: 'MapPin', adminOnly: true },
  { id: 'route-optimization', label: 'Route Optimization', path: '/route-optimization', icon: 'Navigation', adminOnly: true },
  { id: 'charging-sessions', label: 'EV Charging', path: '/charging-sessions', icon: 'Zap', adminOnly: true },
  { id: 'load-planning', label: 'Load Planning', path: '/load-planning', icon: 'Package', adminOnly: true },
  { id: 'toll-transactions', label: 'Toll Transactions', path: '/toll-transactions', icon: 'Receipt', adminOnly: true },
  { id: 'gps-tracking', label: 'GPS Tracking', path: '/gps-tracking', icon: 'Satellite', adminOnly: true },
  { id: 'reservations', label: 'Vehicle Reservations', path: '/reservations', icon: 'BookMarked', adminOnly: true },
  { id: 'weighbridge', label: 'Weighbridge', path: '/weighbridge', icon: 'Scale', adminOnly: true },
  { id: 'proof-of-delivery', label: 'Proof of Delivery', path: '/proof-of-delivery', icon: 'PackageCheck', adminOnly: true },
  { id: 'handovers', label: 'Vehicle Handover', path: '/handovers', icon: 'KeyRound', adminOnly: true },
  { id: 'action-center', label: 'Action Center', path: '/action-center', icon: 'ListTodo', adminOnly: true },
  { id: 'fleet-groups', label: 'Fleet Groups', path: '/fleet-groups', icon: 'Network', adminOnly: true },
  { id: 'trip-replay', label: 'Trip Replay', path: '/trip-replay', icon: 'Play', adminOnly: true },
  { id: 'tyre-age-compliance', label: 'Tyre Age Compliance', path: '/tyre-age-compliance', icon: 'ShieldCheck', roles: ANALYTICS_ROLES },
  { id: 'tyre-passport', label: 'Tyre Passport', path: '/tyre-passport', icon: 'ScanLine' },
  { id: 'fleet-risk-score', label: 'Fleet Risk Score', path: '/fleet-risk-score', icon: 'ShieldAlert', roles: ANALYTICS_ROLES },
  { id: 'rotation-optimizer', label: 'Rotation Optimizer', path: '/rotation-optimizer', icon: 'RotateCcw', roles: ANALYTICS_ROLES },
  { id: 'carbon-tracker', label: 'Carbon Tracker', path: '/carbon-tracker', icon: 'Leaf', roles: ANALYTICS_ROLES },
  { id: 'digital-twin', label: 'Digital Twin', path: '/digital-twin', icon: 'Cpu', roles: ANALYTICS_ROLES },
  { id: 'tyre-service-events', label: 'Tyre Service Events', path: '/tyre-service-events', icon: 'Activity', roles: ANALYTICS_ROLES },
  { id: 'heat-intelligence', label: 'Heat Intelligence', path: '/heat-intelligence', icon: 'Thermometer', roles: ANALYTICS_ROLES },
  { id: 'fleet-optimizer', label: 'Fleet Optimizer', path: '/fleet-optimizer', icon: 'SlidersHorizontal', adminOnly: true },
  { id: 'technician-scorecard', label: 'Technician Scorecard', path: '/technician-scorecard', icon: 'Award', adminOnly: true },
  { id: 'pm-programs', label: 'Preventive Maintenance', path: '/pm-programs', icon: 'CalendarClock', adminOnly: true },
  { id: 'vehicle-washing', label: 'Vehicle Washing', path: '/vehicle-washing', icon: 'Droplet', moduleKey: 'vehicle_washing' },
  { id: 'dtc', label: 'DTC Diagnostics', path: '/dtc', icon: 'Cpu', adminOnly: true },
  { id: 'fuel-cards', label: 'Fuel Cards', path: '/fuel-cards', icon: 'CreditCard', adminOnly: true },
  { id: 'fuel-delivery', label: 'Fuel Delivery', path: '/fuel-delivery', icon: 'Fuel', adminOnly: true },
  { id: 'equipment', label: 'Tool & Equipment', path: '/equipment', icon: 'Wrench', adminOnly: true },
  { id: 'service-requests', label: 'Service Requests', path: '/service-requests', icon: 'LifeBuoy', adminOnly: true },
  { id: 'breakdowns', label: 'Breakdown Callouts', path: '/breakdowns', icon: 'PhoneCall', adminOnly: true },
  { id: 'bay-scheduling', label: 'Bay Scheduling', path: '/bay-scheduling', icon: 'CalendarRange', adminOnly: true },
  { id: 'tyre-pool', label: 'Tyre Pool', path: '/tyre-pool', icon: 'PackageCheck' },
  { id: 'parts-catalog', label: 'Parts Catalog', path: '/parts-catalog', icon: 'Boxes' },
  { id: 'requisitions', label: 'Requisitions', path: '/requisitions', icon: 'ClipboardList' },
  { id: 'goods-receipt', label: 'Goods Receipt', path: '/goods-receipt', icon: 'PackageCheck' },
  { id: 'cost-scenario-planner', label: 'Cost Scenario Planner', path: '/cost-scenario-planner', icon: 'SlidersHorizontal', roles: ANALYTICS_ROLES },
  { id: 'contracts', label: 'Contracts', path: '/contracts', icon: 'FileText' },
  { id: 'ifta-reporting', label: 'IFTA Fuel Tax', path: '/ifta-reporting', icon: 'Landmark', adminOnly: true },
  { id: 'materials', label: 'Materials', path: '/materials', icon: 'Layers', adminOnly: true },
  { id: 'marketplace', label: 'Supplier Marketplace', path: '/marketplace', icon: 'Store', adminOnly: true },
  { id: 'fitment-validation', label: 'Fitment Validation', path: '/fitment-validation', icon: 'ShieldCheck', roles: ANALYTICS_ROLES },
  { id: 'tpms', label: 'TPMS', path: '/tpms', icon: 'Radio', adminOnly: true },
  { id: 'certifications', label: 'Certifications', path: '/certifications', icon: 'BadgeCheck' },
  { id: 'policies', label: 'Policy Management', path: '/policies', icon: 'ScrollText', adminOnly: true },
  { id: 'cold-chain', label: 'Cold-Chain Monitor', path: '/cold-chain', icon: 'Snowflake', adminOnly: true },
  { id: 'retread-claims', label: 'Retread Claims', path: '/retread-claims', icon: 'Recycle', adminOnly: true },
  { id: 'driver-documents', label: 'Driver Documents', path: '/driver-documents', icon: 'FileCheck', adminOnly: true },
  { id: 'driver-expenses', label: 'Driver Expenses', path: '/driver-expenses', icon: 'Wallet', adminOnly: true },
  { id: 'dvir', label: 'DVIR Reports', path: '/dvir', icon: 'ClipboardCheck', adminOnly: true },
  { id: 'checklists', label: 'Checklists', path: '/checklists', icon: 'ListChecks' },
  { id: 'my-checklists', label: 'My Checklists', path: '/my-checklists', icon: 'ClipboardList' },
  { id: 'checklist-schedules', label: 'Checklist Schedules', path: '/checklist-schedules', icon: 'Calendar', adminOnly: true },
  { id: 'checklist-insights', label: 'Checklist Insights', path: '/checklist-insights', icon: 'ClipboardCheck', adminOnly: true },
  { id: 'alert-thresholds', label: 'Alert Thresholds', path: '/alert-thresholds', icon: 'BellRing', moduleKey: 'alerts', adminOnly: true },
  { id: 'driver-safety', label: 'Driver Safety', path: '/driver-safety', icon: 'ShieldAlert', adminOnly: true },
  { id: 'video-telematics', label: 'Video Telematics', path: '/video-telematics', icon: 'Video', adminOnly: true },
  { id: 'hours-of-service', label: 'Hours of Service', path: '/hours-of-service', icon: 'Clock', adminOnly: true },
  { id: 'emissions', label: 'Emissions Tests', path: '/emissions', icon: 'Leaf', adminOnly: true },
  { id: 'driver-training', label: 'Driver Training', path: '/driver-training', icon: 'GraduationCap', adminOnly: true },
  { id: 'tachograph', label: 'Tachograph', path: '/tachograph', icon: 'FileClock', adminOnly: true },
  { id: 'fuel-theft', label: 'Fuel Theft Alerts', path: '/fuel-theft', icon: 'Droplet', adminOnly: true },
  { id: 'driver-coaching', label: 'Driver Coaching', path: '/driver-coaching', icon: 'Award', adminOnly: true },
  { id: 'claims-summary', label: 'Claims Summary', path: '/claims-summary', icon: 'BarChart2' },
  { id: 'insurance-claims', label: 'Insurance Claims', path: '/insurance-claims', icon: 'ShieldAlert' },
  { id: 'incidents', label: 'Incident Reports', path: '/incidents', icon: 'FileWarning' },
  { id: 'accident-workflow-settings', label: 'Accident Workflow', path: '/accident-workflow-settings', icon: 'GitBranch', roles: ANALYTICS_ROLES },
  { id: 'workshop-live', label: 'Workshop Live Control', path: '/workshop-live', icon: 'Activity', roles: ANALYTICS_ROLES },
  { id: 'workshop-absence', label: 'Absence & Attendance', path: '/workshop-absence', icon: 'CalendarCheck2', roles: ANALYTICS_ROLES },
  { id: 'workshop-analytics', label: 'Workshop Analytics', path: '/workshop-analytics', icon: 'TrendingUp', roles: ANALYTICS_ROLES },
  { id: 'workshop-settings', label: 'Workshop Settings', path: '/workshop-settings', icon: 'SlidersHorizontal', roles: ANALYTICS_ROLES },
  { id: 'parts-requests', label: 'Parts Requests', path: '/parts-requests', icon: 'Boxes', roles: ANALYTICS_ROLES },
  { id: 'board-overview', label: 'Board Overview', path: '/board-overview', icon: 'BarChartBig', roles: ANALYTICS_ROLES },
  { id: 'roi-calculator', label: 'ROI Calculator', path: '/roi-calculator', icon: 'DollarSign', roles: ANALYTICS_ROLES },
  { id: 'fleet-renewal', label: 'Fleet Renewal', path: '/fleet-renewal', icon: 'Truck', roles: ANALYTICS_ROLES },
  { id: 'tco-calculator', label: 'TCO Calculator', path: '/tco-calculator', icon: 'Calculator', roles: ANALYTICS_ROLES },
  { id: 'sla-dashboard', label: 'SLA Dashboard', path: '/sla-dashboard', icon: 'Target', adminOnly: true },
  { id: 'taas', label: 'Tyre-as-a-Service', path: '/taas', icon: 'Repeat', adminOnly: true },
  { id: 'ops-intelligence', label: 'Ops Intelligence', path: '/ops-intelligence', icon: 'Siren', adminOnly: true },
  { id: 'report-sharing', label: 'Report Sharing', path: '/report-sharing', icon: 'Share2', roles: ANALYTICS_ROLES },
  { id: 'approvals', label: 'Approvals', path: '/approvals', icon: 'CheckSquare', roles: ANALYTICS_ROLES },
  { id: 'events', label: 'Event Stream', path: '/events', icon: 'Radio', adminOnly: true },
  { id: 'workflow-settings', label: 'Approval Workflows', path: '/workflow-settings', icon: 'GitBranch', adminOnly: true },
  { id: 'approval-delegations', label: 'Approval Delegations', path: '/approval-delegations', icon: 'ArrowLeftRight' },
  { id: 'automation-rules', label: 'Automation Rules', path: '/automation-rules', icon: 'Zap', adminOnly: true },
  { id: 'integrations', label: 'API & Webhooks', path: '/integrations', icon: 'Webhook', adminOnly: true },
  { id: 'data-reconciliation', label: 'Data Reconciliation', path: '/data-reconciliation', icon: 'GitCompare', adminOnly: true },
  { id: 'billing', label: 'Billing & Subscription', path: '/billing', icon: 'CreditCard', adminOnly: true },
  { id: 'brand-assets', label: 'Brand Assets', path: '/brand-assets', icon: 'Palette', adminOnly: true },
  { id: 'customers', label: 'Customers', path: '/customers', icon: 'Building2', adminOnly: true },
  { id: 'customer-portal', label: 'Customer Portal', path: '/customer-portal', icon: 'Building2', adminOnly: true },
  { id: 'advanced-search', label: 'Advanced Search', path: '/advanced-search', icon: 'Search' },
  { id: 'ocr-scanner', label: 'OCR Scanner', path: '/ocr-scanner', icon: 'ScanLine', adminOnly: true },
  { id: 'onboarding-wizard', label: 'Onboarding Wizard', path: '/onboarding-wizard', icon: 'Rocket', adminOnly: true },
  { id: 'developer-portal', label: 'Developer Portal', path: '/developer-portal', icon: 'Code', adminOnly: true },
  { id: 'help', label: 'Help & Support', path: '/help', icon: 'LifeBuoy' },
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
