import { describe, it, expect, vi } from 'vitest'
import {
  WIDGET_CATALOG, WIDGET_BY_ID, WIDGET_CATEGORIES, SIZE_PRESETS,
  MIN_W, MAX_W, HEIGHTS, MAX_WIDGETS_PER_LAYOUT, MAX_LAYOUTS,
  DEFAULT_LAYOUT, DASHBOARD_LAYOUTS_KEY,
  placeWidget, makeLayout, validateLayout,
  addWidget, removeWidget, moveWidget, resizeWidget,
  visibleLayouts, setDefaultLayout, pickInitialLayout,
  computeCostTrend, groupWorkOrdersByStatus,
  parseLayoutsValue, fetchLayouts, saveLayouts,
} from '../lib/dashboardBuilder'

const layoutOf = (widgets) => validateLayout({ id: 'L1', name: 'Test', widgets })

describe('WIDGET_CATALOG', () => {
  it('has unique ids, valid defaults, and a data descriptor per widget', () => {
    const ids = WIDGET_CATALOG.map(w => w.id)
    expect(new Set(ids).size).toBe(ids.length)
    WIDGET_CATALOG.forEach(w => {
      expect(w.label).toBeTruthy()
      expect(w.description).toBeTruthy()
      expect(WIDGET_CATEGORIES).toContain(w.category)
      expect(w.defaultW).toBeGreaterThanOrEqual(MIN_W)
      expect(w.defaultW).toBeLessThanOrEqual(MAX_W)
      expect(HEIGHTS).toContain(w.defaultH)
      expect(w.data?.source).toBeTruthy()
      expect(w.data?.shape).toBeTruthy()
    })
  })

  it('exposes every required widget', () => {
    ;[
      'fleet-availability', 'total-vehicles', 'tyres-in-service', 'critical-tyres',
      'monthly-tyre-cost', 'alerts-by-severity', 'inspections-today', 'pending-approvals',
      'vehicles-by-site', 'recent-alerts', 'tyre-cost-trend', 'work-orders-by-status',
    ].forEach(id => expect(WIDGET_BY_ID[id]).toBeTruthy())
  })
})

describe('placeWidget', () => {
  it('uses catalog defaults and clamps overrides', () => {
    expect(placeWidget('total-vehicles')).toEqual({ widgetId: 'total-vehicles', w: 1, h: 'sm' })
    expect(placeWidget('total-vehicles', { w: 99, h: 'bogus' })).toEqual({ widgetId: 'total-vehicles', w: 4, h: 'md' })
  })

  it('returns null for unknown ids', () => {
    expect(placeWidget('nope')).toBeNull()
  })
})

describe('addWidget', () => {
  it('appends with catalog defaults and returns a new object', () => {
    const l = layoutOf([])
    const next = addWidget(l, 'fleet-availability')
    expect(next).not.toBe(l)
    expect(l.widgets).toHaveLength(0)
    expect(next.widgets).toEqual([{ widgetId: 'fleet-availability', w: 1, h: 'md' }])
  })

  it('ignores unknown widget ids', () => {
    const l = layoutOf([])
    expect(addWidget(l, 'not-a-widget')).toBe(l)
  })

  it('enforces the per-layout widget cap', () => {
    const full = layoutOf(Array.from({ length: MAX_WIDGETS_PER_LAYOUT }, () => ({ widgetId: 'total-vehicles', w: 1, h: 'sm' })))
    expect(addWidget(full, 'total-vehicles')).toBe(full)
  })
})

describe('removeWidget', () => {
  const l = layoutOf([
    { widgetId: 'total-vehicles', w: 1, h: 'sm' },
    { widgetId: 'critical-tyres', w: 1, h: 'sm' },
  ])

  it('removes by index immutably', () => {
    const next = removeWidget(l, 0)
    expect(next.widgets.map(w => w.widgetId)).toEqual(['critical-tyres'])
    expect(l.widgets).toHaveLength(2)
  })

  it('is a no-op for out-of-range or non-integer indices', () => {
    expect(removeWidget(l, -1)).toBe(l)
    expect(removeWidget(l, 2)).toBe(l)
    expect(removeWidget(l, 0.5)).toBe(l)
  })
})

