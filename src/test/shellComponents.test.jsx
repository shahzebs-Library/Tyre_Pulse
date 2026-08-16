/**
 * Shell component tests - TopBar / WorkingContextSelector / ProfileMenu /
 * ReportingScopeBar.
 *
 * These four carry the app's global controls, so the invariants pinned here are
 * the ones whose failure would be a real defect rather than a cosmetic one:
 *
 *  - a user with ONE place gets a STATIC label, not a dropdown that does nothing
 *  - a country absent from allowedContext is NEVER rendered, in any form
 *  - a CUSTOM role never leaks its raw `roles.<name>` i18n key (this app has
 *    shipped that bug before)
 *  - no user-facing string carries an em dash, en dash or middle dot (repo rule)
 *
 * The contexts are mocked rather than provided so each component can be rendered
 * in isolation and the permission inputs driven directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

/* ── Mocks ────────────────────────────────────────────────────────────────────
   Hoisted so the mock factories below can read them, and reassigned per test to
   drive different permission shapes through the same components. */
const h = vi.hoisted(() => ({
  settings: {},
  auth: {},
}))

vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => h.settings,
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => h.auth,
}))

vi.mock('../contexts/CommandPaletteContext', () => ({
  useCommandPalette: () => ({ open: false, setOpen: vi.fn() }),
}))

// The theme context is I/O-free but touches document/localStorage; a flat stub
// keeps these tests about the shell, not about theming.
vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ mode: 'dark', theme: 'dark', isDark: true, setTheme: vi.fn(), toggleTheme: vi.fn() }),
}))

// NotificationCenter opens realtime subscriptions of its own; the shell only
// needs to know it is mounted in the right slot.
vi.mock('../components/NotificationCenter', () => ({
  default: () => <button type="button" aria-label="Notifications">bell</button>,
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, ...p }) => <a {...p}>{children}</a>,
  NavLink: ({ children, ...p }) => <a {...p}>{children}</a>,
}))

import TopBar from '../components/shell/TopBar'
import WorkingContextSelector from '../components/shell/WorkingContextSelector'
import ProfileMenu from '../components/shell/ProfileMenu'
import ReportingScopeBar from '../components/shell/ReportingScopeBar'

/* ── Fixtures shaped like the real permission-filtered tree ──────────────────
   KSA carries regions; UAE and Egypt carry sites with no region at all, which is
   the real shape in this data and the case that must not grow a placeholder
   region level. */
const KSA = {
  country: 'KSA',
  regions: [
    { region: 'CENTRAL', sites: ['QIDDIYA-UPPER PLATEAU', 'DIRIYAH-G1'] },
    { region: 'WESTERN', sites: ['AMAALA', 'RED SEA'] },
  ],
  sites: ['AMAALA', 'DIRIYAH-G1', 'JED', 'QIDDIYA-UPPER PLATEAU', 'RED SEA'],
}
const UAE = { country: 'UAE', regions: [], sites: ['DUBAI YARD', 'SHARJAH'] }
const EGYPT = { country: 'Egypt', regions: [], sites: ['CAIRO'] }

const MULTI = [KSA, UAE, EGYPT]
const SINGLE = [{ country: 'KSA', regions: [], sites: ['QIDDIYA-UPPER PLATEAU'] }]

function baseSettings(over = {}) {
  return {
    appSettings: { company_name: 'Green Concrete', currency: 'SAR' },
    systemConfig: {},
    activeCountry: 'KSA',
    activeCurrency: 'SAR',
    workingContext: { country: 'KSA', region: 'CENTRAL', site: 'QIDDIYA-UPPER PLATEAU' },
    setWorkingContext: vi.fn(),
    allowedContext: MULTI,
    canSwitchWorkingContext: true,
    reportingScope: { countries: ['All'] },
    setReportingScope: vi.fn(),
    allowedScopeCountries: ['KSA', 'UAE', 'Egypt'],
    ...over,
  }
}

function baseAuth(over = {}) {
  return {
    profile: { full_name: 'Anum Khan', username: 'shahzeb', role: 'Admin' },
    isSuperAdmin: false,
    signOut: vi.fn(),
    ...over,
  }
}

beforeEach(() => {
  h.settings = baseSettings()
  h.auth = baseAuth()
  try { localStorage.clear() } catch { /* jsdom storage always present */ }
})

afterEach(() => cleanup())

/* ── TopBar ─────────────────────────────────────────────────────────────────── */

