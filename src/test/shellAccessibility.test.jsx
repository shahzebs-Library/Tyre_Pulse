/**
 * Accessibility behaviour of the app shell (spec section 66).
 *
 * The shell already carried the STATIC half of accessibility - roles, labels,
 * aria-expanded, aria-checked, aria-hidden on decorative icons, Escape to close.
 * What it did not carry was the BEHAVIOUR those roles promise, and a role that
 * promises something it does not do is worse than no role at all: a screen
 * reader announces "menu" and the arrow keys then do nothing.
 *
 * So this file pins the behaviour, not the attributes:
 *
 *  - role=menu answers Arrow keys, Home/End and Tab (WAI-ARIA menu pattern)
 *  - role=dialog keeps Tab inside itself until dismissed
 *  - a context change is ANNOUNCED, and is silent on first render
 *  - the popover mirrors under RTL instead of opening away from its trigger
 *
 * NOTE ON WHAT THESE TESTS CANNOT SEE: jsdom has no accessibility tree and does
 * not implement native Tab traversal, so these assert the mechanics a screen
 * reader would rely on, not what a screen reader actually says. Verifying the
 * spoken output needs NVDA/JAWS/VoiceOver on a real browser.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { useState } from 'react'

/* ── Mocks ────────────────────────────────────────────────────────────────────
   Same shape as shellComponents.test.jsx so the two files agree on what the
   contexts look like, plus a controllable isRTL that file does not need. */
const h = vi.hoisted(() => ({
  settings: {},
  auth: {},
  isRTL: false,
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

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ mode: 'dark', theme: 'dark', isDark: true, setTheme: vi.fn(), toggleTheme: vi.fn() }),
}))

// `t` returns the key, which is exactly what the real translator does for a key
// with no entry - so the components fall through their tx() wrapper to English.
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, isRTL: h.isRTL, language: h.isRTL ? 'ar' : 'en', setLanguage: vi.fn() }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, ...p }) => <a {...p}>{children}</a>,
  NavLink: ({ children, ...p }) => <a {...p}>{children}</a>,
}))

import useAnchoredPopover from '../components/ui/useAnchoredPopover'
import ProfileMenu from '../components/shell/ProfileMenu'
import ReportingScopeBar from '../components/shell/ReportingScopeBar'
import WorkingContextSelector from '../components/shell/WorkingContextSelector'

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

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

function baseSettings(over = {}) {
  return {
    appSettings: { company_name: 'Green Concrete', currency: 'SAR' },
    systemConfig: {},
    activeCountry: 'KSA',
    workingContext: { country: 'KSA', region: 'CENTRAL', site: 'QIDDIYA-UPPER PLATEAU' },
    setWorkingContext: vi.fn(),
    allowedContext: [KSA, UAE, EGYPT],
    canSwitchWorkingContext: true,
    reportingScope: { countries: ['KSA'] },
    setReportingScope: vi.fn(),
    allowedScopeCountries: ['KSA', 'UAE', 'Egypt'],
    ...over,
  }
}

function baseAuth(over = {}) {
  return {
    profile: { full_name: 'Anum Khan', username: 'shahzeb', role: 'Admin' },
    isSuperAdmin: false,
    signOut: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

/** Send a key to whatever currently holds focus, the way a real user would. */
function press(key, opts = {}) {
  fireEvent.keyDown(document.activeElement, { key, ...opts })
}

/** Everything the browser would let a user Tab to, for the trap assertions. */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

const liveText = () => document.querySelector('[aria-live="polite"]')?.textContent ?? null

beforeEach(() => {
  h.settings = baseSettings()
  h.auth = baseAuth()
  h.isRTL = false
  document.documentElement.removeAttribute('dir')
  try { localStorage.clear() } catch { /* jsdom storage always present */ }
})

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('dir')
})

/* ── The menu keyboard model ─────────────────────────────────────────────────
   role=menu is a promise. These assert it is kept. */