describe('moveWidget', () => {
  const l = layoutOf([
    { widgetId: 'total-vehicles', w: 1, h: 'sm' },
    { widgetId: 'critical-tyres', w: 1, h: 'sm' },
    { widgetId: 'recent-alerts', w: 2, h: 'lg' },
  ])

  it('moves forward and backward', () => {
    expect(moveWidget(l, 0, 2).widgets.map(w => w.widgetId))
      .toEqual(['critical-tyres', 'recent-alerts', 'total-vehicles'])
    expect(moveWidget(l, 2, 0).widgets.map(w => w.widgetId))
      .toEqual(['recent-alerts', 'total-vehicles', 'critical-tyres'])
  })

  it('is a no-op for same/invalid indices', () => {
    expect(moveWidget(l, 1, 1)).toBe(l)
    expect(moveWidget(l, -1, 0)).toBe(l)
    expect(moveWidget(l, 0, 3)).toBe(l)
  })
})

describe('resizeWidget', () => {
  const l = layoutOf([{ widgetId: 'vehicles-by-site', w: 2, h: 'md' }])

  it('resizes width and height with clamping', () => {
    expect(resizeWidget(l, 0, { w: 3 }).widgets[0]).toMatchObject({ w: 3, h: 'md' })
    expect(resizeWidget(l, 0, { h: 'lg' }).widgets[0]).toMatchObject({ w: 2, h: 'lg' })
    expect(resizeWidget(l, 0, { w: 0 }).widgets[0].w).toBe(MIN_W)
    expect(resizeWidget(l, 0, { w: 12 }).widgets[0].w).toBe(MAX_W)
    expect(resizeWidget(l, 0, { h: 'huge' }).widgets[0].h).toBe('md')
  })

  it('applies S/M/L presets', () => {
    Object.entries(SIZE_PRESETS).forEach(([, preset]) => {
      const next = resizeWidget(l, 0, preset)
      expect(next.widgets[0]).toMatchObject(preset)
    })
  })

  it('is a no-op out of range', () => {
    expect(resizeWidget(l, 5, { w: 2 })).toBe(l)
  })
})

describe('validateLayout', () => {
  it('drops unknown widget ids and clamps sizes', () => {
    const l = validateLayout({
      id: 'x', name: '  Ops  ',
      widgets: [
        { widgetId: 'total-vehicles', w: 9, h: 'weird' },
        { widgetId: 'ghost-widget', w: 1, h: 'sm' },
        null, 'junk',
      ],
    })
    expect(l.name).toBe('Ops')
    expect(l.widgets).toEqual([{ widgetId: 'total-vehicles', w: 4, h: 'md' }])
  })

  it('never throws on garbage and always returns a usable layout', () => {
    ;[null, undefined, 42, 'str', {}, { widgets: 'nope' }].forEach(input => {
      const l = validateLayout(input)
      expect(typeof l.id).toBe('string')
      expect(l.name).toBe('Untitled')
      expect(l.widgets).toEqual([])
      expect(l.shared).toBe(false)
    })
  })

  it('caps widgets at MAX_WIDGETS_PER_LAYOUT', () => {
    const widgets = Array.from({ length: MAX_WIDGETS_PER_LAYOUT + 5 }, () => ({ widgetId: 'total-vehicles', w: 1, h: 'sm' }))
    expect(validateLayout({ name: 'big', widgets }).widgets).toHaveLength(MAX_WIDGETS_PER_LAYOUT)
  })
})

describe('makeLayout / DEFAULT_LAYOUT', () => {
  it('creates a layout with identity + audit metadata', () => {
    const l = makeLayout({ name: 'Mine', createdBy: 'u1' })
    expect(l.id).toBeTruthy()
    expect(l.name).toBe('Mine')
    expect(l.created_by).toBe('u1')
    expect(l.shared).toBe(false)
    expect(l.is_default).toBe(false)
    expect(new Date(l.created_at).getTime()).not.toBeNaN()
  })

  it('DEFAULT_LAYOUT is valid, shared, and only references catalog widgets', () => {
    expect(DEFAULT_LAYOUT.shared).toBe(true)
    expect(DEFAULT_LAYOUT.widgets.length).toBeGreaterThan(0)
    DEFAULT_LAYOUT.widgets.forEach(w => expect(WIDGET_BY_ID[w.widgetId]).toBeTruthy())
  })
})

