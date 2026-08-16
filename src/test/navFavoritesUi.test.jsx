/**
 * Favourites + recents, as the user meets them: the sidebar Favourites section
 * and the command palette's empty state.
 *
 * `src/lib/navFavorites.js` is already unit-tested as pure logic; these tests
 * pin the behaviour that only exists once it is wired into a surface, and that
 * would be a real defect rather than a cosmetic one:
 *
 *  - A PINNED ROUTE THE USER MAY NOT OPEN IS NEVER RENDERED. Storage holds
 *    routes only and permission is re-evaluated at render, so revoking a module
 *    must remove it from favourites too. A cached "allowed" would turn a revoke
 *    into a still-clickable shortcut, which is the whole reason the store keeps
 *    nothing but a path.
 *  - Pinning from the nav puts the item in the Favourites section.
 *  - THE STAR NEVER NAVIGATES. It sits inside a nav row, so a stray click that
 *    routed instead of pinning would be maddening and easy to ship.
 *  - The palette shows shortcuts ONLY on an empty query; typing goes straight
 *    back to ranked results.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { FAVORITES_KEY, RECENTS_KEY, MAX_FAVORITES, loadFavorites } from '../lib/navFavorites'

/* ── Mocks ────────────────────────────────────────────────────────────────────
   Hoisted so the factories can read them and each test can drive a different
   permission shape through the same components. Everything mocked here is I/O,
   animation or an unrelated shell widget; the nav tree, the permission rules and
   the favourites resolvers are all REAL, because they are what is under test. */
const h = vi.hoisted(() => ({ auth: {}, palette: {} }))

// Only these keys are translated in the test locale, so every other label falls
// back to its plain English text - the same contract the components rely on.
const DICT = {
  'ui.command.groups.recent': 'Recent',
  'ui.command.groups.actions': 'Actions',
  'ui.command.groups.navigation': 'Navigation',
  'ui.command.groups.commands': 'Commands',
}
const t = (k) => DICT[k] ?? k

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t, isRTL: false, language: 'en' }) }))
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'All', contextKey: 'all' }),
}))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: null }) }))
vi.mock('../contexts/CommandPaletteContext', () => ({ useCommandPalette: () => h.palette }))

vi.mock('../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
  useFeatureGate: () => true,
}))
vi.mock('../hooks/useRealtime', () => ({ useRealtimeSync: () => {} }))
vi.mock('../hooks/useWakeLock', () => ({ useWakeLock: () => ({ acquire: () => {}, release: () => {} }) }))

vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('../lib/alertEngine', () => ({ detectAlertBadgeCount: () => Promise.resolve(0) }))
vi.mock('../lib/offlineQueue', () => ({
  syncPendingInspections: () => Promise.resolve(),
  getPendingCount: () => Promise.resolve(0),
  getFailedCount: () => Promise.resolve(0),
  getFailedInspections: () => Promise.resolve([]),
  retryFailedInspection: () => Promise.resolve(),
}))
vi.mock('../lib/api/navLayout', () => ({ getNavLayout: () => Promise.resolve({}) }))
vi.mock('../lib/api/brandLogo', () => ({ getCompanyLogo: () => Promise.resolve('') }))
vi.mock('../lib/brand/library', () => ({ resolveBrandLogo: () => '' }))

// Shell widgets that are not the subject and open their own subscriptions.
vi.mock('../components/shell/TopBar', () => ({ default: () => <div data-testid="topbar" /> }))
vi.mock('../components/MobileBottomNav', () => ({ default: () => null }))
vi.mock('../components/InstallPwaPrompt', () => ({ default: () => null }))
vi.mock('../components/OnboardingWizard', () => ({ default: () => null }))
vi.mock('../components/LanguageSwitcher', () => ({ default: () => null }))
vi.mock('../components/ui/ThemeToggle', () => ({ default: () => null }))
vi.mock('../components/ui/Breadcrumbs', () => ({ default: () => null }))

