/**
 * Tyre position service: hand-pinned behaviour, the generated JS matrix that the
 * SQL mirror is held to, and the generated built-in wheel table inside the draft.
 *
 * Regenerate after an intended change:
 *   UPDATE_POSITION_FIXTURE=1 npx vitest run src/test/tyrePositionMirror.test.js
 * then run supabase/tests/tyre_position_service.test.mjs, which replays the same
 * fixture through the SQL.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveLayout, resolveWheel, comparePositions } from '../lib/tyrePositionService'
import { LAYOUT_SLOTS } from '../lib/vehicleTyreLayout'

const FIXTURE = resolve(process.cwd(), 'src/test/fixtures/tyrePositionCases.json')
const DRAFT = resolve(process.cwd(), 'supabase/pending_migrations/20261116090000_tyre_position_service.sql')
const UPDATE = process.env.UPDATE_POSITION_FIXTURE === '1'
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const KINDS = ['slot', 'erp', 'any']

function layoutOf(def) {
  const key = String(def.vehicleType || '').trim().replace(/\s+/g, ' ').toUpperCase()
  return resolveLayout({
    vehicleType: def.vehicleType, assetNo: def.assetNo, axleCount: def.axleCount ?? null,
    customLayouts: def.custom ? { [key]: { config: def.custom, updatedAt: def.customChanged || null } } : null,
    asOf: def.asOf || null,
    positionMappings: (def.mappings || []).map((m) => ({ ...m, layout_key: def.expect.key })),
  })
}
const byId = Object.fromEntries(fixture.layouts.map((l) => [l.id, l]))

function buildMatrix() {
  const rows = []
  for (const def of fixture.layouts) {
    const layout = layoutOf(def)
    for (const token of fixture.tokens) {
      for (const kind of KINDS) {
        const r = resolveWheel(layout, token, { kind })
        rows.push([def.id, token, kind, r.status, r.reason, r.canonical, r.slot])
      }
    }
  }
  return rows
}

const sqlText = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
function builtinWheelsSql() {
  const lines = []
  for (const key of Object.keys(LAYOUT_SLOTS)) {
    const layout = resolveLayout({ vehicleType: key })
    layout.wheels.forEach((w, i) => {
      lines.push(`    (${sqlText(key)}, ${i + 1}, ${sqlText(w.slot)}, ${sqlText(w.code)}, ${sqlText(w.group)}, ${w.ordinal}, ${sqlText(w.side)}, ${sqlText(w.io)})`)
    })
  }
  return lines.join(',\n')
}
const BEGIN = '-- BEGIN GENERATED BUILTIN WHEELS'
const END = '-- END GENERATED BUILTIN WHEELS'

describe('tyre position service', () => {
  it('every layout key resolves to itself (the generated wheel table covers them all)', () => {
    for (const key of Object.keys(LAYOUT_SLOTS)) {
      const l = resolveLayout({ vehicleType: key })
      expect(l.key, key).toBe(key)
      expect(l.wheels.length, key).toBe(LAYOUT_SLOTS[key].length)
      expect(new Set(l.wheels.map((w) => w.code)).size, `${key} codes are unique`).toBe(l.wheels.length)
    }
  })

  it('resolves each fixture layout as written by hand', () => {
    for (const def of fixture.layouts) {
      const l = layoutOf(def)
      expect(l.status, def.id).toBe(def.expect.status)
      expect(l.key, def.id).toBe(def.expect.key)
      expect(l.wheels.length, def.id).toBe(def.expect.wheels)
      if (def.expect.reason) expect(l.reason, def.id).toBe(def.expect.reason)
    }
  })

  it('holds the hand-pinned positions', () => {
    for (const c of fixture.pinned) {
      const r = resolveWheel(layoutOf(byId[c.layout]), c.token, { kind: c.kind })
      const label = `${c.layout} ${JSON.stringify(c.token)} ${c.kind}`
      expect(r.status, label).toBe(c.expect.status)
      expect(r.canonical, label).toBe(c.expect.canonical)
      if ('slot' in c.expect) expect(r.slot, label).toBe(c.expect.slot)
      if (c.expect.reason) expect(r.reason, label).toBe(c.expect.reason)
    }
  })

  it('holds the hand-pinned comparisons, and null is never read as a match', () => {
    for (const c of fixture.compare) {
      const r = comparePositions(layoutOf(byId[c.layout]), c.slot, c.erp)
      const label = `${c.layout} ${c.slot} vs ${c.erp}`
      expect(r.match, label).toBe(c.match)
      expect(r.status, label).toBe(c.status)
      expect(r.canonical, label).toBe(c.canonical)
      if (r.status !== 'resolved') expect(r.match, label).toBe(null)
    }
  })

  it('a canonical wheel is only ever returned with status resolved', () => {
    for (const row of buildMatrix()) {
      const [, , , status, , canonical, slot] = row
      if (status === 'resolved') { expect(canonical).toBeTruthy(); expect(slot).toBeTruthy() }
      else { expect(canonical).toBe(null); expect(slot).toBe(null) }
    }
  })

  it('an inspection recorded against another wheel plan than the asset has is not concluded', () => {
    const r = comparePositions({ vehicleType: 'TR-MIXER', assetNo: 'TM001' }, 'R1Ro', 'RHCO', { recordedVehicleType: 'TRAILER' })
    expect(r.match).toBe(null)
    expect(r.status).toBe('inconsistent')
    expect(r.reason).toBe('inspection_layout_differs_from_asset')
    const same = comparePositions({ vehicleType: 'TR-MIXER', assetNo: 'TM001' }, 'R1Ro', 'RHCO', { recordedVehicleType: 'Tri-mixer' })
    expect(same.match).toBe(true)
  })

  it('an old inspection resolves on the layout version in force on its date', () => {
    const v1 = { axles: [{ kind: 'steer' }, { kind: 'drive', dual: true }], spare: 0 }                       // 6 wheels
    const v2 = { axles: [{ kind: 'steer' }, { kind: 'steer' }, { kind: 'drive', dual: true }], spare: 0 }    // 8 wheels
    const history = [
      { vehicleType: 'custom rig', validFrom: '2026-01-10T08:00:00Z', validTo: '2026-06-01T09:00:00Z', basis: 'recorded', active: true, config: v1 },
      { vehicleType: 'CUSTOM RIG', validFrom: '2026-06-01T09:00:00Z', validTo: null, basis: 'recorded', active: true, config: v2 },
    ]
    const base = { vehicleType: 'CUSTOM RIG', layoutHistory: history, customLayouts: { 'CUSTOM RIG': { config: v2, updatedAt: '2026-06-01' } } }
    const old = resolveLayout({ ...base, asOf: '2026-03-01' })
    expect(old.basis).toBe('historical')
    expect(old.wheels.length).toBe(6)
    expect(resolveWheel(old, 'F2L', { kind: 'slot' }).status).toBe('inconsistent')   // did not exist then
    expect(resolveWheel(old, 'F1L', { kind: 'slot' }).status).toBe('resolved')
    const now = resolveLayout({ ...base, asOf: '2026-07-01' })
    expect(now.wheels.length).toBe(8)
    expect(resolveWheel(now, 'F2L', { kind: 'slot' }).status).toBe('resolved')
    // Edited on the record's own day: which layout the inspector saw is not known.
    const sameDay = resolveLayout({ ...base, asOf: '2026-06-01' })
    expect(resolveWheel(sameDay, 'F1L', { kind: 'slot' })).toMatchObject({ status: 'ambiguous', reason: 'layout_changed_since_record' })
    // Before the admin layout existed: nothing custom applies ("CUSTOM RIG" has no built-in layout).
    expect(resolveLayout({ ...base, asOf: '2025-12-01' }).status).toBe('unknown')
    // A backfilled first version says nothing about earlier days.
    const backfilled = resolveLayout({ ...base, asOf: '2025-12-01', layoutHistory: [{ ...history[0], basis: 'backfill' }, history[1]] })
    expect(resolveWheel(backfilled, 'F1L', { kind: 'slot' })).toMatchObject({ status: 'ambiguous', reason: 'layout_changed_since_record' })
    // A version switched off means the built-in layout was in force.
    const off = resolveLayout({ vehicleType: 'TR-MIXER', asOf: '2026-03-01', layoutHistory: [{ vehicleType: 'TR-MIXER', validFrom: '2026-01-01', validTo: null, basis: 'recorded', active: false, config: v1 }] })
    expect(off.key).toBe('Tri-mixer')
    // No versions supplied at all: the older safeguard still refuses a layout edited after the record.
    const none = resolveLayout({ vehicleType: 'CUSTOM RIG', customLayouts: base.customLayouts, asOf: '2026-03-01' })
    expect(none.changedAfterRecord).toBe(true)
  })

  it('there is no built-in reading of the ERP dual-rear spelling; only a verified mapping or the shared tyre map resolves it', () => {
    for (const type of ['TR-MIXER', 'TRAILER', 'PICKUP']) {
      const r = resolveWheel(resolveLayout({ vehicleType: type }), 'LHRCO', { kind: 'erp' })
      expect(r, type).toMatchObject({ status: 'ambiguous', reason: 'erp_spelling_not_verified', canonical: null })
    }
    // Concrete pumps: the shared tyre map names their rear wheels (comparison only).
    expect(resolveWheel(resolveLayout({ vehicleType: 'PUMPS' }), 'LHRCO', { kind: 'erp' }))
      .toMatchObject({ status: 'resolved', reason: 'tyre_map_code', slot: 'R1Lo' })
    expect(resolveWheel(resolveLayout({ vehicleType: 'PUMPS' }), 'LHR2-O', { kind: 'erp' }))
      .toMatchObject({ status: 'resolved', reason: 'tyre_map_code', slot: 'R2Lo' })
    expect(resolveWheel(resolveLayout({ vehicleType: 'PUMPS' }), 'LHR1-I', { kind: 'erp' }))
      .toMatchObject({ status: 'resolved', reason: 'tyre_map_code', slot: 'F3L' })
    const mapped = resolveLayout({ vehicleType: 'PUMPS', positionMappings: [
      { layout_key: 'Concrete pump', erp_code: 'LHRCO', slot: 'R1Ri' },          // a verified mapping still wins
      { layout_key: 'Tri-mixer', erp_code: 'RHRCO', slot: 'R1Ro' },               // another layout: not used
    ] })
    expect(resolveWheel(mapped, 'LHRCO', { kind: 'erp' })).toMatchObject({ status: 'resolved', reason: 'verified_mapping', slot: 'R1Ri' })
    expect(resolveWheel(mapped, 'RHRCO', { kind: 'erp' })).toMatchObject({ status: 'resolved', reason: 'tyre_map_code', slot: 'R1Ro' })
    // The 4 axle build reads its own map rows.
    const other = resolveLayout({ vehicleType: 'PUMPS', axleCount: 4 })
    expect(resolveWheel(other, 'LHRCO', { kind: 'erp' })).toMatchObject({ status: 'resolved', slot: 'R1Lo' })
    expect(resolveWheel(other, 'LHR1-I', { kind: 'erp' }).status).not.toBe('resolved')
  })

  it('the generated matrix in the fixture is current (the SQL mirror replays it)', () => {
    const matrix = buildMatrix()
    if (UPDATE) {
      writeFileSync(FIXTURE, `${JSON.stringify({ ...fixture, matrix }, null, 1)
        .replace(/\[\n\s+("[^"]*"),\n\s+("[^"]*"),\n\s+("[^"]*"),\n\s+("[^"]*"),\n\s+("[^"]*"),\n\s+(null|"[^"]*"),\n\s+(null|"[^"]*")\n\s+\]/g, '[$1, $2, $3, $4, $5, $6, $7]')}\n`)
      return
    }
    expect(fixture.matrix.length).toBe(matrix.length)
    expect(fixture.matrix).toEqual(matrix)
  })

  it('the built-in wheel table inside the SQL draft is generated from the JS layouts', () => {
    const sql = readFileSync(DRAFT, 'utf8')
    const a = sql.indexOf(BEGIN)
    const b = sql.indexOf(END)
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    const want = `${BEGIN}\n${builtinWheelsSql()}\n`
    if (UPDATE) {
      writeFileSync(DRAFT, sql.slice(0, a) + want + sql.slice(b))
      return
    }
    expect(sql.slice(a, b)).toBe(want)
  })
})
