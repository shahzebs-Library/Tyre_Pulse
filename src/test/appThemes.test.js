import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ACCENT_THEMES, ACCENT_TOKEN_NAMES, accentTokens, accentContrast, accentCache,
  applyAccentVars, contrastRatio, greenDefaults, normalizeAccentChoice, customAccentTheme,
} from '../lib/appThemes'

const read = (p) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8').replace(/\r/g, '')
const css = read('src/index.css')

/** Custom properties declared directly in the first block opened by `selector {`. */
function blockVars(selector) {
  const start = css.indexOf(`\n${selector} {`)
  expect(start).toBeGreaterThan(-1)
  let depth = 0; let i = css.indexOf('{', start); const from = i
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') { depth--; if (depth === 0) break }
  }
  const body = css.slice(from + 1, i).replace(/\/\*[\s\S]*?\*\//g, '')
  const out = {}
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim()
  return out
}

describe('appThemes: contrast', () => {
  it('computes WCAG ratios correctly', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#16a34a')).toBeCloseTo(3.30, 2)
  })

  for (const t of ACCENT_THEMES.filter((x) => x.id !== 'green')) {
    it(`${t.id} meets AA 4.5:1 for every text pairing`, () => {
      const c = accentContrast(t)
      expect(c.onFill).toBeGreaterThanOrEqual(4.5)
      expect(c.onStrong).toBeGreaterThanOrEqual(4.5)
      expect(c.inkDark).toBeGreaterThanOrEqual(4.5)
      expect(c.inkLight).toBeGreaterThanOrEqual(4.5)
      expect(c.iconLight).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('green keeps its measured legacy contrast (unchanged on purpose)', () => {
    const c = accentContrast('green')
    expect(+c.onFill.toFixed(2)).toBe(3.30) // AA large text / UI only
    expect(+c.inkLight.toFixed(2)).toBe(2.28) // #22c55e on white, as before
    expect(c.inkDark).toBeGreaterThanOrEqual(4.5)
  })

  it('has six distinct presets', () => {
    expect(ACCENT_THEMES.map((t) => t.id)).toEqual(['green', 'blue', 'teal', 'indigo', 'orange', 'slate'])
    expect(new Set(ACCENT_THEMES.map((t) => t.swatch)).size).toBe(6)
  })
})

describe('appThemes: Green is byte-identical to the stylesheet', () => {
  const root = blockVars(':root')
  const light = { ...root, ...blockVars('html.light') }

  it('every Green dark token equals the :root default', () => {
    for (const [k, v] of Object.entries(greenDefaults('dark'))) expect([k, root[k]]).toEqual([k, v])
  })
  it('every Green light token equals the html.light value (or the :root fallback)', () => {
    for (const [k, v] of Object.entries(greenDefaults('light'))) expect([k, light[k]]).toEqual([k, v])
  })
  it('Green and the org default write nothing inline', () => {
    expect(accentTokens('green', 'dark')).toEqual({})
    expect(accentTokens('', 'light')).toEqual({})
  })
})

describe('appThemes: choices and application', () => {
  it('normalises stored values, mapping legacy hexes to presets', () => {
    expect(normalizeAccentChoice('#16A34A')).toBe('green')
    expect(normalizeAccentChoice('#2563eb')).toBe('blue')
    expect(normalizeAccentChoice('e11d48')).toBe('#e11d48')
    expect(normalizeAccentChoice('indigo')).toBe('indigo')
    expect(normalizeAccentChoice('nonsense')).toBe('')
    expect(normalizeAccentChoice(null)).toBe('')
  })

  it('a preset writes the same token names in both modes, borders only in dark', () => {
    const d = accentTokens('blue', 'dark'); const l = accentTokens('blue', 'light')
    expect(d['--accent-rgb']).toBe('29,78,216')
    expect(d['--accent-ink']).toBe('#93c5fd')
    expect(l['--accent-ink']).toBe('#1d4ed8')
    expect(d['--border-brand']).toBeDefined()
    expect(l['--border-brand']).toBeUndefined()
    Object.keys(d).forEach((k) => expect(ACCENT_TOKEN_NAMES).toContain(k))
  })

  it('custom hex picks readable text for the fill', () => {
    expect(customAccentTheme('#fde047').on).toBe('#101828')
    expect(accentTokens('#7c3aed', 'light')['--accent-on']).toBe('#ffffff')
  })

  it('applyAccentVars clears stale tokens and marks a personal choice', () => {
    const props = {}
    const root = {
      style: { setProperty: (k, v) => { props[k] = v }, removeProperty: (k) => { delete props[k] } },
      dataset: {},
    }
    applyAccentVars(root, 'orange', 'dark')
    expect(props['--accent']).toBe('#9a3412')
    expect(root.dataset.userAccent).toBe('1')
    applyAccentVars(root, 'green', 'dark')
    expect(props).toEqual({})
    expect(root.dataset.userAccent).toBe('1')
    applyAccentVars(root, '', 'light')
    expect(root.dataset.userAccent).toBeUndefined()
  })

  it('pre-paint cache carries both modes', () => {
    const c = accentCache('teal')
    expect(c.choice).toBe('teal')
    expect(c.light['--accent']).toBe('#115e59')
    expect(c.dark['--accent-ink']).toBe('#5eead4')
  })
})

describe('shell reads the accent tokens', () => {
  it('Layout no longer hard-codes the brand green rgba', () => {
    const layout = read('src/components/Layout.jsx')
    expect(layout).not.toMatch(/rgba\(22,\s*163,\s*74/)
    expect(layout).toContain('var(--accent-ink)')
    expect(layout).toContain('var(--accent-icon)')
  })
  it('theme-init.js reads tp_mode and the accent cache', () => {
    const init = read('public/theme-init.js')
    expect(init).toContain("'tp_mode'")
    expect(init).toContain("'tp_accent_vars'")
  })
})
