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

/* --- Mocks ---
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

/* --- Fixtures --- */

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

/**
 * The expand/collapse chevron for a branch.
 *
 * It is aria-hidden by design - the treeitem beside it carries aria-expanded and
 * answers the arrow keys, and a second focusable control per node both made the
 * tree malformed and doubled the tab stops - so it cannot be reached by a role
 * query and is addressed by its data hook instead.
 */
const openTwisty = (branchKey) => document.querySelector(`[data-twisty="${branchKey}"]`)

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

/* --- The menu keyboard model ---
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

  it('lands ON the held last country rather than stepping over it', () => {
    // SUPERSEDES an earlier assertion that the arrow key SKIPPED this row.
    // It skipped it because the row carried a real `disabled` attribute, and a
    // disabled element is dropped from the accessibility tree entirely: the user
    // could not find the country, could not hear that it was still in scope, and
    // got no reason why it would not turn off. aria-disabled keeps it announced
    // and reachable and refuses only the action, which is what APG asks for.
    h.settings = baseSettings({
      allowedScopeCountries: ['KSA', 'UAE'],
      reportingScope: { countries: ['KSA'] },
    })
    render(<ReportingScopeBar />)
    fireEvent.click(screen.getByRole('button', { name: /change reporting scope/i }))

    const items = screen.getAllByRole('menuitemcheckbox')
    const held = screen.getByRole('menuitemcheckbox', { name: /^KSA$/ })
    expect(held.hasAttribute('disabled')).toBe(false)
    expect(held.getAttribute('aria-disabled')).toBe('true')
    // It sits BETWEEN the two other rows, so this proves the arrow order follows
    // the DOM rather than quietly routing around it.
    expect(items.indexOf(held)).toBe(1)

    expect(document.activeElement).toBe(items[0])
    press('ArrowDown')
    expect(document.activeElement).toBe(held)
  })

  it('still refuses the action once the arrow key has reached it', () => {
    // Discoverable must not mean operable: emptying the scope would leave the
    // report covering nothing.
    const setReportingScope = vi.fn()
    h.settings = baseSettings({
      allowedScopeCountries: ['KSA', 'UAE'],
      reportingScope: { countries: ['KSA'] },
      setReportingScope,
    })
    render(<ReportingScopeBar />)
    fireEvent.click(screen.getByRole('button', { name: /change reporting scope/i }))

    const held = screen.getByRole('menuitemcheckbox', { name: /^KSA$/ })
    held.focus()
    fireEvent.click(held)
    expect(setReportingScope).not.toHaveBeenCalled()
  })
})

/* --- The dialog focus trap --- */

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

  it('survives a panel with nothing focusable in it', () => {
    // A user with no assigned locations opens a dialog whose only content is a
    // sentence. Both the focus-on-open and the trap have to no-op rather than
    // throw inside the app shell.
    h.settings = baseSettings({ allowedContext: [], canSwitchWorkingContext: true })
    expect(() => {
      render(<WorkingContextSelector />)
      fireEvent.click(screen.getByRole('button', { name: /working location/i }))
      const dialog = screen.getByRole('dialog', { name: /working location/i })
      expect(dialog.querySelectorAll(FOCUSABLE).length).toBe(0)
      fireEvent.keyDown(dialog, { key: 'Tab' })
    }).not.toThrow()
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

/* --- The location hierarchy is a TREE ---
   Before this, the panel announced "dialog" and then handed the user a flat pile
   of buttons: no depth, no position, no sibling count, no way to tell a country
   from a site. These pin the structure that fixes that, and the keyboard model
   the role now promises. */

describe('the location hierarchy is exposed as a tree', () => {
  function openTree(over) {
    if (over) h.settings = baseSettings(over)
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))
    return screen.getByRole('tree')
  }

  const node = (name) => screen.getByRole('treeitem', { name })

  it('owns the countries as a tree rather than loose buttons', () => {
    const tree = openTree()
    expect(tree).not.toBeNull()
    // Every direct structural child is a tree node or a group. A stray button
    // sitting inside role=tree is either read out as loose furniture between
    // nodes or pruned outright, which is what the old twisty buttons were.
    expect(tree.querySelectorAll('button:not([role="treeitem"])').length).toBe(0)
  })

  it('gives each country its level, position and sibling count', () => {
    // "KSA" alone tells a screen reader nothing. "level 1, 1 of 3" is the whole
    // point of the tree.
    openTree()
    const ksa = node(/^KSA/)
    expect(ksa.getAttribute('aria-level')).toBe('1')
    expect(ksa.getAttribute('aria-posinset')).toBe('1')
    expect(ksa.getAttribute('aria-setsize')).toBe('3')
    expect(node(/^Egypt/).getAttribute('aria-posinset')).toBe('3')
  })

  it('nests a region under its country and a site under its region', () => {
    openTree()
    const central = node(/^CENTRAL/)
    expect(central.getAttribute('aria-level')).toBe('2')
    // The sites of the open region sit one level deeper again, inside a group.
    const site = node(/^QIDDIYA-UPPER PLATEAU/)
    expect(site.getAttribute('aria-level')).toBe('3')
    expect(site.closest('[role="group"]')).not.toBeNull()
  })

  it('numbers regions and loose sites as ONE run of siblings', () => {
    // KSA has 2 regions and JED, which carries no region. They are all children
    // of KSA at the same level, so a separate sequence per kind would announce
    // "1 of 2" twice under one country.
    openTree()
    expect(node(/^CENTRAL/).getAttribute('aria-setsize')).toBe('3')
    expect(node(/^WESTERN/).getAttribute('aria-posinset')).toBe('2')
    const jed = node(/^JED/)
    expect(jed.getAttribute('aria-level')).toBe('2')
    expect(jed.getAttribute('aria-posinset')).toBe('3')
    expect(jed.getAttribute('aria-setsize')).toBe('3')
  })

  it('puts a region-less country its sites at level 2, inventing no region', () => {
    openTree({
      allowedContext: [UAE],
      workingContext: { country: 'UAE', region: null, site: 'SHARJAH' },
    })
    expect(node(/^SHARJAH/).getAttribute('aria-level')).toBe('2')
    expect(node(/^SHARJAH/).getAttribute('aria-setsize')).toBe('2')
  })

  it('marks a branch expanded or collapsed, and says nothing on a leaf', () => {
    openTree()
    expect(node(/^KSA/).getAttribute('aria-expanded')).toBe('true')
    expect(node(/^UAE/).getAttribute('aria-expanded')).toBe('false')
    // A leaf that reports "collapsed" invites the user to open an empty branch.
    expect(node(/^QIDDIYA-UPPER PLATEAU/).hasAttribute('aria-expanded')).toBe(false)
    expect(node(/^JED/).hasAttribute('aria-expanded')).toBe(false)
  })

  it('marks the current working location selected, in the tree\'s own terms', () => {
    // aria-selected is what a tree uses; aria-current means nothing on a
    // treeitem and would leave the node reading as just another site.
    openTree()
    expect(node(/^QIDDIYA-UPPER PLATEAU/).getAttribute('aria-selected')).toBe('true')
    expect(node(/^JED/).getAttribute('aria-selected')).toBe('false')
  })

  it('walks the visible nodes with ArrowDown and ArrowUp', () => {
    openTree({
      allowedContext: [UAE],
      workingContext: { country: 'UAE', region: null, site: 'SHARJAH' },
    })
    node(/^UAE/).focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(node(/^DUBAI YARD/))
    press('ArrowDown')
    expect(document.activeElement).toBe(node(/^SHARJAH/))
    press('ArrowUp')
    expect(document.activeElement).toBe(node(/^DUBAI YARD/))
  })

  it('clamps at the ends instead of wrapping like the menus do', () => {
    // A tree is a spatial structure: jumping from the last site back to the
    // first country reads as having lost your place.
    openTree({
      allowedContext: [UAE],
      workingContext: { country: 'UAE', region: null, site: 'SHARJAH' },
    })
    node(/^UAE/).focus()
    press('ArrowUp')
    expect(document.activeElement).toBe(node(/^UAE/))
    node(/^SHARJAH/).focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(node(/^SHARJAH/))
  })

  it('jumps to the first and last visible node with Home and End', () => {
    openTree({
      allowedContext: [UAE],
      workingContext: { country: 'UAE', region: null, site: 'SHARJAH' },
    })
    node(/^DUBAI YARD/).focus()
    press('End')
    expect(document.activeElement).toBe(node(/^SHARJAH/))
    press('Home')
    expect(document.activeElement).toBe(node(/^UAE/))
  })

  it('opens a collapsed branch with ArrowRight and steps into it on the next press', () => {
    // The key that opens every other tree the user has met. Without it, role=tree
    // announces "collapsed" and then answers nothing, which is worse than having
    // said nothing at all.
    openTree()
    const uae = () => node(/^UAE/)
    uae().focus()
    expect(uae().getAttribute('aria-expanded')).toBe('false')

    press('ArrowRight')
    expect(uae().getAttribute('aria-expanded')).toBe('true')
    // Focus stays put on the open, which is what lets the user read the branch
    // before entering it.
    expect(document.activeElement).toBe(uae())

    press('ArrowRight')
    expect(document.activeElement).toBe(node(/^DUBAI YARD/))
  })

  it('collapses with ArrowLeft, then steps out to the parent', () => {
    openTree()
    node(/^CENTRAL/).focus()
    press('ArrowLeft')
    expect(node(/^CENTRAL/).getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(node(/^CENTRAL/))

    // Already collapsed, so the same key now walks out of the group.
    press('ArrowLeft')
    expect(document.activeElement).toBe(node(/^KSA/))
  })

  it('does nothing when stepping out of a root node', () => {
    openTree()
    const ksa = () => node(/^KSA/)
    ksa().focus()
    press('ArrowLeft')           // collapses
    expect(ksa().getAttribute('aria-expanded')).toBe('false')
    press('ArrowLeft')           // no parent to step to
    expect(document.activeElement).toBe(ksa())
  })

  it('mirrors the expand and collapse keys under RTL', () => {
    // In Arabic the tree indents leftward, so ArrowRight is the way OUT. An
    // unmirrored handler would collapse the branch the user is trying to open.
    h.isRTL = true
    openTree({
      allowedContext: [UAE],
      workingContext: { country: 'UAE', region: null, site: 'SHARJAH' },
    })
    const uae = () => node(/^UAE/)
    uae().focus()
    press('ArrowRight')
    expect(uae().getAttribute('aria-expanded')).toBe('false')
    press('ArrowLeft')
    expect(uae().getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps collapsed children out of the arrow order entirely', () => {
    // Not merely hidden: a collapsed branch renders nothing, so the order a user
    // arrows through cannot drift from what is on screen.
    // No country in context, so nothing opens pre-expanded and UAE stays shut.
    const tree = openTree({
      allowedContext: [UAE],
      workingContext: { country: null, region: null, site: null },
    })
    expect(tree.querySelectorAll('[role="treeitem"]').length).toBe(1)
    node(/^UAE/).focus()
    press('ArrowDown')
    expect(document.activeElement).toBe(node(/^UAE/))
  })

  it('leaves the flat lists flat, because they are not a hierarchy', () => {
    // Recents, All countries and the search results are unordered shortcuts. A
    // treeitem outside a tree, or a level on a row that has none, would be a lie.
    localStorage.setItem(
      'tp_context_recents',
      JSON.stringify([{ country: 'UAE', region: null, site: 'SHARJAH' }]),
    )
    h.settings = baseSettings({ canSelectAll: true })
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))

    const all = screen.getByRole('button', { name: /All countries/ })
    expect(all.getAttribute('role')).toBeNull()
    expect(all.hasAttribute('aria-level')).toBe(false)
    expect(screen.getByRole('tree').contains(all)).toBe(false)
  })

  it('still keeps Tab inside the dialog with the tree in place', () => {
    // The tree adds an arrow-key model; it must not cost the dialog its trap.
    const tree = openTree()
    const dialog = screen.getByRole('dialog', { name: /working location/i })
    const focusable = [...dialog.querySelectorAll(FOCUSABLE)]
    expect(tree.querySelectorAll('[role="treeitem"]').length).toBeGreaterThan(1)

    focusable[focusable.length - 1].focus()
    press('Tab')
    expect(document.activeElement).toBe(focusable[0])
  })

  it('still closes on Escape with the tree focused', () => {
    openTree()
    node(/^KSA/).focus()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /working location/i })).toBeNull()
  })

  it('still filters through the search box, which the tree never intercepts', () => {
    // The panel already answers "find a node by name" with a search box that
    // covers sites, regions and countries at once. No typeahead was added to the
    // tree: two different answers to the same keystroke, depending on where
    // focus happened to be, is worse than one good one.
    openTree()
    fireEvent.change(screen.getByRole('textbox', { name: /find a site or region/i }), {
      target: { value: 'sharjah' },
    })
    expect(screen.getByText('SHARJAH')).toBeTruthy()
    expect(screen.queryByRole('tree')).toBeNull()
  })
})

