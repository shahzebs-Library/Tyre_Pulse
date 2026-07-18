import { describe, it, expect } from 'vitest'
import {
  normalizeDiagramConfig, positionsFromConfig, tyreCountFromConfig, builtinToConfig,
  DEFAULT_DIAGRAM_CONFIG, AXLE_KINDS, BODY_STYLES, MAX_AXLES, MAX_SPARES,
  BUILTIN_TEMPLATE_TYPES,
} from '../lib/vehicleDiagram'

const DEFAULT_ACCENTS = {
  hazard: false, beacon: false, headlights: false, workLight: false, hazardSpeed: 'normal',
}

describe('vehicleDiagram engine', () => {
  it('normalizeDiagramConfig returns a valid default for null/garbage input', () => {
    for (const raw of [null, undefined, 42, 'x', {}, { axles: 'nope' }]) {
      const cfg = normalizeDiagramConfig(raw)
      expect(cfg.axles.length).toBeGreaterThanOrEqual(1)
      expect(cfg.axles.length).toBeLessThanOrEqual(MAX_AXLES)
      expect(BODY_STYLES).toContain(cfg.body)
      expect(cfg.spare).toBe(0)
      expect(cfg.accents).toEqual(DEFAULT_ACCENTS)
    }
    // never the same reference as the frozen default
    expect(normalizeDiagramConfig(null)).not.toBe(DEFAULT_DIAGRAM_CONFIG)
  })

  it('clamps axle count to 1..6 and folds invalid kinds to drive', () => {
    const many = { axles: Array.from({ length: 10 }, () => ({ kind: 'bogus', dual: 'yes' })) }
    const cfg = normalizeDiagramConfig(many)
    expect(cfg.axles).toHaveLength(MAX_AXLES)
    cfg.axles.forEach((a) => {
      expect(AXLE_KINDS).toContain(a.kind)
      expect(a.kind).toBe('drive')
      expect(a.dual).toBe(false) // only literal true counts
    })
    expect(normalizeDiagramConfig({ axles: [] }).axles.length).toBeGreaterThanOrEqual(1)
  })

  it('clamps spare to 0..2 and coerces accents to booleans', () => {
    expect(normalizeDiagramConfig({ spare: 9 }).spare).toBe(MAX_SPARES)
    expect(normalizeDiagramConfig({ spare: -3 }).spare).toBe(0)
    expect(normalizeDiagramConfig({ spare: 'abc' }).spare).toBe(0)
    expect(normalizeDiagramConfig({ spare: 1.6 }).spare).toBe(2)
    const cfg = normalizeDiagramConfig({ accents: { hazard: 1, beacon: 'true' } })
    expect(cfg.accents).toEqual(DEFAULT_ACCENTS)
    expect(normalizeDiagramConfig({ accents: { hazard: true, beacon: true } }).accents)
      .toEqual({ ...DEFAULT_ACCENTS, hazard: true, beacon: true })
  })

  it('back-compat: pre-existing accents objects gain the new fields with safe defaults', () => {
    // A config saved before headlights/workLight/hazardSpeed existed.
    const cfg = normalizeDiagramConfig({ accents: { hazard: true, beacon: false } })
    expect(cfg.accents).toEqual({ ...DEFAULT_ACCENTS, hazard: true })
    // New accents clamp: only literal true / known speeds count.
    const junk = normalizeDiagramConfig({ accents: { headlights: 'on', workLight: 1, hazardSpeed: 'ludicrous' } })
    expect(junk.accents).toEqual(DEFAULT_ACCENTS)
    const full = normalizeDiagramConfig({
      accents: { hazard: true, headlights: true, workLight: true, hazardSpeed: 'fast' },
    })
    expect(full.accents).toEqual({
      hazard: true, beacon: false, headlights: true, workLight: true, hazardSpeed: 'fast',
    })
    expect(normalizeDiagramConfig({ accents: { hazardSpeed: 'slow' } }).accents.hazardSpeed).toBe('slow')
  })

  it('back-compat: pre-existing axles gain lift/spacing/tyreSize defaults and clamp junk', () => {
    const legacy = normalizeDiagramConfig({ axles: [{ kind: 'steer', dual: false }] })
    expect(legacy.axles[0]).toEqual({
      kind: 'steer', dual: false, lift: false, spacing: 'normal', tyreSize: 'standard',
    })
    const junk = normalizeDiagramConfig({
      axles: [{ kind: 'drive', dual: true, lift: 'yes', spacing: 'huge', tyreSize: 'mega' }],
    })
    expect(junk.axles[0]).toEqual({
      kind: 'drive', dual: true, lift: false, spacing: 'normal', tyreSize: 'standard',
    })
    const valid = normalizeDiagramConfig({
      axles: [{ kind: 'lift', dual: false, lift: true, spacing: 'wide', tyreSize: 'wide' }],
    })
    expect(valid.axles[0]).toEqual({
      kind: 'lift', dual: false, lift: true, spacing: 'wide', tyreSize: 'wide',
    })
  })

  it('back-compat: a legacy V268 config renders geometry-identical wheel slots', () => {
    // Exactly what a pre-deepening saved row looks like.
    const layout = positionsFromConfig({
      version: 1,
      axles: [{ kind: 'steer', dual: false }, { kind: 'drive', dual: true }],
      spare: 0, body: 'truck', accents: { hazard: false, beacon: false },
    })
    expect(layout.tyres.find((t) => t.id === 'F1L')).toMatchObject({ x: 29, y: 24, w: 22, h: 38 })
    expect(layout.tyres.find((t) => t.id === 'F1R')).toMatchObject({ x: 149, y: 24, w: 22, h: 38 })
    // 24 + 48 (pitch) + 44 (cab gap)
    expect(layout.tyres.find((t) => t.id === 'R1Lo')).toMatchObject({ x: 14, y: 116, w: 19, h: 35 })
    expect(layout.viewH).toBe(116 + 35 + 18)
    expect(layout.bodySpec.liftMarkers).toEqual([])
  })

  it('folds an unknown body style to truck and keeps valid ones', () => {
    expect(normalizeDiagramConfig({ body: 'spaceship' }).body).toBe('truck')
    for (const b of BODY_STYLES) expect(normalizeDiagramConfig({ body: b }).body).toBe(b)
  })

  it('does not mutate its input', () => {
    const raw = {
      axles: [{ kind: 'steer', dual: false, lift: true, spacing: 'wide' }],
      spare: 5, body: 'mixer', accents: { hazard: true, hazardSpeed: 'fast' },
    }
    const snapshot = JSON.parse(JSON.stringify(raw))
    normalizeDiagramConfig(raw)
    positionsFromConfig(raw)
    expect(raw).toEqual(snapshot)
  })

  it('positionsFromConfig: single steer + dual drive emits 6 wheels with component-vocabulary ids', () => {
    const layout = positionsFromConfig({
      axles: [{ kind: 'steer', dual: false }, { kind: 'drive', dual: true }],
      spare: 0, body: 'truck',
    })
    expect(layout.tyres.map((t) => t.id)).toEqual(['F1L', 'F1R', 'R1Lo', 'R1Li', 'R1Ri', 'R1Ro'])
    expect(layout.tyres.find((t) => t.id === 'F1L').label).toBe('LHF1')
    expect(layout.tyres.find((t) => t.id === 'R1Lo').label).toBe('LHR1-O')
  })

  it('dual axles emit 4 wheels, single axles 2, spares add SP slots', () => {
    const layout = positionsFromConfig({
      axles: [
        { kind: 'steer', dual: false },
        { kind: 'drive', dual: true },
        { kind: 'drive', dual: true },
      ],
      spare: 1, body: 'mixer',
    })
    // 2 + 4 + 4 + 1 spare
    expect(layout.tyres).toHaveLength(11)
    expect(layout.tyres.filter((t) => t.id.startsWith('SP'))).toHaveLength(1)
    expect(layout.tyres.find((t) => t.id === 'SP1').label).toBe('SP')

    const two = positionsFromConfig({ axles: [{ kind: 'steer' }], spare: 2 })
    expect(two.tyres.filter((t) => t.id.startsWith('SP')).map((t) => t.id)).toEqual(['SP1', 'SP2'])
  })

  it('position ids are unique even on a maxed-out config', () => {
    const layout = positionsFromConfig({
      axles: [
        { kind: 'steer', dual: false },
        { kind: 'steer', dual: false },
        { kind: 'drive', dual: true },
        { kind: 'drive', dual: true },
        { kind: 'trailer', dual: true },
        { kind: 'lift', dual: false },
      ],
      spare: 2, body: 'pump',
    })
    const ids = layout.tyres.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(layout.tyres).toHaveLength(2 + 2 + 4 + 4 + 4 + 2 + 2)
  })

  it('emits the exact LAYOUTS entry shape the diagram component consumes', () => {
    const layout = positionsFromConfig(DEFAULT_DIAGRAM_CONFIG)
    expect(typeof layout.emoji).toBe('string')
    expect(typeof layout.viewH).toBe('number')
    expect(layout.viewH).toBeGreaterThan(0)
    expect(Array.isArray(layout.tyres)).toBe(true)
    layout.tyres.forEach((t) => {
      expect(typeof t.id).toBe('string')
      expect(typeof t.label).toBe('string')
      for (const k of ['x', 'y', 'w', 'h']) expect(typeof t[k]).toBe('number')
    })
    expect(layout.custom).toBe(true)
    expect(layout.bodySpec).toBeTruthy()
    expect(layout.bodySpec.cab).toBeTruthy()
    expect(layout.bodySpec.hull).toBeTruthy()
    expect(layout.bodySpec.accents.hazardSpeed).toBe('normal')
  })

  it('viewH grows with axle and spare count, wheels stay inside the viewbox', () => {
    const small = positionsFromConfig({ axles: [{ kind: 'steer' }] })
    const big = positionsFromConfig({
      axles: [{ kind: 'steer' }, { kind: 'drive', dual: true }, { kind: 'drive', dual: true }],
      spare: 1,
    })
    expect(big.viewH).toBeGreaterThan(small.viewH)
    big.tyres.forEach((t) => {
      expect(t.y + t.h).toBeLessThanOrEqual(big.viewH)
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.x + t.w).toBeLessThanOrEqual(200)
    })
  })

  it('rear-only config (no steer axle) still lays out from the top', () => {
    const layout = positionsFromConfig({ axles: [{ kind: 'trailer', dual: true }, { kind: 'trailer', dual: true }], body: 'trailer' })
    expect(layout.tyres[0].id).toBe('R1Lo')
    expect(layout.tyres[0].y).toBe(24)
  })

  it('tyreCountFromConfig matches the emitted slot count', () => {
    const cfg = { axles: [{ kind: 'steer' }, { kind: 'drive', dual: true }], spare: 1 }
    expect(tyreCountFromConfig(cfg)).toBe(positionsFromConfig(cfg).tyres.length)
    expect(tyreCountFromConfig(cfg)).toBe(7)
  })

  it('axle spacing changes the gap to the previous axle (compact < normal < wide)', () => {
    const base = [{ kind: 'steer' }, { kind: 'drive', dual: true }]
    const gapTo3 = (spacing) => {
      const layout = positionsFromConfig({ axles: [...base, { kind: 'drive', dual: true, spacing }] })
      const y2 = layout.tyres.find((t) => t.id === 'R1Lo').y
      const y3 = layout.tyres.find((t) => t.id === 'R2Lo').y
      return y3 - y2
    }
    expect(gapTo3('normal')).toBe(48)
    expect(gapTo3('compact')).toBe(34)
    expect(gapTo3('wide')).toBe(66)
    expect(gapTo3('compact')).toBeLessThan(gapTo3('normal'))
    expect(gapTo3('normal')).toBeLessThan(gapTo3('wide'))
    // Spacing on the FIRST axle has no effect (it has no previous axle).
    const first = positionsFromConfig({ axles: [{ kind: 'steer', spacing: 'wide' }] })
    expect(first.tyres[0].y).toBe(24)
  })

  it('tyreSize wide widens the wheel rect and preserves its center', () => {
    const std = positionsFromConfig({ axles: [{ kind: 'steer', dual: false }] })
    const wide = positionsFromConfig({ axles: [{ kind: 'steer', dual: false, tyreSize: 'wide' }] })
    const s = std.tyres.find((t) => t.id === 'F1L')
    const w = wide.tyres.find((t) => t.id === 'F1L')
    expect(w.w).toBeGreaterThan(s.w)
    expect(w.x + w.w / 2).toBeCloseTo(s.x + s.w / 2, 5)
    expect(w.h).toBe(s.h)

    const wideDual = positionsFromConfig({ axles: [{ kind: 'drive', dual: true, tyreSize: 'wide' }] })
    wideDual.tyres.forEach((t) => {
      expect(t.w).toBeGreaterThan(19)
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.x + t.w).toBeLessThanOrEqual(200)
    })
  })

  it('lift shrinks the wheels centered on the axle, marks it in bodySpec and keeps viewH stable', () => {
    const down = positionsFromConfig({ axles: [{ kind: 'steer' }, { kind: 'lift', dual: false }] })
    const up = positionsFromConfig({ axles: [{ kind: 'steer' }, { kind: 'lift', dual: false, lift: true }] })
    const d = down.tyres.find((t) => t.id === 'R1L')
    const u = up.tyres.find((t) => t.id === 'R1L')
    expect(u.w).toBeLessThan(d.w)
    expect(u.h).toBeLessThan(d.h)
    // centered inside the nominal footprint
    expect(u.x).toBeGreaterThan(d.x)
    expect(u.y).toBeGreaterThan(d.y)
    expect(u.x + u.w).toBeLessThan(d.x + d.w)
    expect(u.y + u.h).toBeLessThan(d.y + d.h)
    // toggling lift never changes the page geometry
    expect(up.viewH).toBe(down.viewH)
    expect(up.bodySpec.hull).toEqual(down.bodySpec.hull)
    // marker sits on the axle line
    expect(down.bodySpec.liftMarkers).toEqual([])
    expect(up.bodySpec.liftMarkers).toHaveLength(1)
    expect(up.bodySpec.liftMarkers[0].y).toBeCloseTo(d.y + d.h / 2, 1)
  })

  it('builtinToConfig reverse-maps built-in layouts (axles + body from tyre rows)', () => {
    const mixer = builtinToConfig('Tri-mixer')
    expect(mixer.body).toBe('mixer')
    expect(mixer.spare).toBe(0)
    expect(mixer.axles.map((a) => [a.kind, a.dual])).toEqual([
      ['steer', false], ['steer', false], ['drive', true], ['drive', true],
    ])

    const pump = builtinToConfig('Concrete pump')
    expect(pump.body).toBe('pump')
    expect(pump.axles.map((a) => [a.kind, a.dual])).toEqual([
      ['steer', false], ['steer', false], ['steer', false], ['drive', true], ['drive', true],
    ])

    const pickup = builtinToConfig('Pickup')
    expect(pickup.body).toBe('pickup')
    expect(pickup.axles.map((a) => [a.kind, a.dual])).toEqual([['steer', false], ['drive', false]])
  })

  it('builtinToConfig matches case/whitespace-insensitively and falls back to the default', () => {
    expect(builtinToConfig('  concrete   pump ')).toEqual(builtinToConfig('Concrete pump'))
    expect(builtinToConfig('TRI-MIXER').body).toBe('mixer')
    const fallback = builtinToConfig('Hovercraft')
    expect(fallback).toEqual(normalizeDiagramConfig(DEFAULT_DIAGRAM_CONFIG))
    // always a fresh object, never a shared reference
    expect(builtinToConfig('Hovercraft')).not.toBe(fallback)
    expect(builtinToConfig(null)).toEqual(normalizeDiagramConfig(DEFAULT_DIAGRAM_CONFIG))
  })

  it('every advertised builtin template yields a valid, renderable config', () => {
    expect(BUILTIN_TEMPLATE_TYPES.length).toBeGreaterThanOrEqual(8)
    for (const name of BUILTIN_TEMPLATE_TYPES) {
      const cfg = builtinToConfig(name)
      expect(BODY_STYLES).toContain(cfg.body)
      expect(cfg.axles.length).toBeGreaterThanOrEqual(1)
      expect(cfg.axles.length).toBeLessThanOrEqual(MAX_AXLES)
      const layout = positionsFromConfig(cfg)
      expect(layout.tyres.length).toBeGreaterThanOrEqual(4)
      const ids = layout.tyres.map((t) => t.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('bodySpec carries the full accents object for the renderer', () => {
    const layout = positionsFromConfig({
      axles: [{ kind: 'steer' }],
      accents: { hazard: true, beacon: true, headlights: true, workLight: true, hazardSpeed: 'fast' },
    })
    expect(layout.bodySpec.accents).toEqual({
      hazard: true, beacon: true, headlights: true, workLight: true, hazardSpeed: 'fast',
    })
  })
})
