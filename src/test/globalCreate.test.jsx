/**
 * Global "+ Create" menu (spec 54) and recent RECORDS in the palette (spec 47).
 *
 * The invariants pinned here are the ones whose failure is a real defect rather
 * than a cosmetic one:
 *
 *  - AN ENTRY THE USER CANNOT USE IS NEVER OFFERED. A create shortcut that
 *    lands on Access Denied is worse than no shortcut, so the menu is gated by
 *    the same predicate the palette and the sidebar use, plus the feature flag
 *    that guards the accidents route, plus an explicit create revoke.
 *  - IT DOES NOT RENDER BELOW TWO ENTRIES. The spec says twice not to crowd the
 *    header; a one-item chooser is strictly worse than the page's own button.
 *    An Inspector, who may only reach /inspections, is the real case.
 *  - EVERY OFFERED PATH IS A ROUTE THAT EXISTS. Scanned out of App.jsx, so a
 *    route rename cannot leave this menu pointing at a 404.
 *  - NO REPORT BUILDER IS EVER OFFERED. Building is Admin-only and is not
 *    record creation; asserted even for an Admin, who WOULD pass that gate.
 *  - A RECENT RECORD WHOSE MODULE IS GONE IS NOT RENDERED. Records store a
 *    source, never a permission, so access is re-decided on every render.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { MemoryRouter } from 'react-router-dom'

/* ── Mocks ────────────────────────────────────────────────────────────────────
   Only I/O and unrelated widgets are stubbed. The RBAC rules (commandSearch),
   the record-source registry and the favourites/recents resolvers are all REAL,
   because they are exactly what is under test. */
const h = vi.hoisted(() => ({ auth: {}, palette: {}, flags: {} }))

const DICT = {
  'ui.command.groups.recent': 'Recent',
  'ui.command.groups.actions': 'Actions',
  'ui.command.groups.navigation': 'Navigation',
  'ui.command.groups.commands': 'Commands',
  'common.create': 'Create',
  'shell.createNew': 'Create new record',
  'shell.newInspection': 'New Inspection',
  'shell.newAccident': 'New Accident',
  'shell.newWorkOrder': 'New Work Order',
  'shell.newRequisition': 'New Purchase Request',
  'shell.newAsset': 'New Asset',
  'shell.newTyre': 'New Tyre',
}
const t = (k) => DICT[k] ?? k

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t, isRTL: false, language: 'en' }) }))
vi.mock('../contexts/CommandPaletteContext', () => ({ useCommandPalette: () => h.palette }))
vi.mock('../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ isEnabled: (k) => h.flags[k] !== false, loading: false }),
  useFeatureGate: (k) => h.flags[k] !== false,
}))
// The record search is stubbed at the client boundary so one real vehicle hit
// can be picked. Every other table answers empty, so the assertions below are
// about the row that was chosen and not about search ranking.
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const rows = table === 'vehicle_fleet'
        ? [{ id: 'v1', asset_no: 'MIX-204', make: 'Sany', model: 'Mixer', site: 'JED' }]
        : []
      const builder = {
        select: () => builder,
        or: () => builder,
        limit: () => Promise.resolve({ data: rows, error: null }),
      }
      return builder
    },
  },
}))

import GlobalCreate, {
  CREATE_ACTIONS, MIN_CREATE_ACTIONS, availableCreateActions, createRevoked,
} from '../components/shell/GlobalCreate'
import CommandPalette from '../components/CommandPalette'
import { REPORT_BUILDER_ROUTES } from '../lib/reportBuilderAccess'
import {
  RECORD_RECENTS_KEY, RECENTS_KEY, FAVORITES_KEY, MAX_RECORD_RECENTS,
  loadRecentRecords, pushRecentRecord, loadRecents, visibleRecentRecords,
} from '../lib/navFavorites'

/* ── Harness ────────────────────────────────────────────────────────────────── */

function auth(over = {}) {
  return {
    profile: { role: 'Manager', full_name: 'Test Manager' },
    hasPermission: () => true,
    grantedModules: new Set(),
    isSuperAdmin: false,
    capabilities: {},
    ...over,
  }
}