/* --- Announcing a context change --- */

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
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))
    const dialog = screen.getByRole('dialog', { name: /working location/i })
    // Resolved while the panel is OPEN, so a region that had been moved inside
    // it would be found here rather than reading as absent.
    const region = document.querySelector('[aria-live="polite"]')
    expect(region).not.toBeNull()
    expect(dialog.contains(region)).toBe(false)
  })
})

/* --- Right to left --- */

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

    // The twisty is aria-hidden now that the treeitem beside it carries
    // aria-expanded, so it is reached by its data hook rather than by a role
    // query. The assertion itself - which way the chevron points - is unchanged.
    const twisty = () => openTwisty('UAE')
    // The current branch opens expanded, so collapse it to see the arrow.
    fireEvent.click(twisty())

    expect(twisty().querySelector('svg')?.getAttribute('class')).toMatch(/chevron-left/)
    expect(twisty().querySelector('svg')?.getAttribute('class')).not.toMatch(/chevron-right/)
  })

  it('points it the other way when reading left to right', () => {
    h.isRTL = false
    h.settings = baseSettings({
      allowedContext: [UAE],
      workingContext: { country: 'UAE', region: null, site: 'SHARJAH' },
    })
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))

    fireEvent.click(openTwisty('UAE'))
    expect(openTwisty('UAE').querySelector('svg')?.getAttribute('class')).toMatch(/chevron-right/)
  })

  it('still toggles the branch when the twisty is clicked', () => {
    // Making the twisty decorative must not make it inert: a pointer user has no
    // arrow keys and this is the only thing they can hit.
    h.settings = baseSettings({
      allowedContext: [UAE],
      workingContext: { country: 'UAE', region: null, site: 'SHARJAH' },
    })
    render(<WorkingContextSelector />)
    fireEvent.click(screen.getByRole('button', { name: /working location/i }))

    const node = () => screen.getByRole('treeitem', { name: /UAE/ })
    expect(node().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(openTwisty('UAE'))
    expect(node().getAttribute('aria-expanded')).toBe('false')
    // Scoped to the tree: the trigger chip prints the current site too, so an
    // unscoped query for SHARJAH is ambiguous by design.
    expect(within(screen.getByRole('tree')).queryByText('SHARJAH')).toBeNull()
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
