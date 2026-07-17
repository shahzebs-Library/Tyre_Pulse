import { describe, it, expect } from 'vitest'
import {
  normalizeDiagramConfig, positionsFromConfig, tyreCountFromConfig,
  DEFAULT_DIAGRAM_CONFIG, AXLE_KINDS, BODY_STYLES, MAX_AXLES, MAX_SPARES,
} from '../lib/vehicleDiagram'

describe('vehicleDiagram engine', () => {
  it('normalizeDiagramConfig returns a valid default for null/garbage input', () => {
    for (const raw of [null, undefined, 42, 'x', {}, { axles: 'nope' }]) {
      const cfg = normalizeDiagramConfig(raw)
      expect(cfg.axles.length).toBeGreaterThanOrEqual(1)
      expect(cfg.axles.length).toBeLessThanOrEqual(MAX_AXLES)
      expect(BODY_STYLES).toContain(cfg.body)
      expect(cfg.spare).toBe(0)
      expect(cfg.accents).toEqual({ hazard: false, beacon: false })
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
    expect(cfg.accents).toEqual({ hazard: false, beacon: false })
    expect(normalizeDiagramConfig({ accents: { hazard: true, beacon: true } }).accents)
      .toEqual({ hazard: true, beacon: true })
  })

  it('folds an unknown body style to truck and keeps valid ones', () => {
    expect(normalizeDiagramConfig({ body: 'spaceship' }).body).toBe('truck')
    for (const b of BODY_STYLES) expect(normalizeDiagramConfig({ body: b }).body).toBe(b)
  })

  it('does not mutate its input', () => {
    const raw = { axles: [{ kind: 'steer', dual: false }], spare: 5, body: 'mixer', accents: { hazard: true } }
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
})