// framer-motion renders plain tags here: the animation props are noise in jsdom
// and React warns about unknown attributes if they reach the DOM.
vi.mock('framer-motion', async () => {
  const { createElement } = await import('react')
  const MOTION_ONLY = new Set([
    'initial', 'animate', 'exit', 'transition', 'variants', 'layoutId', 'layout',
    'whileHover', 'whileTap', 'whileFocus', 'whileInView', 'custom',
  ])
  const cache = new Map()
  const factory = (tag) => {
    if (!cache.has(tag)) {
      cache.set(tag, ({ children, ...rest }) => {
        const props = {}
        for (const [k, v] of Object.entries(rest)) if (!MOTION_ONLY.has(k)) props[k] = v
        return createElement(tag, props, children)
      })
    }
    return cache.get(tag)
  }
  return {
    motion: new Proxy({}, { get: (_target, tag) => (typeof tag === 'string' ? factory(tag) : undefined) }),
    AnimatePresence: ({ children }) => children,
  }
})

import Layout from '../components/Layout'
import CommandPalette from '../components/CommandPalette'

/* ── Harness ────────────────────────────────────────────────────────────────── */

// Renders the live route so a click that navigates is impossible to miss.
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="pathname">{location.pathname}</span>
}

function renderLayout({ favorites = [], recents = [], auth = {}, at = '/reports' } = {}) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
  h.auth = {
    profile: { role: 'Manager', full_name: 'Test Manager' },
    hasPermission: () => true,
    grantedModules: new Set(),
    isSuperAdmin: false,
    signOut: () => {},
    ...auth,
  }
  h.palette = { open: false, setOpen: () => {} }
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Layout><LocationProbe /></Layout>
    </MemoryRouter>,
  )
}

function renderPalette({ favorites = [], recents = [], auth = {} } = {}) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
  h.auth = {
    profile: { role: 'Admin', full_name: 'Test Admin' },
    hasPermission: () => true,
    grantedModules: new Set(),
    isSuperAdmin: true,
    ...auth,
  }
  h.palette = { open: true, setOpen: () => {} }
  return render(
    <MemoryRouter initialEntries={['/reports']}>
      <CommandPalette />
    </MemoryRouter>,
  )
}

/** The block a palette group header belongs to, so a label shared with the
 *  Navigation list below cannot satisfy an assertion about Favourites. */
function paletteGroup(heading) {
  return screen.getByText(heading).parentElement
}

beforeAll(() => {
  // jsdom implements neither of these; the palette scrolls its active row into
  // view and Layout reads the mobile breakpoint from matchMedia.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })
  }
})

beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup(); localStorage.clear() })

/* ── Sidebar ────────────────────────────────────────────────────────────────── */

