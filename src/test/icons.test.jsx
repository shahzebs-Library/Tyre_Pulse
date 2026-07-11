import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ICONS, ICON_NAMES, getIcon, hasIcon } from '../components/icons/registry'

describe('custom icon set', () => {
  it('discovers icons via the registry', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(0)
    for (const name of ICON_NAMES) {
      expect(name).toMatch(/^[a-z0-9-]+$/)
      expect(typeof getIcon(name)).toBe('function')
      expect(hasIcon(name)).toBe(true)
    }
  })

  it('every icon renders a theme-aware 24x24 stroke SVG', () => {
    for (const [name, Cmp] of Object.entries(ICONS)) {
      const html = renderToStaticMarkup(<Cmp title={name} />)
      expect(html, name).toContain('<svg')
      expect(html, name).toContain('viewBox="0 0 24 24"')
      expect(html, name).toContain('stroke="currentColor"')
      // No hard-coded colours (theme via currentColor). Allow currentColor only.
      const hexes = html.match(/#[0-9a-fA-F]{3,6}/g) || []
      expect(hexes, `${name} hard-codes ${hexes.join()}`).toHaveLength(0)
    }
  })

  it('unknown names resolve to null', () => {
    expect(getIcon('nope')).toBeNull()
    expect(hasIcon('nope')).toBe(false)
  })
})
