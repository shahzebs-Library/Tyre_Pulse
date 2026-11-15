import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
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
  '/asset-management',
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
  '/checklist-audit',
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

// Routes added DELIBERATELY since the re-group. A genuinely new module legitimately
// adds a route, so the inverse guard below has to admit it - but it is kept in its own
// list rather than folded into ROUTES_BEFORE_REGROUP, whose name would otherwise become
// a lie. Adding an entry here is a deliberate act that says "this route is new".
const ROUTES_ADDED_SINCE_REGROUP = [
  '/repair-requests',
  '/store-material-issue',
  '/driver-workspace',
  '/request-access',
  '/daily-ops/workshop',
  '/workforce-daily',
  '/ai-tyre-inspection',
  // The single Executive menu entry (lands on the executive page the user may open).
  '/executive',
]

// Routes folded DELIBERATELY into a deeper page (owner instruction: one page per job,
// the weaker duplicate is switched off). Each old route must (a) be gone from the
// sidebar, (b) redirect in App.jsx to its keeper, and (c) have a keeper that is itself
// still in the sidebar, so nothing became unreachable. Adding an entry here is a
// deliberate act that says "this page now lives as a tab of that one".
const ROUTES_MERGED_INTO = {
  '/analytics': '/advanced-analytics',
  '/comparison': '/site-comp?tab=periods',
  '/erp-import': '/data-intake?tab=templates',
  '/erp-intake': '/data-intake?tab=reports',
  '/expense-import': '/data-intake?tab=expenses',
  '/safety-compliance': '/compliance?tab=safety',
  '/tyre-failure-cpk': '/cpk-intelligence?tab=failures',
  '/workshop': '/work-orders?tab=analytics',
  '/asset-management': '/fleet-master?tab=analysis',
}

// Routes that left the sidebar but are STILL real pages, reached from the tab bar
// of a single menu entry (owner instruction: one KPI entry, one Executive entry).
// Each must still be a routed page in App.jsx (not a redirect), must be listed in
// the shared tab bar, and its menu entry must be in the sidebar.
const ROUTES_NOW_TABS = {
  '/kpi-engine': '/kpi',
  '/kpi-command': '/kpi',
  '/executive-report': '/executive',
  '/executive-analytics': '/executive',
}

const TABS_SOURCE = readFileSync(join(process.cwd(), 'src/components/ui/SectionTabs.jsx'), 'utf8').replace(/\r\n/g, '\n')

const APP_SOURCE = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8').replace(/\r\n/g, '\n')

const catalogItems = () => NAV_CATALOG.flatMap((g) => g.items)

describe('sidebar re-group parity', () => {
  it('still exposes every route that existed before the re-group', () => {
    const now = new Set(catalogItems().map((i) => i.key))
    const lost = ROUTES_BEFORE_REGROUP.filter((r) => !now.has(r))
    // The only routes allowed to leave the sidebar are the ones merged into a keeper.
    // ... or the ones now reached from a single menu entry's tab bar.
    expect(lost).toEqual([...Object.keys(ROUTES_MERGED_INTO), ...Object.keys(ROUTES_NOW_TABS)].sort())
  })

  it('every merged route redirects to a keeper that is still in the sidebar', () => {
    const now = new Set(catalogItems().map((i) => i.key))
    for (const [from, to] of Object.entries(ROUTES_MERGED_INTO)) {
      expect(now.has(from), `${from} is merged, so it must not also be a sidebar item`).toBe(false)
      expect(now.has(to.split('?')[0]), `keeper ${to} must be reachable from the sidebar`).toBe(true)
      const redirect = `<Route path="${from}"`
      const line = APP_SOURCE.split('\n').find((l) => l.includes(redirect))
      expect(line, `App.jsx must still answer ${from}`).toBeTruthy()
      expect(line).toContain(`<Navigate to="${to}" replace />`)
    }
  })

  it('every page moved behind a tab bar is still routed, listed in the tab bar, and has its menu entry', () => {
    const now = new Set(catalogItems().map((i) => i.key))
    for (const [route, entry] of Object.entries(ROUTES_NOW_TABS)) {
      expect(now.has(route), `${route} must not also be a sidebar item`).toBe(false)
      expect(now.has(entry), `menu entry ${entry} must be in the sidebar`).toBe(true)
      const line = APP_SOURCE.split('\n').find((l) => l.includes(`<Route path="${route}"`))
      expect(line, `App.jsx must still route ${route}`).toBeTruthy()
      expect(line, `${route} must stay a real page, not a redirect`).not.toContain('<Navigate')
      expect(TABS_SOURCE, `${route} must be reachable from the shared tab bar`).toContain(`to: '${route}'`)
    }
  })

  it('the Executive entry is shown by the unchanged rules of its two pages', () => {
    const layout = readFileSync(join(process.cwd(), 'src/components/Layout.jsx'), 'utf8')
    // The members are the OLD nav items, so visibility cannot drift from before.
    expect(layout).toMatch(/\{ to: '\/executive-report', adminOnly: A \}/)
    expect(layout).toMatch(/\{ to: '\/executive-analytics', roles: ANALYTICS_ROLES \}/)
    expect(layout).toMatch(/item\.anyOf\.some\(\(m\) => shouldShowNavItem\(m,/)
  })

  it('invents no route that did not exist before', () => {
    const before = new Set([...ROUTES_BEFORE_REGROUP, ...ROUTES_ADDED_SINCE_REGROUP])
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