describe('sidebar Favourites section', () => {
  it('hides a pinned route the user is not allowed to open', () => {
    // '/tyres' -> tyre_records, '/audit' -> audit_trail (navAccess.NAV_MODULE_KEY).
    // Revoking audit_trail must drop the pin, not just the nav row: a favourite
    // is re-checked on every render precisely so a revoke takes effect at once.
    renderLayout({
      favorites: ['/tyres', '/audit'],
      auth: { hasPermission: (key) => key !== 'audit_trail' },
    })

    const favs = screen.getByTestId('nav-favorites')
    expect(within(favs).getByText('Tyre Records')).toBeInTheDocument()
    expect(within(favs).queryByText('Audit Trail')).toBeNull()
    // and it is gone from the sidebar as a whole, so there is no back door.
    expect(screen.queryByText('Audit Trail')).toBeNull()
  })

  it('renders no Favourites section when every pin is unreachable', () => {
    renderLayout({ favorites: ['/audit'], auth: { hasPermission: () => false } })
    expect(screen.queryByTestId('nav-favorites')).toBeNull()
  })

  it('drops a pinned route that is no longer in the nav', () => {
    // A module removed or renamed leaves a dead path in storage. It must be
    // dropped, never invented into a row pointing nowhere.
    renderLayout({ favorites: ['/tyres', '/module-that-no-longer-exists'] })
    const favs = screen.getByTestId('nav-favorites')
    expect(within(favs).getByText('Tyre Records')).toBeInTheDocument()
    expect(within(favs).getAllByRole('link')).toHaveLength(1)
  })

  it('pins from the nav star and shows the item in Favourites', () => {
    renderLayout()
    expect(screen.queryByTestId('nav-favorites')).toBeNull()

    fireEvent.click(screen.getByLabelText('Add to favourites: Tyre Records'))

    const favs = screen.getByTestId('nav-favorites')
    expect(within(favs).getByText('Tyre Records')).toBeInTheDocument()
    expect(loadFavorites()).toContain('/tyres')
  })

  it('does not navigate when a star is clicked', () => {
    renderLayout({ favorites: ['/tyres'], at: '/reports' })
    expect(screen.getByTestId('pathname')).toHaveTextContent('/reports')

    const favs = screen.getByTestId('nav-favorites')
    fireEvent.click(within(favs).getByLabelText('Remove from favourites: Tyre Records'))

    // The click unpinned the item and left the user exactly where they were.
    expect(screen.getByTestId('pathname')).toHaveTextContent('/reports')
    expect(loadFavorites()).not.toContain('/tyres')
    expect(screen.queryByTestId('nav-favorites')).toBeNull()

    // Control: the row's own link DOES navigate, so the probe above would have
    // caught a star that routed. (Queried by text, not by role: an accessible
    // name lookup across ~200 nav links is pathologically slow in jsdom.)
    fireEvent.click(screen.getByText('Tyre Records').closest('a'))
    expect(screen.getByTestId('pathname')).toHaveTextContent('/tyres')
  })

  it('says so when a new pin replaces the oldest at the cap', () => {
    // navFavorites drops the OLDEST pin at MAX_FAVORITES so the click still
    // visibly works. That is a pin quietly disappearing, so the section has to
    // admit it rather than let the user discover it later.
    // '/' is deliberately absent: navFavorites rejects it as a route, so the
    // dashboard can never be pinned (nor recorded as a recent).
    const full = [
      '/assets', '/tyres', '/work-orders', '/stock', '/budgets', '/actions',
      '/rca', '/inspections', '/reports', '/gate-pass', '/scrap', '/settings',
    ]
    expect(full).toHaveLength(MAX_FAVORITES)
    renderLayout({ favorites: full })

    fireEvent.click(screen.getByLabelText('Add to favourites: Fleet Master'))

    const favs = screen.getByTestId('nav-favorites')
    expect(within(favs).getByText(/Favourites are full/i)).toBeInTheDocument()
    expect(loadFavorites()).toContain('/fleet-master')
    expect(loadFavorites()).toHaveLength(MAX_FAVORITES)
  })

  it('offers a star on nav rows without ever nesting it inside the link', () => {
    // A button inside an anchor is invalid markup and one stray click would
    // route instead of pinning, so the star must be a sibling of the NavLink.
    renderLayout()
    const star = screen.getByLabelText('Add to favourites: Tyre Records')
    expect(star.tagName).toBe('BUTTON')
    expect(star.closest('a')).toBeNull()
  })
})

/* ── Command palette ────────────────────────────────────────────────────────── */

describe('command palette shortcuts', () => {
  it('lists favourites and recents on the empty query', () => {
    renderPalette({ favorites: ['/tyres'], recents: ['/work-orders'] })

    expect(within(paletteGroup('Favourites')).getByText('Tyre Records')).toBeInTheDocument()
    expect(within(paletteGroup('Recent')).getByText('Work Orders')).toBeInTheDocument()
  })

  it('drops a favourite the palette itself would not list', () => {
    // Same rule as the sidebar: the gate is the palette's own visibility filter
    // (visibleCommands), so a shortcut can never reach a page the palette would
    // refuse to show. The allowed pin alongside it proves the block still ran.
    renderPalette({
      favorites: ['/audit', '/tyres'],
      auth: {
        profile: { role: 'Manager', full_name: 'Test Manager' },
        isSuperAdmin: false,
        hasPermission: (key) => key !== 'audit_trail',
      },
    })

    const favs = paletteGroup('Favourites')
    expect(within(favs).getByText('Tyre Records')).toBeInTheDocument()
    expect(within(favs).queryByText('Audit Trail')).toBeNull()
    expect(screen.queryByText('Audit Trail')).toBeNull()
  })

  it('shows no shortcut blocks once the user types', () => {
    renderPalette({ favorites: ['/tyres'], recents: ['/work-orders'] })
    expect(screen.getByText('Favourites')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'budget' } })

    expect(screen.queryByText('Favourites')).toBeNull()
    expect(screen.queryByText('Recent')).toBeNull()
    expect(screen.getByText('Commands')).toBeInTheDocument()
  })
})