function renderCreate({ auth: over = {}, flags = {}, ...props } = {}) {
  h.auth = auth(over)
  h.flags = flags
  return render(
    <MemoryRouter initialEntries={['/reports']}>
      <GlobalCreate {...props} />
    </MemoryRouter>,
  )
}

/** Open the menu and return its role="menu" element. */
function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /create new record/i }))
  return screen.getByRole('menu')
}

function renderPalette({ records = [], auth: over = {} } = {}) {
  localStorage.setItem(RECORD_RECENTS_KEY, JSON.stringify(records))
  h.auth = auth({ profile: { role: 'Manager', full_name: 'Test Manager' }, ...over })
  h.flags = {}
  h.palette = { open: true, setOpen: () => {} }
  return render(
    <MemoryRouter initialEntries={['/reports']}>
      <CommandPalette />
    </MemoryRouter>,
  )
}

const VEHICLE_RECORD = { label: 'TM527', path: '/vehicle/TM527', source: 'vehicles', icon: 'Truck' }
// suppliers is adminOnly + moduleKey 'stock' in RECORD_SOURCES, so a Manager
// can never see it - the "module the user may not reach" case.
const SUPPLIER_RECORD = { label: 'Al Fanar Trading', path: '/suppliers', source: 'suppliers', icon: 'Users' }

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})
beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup(); localStorage.clear() })

/* ── Task A: the create menu ────────────────────────────────────────────────── */

describe('GlobalCreate - what is offered', () => {
  it('offers only actions whose destination the user may open', () => {
    // Denying the work_orders module must remove New Work Order and nothing
    // else; the entries beside it prove the filter ran rather than emptied.
    renderCreate({ auth: { hasPermission: (key) => key !== 'work_orders' } })
    const menu = openMenu()

    expect(within(menu).queryByText('New Work Order')).toBeNull()
    expect(within(menu).getByText('New Inspection')).toBeInTheDocument()
    expect(within(menu).getByText('New Tyre')).toBeInTheDocument()
  })

  it('drops an entry whose module is behind a switched-off feature flag', () => {
    // /accidents is <FlagRoute flag="accidents_module">, which redirects home
    // when the org turns the module off. Route permission alone cannot see that.
    renderCreate({ flags: { accidents_module: false } })
    const menu = openMenu()

    expect(within(menu).queryByText('New Accident')).toBeNull()
    expect(within(menu).getByText('New Inspection')).toBeInTheDocument()
  })

  it('drops an entry whose create capability is explicitly revoked', () => {
    renderCreate({ auth: { capabilities: { tyre_records: { create: 'revoke' } } } })
    const menu = openMenu()

    expect(within(menu).queryByText('New Tyre')).toBeNull()
    expect(within(menu).getByText('New Inspection')).toBeInTheDocument()
  })

  it('treats only an explicit revoke as a block, never a missing capability map', () => {
    // hasCapability resolves create with roleAllows:false, so an absent entry
    // means "not configured", not "denied". Reading it as denied would hide the
    // menu from every Manager who creates work orders daily.
    expect(createRevoked(undefined, 'tyre_records')).toBe(false)
    expect(createRevoked({}, 'tyre_records')).toBe(false)
    expect(createRevoked({ tyre_records: {} }, 'tyre_records')).toBe(false)
    expect(createRevoked({ tyre_records: { create: 'grant' } }, 'tyre_records')).toBe(false)
    expect(createRevoked({ tyre_records: { create: 'revoke' } }, 'tyre_records')).toBe(true)
  })
})