describe('TopBar', () => {
  it('renders and exposes the global search trigger', () => {
    render(<TopBar onToggleSidebar={vi.fn()} sidebarOpen appIcon="/logo.svg" />)
    const search = screen.getByRole('button', { name: /search asset, tyre, serial/i })
    expect(search).toBeTruthy()
  })

  it('shows a keyboard hint on desktop and hides it on mobile', () => {
    const { unmount } = render(<TopBar onToggleSidebar={vi.fn()} sidebarOpen appIcon="/logo.svg" />)
    expect(/Ctrl K|Cmd K/.test(document.body.textContent)).toBe(true)
    unmount()

    render(<TopBar onToggleSidebar={vi.fn()} isMobile appIcon="/logo.svg" />)
    expect(/Ctrl K|Cmd K/.test(document.body.textContent)).toBe(false)
  })

  it('calls onToggleSidebar when the sidebar control is used', () => {
    const onToggleSidebar = vi.fn()
    render(<TopBar onToggleSidebar={onToggleSidebar} sidebarOpen appIcon="/logo.svg" />)
    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    expect(onToggleSidebar).toHaveBeenCalled()
  })

  it('renders an alert badge on mobile only when there is something to report', () => {
    const { unmount } = render(<TopBar onToggleSidebar={vi.fn()} isMobile alertCount={0} appIcon="/logo.svg" />)
    expect(screen.getByRole('button', { name: /^alerts$/i })).toBeTruthy()
    unmount()

    render(<TopBar onToggleSidebar={vi.fn()} isMobile alertCount={4} appIcon="/logo.svg" />)
    expect(screen.getByRole('button', { name: /alerts \(4\)/i })).toBeTruthy()
  })

  it('mounts with an unresolved settings context without throwing', () => {
    // The shell must survive a first paint before the context has loaded.
    h.settings = {}
    expect(() => render(<TopBar onToggleSidebar={vi.fn()} appIcon="/logo.svg" />)).not.toThrow()
  })
})

/* ── WorkingContextSelector ─────────────────────────────────────────────────── */

describe('WorkingContextSelector', () => {
  it('renders a STATIC label with no dropdown when the user cannot switch', () => {
    h.settings = baseSettings({
      allowedContext: SINGLE,
      canSwitchWorkingContext: false,
      workingContext: { country: 'KSA', region: null, site: 'QIDDIYA-UPPER PLATEAU' },
    })
    const { container } = render(<WorkingContextSelector />)

    // The place is stated...
    expect(screen.getByText('QIDDIYA-UPPER PLATEAU')).toBeTruthy()
    // ...and there is nothing to press. A dropdown that cannot change anything
    // teaches the user the control lies.
    expect(container.querySelectorAll('button').length).toBe(0)
    expect(container.querySelector('[aria-haspopup]')).toBeNull()
  })

  it('renders an interactive control when the user CAN switch', () => {
    render(<WorkingContextSelector />)
    const trigger = screen.getByRole('button', { name: /working location/i })
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens a picker offering every permitted country', () => {
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))

    // Scoped to the dialog: the trigger itself also prints the current country
    // as its subtitle, so an unscoped getByText('KSA') is ambiguous by design.
    const picker = within(screen.getByRole('dialog', { name: /working location/i }))
    expect(picker.getByText('KSA')).toBeTruthy()
    expect(picker.getByText('UAE')).toBeTruthy()
    expect(picker.getByText('Egypt')).toBeTruthy()
  })

  it('never renders a country absent from allowedContext', () => {
    // Only KSA is permitted; UAE and Egypt must not appear anywhere, not even
    // disabled - an unreachable location on screen reads as a permission bug.
    h.settings = baseSettings({
      allowedContext: [KSA],
      allowedScopeCountries: ['KSA'],
    })
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))

    const picker = within(screen.getByRole('dialog', { name: /working location/i }))
    expect(picker.getByText('KSA')).toBeTruthy()
    expect(picker.queryByText('UAE')).toBeNull()
    expect(picker.queryByText('Egypt')).toBeNull()
    expect(picker.queryByText('DUBAI YARD')).toBeNull()
    expect(picker.queryByText('CAIRO')).toBeNull()
  })

  it('offers a country with no regions its sites directly, with no region level', () => {
    h.settings = baseSettings({
      allowedContext: [UAE],
      workingContext: { country: 'UAE', region: null, site: 'SHARJAH' },
      allowedScopeCountries: ['UAE'],
    })
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))

    // The branch holding the current selection opens already expanded, so the
    // user never has to hunt for where they already are. Read off the node's own
    // aria-expanded rather than off a "Collapse UAE" button label: the twisty is
    // decorative now that the treeitem carries the state, and the state is the
    // thing a screen reader actually announces.
    const picker = within(screen.getByRole('dialog', { name: /working location/i }))
    expect(picker.getByRole('treeitem', { name: /UAE/ }).getAttribute('aria-expanded')).toBe('true')
    expect(picker.getByText('DUBAI YARD')).toBeTruthy()
    expect(picker.getByText('SHARJAH')).toBeTruthy()
    // No invented region placeholder for a country the register gives none.
    expect(document.body.textContent).not.toMatch(/unassigned|no region/i)
  })

  it('writes the selected place through setWorkingContext', () => {
    const setWorkingContext = vi.fn()
    h.settings = baseSettings({ setWorkingContext })
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))
    // The country row itself is selectable: a country with several sites means
    // "the whole country", region and site cleared.
    fireEvent.click(screen.getByText('UAE'))

    expect(setWorkingContext).toHaveBeenCalledWith({ country: 'UAE', region: null, site: null })
  })

  it('does not render a stale recent the user may no longer reach', () => {
    // A recents entry is a cached convenience, not an authorisation.
    localStorage.setItem(
      'tp_context_recents',
      JSON.stringify([{ country: 'Egypt', region: null, site: 'CAIRO' }]),
    )
    h.settings = baseSettings({ allowedContext: [KSA], allowedScopeCountries: ['KSA'] })
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))

    expect(screen.queryByText('CAIRO')).toBeNull()
  })

  it('mounts with an unresolved context without throwing', () => {
    h.settings = {}
    expect(() => render(<WorkingContextSelector />)).not.toThrow()
  })
})

