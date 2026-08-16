import { describe, it, expect } from 'vitest'
import { NAV_CATALOG } from '../components/Layout'

/**
 * Regression guard for the sidebar re-group.
 *
 * The 210 nav items used to sit in 10 flat groups, one of which (Operations) was
 * 43 items long. They were regrouped into 13 groups with sub-headings. Regrouping
 * is exactly the kind of change that silently drops a route, so this pins the
 * complete route set as it stood immediately BEFORE the re-group (commit
 * 49d99af6). Every one of them must still be reachable from the sidebar.
 *
 * It also pins the two structural contracts the re-group had to respect:
 *  - NAV_CATALOG stays FLAT (group -> items). Four console/admin surfaces
 *    (CustomRolesManager, ConsoleModuleControl, ConsoleNavigation,
 *    ConsolePlatformMap) and five tests consume that shape, so the nesting is
 *    render-time only, driven by an optional `parent` string on each item.
 *  - Routes stay unique, so no item can shadow another.
 */

// The route set before the re-group. Do not edit to make a failure go away:
// a missing entry means a module became unreachable from the sidebar.
const ROUTES_BEFORE_REGROUP = [
  '/',
  '/accident-cases',
  '/accident-workflow-settings',
  '/accidents',
  '/action-center',
  '/actions',
  '/advanced-analytics',
  '/advanced-search',
  '/ai-command-center',
  '/ai-cost-monitor',
  '/alert-thresholds',
  '/alerts',
  '/analytics',
  '/anomalies',
  '/approval-delegations',
  '/approval-matrix',
  '/approvals',
  '/asset-breakdowns',
  '/asset-disposals',
  '/assets',
  '/audit',
  '/automation-rules',
  '/batteries',
  '/bay-scheduling',
  '/benchmark',
  '/billing',
  '/board-overview',
  '/brand-assets',
  '/brand-perf',
  '/breakdowns',
  '/broadcast',
  '/budget-planner',
  '/budgets',
  '/carbon-tracker',
  '/certifications',
  '/charging-sessions',
  '/checklist-insights',
  '/checklist-schedules',
  '/checklists',
  '/claims-summary',
  '/cleaning',
  '/cold-chain',
  '/combinations',
  '/comparison',
  '/compliance',
  '/continuous-improvement',
  '/contracts',
  '/cost-center',
  '/cost-per-m3',
  '/cost-scenario-planner',
  '/country-comp',
  '/cpk-intelligence',
  '/custom-data',
  '/customer-portal',
  '/customers',
  '/daily-ops',
  '/dashboard-builder',
  '/data-intake',
  '/data-reconciliation',
  '/developer-portal',
  '/digital-twin',
  '/dispatch',
  '/display',
  '/downtime',
  '/driver-coaching',
  '/driver-documents',
  '/driver-expenses',
  '/driver-management',
  '/driver-safety',
  '/driver-training',
  '/dtc',
  '/dvir',
  '/emissions',
  '/engine-hours',
  '/equipment',
  '/erp-import',
  '/erp-intake',
  '/erp-sync',
  '/events',
  '/executive-analytics',
  '/executive-report',
  '/expense-import',
  '/expense-report',
  '/expense-trends',
  '/fitment-validation',
  '/fleet',
  '/fleet-groups',
  '/fleet-health',
  '/fleet-intelligence',
  '/fleet-master',
  '/fleet-optimizer',
  '/fleet-renewal',
  '/fleet-risk-score',
  '/fleet-utilization',
  '/forecasting',
  '/fuel-cards',
  '/fuel-delivery',
  '/fuel-efficiency',
  '/fuel-theft',
  '/gate-pass',
  '/geofencing',
  '/goods-receipt',
  '/gps-tracking',
  '/handovers',
  '/heat-intelligence',
  '/help',
  '/hours-of-service',
  '/ifta-reporting',
  '/incidents',
  '/inspection-intelligence',
  '/inspection-planner',
  '/inspections',
  '/insurance-claims',
  '/insurance-policies',
  '/integrations',
  '/journeys',
  '/knowledge-base',
  '/kpi',
  '/kpi-command',
  '/kpi-engine',
  '/live-fleet',
  '/load-planning',
  '/maintenance-calendar',
  '/maintenance-cost-board',
  '/marketplace',
  '/materials',
  '/my-checklists',
  '/ocr-scanner',
  '/odometer-logs',
  '/onboarding-wizard',
  '/ops-intelligence',
  '/parts-catalog',
  '/parts-requests',
  '/pm-programs',
  '/policies',
  '/position-intelligence',
  '/predictive-maintenance',
  '/pressure-intel',
  '/procurement',
  '/production-m3',
  '/proof-of-delivery',
  '/qr-labels',
  '/rca',
  '/recall-tracker',
  '/report-center',
  '/report-sharing',
  '/reports',
  '/requisitions',
  '/reservations',
  '/retread',
  '/retread-claims',
  '/rfid',
  '/roi-calculator',
  '/root-cause',
  '/rotation',
  '/rotation-optimizer',
  '/route-optimization',
  '/safety-compliance',
  '/sany-delay-penalty',
  '/sany-invoices',
  '/scheduled-reports',
  '/sco-costs',
  '/scrap',
  '/serial-tracker',
  '/service-requests',
  '/settings',
  '/shifts',
  '/site-comp',
  '/sites',
  '/sla-dashboard',
  '/speed-limiter',
  '/stock',
  '/stock-replenishment',
  '/suppliers',
  '/system-health',
  '/taas',
  '/tachograph',
  '/tco-calculator',
  '/technician-scorecard',
  '/telematics-devices',
  '/tenant-health',
  '/toll-transactions',
  '/tpms',
  '/trip-replay',
  '/trips',
  '/tyre-age-compliance',
  '/tyre-exchange',
  '/tyre-failure-cpk',
  '/tyre-lifecycle',
  '/tyre-passport',
  '/tyre-pool',
  '/tyre-service-events',
  '/tyre-size',
  '/tyre-specs',
  '/tyres',
  '/upload-approvals',
  '/vehicle-checkinout',
  '/vehicle-history',
  '/vehicle-washing',
  '/vendor-intelligence',
  '/video-telematics',
  '/warranty',
  '/weighbridge',
  '/work-orders',
  '/workflow-settings',
  '/workshop',
  '/workshop-absence',
  '/workshop-analytics',
  '/workshop-live',
  '/workshop-settings',
]

