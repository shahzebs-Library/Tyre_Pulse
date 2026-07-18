import { describe, it, expect } from 'vitest'
import {
  normalizeNavLayout,
  applyNavLayout,
  buildNavEditorModel,
  editorModelToLayout,
} from '../lib/navLayout'

// A miniature stand-in for NAV_GROUPS: groups keyed by `label`, items keyed by
// `to`, carrying the same kind of gate props (adminOnly / roles / flag) the real
// nav uses — so we can prove those survive the overlay untouched.
const DEFAULTS = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: 'D' },
      { to: '/tyres', label: 'Tyre Records', icon: 'T' },
    ],
  },
  {
    label: 'Operations',
    groupRoles: ['Admin'],
    items: [
      { to: '/fleet-master', label: 'Fleet Master', icon: 'F' },
      { to: '/actions', label: 'Corrective Actions', icon: 'C', adminOnly: true },
      { to: '/rca', label: 'Root Cause', icon: 'R', roles: ['Admin', 'Manager'] },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/reports', label: 'Reports', icon: 'Rp' },
      { to: '/approvals', label: 'Approvals', icon: 'A', flag: 'automation_platform' },
    ],
  },
]

const groupOrder = (groups) => groups.map((g) => g.label)
const itemsOf = (groups, label) => {
  const g = groups.find((x) => x.label === label)
  return g ? g.items.map((i) => i.to) : null
}

describe('normalizeNavLayout', () => {
  it('empty / non-object input yields the canonical empty layout', () => {
    for (const bad of [undefined, null, 0, 'x', [], {}]) {
      expect(normalizeNavLayout(bad)).toEqual({ version: 1, groups: [], items: [] })
    }
  })

  it('drops malformed entries, non-string / duplicate keys and non-numeric orders', () => {
    const norm = normalizeNavLayout({
      groups: [
        { key: 'Overview', order: 1, hidden: true, label: 'Home' },
        { key: 'Overview', order: 9 }, // duplicate key -> ignored (first wins)
        { key: '', order: 2 }, // blank key -> dropped
        { order: 3 }, // missing key -> dropped
        { key: 'Ops', order: 'notanumber' }, // bad order -> kept without order
        null,
      ],
      items: [{ key: '/', group: 'Overview', order: 0, hidden: false }, { foo: 'bar' }],
    })
    expect(norm.groups).toEqual([
      { key: 'Overview', order: 1, hidden: true, label: 'Home' },
      { key: 'Ops' },
    ])
    expect(norm.items).toEqual([{ key: '/', group: 'Overview', order: 0, hidden: false }])
  })
})

