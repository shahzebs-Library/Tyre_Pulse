import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Every module the app routes must be visible and controllable from the System Console.
 *
 * The console derives its module lists from Layout's NAV_CATALOG (Module Control seeds
 * from buildNavModuleCatalog(NAV_CATALOG); Platform Map and the Navigation editor read
 * the same catalog) and from ConsoleLayout's CONSOLE_NAV. So a routed page that is in
 * neither list is invisible to the super admin: it cannot be switched off, put into
 * maintenance or found on the Platform Map.
 *
 * This pins that relationship. A new top-level page must either get a nav item or be
 * listed below with the reason it is not a module of its own.
 */

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
const APP = read('src/App.jsx')
const LAYOUT = read('src/components/Layout.jsx')
const CONSOLE_LAYOUT = read('src/console/components/ConsoleLayout.jsx')

/** Routed pages that are deliberately not a module row of their own. */
const NOT_A_MODULE = {
  '/login': 'public sign-in',
  '/reset-password': 'public auth step',
  '/data-deletion': 'public Play Store deletion page',
  '/delete-account': 'redirect alias of /data-deletion',
  '/privacy': 'public legal page',
  '/privacy-policy': 'public legal page',
  '/terms': 'public legal page',
  '/terms-of-service': 'public legal page',
  '/status': 'public status page',
  '/support': 'public support page',
  '/report-builder': 'sub-page of Reports (SectionTabs, admin-only, governed by report builder access)',
  '/checklist-builder': 'sub-page of Checklists (author roles)',
  '/automation-rules/builder': 'sub-page of Automation Rules',
  '/data-intake/history': 'sub-page of Data Intake',
  '/upload': 'legacy step of Data Intake (flag data_intake)',
  '/rfid-registry': 'alias of /rfid',
  '/design-system': 'admin reference page, reachable from search',
  '/my-problems': 'personal page of every user (profile menu), not a module',
}

function appRoutes() {
  const out = new Set()
  for (const line of APP.split('\n')) {
    const m = line.match(/<Route\s+path="(\/[^"]*)"/)
    if (!m) continue
    const path = m[1]
    if (path.includes(':') || path === '/' || path === '*' || path.startsWith('/console')) continue
    if (/LegacyRedirect|<Navigate/.test(line)) continue
    out.add(path)
  }
  return out
}

const navPaths = new Set([...LAYOUT.matchAll(/to:\s*'(\/[^']*)'/g)].map((m) => m[1]))

describe('console module coverage', () => {
  it('every routed app page is in the sidebar catalog the console reads, or is justified', () => {
    const routes = appRoutes()
    expect(routes.size).toBeGreaterThan(150)
    const missing = [...routes].filter((p) => !navPaths.has(p) && !NOT_A_MODULE[p])
    expect(missing).toEqual([])
  })

  it('the justification list stays honest (every entry is a real route)', () => {
    const routes = appRoutes()
    const allRoutePaths = new Set([...APP.matchAll(/<Route\s+path="(\/[^"]*)"/g)].map((m) => m[1]))
    const stale = Object.keys(NOT_A_MODULE).filter((p) => !routes.has(p) && !allRoutePaths.has(p))
    expect(stale).toEqual([])
  })

  it('every console route has a console nav entry (retired redirects excepted)', () => {
    const consolePaths = new Set(
      [...CONSOLE_LAYOUT.matchAll(/to:\s*'\/console\/([^']*)'/g)].map((m) => m[1]),
    )
    const RETIRED = new Set(['admin-roles', 'audit', 'permissions', 'system'])
    const routed = new Set(
      [...APP.matchAll(/<Route\s+path="([a-z][^":]*)"/g)].map((m) => m[1]),
    )
    const missing = [...routed].filter((p) => !consolePaths.has(p) && !RETIRED.has(p))
    expect(missing).toEqual([])
  })
})

describe('access control lists every module', () => {
  it('the console access catalog includes every sidebar module key (e.g. Tyre Passport)', async () => {
    const { ACCESS_MODULES } = await import('../lib/accessCatalog')
    const { NAV_MODULE_KEY } = await import('../lib/navAccess')
    const { MODULE_GROUPS } = await import('../lib/moduleCatalog')
    const keys = new Set(ACCESS_MODULES.map((m) => m.key))
    expect(keys.has('tyre_passport')).toBe(true)
    const missingNav = Object.entries(NAV_MODULE_KEY)
      .filter(([route]) => navPaths.has(route))
      .map(([, k]) => k)
      .filter((k) => !keys.has(k))
    expect(missingNav).toEqual([])
    const missingCurated = MODULE_GROUPS.flatMap((g) => g.modules.map((m) => m.key)).filter((k) => !keys.has(k))
    expect(missingCurated).toEqual([])
    expect(keys.size).toBe(ACCESS_MODULES.length)
    expect(ACCESS_MODULES.length).toBeGreaterThan(100)
  })

  it('every console access surface reads the full catalog, not the curated 37', () => {
    for (const f of [
      'src/console/pages/access/AccessManager.jsx',
      'src/console/pages/access/AccessPreviewOverride.jsx',
      'src/console/pages/access/BulkOperations.jsx',
      'src/console/pages/ConsoleJitElevation.jsx',
      'src/console/pages/ConsoleUsers.jsx',
      'src/pages/AccessGrantsManager.jsx',
    ]) {
      expect(read(f)).toMatch(/from '(\.\.\/)+lib\/accessCatalog'/)
    }
  })
})