const catalogItems = () => NAV_CATALOG.flatMap((g) => g.items)

describe('sidebar re-group parity', () => {
  it('still exposes every route that existed before the re-group', () => {
    const now = new Set(catalogItems().map((i) => i.key))
    const lost = ROUTES_BEFORE_REGROUP.filter((r) => !now.has(r))
    expect(lost).toEqual([])
  })

  it('invents no route that did not exist before', () => {
    const before = new Set(ROUTES_BEFORE_REGROUP)
    const added = catalogItems().map((i) => i.key).filter((r) => !before.has(r))
    expect(added).toEqual([])
  })

  it('keeps every route unique', () => {
    const keys = catalogItems().map((i) => i.key)
    expect(keys.length).toBe(new Set(keys).size)
  })

  it('keeps NAV_CATALOG flat, because four console surfaces read that shape', () => {
    for (const g of NAV_CATALOG) {
      expect(Array.isArray(g.items)).toBe(true)
      for (const item of g.items) {
        expect(item).not.toHaveProperty('items')
        expect(item).not.toHaveProperty('children')
      }
    }
  })

  it('groups every route into a non-empty named group', () => {
    for (const g of NAV_CATALOG) {
      expect(typeof g.key === 'string' && g.key.length).toBeTruthy()
      expect(g.items.length).toBeGreaterThan(0)
    }
  })
})
