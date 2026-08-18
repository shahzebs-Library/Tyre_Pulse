/**
 * Every route a notification can send someone to must actually exist.
 *
 * This class of bug shipped on the phone: notificationRoute() returned
 * '/(app)/inspection' and '/(app)/accident', neither of which is a route,
 * because those folders carry no index screen. Tapping the notification landed
 * the user on the router's raw "Unmatched Route" developer screen.
 *
 * A grep for route literals would not have caught it - the broken values were
 * COMPUTED and returned from a function. So this test reads the mapping out of
 * the source and checks each target against the real route table in App.jsx,
 * rather than checking a list someone remembered to keep updated.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const APP = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const CENTER = fs.readFileSync(path.join(root, 'src/components/NotificationCenter.jsx'), 'utf8')

/** Every path App.jsx declares as a <Route path="...">. */
function declaredRoutes() {
  return new Set(
    Array.from(APP.matchAll(/path=["']([^"']+)["']/g)).map((m) => m[1]),
  )
}

/** The targets notificationLink() can return, read from its own body. */
function notificationTargets() {
  const start = CENTER.indexOf('function notificationLink')
  expect(start, 'notificationLink must exist in NotificationCenter.jsx').toBeGreaterThan(-1)
  const body = CENTER.slice(start, CENTER.indexOf('\n}', start))
  return Array.from(body.matchAll(/['"](\/[A-Za-z0-9\-/_]*)['"]/g)).map((m) => m[1])
}

describe('notification links point at real routes', () => {
  it('finds the targets rather than trusting a hand-kept list', () => {
    const targets = notificationTargets()
    expect(targets.length).toBeGreaterThan(0)
  })

  it('every notification target resolves to a declared route', () => {
    const routes = declaredRoutes()
    const dead = notificationTargets().filter((t) => !routes.has(t))
    expect(dead, `notification links with no matching <Route path>: ${dead.join(', ')}`).toEqual([])
  })

  it('the footer "view all" link resolves too', () => {
    const routes = declaredRoutes()
    const footer = Array.from(CENTER.matchAll(/to=["'](\/[A-Za-z0-9\-/_]*)["']/g)).map((m) => m[1])
    const dead = footer.filter((t) => !routes.has(t))
    expect(dead, `dead <Link to> in the notification centre: ${dead.join(', ')}`).toEqual([])
  })
})