describe('applyNavLayout', () => {
  it('empty layout === defaults (order + items preserved)', () => {
    const eff = applyNavLayout(DEFAULTS, {})
    expect(groupOrder(eff)).toEqual(['Overview', 'Operations', 'Reports'])
    expect(itemsOf(eff, 'Overview')).toEqual(['/', '/tyres'])
    expect(itemsOf(eff, 'Operations')).toEqual(['/fleet-master', '/actions', '/rca'])
    expect(itemsOf(eff, 'Reports')).toEqual(['/reports', '/approvals'])
  })

  it('reorders groups; unmentioned groups keep default order appended after', () => {
    const eff = applyNavLayout(DEFAULTS, {
      groups: [{ key: 'Reports', order: 0 }, { key: 'Overview', order: 1 }],
    })
    // Reports, Overview customized first; Operations (unmentioned) appended.
    expect(groupOrder(eff)).toEqual(['Reports', 'Overview', 'Operations'])
  })

  it('reorders items within a group', () => {
    const eff = applyNavLayout(DEFAULTS, {
      items: [
        { key: '/rca', order: 0 },
        { key: '/fleet-master', order: 1 },
        // /actions unmentioned -> appended after the ordered ones
      ],
    })
    expect(itemsOf(eff, 'Operations')).toEqual(['/rca', '/fleet-master', '/actions'])
  })

  it('moves (regroups) an item into a different group at the chosen position', () => {
    // The console emits explicit orders for every item, so a regrouped item
    // sorts by its order among the target group's items.
    const eff = applyNavLayout(DEFAULTS, {
      items: [
        { key: '/', order: 0 },
        { key: '/tyres', order: 1 },
        { key: '/reports', group: 'Overview', order: 2 },
      ],
    })
    expect(itemsOf(eff, 'Overview')).toEqual(['/', '/tyres', '/reports'])
    expect(itemsOf(eff, 'Reports')).toEqual(['/approvals']) // moved out
  })

  it('hides an item and hides a group (cosmetic removal only)', () => {
    const eff = applyNavLayout(DEFAULTS, {
      groups: [{ key: 'Reports', hidden: true }],
      items: [{ key: '/actions', hidden: true }],
    })
    expect(groupOrder(eff)).toEqual(['Overview', 'Operations']) // Reports hidden
    expect(itemsOf(eff, 'Operations')).toEqual(['/fleet-master', '/rca']) // /actions hidden
  })

  it('renames a group label (display only; identity stays the default key)', () => {
    const eff = applyNavLayout(DEFAULTS, { groups: [{ key: 'Overview', label: 'Home', order: 0 }] })
    const home = eff.find((g) => g.key === 'Overview')
    expect(home.label).toBe('Home')
    expect(home.key).toBe('Overview')
  })

  it('ignores unknown group / item keys (never invents entries)', () => {
    const eff = applyNavLayout(DEFAULTS, {
      groups: [{ key: 'DoesNotExist', order: 0 }],
      items: [{ key: '/ghost', group: 'Nowhere', order: 0 }],
    })
    expect(groupOrder(eff)).toEqual(['Overview', 'Operations', 'Reports'])
    expect(itemsOf(eff, 'Overview')).toEqual(['/', '/tyres'])
  })

  it('preserves item role/flag/adminOnly gates and group props through the overlay', () => {
    const eff = applyNavLayout(DEFAULTS, {
      groups: [{ key: 'Operations', order: 0 }],
      items: [{ key: '/actions', order: 0 }],
    })
    const ops = eff.find((g) => g.key === 'Operations')
    expect(ops.groupRoles).toEqual(['Admin']) // group-level prop survived
    const actions = ops.items.find((i) => i.to === '/actions')
    expect(actions.adminOnly).toBe(true)
    const rca = ops.items.find((i) => i.to === '/rca')
    expect(rca.roles).toEqual(['Admin', 'Manager'])
    const approvals = eff.find((g) => g.key === 'Reports').items.find((i) => i.to === '/approvals')
    expect(approvals.flag).toBe('automation_platform')
  })

  it('is deterministic: same inputs produce identical output', () => {
    const layout = { groups: [{ key: 'Reports', order: 0 }], items: [{ key: '/rca', order: 0 }] }
    expect(applyNavLayout(DEFAULTS, layout)).toEqual(applyNavLayout(DEFAULTS, layout))
  })

  it('non-array defaults degrade to []', () => {
    expect(applyNavLayout(null, {})).toEqual([])
  })
})

describe('buildNavEditorModel', () => {
  it('includes hidden entries (flagged) so they can be toggled back on', () => {
    const model = buildNavEditorModel(DEFAULTS, {
      groups: [{ key: 'Reports', hidden: true }],
      items: [{ key: '/actions', hidden: true }],
    })
    const reports = model.find((g) => g.key === 'Reports')
    expect(reports.hidden).toBe(true) // still present in the editor
    const actions = model
      .find((g) => g.key === 'Operations')
      .items.find((i) => i.key === '/actions')
    expect(actions.hidden).toBe(true)
    expect(actions.label).toBe('Corrective Actions')
  })

  it('surfaces the rename plus the default label for reversibility', () => {
    const model = buildNavEditorModel(DEFAULTS, { groups: [{ key: 'Overview', label: 'Home' }] })
    const ov = model.find((g) => g.key === 'Overview')
    expect(ov.label).toBe('Home')
    expect(ov.defaultLabel).toBe('Overview')
  })
})

describe('editorModelToLayout round-trip', () => {
  it('serializes a model and re-applies to the same arrangement', () => {
    const model = buildNavEditorModel(DEFAULTS, {})
    // Move Reports to the front, rename Overview, hide /actions.
    const reordered = [model[2], { ...model[0], label: 'Home' }, model[1]]
    reordered[2].items = reordered[2].items.map((i) =>
      i.key === '/actions' ? { ...i, hidden: true } : i,
    )
    const layout = editorModelToLayout(reordered)
    const eff = applyNavLayout(DEFAULTS, layout)
    expect(eff.map((g) => g.key)).toEqual(['Reports', 'Overview', 'Operations'])
    expect(eff.find((g) => g.key === 'Overview').label).toBe('Home')
    expect(itemsOf(eff, 'Operations')).toEqual(['/fleet-master', '/rca'])
  })

  it('does not store a group label that equals its default', () => {
    const model = buildNavEditorModel(DEFAULTS, {})
    const layout = editorModelToLayout(model)
    for (const g of layout.groups) expect(g.label).toBeUndefined()
  })
})