/* ── ProfileMenu ────────────────────────────────────────────────────────────── */

describe('ProfileMenu', () => {
  it('renders the name, role and sign-out', () => {
    render(<ProfileMenu />)
    fireEvent.click(screen.getByRole('button', { name: /account/i }))

    expect(screen.getByText('Anum Khan')).toBeTruthy()
    expect(screen.getByText('Admin')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeTruthy()
  })

  it('does not leak a raw roles. i18n key for a CUSTOM role', () => {
    // A custom role has no `roles.<name>` entry, so an unguarded t() would print
    // "roles.Fleet Supervisor" straight onto the menu.
    h.auth = baseAuth({
      profile: { full_name: 'Sara Ali', username: 'sara', role: 'Fleet Supervisor' },
    })
    render(<ProfileMenu />)
    fireEvent.click(screen.getByRole('button', { name: /account/i }))

    expect(screen.getByText('Fleet Supervisor')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/roles\./)
  })

  it('shows the company and the current working location as status, not a control', () => {
    render(<ProfileMenu />)
    fireEvent.click(screen.getByRole('button', { name: /account/i }))

    expect(screen.getByText('Green Concrete')).toBeTruthy()
    // Rendered by the shared contextLabel helper: "SITE - COUNTRY".
    expect(screen.getByText(/QIDDIYA-UPPER PLATEAU/)).toBeTruthy()
    // The menu must not offer a second way to WRITE the working context.
    expect(screen.queryByRole('dialog', { name: /working location/i })).toBeNull()
  })

  it('renders a version only when system_config.app_version is set', () => {
    const { unmount } = render(<ProfileMenu />)
    fireEvent.click(screen.getByRole('button', { name: /account/i }))
    // Never a fabricated version number.
    expect(document.body.textContent).not.toMatch(/\bv\d/)
    unmount()

    h.settings = baseSettings({ systemConfig: { app_version: '"2.4.1"' } })
    render(<ProfileMenu />)
    fireEvent.click(screen.getByRole('button', { name: /account/i }))
    expect(document.body.textContent).toMatch(/v2\.4\.1/)
  })

  it('signs out through AuthContext rather than reimplementing the teardown', () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    h.auth = baseAuth({ signOut })
    render(<ProfileMenu />)
    fireEvent.click(screen.getByRole('button', { name: /account/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /sign out/i }))

    expect(signOut).toHaveBeenCalled()
  })

  it('carries the language switcher only when asked (mobile)', () => {
    const { unmount } = render(<ProfileMenu />)
    fireEvent.click(screen.getByRole('button', { name: /account/i }))
    expect(screen.queryByRole('group', { name: /language/i })).toBeNull()
    unmount()

    render(<ProfileMenu showLanguage />)
    fireEvent.click(screen.getByRole('button', { name: /account/i }))
    expect(screen.getByRole('group', { name: /language/i })).toBeTruthy()
  })
})

/* ── ReportingScopeBar ──────────────────────────────────────────────────────── */