describe('visibility & defaults', () => {
  const layouts = [
    { id: 'a', name: 'A', widgets: [], created_by: 'u1', shared: false, is_default: false },
    { id: 'b', name: 'B', widgets: [], created_by: 'u2', shared: true, is_default: false },
    { id: 'c', name: 'C', widgets: [], created_by: 'u2', shared: false, is_default: false },
    { id: 'd', name: 'D', widgets: [], created_by: 'u1', shared: false, is_default: true },
  ]

  it('visibleLayouts: own + shared only', () => {
    expect(visibleLayouts(layouts, 'u1').map(l => l.id)).toEqual(['a', 'b', 'd'])
    expect(visibleLayouts(layouts, 'u2').map(l => l.id)).toEqual(['b', 'c'])
    expect(visibleLayouts(layouts, null).map(l => l.id)).toEqual(['b'])
    expect(visibleLayouts(undefined, 'u1')).toEqual([])
  })

  it('setDefaultLayout: sets one, clears the user\'s others, ignores other owners', () => {
    const next = setDefaultLayout(layouts, 'a', 'u1')
    expect(next.find(l => l.id === 'a').is_default).toBe(true)
    expect(next.find(l => l.id === 'd').is_default).toBe(false)
    expect(next.find(l => l.id === 'b').is_default).toBe(false)
    // original untouched
    expect(layouts.find(l => l.id === 'd').is_default).toBe(true)
  })

  it('pickInitialLayout: user default → first own → first shared → null', () => {
    expect(pickInitialLayout(layouts, 'u1').id).toBe('d')
    expect(pickInitialLayout(layouts, 'u2').id).toBe('b')
    expect(pickInitialLayout(layouts, 'u3').id).toBe('b')
    expect(pickInitialLayout([], 'u1')).toBeNull()
  })
})

describe('computeCostTrend', () => {
  const now = new Date('2026-07-15T12:00:00')

  it('buckets cost_per_tyre × qty into the last 6 calendar months, oldest first', () => {
    const trend = computeCostTrend([
      { issue_date: '2026-07-01', cost_per_tyre: 100, qty: 2 },   // 200 in Jul
      { issue_date: '2026-07-20', cost_per_tyre: 50 },            // +50 (qty defaults 1)
      { issue_date: '2026-02-10', cost_per_tyre: 300, qty: 1 },   // 300 in Feb
      { issue_date: '2025-12-31', cost_per_tyre: 999 },           // outside window
      { issue_date: null, cost_per_tyre: 999 },                   // no date
    ], now)
    expect(trend).toHaveLength(6)
    expect(trend[0].key).toBe('2026-02')
    expect(trend[0].cost).toBe(300)
    expect(trend[5].key).toBe('2026-07')
    expect(trend[5].cost).toBe(250)
    expect(trend[1].cost + trend[2].cost + trend[3].cost + trend[4].cost).toBe(0)
  })

  it('handles empty input', () => {
    const trend = computeCostTrend([], now)
    expect(trend).toHaveLength(6)
    expect(trend.every(b => b.cost === 0)).toBe(true)
  })
})

describe('groupWorkOrdersByStatus', () => {
  it('groups, sorts descending, buckets missing status as Unknown', () => {
    const r = groupWorkOrdersByStatus([
      { status: 'Open' }, { status: 'Open' }, { status: 'Completed' },
      { status: '' }, { status: null }, {},
    ])
    expect(r).toEqual([
      { status: 'Unknown', count: 3 },
      { status: 'Open', count: 2 },
      { status: 'Completed', count: 1 },
    ])
  })

  it('caps buckets at the limit and handles empty input', () => {
    const rows = ['A', 'B', 'C'].map(status => ({ status }))
    expect(groupWorkOrdersByStatus(rows, 2)).toHaveLength(2)
    expect(groupWorkOrdersByStatus()).toEqual([])
  })
})

