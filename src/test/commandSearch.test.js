import { describe, it, expect } from 'vitest'
import {
  NAV_COMMANDS,
  ACTION_COMMANDS,
  RECORD_SOURCES,
  isCommandVisible,
  visibleCommands,
  visibleRecordSources,
  scoreCommand,
  rankCommands,
  buildOrClause,
  mapRecordRows,
} from '../lib/commandSearch'

const admin = { role: 'Admin' }
const manager = { role: 'Manager' }
const inspector = { role: 'Inspector' }
const tyreMan = { role: 'Tyre Man' }
const allowAll = () => true
const denyAll = () => false

// ─────────────────────────────────────────────────────────────────────────────
// RBAC visibility - must mirror Layout.jsx shouldShowNavItem + App.jsx ModuleRoute
// ─────────────────────────────────────────────────────────────────────────────
describe('isCommandVisible', () => {
  it('hides everything when there is no profile', () => {
    expect(isCommandVisible({ path: '/tyres' }, null, allowAll)).toBe(false)
    expect(isCommandVisible({ path: '/tyres' }, undefined, allowAll)).toBe(false)
  })

  it('Inspector only sees /inspections and /settings', () => {
    expect(isCommandVisible({ path: '/inspections' }, inspector, allowAll)).toBe(true)
    expect(isCommandVisible({ path: '/settings' }, inspector, allowAll)).toBe(true)
    expect(isCommandVisible({ path: '/tyres' }, inspector, allowAll)).toBe(false)
    expect(isCommandVisible({ path: '/audit', adminOnly: true }, inspector, allowAll)).toBe(false)
  })

  it('adminOnly commands are hidden from non-Admin roles', () => {
    const cmd = { path: '/audit', adminOnly: true }
    expect(isCommandVisible(cmd, admin, allowAll)).toBe(true)
    expect(isCommandVisible(cmd, manager, allowAll)).toBe(false)
    expect(isCommandVisible(cmd, tyreMan, allowAll)).toBe(false)
  })

  it('roles-restricted commands require role membership', () => {
    const cmd = { path: '/analytics', roles: ['Admin', 'Manager', 'Director'] }
    expect(isCommandVisible(cmd, manager, allowAll)).toBe(true)
    expect(isCommandVisible(cmd, tyreMan, allowAll)).toBe(false)
  })

  it('moduleKey commands are gated through hasPermission', () => {
    const cmd = { path: '/analytics', roles: ['Admin', 'Manager', 'Director'], moduleKey: 'analytics' }
    expect(isCommandVisible(cmd, manager, allowAll)).toBe(true)
    expect(isCommandVisible(cmd, manager, denyAll)).toBe(false)
  })

  it('keyed commands are gated by the access matrix even without an explicit moduleKey', () => {
    // /tyres maps to NAV_MODULE_KEY 'tyre_records' - hidden when the matrix denies it,
    // exactly as the sidebar hides it (this was the reported search bug).
    expect(isCommandVisible({ path: '/tyres' }, manager, denyAll)).toBe(false)
    expect(isCommandVisible({ path: '/tyres' }, tyreMan, denyAll)).toBe(false)
    expect(isCommandVisible({ path: '/tyres' }, manager, allowAll)).toBe(true)
  })

  it('truly ungated commands (no module key) stay visible to any non-Inspector role', () => {
    expect(isCommandVisible({ path: '/zzz-unmapped' }, tyreMan, denyAll)).toBe(true)
    expect(isCommandVisible({ path: '/zzz-unmapped' }, manager, denyAll)).toBe(true)
  })

  it('Data Monitor Officer only sees accidents + settings', () => {
    const dmo = { role: 'Data Monitor Officer' }
    expect(isCommandVisible({ path: '/accidents' }, dmo, allowAll)).toBe(true)
    expect(isCommandVisible({ path: '/settings' }, dmo, allowAll)).toBe(true)
    expect(isCommandVisible({ path: '/analytics', roles: ['Admin', 'Manager', 'Director'] }, dmo, allowAll)).toBe(false)
  })

  it('a custom role is deny-by-default, gated through the matrix', () => {
    const custom = { role: 'Fleet Supervisor' }
    expect(isCommandVisible({ path: '/tyres' }, custom, denyAll)).toBe(false)
    expect(isCommandVisible({ path: '/tyres' }, custom, allowAll)).toBe(true)
    expect(isCommandVisible({ path: '/settings' }, custom, denyAll)).toBe(true) // always-allowed
  })

  it('a per-user grant opens a denied module', () => {
    const granted = new Set(['tyre_records'])
    expect(isCommandVisible({ path: '/tyres' }, manager, denyAll)).toBe(false)
    expect(isCommandVisible({ path: '/tyres' }, manager, denyAll, granted)).toBe(true)
  })

  it('super-admin sees adminOnly commands regardless of role', () => {
    const su = { role: 'Reporter' }
    const cmd = { path: '/audit', adminOnly: true }
    expect(isCommandVisible(cmd, su, allowAll)).toBe(false)
    expect(isCommandVisible(cmd, su, allowAll, undefined, true)).toBe(true)
  })
})

