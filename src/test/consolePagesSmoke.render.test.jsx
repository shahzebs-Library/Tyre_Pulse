/**
 * Console render smoke test.
 *
 * Mounts EVERY page listed in the console sidebar (CONSOLE_NAV) against a mocked
 * Supabase client in two states:
 *   - empty: every read resolves with no rows
 *   - error: every read, RPC and edge-function call fails with raw Postgres /
 *     PostgREST text
 *
 * For each page it asserts: no crash (no error boundary, no thrown render), a
 * heading renders, the page is not blank, and no raw database error text leaks
 * into the UI. None of these pages had ever been rendered in a browser, so this
 * is the cheapest guard that each one at least paints and fails honestly.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, cleanup, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Suspense, Component } from 'react'

vi.mock('react-chartjs-2', () => ({
  Bar: () => null, Doughnut: () => null, Line: () => null, Pie: () => null,
  Radar: () => null, PolarArea: () => null, Scatter: () => null, Bubble: () => null, Chart: () => null,
}))
vi.mock('../console/components/ui/charts', async (importOriginal) => {
  const real = await importOriginal()
  const Stub = ({ summary }) => <div data-testid="chart">{summary || null}</div>
  return {
    ...real,
    TrendChart: Stub, BarsChart: Stub, ShareChart: Stub,
    ScoreRing: ({ score }) => <div data-testid="score">{score ?? 'N/A'}</div>,
    useChartTheme: () => 'dark',
  }
})
vi.mock('../components/charts/EChart', () => ({ default: () => <div data-testid="echart" /> }))

const h = vi.hoisted(() => ({ mode: 'empty' }))

vi.mock('../lib/supabase', () => {
  const rawError = () => ({
    message: 'permission denied for relation secret_audit_table (PGRST301)',
    code: '42501',
    details: 'PGRST301: relation "secret_audit_table" permission denied',
    hint: null,
  })
  const result = (shape) => {
    if (h.mode === 'error') return { data: null, error: rawError(), count: null, status: 403 }
    if (shape === 'single') return { data: null, error: null, count: 0, status: 200 }
    return { data: [], error: null, count: 0, status: 200 }
  }
  // A chainable PostgREST-style builder: any method returns the builder, and
  // awaiting it resolves the result. `.single()/.maybeSingle()` flip the shape.
  const builder = (initialShape = 'list') => {
    let shape = initialShape
    const target = function () {}
    const proxy = new Proxy(target, {
      get(_t, prop) {
        if (prop === 'then') {
          const p = Promise.resolve(result(shape))
          return p.then.bind(p)
        }
        if (prop === 'catch' || prop === 'finally') {
          const p = Promise.resolve(result(shape))
          return p[prop].bind(p)
        }
        if (prop === 'single' || prop === 'maybeSingle') {
          return () => { shape = 'single'; return proxy }
        }
        if (typeof prop === 'symbol') return undefined
        return () => proxy
      },
      apply() { return proxy },
    })
    return proxy
  }
  const channel = () => {
    const ch = {
      on: () => ch,
      subscribe: (cb) => { if (typeof cb === 'function') cb('SUBSCRIBED'); return ch },
      unsubscribe: () => Promise.resolve('ok'),
      send: () => Promise.resolve('ok'),
    }
    return ch
  }
  const user = { id: 'admin-1', email: 'admin@example.com' }
  const auth = {
    getUser: () => Promise.resolve({ data: { user }, error: null }),
    getSession: () => Promise.resolve({ data: { session: { user, access_token: 't' } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signOut: () => Promise.resolve({ error: null }),
    signInWithPassword: () => Promise.resolve({ data: {}, error: null }),
    refreshSession: () => Promise.resolve({ data: {}, error: null }),
    updateUser: () => Promise.resolve({ data: {}, error: null }),
    mfa: {
      listFactors: () => Promise.resolve({ data: { all: [], totp: [] }, error: null }),
      getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }),
      enroll: () => Promise.resolve({ data: null, error: null }),
      challenge: () => Promise.resolve({ data: null, error: null }),
      verify: () => Promise.resolve({ data: null, error: null }),
      unenroll: () => Promise.resolve({ data: null, error: null }),
    },
  }
  const storageBucket = {
    list: () => Promise.resolve(result('list')),
    upload: () => Promise.resolve(result('single')),
    remove: () => Promise.resolve(result('list')),
    download: () => Promise.resolve(result('single')),
    createSignedUrl: () => Promise.resolve(result('single')),
    createSignedUrls: () => Promise.resolve(result('list')),
    getPublicUrl: () => ({ data: { publicUrl: '' } }),
  }
  const supabase = {
    from: () => builder('list'),
    rpc: () => builder('single'),
    schema: () => ({ from: () => builder('list'), rpc: () => builder('single') }),
    functions: { invoke: () => Promise.resolve(result('single')) },
    storage: { from: () => storageBucket },
    channel,
    removeChannel: () => Promise.resolve('ok'),
    removeAllChannels: () => Promise.resolve([]),
    getChannels: () => [],
    auth,
  }
  return { supabase, IS_CONSOLE_SURFACE: true, AUTH_STORAGE_KEY: 'tp_console_auth', default: supabase }
})

const consoleAuth = {
  admin: { id: 'admin-1', email: 'admin@example.com', full_name: 'Test Admin', role: 'Admin', is_super_admin: true },
  loading: false,
  activeOrg: null, setActiveOrg: () => {}, orgs: [], loadOrgs: () => Promise.resolve([]),
  signIn: vi.fn(), verifyMfa: vi.fn(), enrollMfa: vi.fn(), confirmMfaEnrollment: vi.fn(),
  unenrollMfa: vi.fn(), listMfaFactors: vi.fn(() => Promise.resolve([])),
  signOut: vi.fn(), logAction: vi.fn(() => Promise.resolve()), ipBlocked: null,
}
vi.mock('../console/ConsoleAuthContext', () => ({
  useConsoleAuth: () => consoleAuth,
  ConsoleAuthProvider: ({ children }) => children,
}))

import { CONSOLE_NAV } from '../console/components/ConsoleLayout'
import ConsoleAuthBridge from '../console/ConsoleAuthBridge'

// Route -> page module, mirroring the /console routes in App.jsx.
const PAGES = {
  '/console': () => import('../console/pages/ConsoleDashboard'),
  '/console/health': () => import('../console/pages/ConsoleSystemHealth'),
  '/console/platform-map': () => import('../console/pages/ConsolePlatformMap'),
  '/console/crash-reports': () => import('../console/pages/ConsoleCrashReports'),
  '/console/security-audit': () => import('../console/pages/ConsoleSecurityAudit'),
  '/console/audit-trail': () => import('../console/pages/ConsoleAuditTrail'),
  '/console/audit-integrity': () => import('../console/pages/ConsoleAuditIntegrity'),
  '/console/sessions': () => import('../console/pages/ConsoleSessions'),
  '/console/security': () => import('../console/pages/ConsoleSecurity'),
  '/console/support-sessions': () => import('../console/pages/ConsoleSupportSessions'),
  '/console/api-keys': () => import('../console/pages/ConsoleApiKeys'),
  '/console/compliance': () => import('../console/pages/ConsoleCompliance'),
  '/console/approvals': () => import('../console/pages/ConsoleApprovals'),
  '/console/incidents': () => import('../console/pages/ConsoleIncidents'),
  '/console/jit-elevation': () => import('../console/pages/ConsoleJitElevation'),
  '/console/access-policies': () => import('../console/pages/ConsoleAccessPolicies'),
  '/console/users': () => import('../console/pages/ConsoleUsers'),
  '/console/access': () => import('../console/pages/ConsoleAccessControl'),
  '/console/access-reviews': () => import('../console/pages/ConsoleAccessReviews'),
  '/console/organisations': () => import('../console/pages/ConsoleOrganisations'),
  '/console/account-deletions': () => import('../console/pages/ConsoleAccountDeletions'),
  '/console/control-center': () => import('../console/pages/ConsoleControlCenter'),
  '/console/data-quality': () => import('../console/pages/ConsoleDataQuality'),
  '/console/reconciliation': () => import('../console/pages/ConsoleReconciliation'),
  '/console/trust-alerts': () => import('../console/pages/ConsoleTrustAlerts'),
  '/console/correction-center': () => import('../console/pages/ConsoleCorrectionCenter'),
  '/console/lineage': () => import('../console/pages/ConsoleLineageExplorer'),
  '/console/metric-catalogue': () => import('../console/pages/ConsoleMetricCatalogue'),
  '/console/pipeline-monitor': () => import('../console/pages/ConsolePipelineMonitor'),
  '/console/releases': () => import('../console/pages/ConsoleReleases'),
  '/console/data-ops': () => import('../console/pages/ConsoleDataOps'),
  '/console/import-history': () => import('../console/pages/ConsoleImportHistory'),
  '/console/smart-import': () => import('../console/pages/ConsoleSmartImport'),
  '/console/material-master': () => import('../console/pages/ConsoleMaterialMaster'),
  '/console/classification-learning': () => import('../console/pages/ConsoleClassificationLearning'),
  '/console/data-learning': () => import('../console/pages/ConsoleDataLearning'),
  '/console/duplicates': () => import('../console/pages/ConsoleDuplicateControl'),
  '/console/data-browser': () => import('../console/pages/ConsoleDataBrowser'),
  '/console/data-cleanup': () => import('../console/pages/ConsoleDataCleanup'),
  '/console/tenant-export': () => import('../console/pages/ConsoleTenantExport'),
  '/console/backups': () => import('../console/pages/ConsoleBackups'),
  '/console/alert-rules': () => import('../console/pages/ConsoleAlertRules'),
  '/console/automation': () => import('../console/pages/ConsoleAutomation'),
  '/console/delivery': () => import('../console/pages/ConsoleDelivery'),
  '/console/self-healing': () => import('../console/pages/ConsoleSelfHealing'),
  '/console/announcements': () => import('../console/pages/ConsoleAnnouncements'),
  '/console/ai-usage': () => import('../console/pages/ConsoleAIUsage'),
  '/console/ai-admin': () => import('../pages/AiAdministration'),
  '/console/config': () => import('../console/pages/ConsoleSystemConfig'),
  '/console/module-control': () => import('../console/pages/ConsoleModuleControl'),
  '/console/navigation': () => import('../console/pages/ConsoleNavigation'),
  '/console/mobile-app': () => import('../console/pages/ConsoleMobileApp'),
  '/console/appearance': () => import('../console/pages/ConsoleReportAppearance'),
  '/console/vehicle-designer': () => import('../console/pages/ConsoleVehicleDesigner'),
}

const NAV_ITEMS = CONSOLE_NAV.flatMap((g) => g.items)

// Raw fragments that mean a database error reached the screen. The injected
// error carries all of them, so any one appearing is the raw text leaking.
// A page whose every read failed must say so - otherwise the failure reads as
// "there is nothing here", which is the opposite claim.
const ERROR_WORDING = /could not|couldn't|cannot|can't|unable|failed|not available|unavailable|permission|try again|went wrong|error|retry|unreadable|not provisioned|not configured/i
// Pages that read nothing until the operator acts (no effect on mount), so a
// failing backend has nothing to report yet.
const NO_MOUNT_READS = new Set(['/console/smart-import'])
const HARD_LEAKS = [/PGRST/, /permission denied/i, /for relation/i, /relation "/i, /secret_audit_table/, /42501/]

class Boundary extends Component {
  constructor(p) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch() {}
  render() {
    if (this.state.error) return <div data-testid="crashed">{String(this.state.error?.stack || this.state.error)}</div>
    return this.props.children
  }
}

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
  if (!window.HTMLElement.prototype.scrollIntoView) window.HTMLElement.prototype.scrollIntoView = () => {}
  globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
})

afterEach(() => { cleanup(); h.mode = 'empty' })

async function mount(path) {
  const mod = await PAGES[path]()
  const Page = mod.default
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <Boundary>
        <ConsoleAuthBridge>
          <Suspense fallback={<div>Loading</div>}>
            <div className="console-root"><Page /></div>
          </Suspense>
        </ConsoleAuthBridge>
      </Boundary>
    </MemoryRouter>,
  )
  // Let every mocked read settle and any follow-up effects run.
  for (let i = 0; i < 6; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 15)) })
  }
  return utils
}

function assertHealthy(container, path) {
  const crashed = screen.queryByTestId('crashed')
  if (crashed) throw new Error(`${path} crashed:\n${crashed.textContent.slice(0, 800)}`)
  const headings = container.querySelectorAll('h1, h2, h3')
  expect(headings.length, `${path} renders no heading`).toBeGreaterThan(0)
  const text = container.textContent.replace(/\s+/g, ' ').trim()
  expect(text.length, `${path} is blank`).toBeGreaterThan(20)
  return text
}

describe('console pages smoke', () => {
  it('covers every console sidebar entry', () => {
    const missing = NAV_ITEMS.map((i) => i.to).filter((to) => !PAGES[to])
    expect(missing).toEqual([])
    expect(NAV_ITEMS.length).toBeGreaterThan(40)
  })

  describe.each(NAV_ITEMS.map((i) => [i.label, i.to]))('%s (%s)', (_label, path) => {
    it('renders with empty data', async () => {
      h.mode = 'empty'
      const { container } = await mount(path)
      assertHealthy(container, path)
    }, 20000)

    it('renders an honest error state without leaking raw errors', async () => {
      h.mode = 'error'
      const { container } = await mount(path)
      const text = assertHealthy(container, path)
      if (!NO_MOUNT_READS.has(path)) expect(ERROR_WORDING.test(text), `${path} failed every read but shows no error message: ${text.slice(0, 300)}`).toBe(true)
      for (const re of HARD_LEAKS) {
        expect(re.test(text), `${path} leaks raw error text matching ${re}: "${text.match(re)?.[0]}" in ...${text.slice(Math.max(0, text.search(re) - 80), text.search(re) + 80)}`).toBe(false)
      }
    }, 20000)
  })
})