describe('serialization: parseLayoutsValue', () => {
  it('round-trips a saved array (string or object) through validation', () => {
    const layouts = [makeLayout({ name: 'Mine', createdBy: 'u1', widgets: [{ widgetId: 'total-vehicles', w: 2, h: 'sm' }] })]
    const parsed = parseLayoutsValue(JSON.stringify(layouts))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('Mine')
    expect(parsed[0].widgets).toEqual([{ widgetId: 'total-vehicles', w: 2, h: 'sm' }])
    expect(parseLayoutsValue(layouts)).toHaveLength(1)
  })

  it('rejects malformed values without throwing', () => {
    expect(parseLayoutsValue('not json {{')).toEqual([])
    expect(parseLayoutsValue('{"a":1}')).toEqual([])
    expect(parseLayoutsValue(null)).toEqual([])
    expect(parseLayoutsValue([{ bogus: true }, { name: 'ok', widgets: [] }])).toHaveLength(1)
  })

  it('drops unknown widget ids inside stored layouts', () => {
    const parsed = parseLayoutsValue([{ name: 'L', widgets: [{ widgetId: 'ghost' }, { widgetId: 'recent-alerts' }] }])
    expect(parsed[0].widgets.map(w => w.widgetId)).toEqual(['recent-alerts'])
  })

  it('caps stored layouts at MAX_LAYOUTS', () => {
    const many = Array.from({ length: MAX_LAYOUTS + 10 }, (_, i) => ({ name: `L${i}`, widgets: [] }))
    expect(parseLayoutsValue(many)).toHaveLength(MAX_LAYOUTS)
  })
})

describe('persistence wrappers (mock supabase)', () => {
  function mockSupabase({ value = null, error = null, upsertError = null } = {}) {
    const upsert = vi.fn().mockResolvedValue({ error: upsertError })
    const maybeSingle = vi.fn().mockResolvedValue({ data: value == null ? null : { value }, error })
    const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle, upsert }
    return { from: vi.fn(() => chain), _chain: chain }
  }

  it('fetchLayouts reads app_settings by key and parses defensively', async () => {
    const layouts = [makeLayout({ name: 'Saved', createdBy: 'u1' })]
    const sb = mockSupabase({ value: JSON.stringify(layouts) })
    const rows = await fetchLayouts(sb)
    expect(sb.from).toHaveBeenCalledWith('app_settings')
    expect(sb._chain.eq).toHaveBeenCalledWith('key', DASHBOARD_LAYOUTS_KEY)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Saved')
  })

  it('fetchLayouts returns [] when nothing is stored and throws on DB error', async () => {
    expect(await fetchLayouts(mockSupabase())).toEqual([])
    await expect(fetchLayouts(mockSupabase({ error: { message: 'denied' } }))).rejects.toThrow('denied')
  })

  it('saveLayouts validates, serialises and upserts on the key', async () => {
    const sb = mockSupabase()
    const dirty = [{ name: 'Keep', widgets: [{ widgetId: 'ghost' }, { widgetId: 'total-vehicles', w: 9, h: 'x' }] }, null]
    const saved = await saveLayouts(sb, dirty)
    expect(saved).toHaveLength(1)
    expect(saved[0].widgets).toEqual([{ widgetId: 'total-vehicles', w: 4, h: 'md' }])
    const arg = sb._chain.upsert.mock.calls[0][0]
    expect(arg.key).toBe(DASHBOARD_LAYOUTS_KEY)
    expect(JSON.parse(arg.value)).toHaveLength(1)
    expect(sb._chain.upsert.mock.calls[0][1]).toEqual({ onConflict: 'key' })
  })

  it('saveLayouts surfaces upsert failures', async () => {
    const sb = mockSupabase({ upsertError: { message: 'RLS: admins only' } })
    await expect(saveLayouts(sb, [])).rejects.toThrow('RLS: admins only')
  })
})
