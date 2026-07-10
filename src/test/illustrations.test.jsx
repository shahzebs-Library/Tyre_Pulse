import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ILLUSTRATIONS, ILLUSTRATION_NAMES, getIllustration, hasIllustration } from '../components/illustrations/registry'

// Theme hexes that must NOT be hard-coded in artwork (surfaces/ink must be
// tokens so Light/Dark + tenant branding work). Brand hexes are allowed only as
// var() fallbacks like `var(--brand, #16a34a)`.
const FORBIDDEN_DARK = ['#0f172a', '#020704', '#111827', '#1e293b']

describe('illustration system', () => {
  it('discovers illustrations via the registry', () => {
    expect(ILLUSTRATION_NAMES.length).toBeGreaterThan(0)
    for (const name of ILLUSTRATION_NAMES) {
      expect(name).toMatch(/^[a-z0-9]+\/[a-z0-9-]+$/) // category/kebab-name
      expect(typeof getIllustration(name)).toBe('function')
      expect(hasIllustration(name)).toBe(true)
    }
  })

  it('every illustration renders accessible, self-contained SVG', () => {
    for (const [name, Cmp] of Object.entries(ILLUSTRATIONS)) {
      const html = renderToStaticMarkup(<Cmp title={`test ${name}`} animate={false} />)
      expect(html, name).toContain('<svg')
      expect(html, name).toContain('role="img"')
      expect(html, name).toContain('<title')           // a11y label present
      // No hard-coded dark surface hexes outside a var() fallback.
      for (const hex of FORBIDDEN_DARK) {
        const bare = new RegExp(`(?<!, )${hex}`, 'i') // allow `var(--x, #hex)`
        expect(bare.test(html), `${name} hard-codes ${hex}`).toBe(false)
      }
    }
  })

  it('unknown names resolve to null', () => {
    expect(getIllustration('does/not-exist')).toBeNull()
    expect(hasIllustration('does/not-exist')).toBe(false)
  })
})