describe('visibleCommands', () => {
  it('Admin with full permissions sees the whole registry', () => {
    expect(visibleCommands(NAV_COMMANDS, admin, allowAll)).toHaveLength(NAV_COMMANDS.length)
  })

  it('Manager never sees adminOnly entries', () => {
    const visible = visibleCommands(NAV_COMMANDS, manager, allowAll)
    expect(visible.some((c) => c.adminOnly)).toBe(false)
    expect(visible.some((c) => c.path === '/tyres')).toBe(true)
  })

  it('Inspector sees only the inspection surface', () => {
    const visible = visibleCommands([...NAV_COMMANDS, ...ACTION_COMMANDS], inspector, allowAll)
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.every((c) => c.path === '/inspections' || c.path === '/settings')).toBe(true)
  })
})

describe('visibleRecordSources', () => {
  it('Admin searches all record sources', () => {
    expect(visibleRecordSources(RECORD_SOURCES, admin, allowAll)).toHaveLength(RECORD_SOURCES.length)
  })

  it('non-admin roles do not search admin-only entities (suppliers, drivers)', () => {
    const ids = visibleRecordSources(RECORD_SOURCES, manager, allowAll).map((s) => s.id)
    expect(ids).not.toContain('suppliers')
    expect(ids).not.toContain('drivers')
    expect(ids).toContain('vehicles')
    expect(ids).toContain('tyres')
  })

  it('Inspector only searches inspections', () => {
    const ids = visibleRecordSources(RECORD_SOURCES, inspector, allowAll).map((s) => s.id)
    expect(ids).toEqual(['inspections'])
  })

  // ── Added record sources: each must be gated like the page it links to ──
  it('purchase orders are admin-only (same gate as suppliers)', () => {
    const forRole = (p, perm = allowAll) =>
      visibleRecordSources(RECORD_SOURCES, p, perm).map((s) => s.id)
    expect(forRole(admin)).toContain('purchase-orders')
    expect(forRole(manager)).not.toContain('purchase-orders')
    expect(forRole(tyreMan)).not.toContain('purchase-orders')
  })

  it('insurance claims follow the Admin/Manager/Director route gate', () => {
    const forRole = (p) => visibleRecordSources(RECORD_SOURCES, p, allowAll).map((s) => s.id)
    expect(forRole(admin)).toContain('insurance-claims')
    expect(forRole(manager)).toContain('insurance-claims')
    expect(forRole({ role: 'Director' })).toContain('insurance-claims')
    expect(forRole(tyreMan)).not.toContain('insurance-claims')
    expect(forRole({ role: 'Reporter' })).not.toContain('insurance-claims')
  })

  it('work orders, accidents and stock are hidden when their module is denied', () => {
    const denied = visibleRecordSources(RECORD_SOURCES, manager, denyAll).map((s) => s.id)
    expect(denied).not.toContain('work-orders')
    expect(denied).not.toContain('accidents')
    expect(denied).not.toContain('stock')

    const allowed = visibleRecordSources(RECORD_SOURCES, manager, allowAll).map((s) => s.id)
    expect(allowed).toContain('work-orders')
    expect(allowed).toContain('accidents')
    expect(allowed).toContain('stock')
  })

  it('a per-user grant opens a denied record source', () => {
    const granted = new Set(['work_orders'])
    const ids = visibleRecordSources(RECORD_SOURCES, manager, denyAll, granted).map((s) => s.id)
    expect(ids).toContain('work-orders')
    expect(ids).not.toContain('stock')
  })

  it('Data Monitor Officer searches accidents only', () => {
    const dmo = { role: 'Data Monitor Officer' }
    const ids = visibleRecordSources(RECORD_SOURCES, dmo, allowAll).map((s) => s.id)
    expect(ids).toEqual(['accidents'])
  })

  it('every record source declares a table, a select, fields and an access gate', () => {
    RECORD_SOURCES.forEach((s) => {
      expect(typeof s.table).toBe('string')
      expect(s.table.length).toBeGreaterThan(0)
      expect(typeof s.select).toBe('string')
      expect(s.select).not.toContain('*')          // never SELECT *
      expect(Array.isArray(s.fields)).toBe(true)
      expect(s.fields.length).toBeGreaterThan(0)
      expect(typeof s.access?.path).toBe('string')
      expect(typeof s.toResult).toBe('function')
      // Every searched field must be in the projection, or the ilike filters a
      // column the row does not carry back.
      const cols = s.select.split(',')
      s.fields.forEach((f) => expect(cols).toContain(f))
    })
  })

  it('record source ids are unique', () => {
    const ids = RECORD_SOURCES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Ranking
// ─────────────────────────────────────────────────────────────────────────────
describe('scoreCommand / rankCommands', () => {
  const cmds = [
    { id: 'a', label: 'Dashboard', path: '/' },
    { id: 'b', label: 'Fleet Analytics', path: '/fleet' },
    { id: 'c', label: 'Fleet Master', path: '/fleet-master' },
    { id: 'd', label: 'Live Fleet Status', path: '/live-fleet' },
    { id: 'e', label: 'Settings', path: '/settings', keywords: ['preferences'] },
  ]

  it('returns 0 for empty or non-matching queries', () => {
    expect(scoreCommand(cmds[0], '')).toBe(0)
    expect(scoreCommand(cmds[0], '   ')).toBe(0)
    expect(scoreCommand(cmds[0], 'zzz')).toBe(0)
  })

  it('prefers exact match over prefix over word-prefix over substring', () => {
    const exact = scoreCommand({ label: 'Fleet', path: '/x' }, 'fleet')
    const prefix = scoreCommand(cmds[1], 'fleet')       // label starts with query
    const wordPrefix = scoreCommand(cmds[3], 'fleet')   // "Live Fleet Status"
    const substring = scoreCommand({ label: 'Refleeting', path: '/x' }, 'fleet')
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(wordPrefix)
    expect(wordPrefix).toBeGreaterThan(substring)
  })

  it('is case-insensitive', () => {
    expect(scoreCommand(cmds[1], 'FLEET')).toBe(scoreCommand(cmds[1], 'fleet'))
  })

  it('matches on path and keywords as weakest signals', () => {
    expect(scoreCommand(cmds[2], '/fleet-master')).toBeGreaterThan(0)
    expect(scoreCommand(cmds[4], 'preferences')).toBeGreaterThan(0)
  })

  it('rankCommands sorts by score, is stable, and respects the limit', () => {
    const ranked = rankCommands(cmds, 'fleet')
    expect(ranked[0].id).toBe('b') // prefix beats word-prefix
    expect(ranked.map((c) => c.id)).toContain('c')
    expect(ranked.map((c) => c.id)).not.toContain('a')
    expect(rankCommands(cmds, 'fleet', 1)).toHaveLength(1)
    expect(rankCommands(cmds, '')).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Query building + record mapping
// ─────────────────────────────────────────────────────────────────────────────
describe('buildOrClause', () => {
  it('builds an ilike or-clause across fields', () => {
    expect(buildOrClause(['asset_no', 'make'], 'volvo'))
      .toBe('asset_no.ilike.%volvo%,make.ilike.%volvo%')
  })

  it('strips PostgREST-breaking characters (commas, parens, backslash, star)', () => {
    expect(buildOrClause(['name'], 'ab,c(d)\\*e')).toBe('name.ilike.%abcde%')
  })

  it('returns null when the sanitized term is too short', () => {
    expect(buildOrClause(['name'], 'a')).toBeNull()
    expect(buildOrClause(['name'], ',,(')).toBeNull()
    expect(buildOrClause(['name'], null)).toBeNull()
  })
})

describe('mapRecordRows', () => {
  const source = (id) => RECORD_SOURCES.find((s) => s.id === id)

  it('vehicle rows deep-link to /vehicle/:assetNo (URL-encoded)', () => {
    const [item] = mapRecordRows(source('vehicles'), [
      { id: 7, asset_no: 'TRK 001', make: 'Volvo', model: 'FH16', site: 'Muscat' },
    ])
    expect(item.path).toBe('/vehicle/TRK%20001')
    expect(item.label).toBe('TRK 001')
    expect(item.sub).toBe('Volvo · FH16 · Muscat')
    expect(item.id).toBe('vehicles-7')
  })

  it('vehicle rows without asset_no fall back to the fleet page', () => {
    const [item] = mapRecordRows(source('vehicles'), [{ id: 8, make: 'MAN' }])
    expect(item.path).toBe('/fleet-master')
  })

  it('tyre, supplier, driver and inspection rows map to their module pages', () => {
    expect(mapRecordRows(source('tyres'), [{ id: 1, serial_no: 'SN1', brand: 'Michelin' }])[0].path).toBe('/tyres?search=SN1')
    expect(mapRecordRows(source('suppliers'), [{ id: 2, supplier_name: 'Acme', supplier_code: 'AC1' }])[0].path).toBe('/suppliers')
    expect(mapRecordRows(source('drivers'), [{ id: 3, driver_id: 'D9', driver_name: 'Ali' }])[0].path).toBe('/driver-management')
    expect(mapRecordRows(source('inspections'), [{ id: 4, asset_no: 'TRK9' }])[0].path).toBe('/inspections')
  })

  it('handles null/empty row sets', () => {
    expect(mapRecordRows(source('tyres'), null)).toEqual([])
    expect(mapRecordRows(source('tyres'), [])).toEqual([])
  })

  // ── Added / extended sources ──────────────────────────────────────────────
  it('vehicles can be found by plate and by chassis, and show the plate', () => {
    const s = source('vehicles')
    // registration_no IS the plate on vehicle_fleet; there is no plate_number column.
    expect(s.fields).toContain('registration_no')
    expect(s.fields).toContain('chassis_no')
    expect(s.fields).not.toContain('plate_number')
    expect(s.select).toContain('registration_no')
    expect(s.select).toContain('chassis_no')

    const [item] = mapRecordRows(s, [
      { id: 9, asset_no: 'TM400', make: 'Sany', model: 'FH', registration_no: '7326 HRA', site: 'NHC' },
    ])
    expect(item.sub).toBe('Sany · FH · 7326 HRA · NHC')
  })

  it('tyres can be found by size, and the size is shown', () => {
    const s = source('tyres')
    expect(s.fields).toContain('size')
    expect(s.select).toContain('size')
    const [item] = mapRecordRows(s, [
      { id: 1, serial_no: 'SN1', asset_no: 'TM400', brand: 'Triangle', size: '315/80R22.5' },
    ])
    expect(item.sub).toBe('TM400 · Triangle · 315/80R22.5')
  })

  it('work order rows label on the job card number and link to the module page', () => {
    const [item] = mapRecordRows(source('work-orders'), [
      { id: 5, work_order_no: 'GCKR/JC/1005/0826', asset_no: 'TM400', status: 'Open', site: 'NHC' },
    ])
    expect(item.label).toBe('GCKR/JC/1005/0826')
    expect(item.sub).toBe('TM400 · Open · NHC')
    expect(item.path).toBe('/work-orders')
    expect(item.id).toBe('work-orders-5')
  })

  it('accident rows deep-link to the real /accidents/:id detail route', () => {
    const [item] = mapRecordRows(source('accidents'), [
      { id: 'abc-1', reference_no: 'ACC-2026-0007', asset_no: 'TM400', incident_date: '2026-07-08', severity: 'minor', status: 'reported' },
    ])
    expect(item.label).toBe('ACC-2026-0007')
    expect(item.path).toBe('/accidents/abc-1')

    // Falls back to the asset number as a label, and to the register with no id.
    const [noRef] = mapRecordRows(source('accidents'), [{ id: 2, asset_no: 'MP093' }])
    expect(noRef.label).toBe('MP093')
    const [noId] = mapRecordRows(source('accidents'), [{ asset_no: 'MP093' }])
    expect(noId.path).toBe('/accidents')
  })

  it('insurance claim rows label on the claim number', () => {
    const [item] = mapRecordRows(source('insurance-claims'), [
      { id: 3, claim_no: 'CLM-77', asset_no: 'TM400', insurer: 'Walaa', status: 'submitted' },
    ])
    expect(item.label).toBe('CLM-77')
    expect(item.sub).toBe('TM400 · Walaa · submitted')
    expect(item.path).toBe('/insurance-claims')
  })

  it('purchase order rows fall back from vendor_name to supplier_name', () => {
    const s = source('purchase-orders')
    expect(mapRecordRows(s, [{ id: 4, po_number: 'PO-1', vendor_name: 'Acme', order_date: '2026-08-01', status: 'open' }])[0].sub)
      .toBe('Acme · 2026-08-01 · open')
    expect(mapRecordRows(s, [{ id: 5, po_number: 'PO-2', supplier_name: 'Beta Co' }])[0].sub)
      .toBe('Beta Co')
    expect(mapRecordRows(s, [{ id: 6 }])[0].label).toBe('Purchase order')
  })

  it('stock rows keep a ZERO quantity visible (0 is falsy but meaningful)', () => {
    const s = source('stock')
    // A zero-stock item is exactly the row someone searches for, so the quantity
    // must survive the sub-line filter.
    const [zero] = mapRecordRows(s, [
      { id: 7, description: 'MS BOLT 8*25', site: 'JED', stock_qty: 0, stock_status: 'Critical' },
    ])
    expect(zero.sub).toBe('JED · Qty 0 · Critical')

    const [some] = mapRecordRows(s, [{ id: 8, description: 'GEAR OIL', site: 'JED', stock_qty: 42 }])
    expect(some.sub).toBe('JED · Qty 42')

    // A missing quantity is genuinely unknown and is simply omitted, not shown as 0.
    const [unknown] = mapRecordRows(s, [{ id: 9, description: 'GREASE', site: 'JED' }])
    expect(unknown.sub).toBe('JED')
    expect(unknown.path).toBe('/stock')
  })

  it('buildOrClause covers every new field set', () => {
    const clause = (id) => buildOrClause(source(id).fields, 'ab')
    expect(clause('vehicles'))
      .toBe('asset_no.ilike.%ab%,make.ilike.%ab%,model.ilike.%ab%,registration_no.ilike.%ab%,chassis_no.ilike.%ab%')
    expect(clause('work-orders')).toBe('work_order_no.ilike.%ab%,asset_no.ilike.%ab%')
    expect(clause('accidents')).toBe('asset_no.ilike.%ab%,reference_no.ilike.%ab%')
    expect(clause('insurance-claims')).toBe('claim_no.ilike.%ab%,asset_no.ilike.%ab%,policy_no.ilike.%ab%')
    expect(clause('purchase-orders')).toBe('po_number.ilike.%ab%,vendor_name.ilike.%ab%,supplier_name.ilike.%ab%')
    expect(clause('stock')).toBe('description.ilike.%ab%')
    // Still skips a too-short term on every source.
    RECORD_SOURCES.forEach((s) => expect(buildOrClause(s.fields, 'a')).toBeNull())
  })

  it('every new source maps a null/empty row set to []', () => {
    ;['work-orders', 'accidents', 'insurance-claims', 'purchase-orders', 'stock'].forEach((id) => {
      expect(mapRecordRows(source(id), null)).toEqual([])
      expect(mapRecordRows(source(id), [])).toEqual([])
    })
  })
})
