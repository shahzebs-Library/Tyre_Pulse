/**
 * Access Control tab render test (every ?tab= of /console/access, empty and error).
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

import ConsoleAuthBridge from '../console/ConsoleAuthBridge'
import ConsoleAccessControl from '../console/pages/ConsoleAccessControl'

const HARD_LEAKS = [/PGRST/, /permission denied/i, /for relation/i, /secret_audit_table/, /42501/]
const TABS = ['roles', 'web', 'mobile', 'people', 'custom', 'reviews', 'temporary', 'approvals', 'policies',
  'newareas', 'history', 'check', 'who', 'preview', 'country', 'bulk', 'delegation', 'capabilities', 'security',
  'manager', 'grants', 'audit', 'effective']

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
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  if (!window.ResizeObserver) window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  if (!window.IntersectionObserver) window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
  if (!window.HTMLElement.prototype.scrollIntoView) window.HTMLElement.prototype.scrollIntoView = () => {}
  globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
})
afterEach(() => { cleanup(); h.mode = 'empty' })

async function mount(tab) {
  const utils = render(
    <MemoryRouter initialEntries={[`/console/access?tab=${tab}`]}>
      <Boundary><ConsoleAuthBridge><Suspense fallback={<div>Loading</div>}>
        <div className="console-root"><ConsoleAccessControl /></div>
      </Suspense></ConsoleAuthBridge></Boundary>
    </MemoryRouter>,
  )
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 15)) })
  return utils
}

describe.each(TABS)('/console/access?tab=%s', (tab) => {
  it.each(['empty', 'error'])('renders in %s mode without crashing or leaking', async (mode) => {
    h.mode = mode
    const { container } = await mount(tab)
    const crashed = screen.queryByTestId('crashed')
    if (crashed) throw new Error(`${tab} crashed:\n${crashed.textContent.slice(0, 800)}`)
    const text = container.textContent
    expect(text).toMatch(/Access Control/)
    for (const re of HARD_LEAKS) expect(re.test(text), `${tab} leaks ${re}`).toBe(false)
    expect(/[\u2013\u2014]/.test(text), `${tab} shows an en or em dash`).toBe(false)
  }, 20000)
})