describe('ReportingScopeBar', () => {
  it('renders the resolved scope label', () => {
    render(<ReportingScopeBar />)
    expect(screen.getByRole('button', { name: /scope: all countries/i })).toBeTruthy()
  })

  it('multi-selects countries and never writes the working context', () => {
    const setReportingScope = vi.fn()
    const setWorkingContext = vi.fn()
    h.settings = baseSettings({
      setReportingScope,
      setWorkingContext,
      reportingScope: { countries: ['KSA', 'UAE'] },
    })
    render(<ReportingScopeBar />)
    fireEvent.click(screen.getByRole('button', { name: /change reporting scope/i }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Egypt$/ }))

    expect(setReportingScope).toHaveBeenCalled()
    // Selecting all three collapses to the ALL sentinel rather than listing them.
    expect(setReportingScope.mock.calls[0][0]).toEqual({ countries: ['All'] })
    // The operational selection must be untouched by a reporting choice.
    expect(setWorkingContext).not.toHaveBeenCalled()
  })

  it('refuses to empty the scope, so a report can never cover nothing', () => {
    const setReportingScope = vi.fn()
    h.settings = baseSettings({ setReportingScope, reportingScope: { countries: ['KSA'] } })
    render(<ReportingScopeBar />)
    fireEvent.click(screen.getByRole('button', { name: /change reporting scope/i }))

    const last = screen.getByRole('menuitemcheckbox', { name: /^KSA$/ })
    // aria-disabled, NOT the disabled attribute. A disabled element is dropped
    // from the accessibility tree, so a screen reader user could not find the
    // country at all, could not hear that it is still IN scope, and got no
    // reason why it would not turn off. The refusal is what matters here and it
    // is unchanged; the discoverability is what improved.
    expect(last.hasAttribute('disabled')).toBe(false)
    expect(last.getAttribute('aria-disabled')).toBe('true')
    expect(last.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(last)
    expect(setReportingScope).not.toHaveBeenCalled()
  })

  it('explains WHY the last remaining country will not switch off', () => {
    // Without a description the row is simply inert: it looks like a control
    // that is broken rather than one that is deliberately held.
    h.settings = baseSettings({ reportingScope: { countries: ['KSA'] } })
    render(<ReportingScopeBar />)
    fireEvent.click(screen.getByRole('button', { name: /change reporting scope/i }))

    const last = screen.getByRole('menuitemcheckbox', { name: /^KSA$/ })
    const describedBy = last.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy).textContent)
      .toMatch(/at least one country must stay selected/i)
    // The explanation is a DESCRIPTION, never folded into the name: a name of
    // "KSA. At least one country must stay selected." is read on every pass over
    // the row and buries the country it is supposed to identify.
    expect(last.textContent).not.toMatch(/must stay selected/i)
  })

  it('renders a static label when only one country may be reported on', () => {
    h.settings = baseSettings({
      allowedScopeCountries: ['KSA'],
      reportingScope: { countries: ['KSA'] },
    })
    const { container } = render(<ReportingScopeBar />)
    expect(screen.getByText('KSA')).toBeTruthy()
    expect(container.querySelectorAll('button').length).toBe(0)
  })

  it('says so honestly when there is nothing to report on', () => {
    h.settings = baseSettings({ allowedScopeCountries: [], reportingScope: { countries: [] } })
    render(<ReportingScopeBar />)
    // Never "All countries" over an empty set.
    expect(screen.getByText(/no countries are available/i)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/all countries/i)
  })

  it('explains that currencies are never blended', () => {
    render(<ReportingScopeBar />)
    expect(screen.getByText(/never added across currencies/i)).toBeTruthy()
  })

  it('mounts with an unresolved context without throwing', () => {
    h.settings = {}
    expect(() => render(<ReportingScopeBar />)).not.toThrow()
  })
})

/* ── Repo-wide text rule ────────────────────────────────────────────────────── */

describe('shell text is ASCII punctuation only', () => {
  // House rule: no em dash, en dash, middle dot or arrows in user-facing text.
  // An exported report or forwarded PDF carrying them has been a real defect.
  const BANNED = /[–—·•→←“”‘’]/

  it('holds across every shell surface, open and closed', () => {
    render(
      <div>
        <TopBar onToggleSidebar={vi.fn()} sidebarOpen appIcon="/logo.svg" />
        <ReportingScopeBar />
      </div>,
    )
    expect(BANNED.test(document.body.textContent)).toBe(false)

    // And with each menu open, which is where most of the new copy lives.
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))
    expect(BANNED.test(document.body.textContent)).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))

    fireEvent.click(screen.getByRole('button', { name: /account/i }))
    expect(BANNED.test(document.body.textContent)).toBe(false)
  })
})
