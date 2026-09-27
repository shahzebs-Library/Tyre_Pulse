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
const PALETTE = read('src/components/CommandPalette.jsx')

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
    expect(LAYOUT).toMatch(/onClick=\{\(\) => toggleGroup\(groupId\)\}\s+aria-expanded=\{!isCollapsed\}\s+aria-controls=/)
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

  it('the closed mobile drawer is inert and the drawer mirrors in RTL', () => {
    expect(LAYOUT).toMatch(/inert=\{isMobile && !sidebarOpen \? true : undefined\}/)
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
    expect(NOTIF).toMatch(/absolute end-0 top-9 w-80/)
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
