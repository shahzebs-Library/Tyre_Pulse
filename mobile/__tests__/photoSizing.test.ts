import { LADDERS, resizeTarget, resizedDimensions } from '../lib/photoSizing'

describe('photoSizing', () => {
  it('tyre ladder starts at 1280px / q0.6 and only shrinks', () => {
    const t = LADDERS.tyre
    expect(t[0]).toEqual({ maxLongEdge: 1280, compress: 0.6 })
    for (let i = 1; i < t.length; i++) {
      expect(t[i].maxLongEdge).toBeLessThan(t[i - 1].maxLongEdge)
      expect(t[i].compress).toBeLessThanOrEqual(t[i - 1].compress)
    }
    expect(t[t.length - 1].maxLongEdge).toBeGreaterThanOrEqual(720)
  })
  it('general ladder is unchanged', () => {
    expect(LADDERS.general[0]).toEqual({ maxLongEdge: 1600, compress: 0.5 })
  })
  it('targets the long edge for landscape and portrait', () => {
    expect(resizeTarget(4000, 3000, 1280)).toEqual({ width: 1280 })
    expect(resizeTarget(3000, 4000, 1280)).toEqual({ height: 1280 })
    expect(resizeTarget(3000, 3000, 1280)).toEqual({ width: 1280 })
  })
  it('never upscales', () => {
    expect(resizeTarget(1000, 800, 1280)).toBeNull()
    expect(resizeTarget(1280, 720, 1280)).toBeNull()
  })
  it('falls back to width when dimensions unknown', () => {
    expect(resizeTarget(null, undefined, 1280)).toEqual({ width: 1280 })
    expect(resizeTarget(0, 0, 1280)).toEqual({ width: 1280 })
    expect(resizeTarget(NaN, 5, 1280)).toEqual({ width: 1280 })
  })
  it('computes output size and a >60% pixel reduction vs 1600px for a 4:3 portrait', () => {
    const d = resizedDimensions(3000, 4000, 1280)
    expect(d).toEqual({ width: 960, height: 1280 })
    const oldPixels = 1600 * Math.round(4000 * (1600 / 3000)) // before: width-only 1600 => 1600x2133
    expect(d.width * d.height).toBeLessThan(oldPixels * 0.4)
  })
})
