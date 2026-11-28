import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * A nav item with a `roles` list is shown ONLY to those roles: shouldShowNavItem
 * does not let Admin or a super admin past `item.roles`. So when the route itself
 * admits Admin, the menu must list Admin too, or the page is reachable by URL but
 * missing from the Admin's sidebar. Driver Concerns (2026-11-28 release) shipped
 * in exactly that state.
 */
const APP = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8')
const LAYOUT = readFileSync(join(process.cwd(), 'src/components/Layout.jsx'), 'utf8')

function routeAllowed(path) {
  const re = new RegExp(`<Route path="${path.replace(/[/-]/g, (c) => `\\${c}`)}"[^\\n]*?RoleRoute allowed=\\{\\[([^\\]]*)\\]`)
  const m = APP.match(re)
  return m ? m[1].split(',').map((s) => s.trim().replace(/'/g, '')) : null
}

describe('nav roles list Admin whenever the route admits Admin', () => {
  const items = [...LAYOUT.matchAll(/\{\s*to:\s*'([^']+)'[^}]*?roles:\s*\[([^\]]*)\]/g)]
    .map((m) => ({ to: m[1], roles: m[2].split(',').map((s) => s.trim().replace(/'/g, '')) }))

  it('finds role-gated nav items', () => {
    expect(items.length).toBeGreaterThan(10)
  })

  it('every role-gated item whose route admits Admin also lists Admin', () => {
    const bad = items.filter((it) => {
      const allowed = routeAllowed(it.to)
      return allowed && allowed.includes('Admin') && !it.roles.includes('Admin')
    }).map((it) => it.to)
    expect(bad).toEqual([])
  })

  it('Driver Concerns is in the Admin menu', () => {
    expect(items.find((it) => it.to === '/driver-concerns')?.roles).toContain('Admin')
  })

  it('Driver workspace is in the Admin menu and its route admits Admin', () => {
    expect(items.find((it) => it.to === '/driver-workspace')?.roles).toContain('Admin')
    expect(routeAllowed('/driver-workspace')).toContain('Admin')
  })
})
