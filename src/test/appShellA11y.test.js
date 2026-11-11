import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * App-shell accessibility + RTL regression guard.
 *
 * Source scans rather than renders: Layout is wired to Auth, Settings, Tenant,
 * Language, Supabase and the router, and every property checked here is a
 * static fact about the markup. Each case names the defect it closed so a
 * revert fails with the reason attached.
 */

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

const LAYOUT = read('src/components/Layout.jsx')
const CSS = read('src/index.css')
const NOTIF = read('src/components/NotificationCenter.jsx')
const NOTIF_CSS = read('src/components/notificationCenter.css')
const PALETTE = read('src/components/CommandPalette.jsx')
const CONSOLE_KIT = read('src/console/components/ui/index.jsx')
const CC_CSS = read('src/components/commandCenter/commandCenter.css')
const ETABLE = read('src/components/ui/EnterpriseTable.jsx')
const PAGE_HEADER = read('src/components/ui/PageHeader.jsx')

// Tailwind palette constants the console secondary-text swap moves between.
const GRAY_400 = '#9ca3af'
const GRAY_500 = '#6b7280'
const GRAY_900 = '#111827' // console panel / input base

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('app shell landmarks', () => {
  it('both shells carry a skip link that targets the main landmark', () => {
    expect(LAYOUT.match(/href="#main-content" className="tp-skip-link"/g)?.length).toBe(2)
    expect(LAYOUT.match(/<main\s+id="main-content"\s+tabIndex=\{-1\}/g)?.length).toBe(2)
  })

  it('the skip link style exists and is revealed on focus', () => {
    expect(CSS).toMatch(/\.tp-skip-link \{[\s\S]*?transform: translateY\(-160%\)/)
    expect(CSS).toMatch(/\.tp-skip-link:focus[\s\S]*?transform: translateY\(0\)/)
  })

  it('the sidebar nav is a labelled navigation landmark', () => {
    expect(LAYOUT).toMatch(/<nav\s+aria-label=\{tOr\(t, 'shell\.primaryNav', 'Main navigation'\)\}/)
  })
})

describe('sidebar behaviour', () => {
  it('group toggles report their expanded state and control their list', () => {
    const toggle = LAYOUT.match(/<button\b[^>]*onClick=\{\(\) => toggleGroup\(groupId\)\}[^>]*>/)?.[0]
    expect(toggle).toBeTruthy()
    expect(toggle).toContain('aria-expanded={!isCollapsed}')
    expect(toggle).toContain('aria-controls={`nav-group-${groupDomId(groupId)}`}')
    expect(toggle).toContain('disabled={Boolean(normalizedModuleQuery)}')
    expect(LAYOUT).toMatch(/id=\{`nav-group-\$\{groupDomId\(groupId\)\}`\}/)
  })

  it('a sidebar NavLink has ONE style prop so out-of-context dimming is drawn', () => {
    // The dimming used to be a first `style=` that a second `style=` on the same
    // element silently replaced.
    const start = LAYOUT.indexOf('title={_outOfContext')
    const end = LAYOUT.indexOf('>\n                          {({ isActive }) => (', start)
    const tag = LAYOUT.slice(start, end)
    expect(tag.match(/\bstyle=/g)?.length).toBe(1)
    expect(tag).toMatch(/_outOfContext \? \{ opacity: 0\.45 \}/)
  })

  it('the closed sidebar is inert on every viewport and the drawer mirrors in RTL', () => {
    expect(LAYOUT).toMatch(/inert=\{!sidebarOpen \? true : undefined\}/)
    expect(LAYOUT).toMatch(/isRTL \? 'right-0' : 'left-0'/)
    expect(LAYOUT).toMatch(/isRTL \? drawerWidth : -drawerWidth/)
  })

  it('the open drawer closes on Escape and returns focus when it held it', () => {
    expect(LAYOUT).toMatch(/if \(e\.key === 'Escape'\) setSidebarOpen\(false\)/)
    expect(LAYOUT).toMatch(/drawerReturnRef\.current = document\.activeElement/)
  })

  it('the active indicator and badge use logical sides', () => {
    expect(LAYOUT).not.toMatch(/absolute left-0 top-1\/2 -translate-y-1\/2 w-\[3px\]/)
    expect(LAYOUT).toMatch(/absolute start-0 top-1\/2 -translate-y-1\/2 w-\[3px\] h-\[52%\] rounded-e-full/)
  })

  it('framer-motion honours prefers-reduced-motion in both shells', () => {
    expect(LAYOUT.match(/<MotionConfig reducedMotion="user">/g)?.length).toBe(2)
    expect(LAYOUT.match(/<\/MotionConfig>/g)?.length).toBe(2)
  })
})

describe('contrast', () => {
  it('sidebar section headings meet AA on the sidebar background', () => {
    const m = CSS.match(/aside \.text-gray-700 \{ color: (#[0-9a-f]{6}); \}/i)
    expect(m).toBeTruthy()
    expect(contrast(m[1], '#030805')).toBeGreaterThanOrEqual(4.5)
  })

  // F-J-04: console secondary text at 11-12px used text-gray-500 (#6b7280),
  // only 3.67:1 on the dark panel/input base - below AA. It is now text-gray-400
  // (#9ca3af, 6.99:1). Light mode is unchanged: both utilities already resolve to
  // #475569 there, so the swap is purely the dark-mode lift.
  it('the gray-400 the console secondary text moved TO meets AA on dark; the gray-500 it moved FROM did not', () => {
    expect(contrast(GRAY_400, GRAY_900)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(GRAY_500, GRAY_900)).toBeLessThan(4.5)
  })

  it('the console kit secondary-text spots carry text-gray-400, not text-gray-500', () => {
    // The seven spots F-J-04 names (PanelHeader sub, StatTile label + sub, Badge
    // quiet, LoadingState, EmptyState reason, SearchInput placeholder).
    expect(CONSOLE_KIT).toMatch(/subtitle && <p className="text-xs text-gray-400/) // PanelHeader sub
    expect(CONSOLE_KIT).toMatch(/uppercase tracking-wide text-gray-400 truncate/)  // StatTile label
    expect(CONSOLE_KIT).toMatch(/sub && <p className="text-\[11px\] text-gray-400/) // StatTile sub
    expect(CONSOLE_KIT).toMatch(/quiet: 'bg-gray-900 text-gray-400/)               // Badge quiet
    expect(CONSOLE_KIT).toMatch(/text-xs text-gray-400 text-center mt-3/)          // LoadingState
    expect(CONSOLE_KIT).toMatch(/reason && <p className="text-xs text-gray-400/)   // EmptyState reason
    expect(CONSOLE_KIT).toMatch(/placeholder-gray-400/)                            // SearchInput placeholder
  })

  // New pair 1: the light-mode console override. text-gray-500 inside .console-root
  // is pinned to #475569 (7.24:1 on the console-root light surface), and the light
  // gray-400 override maps to the same #475569 so the dark swap does not regress light.
  it('console light secondary text is pinned to #475569 and meets AA', () => {
    expect(CSS).toMatch(/html\.light \.console-root \.text-gray-500 \{ color: #475569 !important; \}/)
    expect(CSS).toMatch(/html\.light \.text-gray-400\s+\{ color: #475569 !important; \}/)
    expect(contrast('#475569', '#f8fafc')).toBeGreaterThanOrEqual(4.5)
  })

  // New pair 2: the command-center kit. The outlined .cc-btn used --cc-green
  // (#16a34a, only 3.30:1 on the white light card). In light it now points at
  // --cc-green-strong (#15803d, 5.02:1); dark is deliberately untouched (its
  // brighter #22c55e already reads at 8.11:1).
  it('the light cc-btn uses --cc-green-strong and that token meets AA on the white card', () => {
    expect(CC_CSS).toMatch(/html\.light \.cc \.cc-btn \{ color: var\(--cc-green-strong\); \}/)
    const lightGreenStrong = CC_CSS.match(/html\.light \.cc \{[\s\S]*?--cc-green-strong:\s*(#[0-9a-f]{6})/i)
    expect(lightGreenStrong).toBeTruthy()
    expect(contrast(lightGreenStrong[1], '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('touch targets', () => {
  it('the touch-target utility expands the hit area to 44px on touch widths', () => {
    expect(CSS).toMatch(/@media \(pointer: coarse\), \(max-width: 767px\) \{[\s\S]*?\.tp-touch-target::after \{[\s\S]*?width: max\(100%, 44px\);[\s\S]*?height: max\(100%, 44px\);/)
  })

  it('the small mobile top-bar controls use it', () => {
    const top = read('src/components/shell/TopBar.jsx')
    expect(top.match(/tp-touch-target/g)?.length).toBeGreaterThanOrEqual(3)
    expect(read('src/components/shell/ProfileMenu.jsx')).toMatch(/tp-touch-target/)
  })

  // F-J-03: the kit buttons styled by class (not by a React prop) get the same
  // 44x44 ::after hit-area at touch widths, so they need no per-call-site class.
  it('the class-styled kit buttons get the 44x44 hit area at touch widths', () => {
    const block = CSS.match(/@media \(pointer: coarse\), \(max-width: 767px\) \{[\s\S]*?\n\}/)?.[0] || ''
    for (const sel of ['.tp-dialog-head button', '.cc-pager-nums button', '.cc-tab', '.cc-btn', '.cc-icon-btn']) {
      // Each selector appears in the position:relative group and carries an
      // ::after overlay (both rules live inside the touch-width media block).
      expect(block).toContain(sel)
      expect(block).toContain(`${sel}::after`)
    }
    // ...and that overlay is the 44x44 hit box.
    expect(block).toMatch(/\.cc-btn::after[\s\S]*?width: max\(100%, 44px\);[\s\S]*?height: max\(100%, 44px\);/)
  })

  // F-J-03: the controls styled by a React className carry tp-touch-target.
  it('the console kit, the table pager/retry and the page header carry the hit-area class', () => {
    // console Btn, Segmented options, SearchInput clear
    expect(CONSOLE_KIT.match(/tp-touch-target/g)?.length).toBeGreaterThanOrEqual(3)
    // EnterpriseTable Previous, Next and Retry
    expect(ETABLE.match(/tp-touch-target/g)?.length).toBeGreaterThanOrEqual(3)
    // PageHeader Back and Refresh
    expect(PAGE_HEADER.match(/tp-touch-target/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('the search clear is given a padded box so its drawn target is not a bare glyph', () => {
    expect(CONSOLE_KIT).toMatch(/aria-label="Clear search"[\s\S]*?p-1\.5[\s\S]*?tp-touch-target/)
  })
})

describe('notification centre', () => {
  it('the bell announces its popup and state', () => {
    expect(NOTIF).toMatch(/aria-haspopup="dialog"\s+aria-expanded=\{open\}/)
    expect(NOTIF).toMatch(/role="dialog"\s+aria-label="Notifications"/)
  })

  it('Escape is only listened for while open, and hands focus back to the bell', () => {
    expect(NOTIF).toMatch(/if \(!open\) return undefined[\s\S]*?buttonRef\.current\?\.focus\(\)[\s\S]*?\}, \[open\]\)/)
  })

  it('rows are keyboard operable and the panel anchors to the logical end', () => {
    expect(NOTIF).toMatch(/role="button"\s+tabIndex=\{0\}/)
    expect(NOTIF).toMatch(/role="dialog"\s+aria-label="Notifications"\s+className="tp-notification-panel"/)
    expect(NOTIF_CSS).toMatch(/\.tp-notification-panel\s*\{[^}]*position:\s*absolute;[^}]*inset-inline-end:\s*0;/)
    expect(NOTIF_CSS).toMatch(/@media \(max-width: 640px\)\s*\{\s*\.tp-notification-panel\s*\{[^}]*position:\s*fixed;[^}]*inset-inline:\s*12px;/)
  })
})

describe('command palette', () => {
  it('returns focus to what opened it and labels its combobox', () => {
    expect(PALETTE).toMatch(/returnFocusRef\.current = document\.activeElement/)
    expect(PALETTE).toMatch(/aria-controls="cp-listbox"/)
    expect(PALETTE).toMatch(/id="cp-listbox"/)
    expect(PALETTE).toMatch(/aria-label=\{labelOr\(t, 'shell\.commandSearchLabel'/)
    expect(PALETTE).toMatch(/borderInlineStart:/)
  })
})

describe('RTL: no physical left/right in shell chrome', () => {
  const FILES = [
    'src/components/shell/TopBar.jsx',
    'src/components/shell/ProfileMenu.jsx',
    'src/components/shell/GlobalCreate.jsx',
    'src/components/shell/ReportingScopeBar.jsx',
    'src/components/shell/WorkingContextSelector.jsx',
    'src/components/NotificationCenter.jsx',
    'src/components/ui/Breadcrumbs.jsx',
    'src/components/ui/PageHeader.jsx',
    'src/components/MobileBottomNav.jsx',
  ]
  it.each(FILES)('%s', (file) => {
    // "left-0 right-0" together is a full-width span and mirrors itself.
    const src = read(file).replace(/left-0 right-0/g, '')
    expect(src).not.toMatch(/(^|[\s"`'])-?(left|right)-(\d|\[)/m)
    expect(src).not.toMatch(/(^|[\s"`'])(ml|mr|pl|pr)-(\d|auto|\[)/m)
    expect(src).not.toMatch(/(^|[\s"`'])(rounded|border)-(l|r)(-|\s|"|`)/m)
  })

  it('directional arrows in the shell flip under RTL', () => {
    expect(read('src/components/ui/Breadcrumbs.jsx')).toMatch(/rtl:rotate-180/)
    expect(read('src/components/ui/PageHeader.jsx')).toMatch(/ArrowLeft aria-hidden="true" className="w-4 h-4 rtl:rotate-180"/)
    expect(LAYOUT).toMatch(/<ArrowLeft size=\{13\} aria-hidden="true" className="flex-shrink-0 rtl:rotate-180" \/>/)
  })
})

describe('loading and error states', () => {
  it('loading states are announced', () => {
    expect(read('src/components/LoadingSpinner.jsx')).toMatch(/role="status"/)
    expect(read('src/components/ProtectedRoute.jsx')).toMatch(/h-64 text-gray-400" role="status"/)
  })

  it('page-replacing states own the page heading and hide decorative emoji', () => {
    const pr = read('src/components/ProtectedRoute.jsx')
    expect(pr).not.toMatch(/<h2 className="text-xl font-bold text-white/)
    expect(pr).not.toMatch(/<span className="text-(3|4)xl">/)
    const eb = read('src/components/ErrorBoundary.jsx')
    expect(eb).toMatch(/role="alert"/)
    expect(eb).toMatch(/<h1 style=/)
  })
})
