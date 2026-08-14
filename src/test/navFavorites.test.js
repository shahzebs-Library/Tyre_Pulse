import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  FAVORITES_KEY,
  RECENTS_KEY,
  MAX_FAVORITES,
  MAX_RECENTS,
  loadFavorites,
  saveFavorites,
  toggleFavorite,
  isFavorite,
  loadRecents,
  pushRecent,
  visibleFavorites,
  visibleRecents,
} from '../lib/navFavorites'

// A small live-nav index in the shape the sidebar builds: route -> { label, group }.
const navIndex = {
  '/tyres': { label: 'Tyre Records', group: 'Overview' },
  '/fleet-master': { label: 'Fleet Master', group: 'Operations' },
  '/analytics': { label: 'Analytics', group: 'Tyre Performance' },
  '/stock': { label: 'Stock Management', group: 'Stock & Procurement' },
  '/settings': { label: 'Settings', group: 'Administration & Data' },
}
const allowAll = () => true
const denyAll = () => false

beforeEach(() => localStorage.clear())

// ─────────────────────────────────────────────────────────────────────────────
// Favourites
// ─────────────────────────────────────────────────────────────────────────────
describe('favourites storage', () => {
  it('starts empty and round-trips a saved list', () => {
    expect(loadFavorites()).toEqual([])
    saveFavorites(['/tyres', '/analytics'])
    expect(loadFavorites()).toEqual(['/tyres', '/analytics'])
  })

  it('toggleFavorite pins to the front and unpins', () => {
    toggleFavorite('/tyres')
    toggleFavorite('/analytics')
    expect(loadFavorites()).toEqual(['/analytics', '/tyres'])
    expect(isFavorite('/tyres')).toBe(true)

    toggleFavorite('/tyres')
    expect(loadFavorites()).toEqual(['/analytics'])
    expect(isFavorite('/tyres')).toBe(false)
  })

  it('de-duplicates: pinning the same route twice never stores it twice', () => {
    saveFavorites(['/tyres', '/tyres', '/analytics', '/tyres'])
    expect(loadFavorites()).toEqual(['/tyres', '/analytics'])
  })

  it('caps at MAX_FAVORITES, dropping the oldest pin', () => {
    const many = Array.from({ length: MAX_FAVORITES + 5 }, (_, i) => `/m${i}`)
    saveFavorites(many)
    const stored = loadFavorites()
    expect(stored).toHaveLength(MAX_FAVORITES)
    expect(stored[0]).toBe('/m0')

    // Pinning one more evicts the oldest (last) entry, keeping the newest in front.
    toggleFavorite('/brand-new')
    const after = loadFavorites()
    expect(after).toHaveLength(MAX_FAVORITES)
    expect(after[0]).toBe('/brand-new')
    expect(after).not.toContain(`/m${MAX_FAVORITES - 1}`)
  })

  it('ignores junk routes (blank, non-string, relative)', () => {
    saveFavorites(['/tyres', '', '   ', null, 42, 'tyres', '/'])
    expect(loadFavorites()).toEqual(['/tyres'])
    expect(toggleFavorite('')).toEqual(['/tyres'])   // no-op, list unchanged
    expect(isFavorite('')).toBe(false)
    expect(isFavorite(null)).toBe(false)
  })

  it('survives a corrupt stored value instead of throwing', () => {
    localStorage.setItem(FAVORITES_KEY, '{not json')
    expect(() => loadFavorites()).not.toThrow()
    expect(loadFavorites()).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Recents
// ─────────────────────────────────────────────────────────────────────────────
describe('recents storage', () => {
  it('records visits most-recent-first', () => {
    pushRecent('/tyres')
    pushRecent('/analytics')
    pushRecent('/stock')
    expect(loadRecents()).toEqual(['/stock', '/analytics', '/tyres'])
  })

  it('re-visiting MOVES a route to the front rather than duplicating it', () => {
    pushRecent('/tyres')
    pushRecent('/analytics')
    pushRecent('/tyres')
    expect(loadRecents()).toEqual(['/tyres', '/analytics'])
  })

  it('caps at MAX_RECENTS, evicting the oldest visit', () => {
    for (let i = 0; i < MAX_RECENTS + 4; i += 1) pushRecent(`/r${i}`)
    const stored = loadRecents()
    expect(stored).toHaveLength(MAX_RECENTS)
    expect(stored[0]).toBe(`/r${MAX_RECENTS + 3}`)   // newest
    expect(stored).not.toContain('/r0')              // oldest evicted
  })

  it('never records the dashboard/home route - everyone lands there', () => {
    pushRecent('/')
    pushRecent('/dashboard')
    expect(loadRecents()).toEqual([])

    pushRecent('/tyres')
    pushRecent('/dashboard')
    expect(loadRecents()).toEqual(['/tyres'])
  })

  it('ignores junk routes', () => {
    pushRecent('')
    pushRecent(null)
    pushRecent('tyres')
    expect(loadRecents()).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Storage unavailable (private mode / embedded webview / quota)
// ─────────────────────────────────────────────────────────────────────────────
describe('localStorage unavailable', () => {
  let getSpy
  let setSpy

  // NOTE: the spy MUST go on Storage.prototype, not on the `localStorage`
  // instance. jsdom's localStorage is proxy-backed, so vi.spyOn(localStorage,
  // 'getItem') silently fails to install and the test would pass against the
  // REAL storage - i.e. prove nothing. Verified: instance spying reports
  // isMockFunction === false, prototype spying === true.
  beforeEach(() => {
    getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
  })
  afterEach(() => {
    getSpy.mockRestore()
    setSpy.mockRestore()
  })

  it('every storage helper degrades quietly instead of throwing', () => {
    expect(() => loadFavorites()).not.toThrow()
    expect(() => loadRecents()).not.toThrow()
    expect(() => saveFavorites(['/tyres'])).not.toThrow()
    expect(() => toggleFavorite('/tyres')).not.toThrow()
    expect(() => pushRecent('/tyres')).not.toThrow()
    expect(() => isFavorite('/tyres')).not.toThrow()

    // Reads degrade to empty: with storage unreadable we cannot claim a route is
    // pinned, so isFavorite is honestly false rather than guessing.
    expect(loadFavorites()).toEqual([])
    expect(loadRecents()).toEqual([])
    expect(isFavorite('/tyres')).toBe(false)
    // Writes still report the list they tried to store, so the caller's in-memory
    // state stays correct for this session; it just will not survive a reload.
    expect(saveFavorites(['/tyres'])).toEqual(['/tyres'])
    expect(toggleFavorite('/tyres')).toEqual(['/tyres'])
    expect(pushRecent('/tyres')).toEqual(['/tyres'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Pure resolvers - the permission regression guard
// ─────────────────────────────────────────────────────────────────────────────
describe('visibleFavorites / visibleRecents', () => {
  it('resolves stored routes to live nav labels and groups, in order', () => {
    expect(visibleFavorites(['/analytics', '/tyres'], navIndex, allowAll)).toEqual([
      { route: '/analytics', label: 'Analytics', group: 'Tyre Performance' },
      { route: '/tyres', label: 'Tyre Records', group: 'Overview' },
    ])
  })

  it('drops a stale route that no longer exists in the nav', () => {
    const out = visibleFavorites(['/tyres', '/retired-module'], navIndex, allowAll)
    expect(out.map((e) => e.route)).toEqual(['/tyres'])
  })

  it('drops a route the user may no longer see (revoked access)', () => {
    // The permission regression test: access is re-evaluated at render, so
    // revoking a module must remove it from favourites immediately.
    expect(visibleFavorites(['/tyres', '/analytics'], navIndex, denyAll)).toEqual([])

    const canSee = (route) => route !== '/analytics'
    expect(visibleFavorites(['/tyres', '/analytics'], navIndex, canSee).map((e) => e.route))
      .toEqual(['/tyres'])
  })

  it('fails CLOSED when no permission predicate is supplied', () => {
    expect(visibleFavorites(['/tyres'], navIndex, undefined)).toEqual([])
    expect(visibleRecents(['/tyres'], navIndex, null)).toEqual([])
  })

  it('handles a missing nav index or a non-array route list', () => {
    expect(visibleFavorites(['/tyres'], null, allowAll)).toEqual([])
    expect(visibleFavorites(null, navIndex, allowAll)).toEqual([])
    expect(visibleRecents(undefined, navIndex, allowAll)).toEqual([])
  })

  it('de-duplicates and caps the resolved list', () => {
    const dupes = ['/tyres', '/tyres', '/analytics']
    expect(visibleRecents(dupes, navIndex, allowAll).map((e) => e.route))
      .toEqual(['/tyres', '/analytics'])
    expect(visibleRecents(dupes, navIndex, allowAll).length).toBeLessThanOrEqual(MAX_RECENTS)
  })

  it('falls back to the route as a label when the nav entry has no label', () => {
    const sparse = { '/x-module': {} }
    expect(visibleFavorites(['/x-module'], sparse, allowAll)).toEqual([
      { route: '/x-module', label: '/x-module', group: '' },
    ])
  })

  it('is pure - it reads nothing from storage', () => {
    saveFavorites(['/stock'])
    // Passing an explicit list must win; the stored '/stock' is not consulted.
    expect(visibleFavorites(['/tyres'], navIndex, allowAll).map((e) => e.route)).toEqual(['/tyres'])
    expect(localStorage.getItem(RECENTS_KEY)).toBeNull()
  })
})