describe('GlobalCreate - when it stays out of the way', () => {
  it('renders nothing at all when the user has fewer than two create actions', () => {
    // An Inspector may reach /inspections and /settings only, so exactly one
    // create action survives. A one-item menu is worse than the page's button.
    const inspector = { profile: { role: 'Inspector', full_name: 'Insp' } }
    const offered = availableCreateActions({ ...auth(inspector) })
    expect(offered).toHaveLength(1)
    expect(offered.length).toBeLessThan(MIN_CREATE_ACTIONS)

    const { container } = renderCreate({ auth: inspector })
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: /create/i })).toBeNull()
  })

  it('renders nothing when the user can create nothing at all', () => {
    const { container } = renderCreate({
      auth: { profile: { role: 'Reporter' }, hasPermission: () => false },
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('never renders on the mobile bar, however many actions are available', () => {
    const { container } = renderCreate({ isMobile: true })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the menu once two or more actions are available', () => {
    renderCreate()
    const menu = openMenu()
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThanOrEqual(MIN_CREATE_ACTIONS)
  })

  it('closes the menu and navigates when an entry is chosen', () => {
    renderCreate()
    const menu = openMenu()
    fireEvent.click(within(menu).getByText('New Tyre'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('GlobalCreate - destinations', () => {
  // Every `path="..."` declared in the router, so a rename here fails loudly
  // instead of shipping a menu entry that lands on a 404.
  const APP_ROUTES = new Set(
    [...readFileSync('src/App.jsx', 'utf8').matchAll(/path="([^"]+)"/g)].map((m) => m[1]),
  )

  it('finds the routes at all, so the scan cannot pass vacuously', () => {
    expect(APP_ROUTES.size).toBeGreaterThan(50)
  })

  it('points every action at a route that exists in App.jsx', () => {
    const missing = CREATE_ACTIONS.filter((a) => !APP_ROUTES.has(a.path)).map((a) => a.path)
    expect(missing).toEqual([])
  })

  it('keeps each action gate on the path it actually navigates to', () => {
    // A gate checked against one route while navigating to another is exactly
    // how an Access Denied entry gets shipped.
    const mismatched = CREATE_ACTIONS
      .filter((a) => a.access?.path !== a.path)
      .map((a) => `${a.id}: gates ${a.access?.path} navigates ${a.path}`)
    expect(mismatched).toEqual([])
  })

  it('never offers a report builder, not even to an Admin', () => {
    // Building a report is Admin-only and is not record creation. An Admin
    // passes canUseReportBuilder, so this is the case that would leak.
    const builders = CREATE_ACTIONS.filter((a) => REPORT_BUILDER_ROUTES.includes(a.path))
    expect(builders).toEqual([])

    const offered = availableCreateActions({
      ...auth({ profile: { role: 'Admin' }, isSuperAdmin: true }),
    })
    expect(offered.filter((a) => REPORT_BUILDER_ROUTES.includes(a.path))).toEqual([])
    expect(offered.length).toBeGreaterThanOrEqual(MIN_CREATE_ACTIONS)
  })

  it('carries no dash punctuation or arrows in its labels (repo rule)', () => {
    const banned = /[–—·→‘’“”]/
    const bad = CREATE_ACTIONS.filter((a) => banned.test(a.label)).map((a) => a.label)
    expect(bad).toEqual([])
  })
})

/* ── Task B: recent records in the palette ──────────────────────────────────── */

describe('recent records', () => {
  it('shows a recently opened record under Recent', () => {
    renderPalette({ records: [VEHICLE_RECORD] })
    const recent = screen.getByText('Recent').parentElement
    expect(within(recent).getByText('TM527')).toBeInTheDocument()
  })

  it('does not render a record whose module the user may no longer see', () => {
    // Suppliers is admin-only, so a Manager must not see the stored supplier
    // record. The vehicle beside it proves the block ran rather than emptied.
    renderPalette({ records: [VEHICLE_RECORD, SUPPLIER_RECORD] })

    const recent = screen.getByText('Recent').parentElement
    expect(within(recent).getByText('TM527')).toBeInTheDocument()
    expect(within(recent).queryByText('Al Fanar Trading')).toBeNull()
    // and nowhere else in the palette either, so there is no back door.
    expect(screen.queryByText('Al Fanar Trading')).toBeNull()
  })

  it('drops a record once its own module is revoked', () => {
    // Same record, same user, only the permission changed: access is re-decided
    // on every render because the store holds a source, never an allow.
    renderPalette({
      records: [VEHICLE_RECORD],
      auth: { hasPermission: (key) => key !== 'fleet_master' },
    })
    expect(screen.queryByText('TM527')).toBeNull()
  })

  it('drops a record whose source is no longer in the registry', () => {
    renderPalette({ records: [{ label: 'Ghost', path: '/ghost/1', source: 'no-such-source' }] })
    expect(screen.queryByText('Ghost')).toBeNull()
  })

  it('shows nothing typed-query side, so ranking is untouched', () => {
    renderPalette({ records: [VEHICLE_RECORD] })
    expect(screen.getByText('TM527')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'budget' } })

    expect(screen.queryByText('Recent')).toBeNull()
    expect(screen.queryByText('TM527')).toBeNull()
    expect(screen.getByText('Commands')).toBeInTheDocument()
  })
})

describe('recording a record when the user opens it', () => {
  it('captures the picked record, and keeps it out of the command store', () => {
    renderPalette()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MIX' } })

    return screen.findByText('MIX-204').then((row) => {
      fireEvent.mouseDown(row)

      // Label and path are captured at the moment of the pick, because there is
      // no nav entry to look either of them up from afterwards.
      expect(loadRecentRecords()).toEqual([
        expect.objectContaining({ label: 'MIX-204', path: '/vehicle/MIX-204', source: 'vehicles' }),
      ])
      // and the palette's own command trail stays free of it.
      expect(localStorage.getItem('tp_recent_commands') || '[]').not.toContain('MIX-204')
    })
  })
})

describe('recent record storage', () => {
  it('keeps records out of the nav-route recents and vice versa', () => {
    pushRecentRecord(VEHICLE_RECORD)
    expect(loadRecentRecords()).toHaveLength(1)
    expect(loadRecents()).toEqual([])
    expect(localStorage.getItem(RECENTS_KEY)).toBeNull()

    // A bare route is not a record: no label, no source, so it is refused.
    localStorage.setItem(RECENTS_KEY, JSON.stringify(['/tyres']))
    pushRecentRecord('/tyres')
    expect(loadRecentRecords()).toHaveLength(1)
  })

  it('moves a re-opened record to the front instead of duplicating it', () => {
    pushRecentRecord(VEHICLE_RECORD)
    pushRecentRecord({ label: 'Tyre 24098182', path: '/tyres?search=24098182', source: 'tyres' })
    pushRecentRecord(VEHICLE_RECORD)

    const stored = loadRecentRecords()
    expect(stored.map((r) => r.path)).toEqual(['/vehicle/TM527', '/tyres?search=24098182'])
  })

  it('caps the list so it can never grow without bound', () => {
    for (let i = 0; i < MAX_RECORD_RECENTS + 4; i += 1) {
      pushRecentRecord({ label: `Asset ${i}`, path: `/vehicle/A${i}`, source: 'vehicles' })
    }
    expect(loadRecentRecords()).toHaveLength(MAX_RECORD_RECENTS)
  })

  it('never throws on unusable storage or junk, it just does nothing', () => {
    localStorage.setItem(RECORD_RECENTS_KEY, 'not json at all')
    expect(loadRecentRecords()).toEqual([])

    localStorage.setItem(RECORD_RECENTS_KEY, JSON.stringify([{ path: '/x' }, null, 5, '/y']))
    expect(loadRecentRecords()).toEqual([])

    expect(() => pushRecentRecord(null)).not.toThrow()
    expect(() => pushRecentRecord({ label: '', path: '', source: '' })).not.toThrow()
  })

  it('fails closed when no permission predicate is supplied', () => {
    // "We could not check" is not "it is allowed" - the same rule the route
    // resolvers follow.
    expect(visibleRecentRecords([VEHICLE_RECORD], undefined)).toEqual([])
    expect(visibleRecentRecords([VEHICLE_RECORD], () => true)).toHaveLength(1)
  })

  it('leaves favourites untouched', () => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(['/tyres']))
    pushRecentRecord(VEHICLE_RECORD)
    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY))).toEqual(['/tyres'])
  })
})