describe('role=menu answers the keyboard', () => {
  function openProfileMenu() {
    render(<ProfileMenu />)
    fireEvent.click(screen.getByRole('button', { name: /account/i }))
    return screen.getAllByRole('menuitem')
  }

  it('moves focus INTO the menu when it opens', () => {
    // Without this the menu is announced, opens, and the next Tab walks the page
    // behind it - the menu the user just opened is unreachable.
    const items = openProfileMenu()
    expect(items.length).toBeGreaterThan(1)
    expect(document.activeElement).toBe(items[0])
  })

  it('walks the items with ArrowDown and wraps at the end', () => {
    const items = openProfileMenu()
    press('ArrowDown')
    expect(document.activeElement).toBe(items[1])
    press('ArrowDown')
    expect(document.activeElement).toBe(items[2])

    // From the last item, down returns to the first rather than dead-ending.
    items[items.length - 1].focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(items[0])
  })

  it('walks backwards with ArrowUp and wraps at the start', () => {
    const items = openProfileMenu()
    expect(document.activeElement).toBe(items[0])
    press('ArrowUp')
    expect(document.activeElement).toBe(items[items.length - 1])
    press('ArrowUp')
    expect(document.activeElement).toBe(items[items.length - 2])
  })

  it('jumps to the first and last item with Home and End', () => {
    const items = openProfileMenu()
    press('End')
    expect(document.activeElement).toBe(items[items.length - 1])
    press('Home')
    expect(document.activeElement).toBe(items[0])
  })

  it('ignores keys raised outside the panel while it is open', () => {
    // The handler is on the document so it can hear keys wherever focus sits
    // inside a portalled panel. That reach has to be fenced: a keypress meant
    // for the page must never be swallowed just because a menu happens to be
    // open behind it.
    render(<ProfileMenu />)
    fireEvent.click(screen.getByRole('button', { name: /account/i }))

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    fireEvent.keyDown(outside, { key: 'Tab' })

    expect(screen.queryByRole('menu')).not.toBeNull()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('leaves the menu on Tab, closing it and handing focus back to the trigger', () => {
    // The ARIA menu pattern: Tab exits rather than walking the menu. Returning
    // focus to the trigger means the user's next Tab carries on from where the
    // menu was, instead of restarting at the top of the document.
    render(<ProfileMenu />)
    const trigger = screen.getByRole('button', { name: /account/i })
    fireEvent.click(trigger)
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0)

    press('Tab')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('applies to every menu in the shell, not just one', () => {
    // The behaviour lives in the shared hook precisely so the five menus cannot
    // drift apart. Reporting scope is a second, independently-mounted menu.
    // Two countries selected, so none of them is the last one and none is
    // disabled - the disabled case is its own test below.
    h.settings = baseSettings({ reportingScope: { countries: ['KSA', 'UAE'] } })
    render(<ReportingScopeBar />)
    fireEvent.click(screen.getByRole('button', { name: /change reporting scope/i }))

    const items = screen.getAllByRole('menuitemcheckbox')
    expect(document.activeElement).toBe(items[0])
    press('ArrowDown')
    expect(document.activeElement).toBe(items[1])
  })

  it('skips a disabled item, which cannot take focus anyway', () => {
    // The scope menu disables its last remaining country so a report can never
    // cover nothing. Including it in the arrow order would produce a keypress
    // that silently does nothing.
    h.settings = baseSettings({
      allowedScopeCountries: ['KSA', 'UAE'],
      reportingScope: { countries: ['KSA'] },
    })
    render(<ReportingScopeBar />)
    fireEvent.click(screen.getByRole('button', { name: /change reporting scope/i }))

    const items = screen.getAllByRole('menuitemcheckbox')
    const disabled = screen.getByRole('menuitemcheckbox', { name: /^KSA$/ })
    const uae = screen.getByRole('menuitemcheckbox', { name: /^UAE$/ })
    expect(disabled.hasAttribute('disabled')).toBe(true)
    // Disabled KSA sits BETWEEN the two reachable rows in the DOM, so an arrow
    // press that honoured DOM order alone would land on it and appear to hang.
    expect(items.indexOf(disabled)).toBe(1)

    expect(document.activeElement).toBe(items[0])
    press('ArrowDown')
    expect(document.activeElement).toBe(uae)
    expect(document.activeElement).not.toBe(disabled)
  })
})

/* ── The dialog focus trap ───────────────────────────────────────────────── */

describe('role=dialog keeps focus inside itself', () => {
  function openDialog() {
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))
    return screen.getByRole('dialog', { name: /working location/i })
  }

  it('moves focus into the panel when it opens', () => {
    const dialog = openDialog()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('wraps Tab from the last control back to the first', () => {
    // The panel is portalled to <body>, so without a trap Tab leaves the open
    // dialog and walks the page behind it while the dialog still covers it.
    const dialog = openDialog()
    const focusable = [...dialog.querySelectorAll(FOCUSABLE)]
    expect(focusable.length).toBeGreaterThan(2)

    focusable[focusable.length - 1].focus()
    press('Tab')

    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(focusable[0])
  })

  it('wraps Shift+Tab from the first control back to the last', () => {
    const dialog = openDialog()
    const focusable = [...dialog.querySelectorAll(FOCUSABLE)]

    focusable[0].focus()
    press('Tab', { shiftKey: true })

    expect(document.activeElement).toBe(focusable[focusable.length - 1])
  })

  it('does not swallow keys aimed at the page while the dialog is shut', () => {
    render(<WorkingContextSelector />)
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    // No dialog open, so Tab must be left entirely alone.
    fireEvent.keyDown(outside, { key: 'Tab' })
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})

/* ── Announcing a context change ─────────────────────────────────────────── */

describe('a context change is announced', () => {
  it('says nothing on first render', () => {
    // A live region that speaks on every page load is one people learn to
    // ignore, which costs the announcements that actually matter.
    render(<WorkingContextSelector />)
    expect(liveText()).toBe('')
  })

  it('states the new working location after it changes', () => {
    const { rerender } = render(<WorkingContextSelector />)
    expect(liveText()).toBe('')

    h.settings = baseSettings({
      workingContext: { country: 'UAE', region: null, site: 'SHARJAH' },
    })
    rerender(<WorkingContextSelector />)

    expect(liveText()).toMatch(/Working location changed to/i)
    expect(liveText()).toMatch(/SHARJAH/)
  })

  it('states the new reporting scope after it changes', () => {
    const { rerender } = render(<ReportingScopeBar />)
    expect(liveText()).toBe('')

    h.settings = baseSettings({ reportingScope: { countries: ['KSA', 'UAE'] } })
    rerender(<ReportingScopeBar />)

    expect(liveText()).toMatch(/Reporting scope changed to/i)
  })

  it('is polite, so it never interrupts what the user is already reading', () => {
    render(<WorkingContextSelector />)
    const region = document.querySelector('[aria-live]')
    expect(region).not.toBeNull()
    expect(region.getAttribute('aria-live')).toBe('polite')
  })

  it('lives outside the popover, so it survives the panel closing', () => {
    // A live region inserted at the same moment as its text is not reliably
    // announced, and this panel unmounts the instant a location is picked.
    render(<WorkingContextSelector />)
    const region = document.querySelector('[aria-live="polite"]')
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))
    const dialog = screen.getByRole('dialog', { name: /working location/i })
    expect(dialog.contains(region)).toBe(false)
  })
})

/* ── Right to left ───────────────────────────────────────────────────────── */

function AlignHarness({ align }) {
  const [open, setOpen] = useState(false)
  const { triggerRef, coords } = useAnchoredPopover(open, { width: 200, height: 100, align })
  return (
    <div>
      <button ref={triggerRef} onClick={() => setOpen(true)}>Open</button>
      <span data-testid="left">{coords ? String(coords.left) : ''}</span>
    </div>
  )
}

describe('right to left', () => {
  function openAnchored(align) {
    render(<AlignHarness align={align} />)
    const btn = screen.getByText('Open')
    // jsdom lays nothing out, so the trigger's box has to be stated.
    btn.getBoundingClientRect = () => ({
      left: 700, right: 800, top: 10, bottom: 40, width: 100, height: 30, x: 700, y: 10,
    })
    fireEvent.click(btn)
    return Number(screen.getByTestId('left').textContent)
  }

  it('hugs the trigger edge asked for when reading left to right', () => {
    // align 'right' means the panel's right edge meets the trigger's: 800 - 200.
    expect(openAnchored('right')).toBe(600)
  })

  it('mirrors that edge under RTL so the panel still hugs its trigger', () => {
    // The bar itself mirrors, because flexbox follows `dir`. A panel that kept
    // hugging the physical right edge would open away from its trigger, across
    // the bar. Under RTL the same request means the trigger's LEFT edge: 700.
    document.documentElement.setAttribute('dir', 'rtl')
    expect(openAnchored('right')).toBe(700)
  })

  it('mirrors the opposite request too', () => {
    document.documentElement.setAttribute('dir', 'rtl')
    // 'left' under RTL becomes the physical right edge: 800 - 200.
    expect(openAnchored('left')).toBe(600)
  })

  it('points a collapsed tree branch toward the reading direction', () => {
    // A right-pointing arrow in Arabic points back at the parent, not into the
    // branch it opens.
    h.isRTL = true
    h.settings = baseSettings({
      allowedContext: [UAE],
      workingContext: { country: 'UAE', region: null, site: 'SHARJAH' },
    })
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))

    const dialog = screen.getByRole('dialog', { name: /working location/i })
    // The current branch opens expanded, so collapse it to see the arrow.
    fireEvent.click(within(dialog).getByRole('button', { name: /collapse uae/i }))

    const expand = within(dialog).getByRole('button', { name: /expand uae/i })
    expect(expand.querySelector('svg')?.getAttribute('class')).toMatch(/chevron-left/)
    expect(expand.querySelector('svg')?.getAttribute('class')).not.toMatch(/chevron-right/)
  })

  it('points it the other way when reading left to right', () => {
    h.isRTL = false
    h.settings = baseSettings({
      allowedContext: [UAE],
      workingContext: { country: 'UAE', region: null, site: 'SHARJAH' },
    })
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))

    const dialog = screen.getByRole('dialog', { name: /working location/i })
    fireEvent.click(within(dialog).getByRole('button', { name: /collapse uae/i }))

    const expand = within(dialog).getByRole('button', { name: /expand uae/i })
    expect(expand.querySelector('svg')?.getAttribute('class')).toMatch(/chevron-right/)
  })

  it('uses logical spacing classes so the shell mirrors as a whole', () => {
    // Physical ml-/pl-/left- would keep the tree indenting from the left and the
    // search icon pinned to the left of its box in an otherwise mirrored panel.
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))
    const dialog = screen.getByRole('dialog', { name: /working location/i })

    const html = dialog.outerHTML
    expect(html).not.toMatch(/class="[^"]*\bml-6\b/)
    expect(html).not.toMatch(/class="[^"]*\btext-left\b/)
    expect(html).toMatch(/\bms-6\b/)
  })
})
