import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_CATALOG } from '../components/Layout'
import { NAV_COMMANDS } from '../lib/commandSearch'
import { governingModuleKey } from '../lib/navAccess'
import { ROUTE_ALIASES, canonicalRoute, isLegacyRoute } from '../lib/routeOwnership'

const root = resolve(import.meta.dirname, '../..')
const appSource = readFileSync(resolve(root, 'src/App.jsx'), 'utf8')

describe('canonical route ownership', () => {
  it('has unique aliases and never aliases a canonical route again', () => {
    const aliases = ROUTE_ALIASES.map((entry) => entry.alias)
    const canonicals = new Set(ROUTE_ALIASES.map((entry) => entry.canonical))
    expect(new Set(aliases).size).toBe(aliases.length)
    expect(aliases.filter((alias) => canonicals.has(alias))).toEqual([])
  })

  it('preserves query strings and fragments when canonicalising legacy links', () => {
    expect(canonicalRoute('/ai?conversation=42#answer')).toBe('/ai-command-center?conversation=42#answer')
    expect(canonicalRoute('/tyres?status=active')).toBe('/tyres?status=active')
    expect(canonicalRoute(null)).toBeNull()
  })

  it('keeps every compatibility alias as an explicit redirect', () => {
    for (const { alias, canonical } of ROUTE_ALIASES) {
      expect(appSource).toContain(`path="${alias}"`)
      expect(appSource).toContain(`<LegacyRedirect to="${canonical}" />`)
    }
    expect(appSource).toContain('<Navigate to={`${to}${search}${hash}`} replace />')
  })

  it('uses canonical paths in sidebar and command navigation', () => {
    const sidebarPaths = NAV_CATALOG.flatMap((group) => group.items.map((item) => item.key))
    const commandPaths = NAV_COMMANDS.map((command) => command.path)
    expect(sidebarPaths.filter(isLegacyRoute)).toEqual([])
    expect(commandPaths.filter(isLegacyRoute)).toEqual([])
  })

  it('resolves legacy and canonical permission ownership identically', () => {
    for (const { alias, canonical } of ROUTE_ALIASES) {
      expect(governingModuleKey(alias)).toBe(governingModuleKey(canonical))
    }
  })

  it('does not index the same canonical module twice in navigation search', () => {
    const canonicalPaths = NAV_COMMANDS.map(({ path }) => canonicalRoute(path))
    const duplicates = canonicalPaths.filter((path, index) => canonicalPaths.indexOf(path) !== index)
    expect(duplicates).toEqual([])
  })
})
