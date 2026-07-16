import { describe, it, expect } from 'vitest'
import {
  CATEGORICAL, colorAt, categorical, withAlpha, stylize, TREND_LINES,
  PRESETS, PRESET_KEYS, setReportPalette, getReportPalette, activePaletteName, DEFAULT_PRESET,
} from '../lib/reportColors'
import { afterEach } from 'vitest'

afterEach(() => setReportPalette(DEFAULT_PRESET, { persist: false })) // keep the singleton clean

describe('reportColors', () => {
  it('categorical palette is 12 unique #rrggbb hues', () => {
    expect(CATEGORICAL).toHaveLength(12)
    expect(new Set(CATEGORICAL).size).toBe(12)
    for (const c of CATEGORICAL) expect(c).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('colorAt cycles and is safe for negative / out-of-range indices', () => {
    expect(colorAt(0)).toBe(CATEGORICAL[0])
    expect(colorAt(12)).toBe(CATEGORICAL[0])
    expect(colorAt(13)).toBe(CATEGORICAL[1])
    expect(colorAt(-1)).toBe(CATEGORICAL[11])
  })

  it('categorical(n) returns n colours', () => {
    expect(categorical(3)).toEqual(CATEGORICAL.slice(0, 3))
    expect(categorical(0)).toEqual([])
    expect(categorical(-2)).toEqual([])
  })

  it('withAlpha appends an alpha byte and passes non-hex through', () => {
    expect(withAlpha('#6366f1', 1)).toBe('#6366f1ff')
    expect(withAlpha('#6366f1', 0)).toBe('#6366f100')
    expect(withAlpha('#10b981', 0.15)).toMatch(/^#10b981[0-9a-f]{2}$/)
    expect(withAlpha('rgb(1,2,3)', 0.5)).toBe('rgb(1,2,3)')
  })

  it('stylize colours bars per point and lines per dataset (non-mutating)', () => {
    const bar = { labels: ['a', 'b', 'c'], datasets: [{ data: [1, 2, 3] }] }
    const styledBar = stylize(bar, 'bar')
    expect(styledBar).not.toBe(bar)
    expect(styledBar.datasets[0].backgroundColor).toEqual(CATEGORICAL.slice(0, 3))
    expect(bar.datasets[0].backgroundColor).toBeUndefined() // original untouched

    const line = { labels: ['a', 'b'], datasets: [{ data: [1, 2] }, { data: [3, 4] }] }
    const styledLine = stylize(line, 'line')
    expect(styledLine.datasets[0].borderColor).toBe(TREND_LINES[0])
    expect(styledLine.datasets[1].borderColor).toBe(TREND_LINES[1])

    const area = stylize({ datasets: [{ data: [1] }] }, 'area')
    expect(area.datasets[0].fill).toBe(true)
    expect(area.datasets[0].backgroundColor).toMatch(/^#6366f1[0-9a-f]{2}$/)
  })

  it('tolerates empty / malformed input', () => {
    expect(stylize(null)).toBeNull()
    expect(stylize({})).toEqual({})
    expect(stylize({ datasets: 'x' })).toEqual({ datasets: 'x' })
  })

  it('every preset has 12 unique valid hex colours', () => {
    expect(PRESET_KEYS.length).toBeGreaterThanOrEqual(6)
    for (const key of PRESET_KEYS) {
      const p = PRESETS[key]
      expect(p, key).toHaveLength(12)
      expect(new Set(p).size, `${key} has duplicates`).toBe(12)
      for (const c of p) expect(c, key).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('setReportPalette switches the active palette by preset name', () => {
    setReportPalette('ocean', { persist: false })
    expect(activePaletteName()).toBe('ocean')
    expect(getReportPalette()).toEqual(PRESETS.ocean)
    expect(colorAt(0)).toBe(PRESETS.ocean[0])
    const styled = stylize({ datasets: [{ data: [1, 2] }] }, 'bar')
    expect(styled.datasets[0].backgroundColor).toEqual(PRESETS.ocean.slice(0, 2))
  })

  it('setReportPalette accepts a custom hex array and rejects junk', () => {
    setReportPalette(['#123456', '#abcdef'], { persist: false })
    expect(activePaletteName()).toBe('custom')
    expect(getReportPalette()).toEqual(['#123456', '#abcdef'])
    // invalid input is ignored (active palette unchanged)
    setReportPalette('not-a-preset', { persist: false })
    expect(getReportPalette()).toEqual(['#123456', '#abcdef'])
    setReportPalette(['nope', ''], { persist: false })
    expect(getReportPalette()).toEqual(['#123456', '#abcdef'])
  })
})
