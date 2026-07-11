import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import BrandIcon from '../components/ui/BrandIcon'

describe('BrandIcon', () => {
  it('renders the default mark as a bare image (unchanged chrome)', () => {
    const html = renderToStaticMarkup(<BrandIcon src="/logo.svg" size={18} />)
    expect(html).toContain('<img')
    expect(html).not.toContain('bg-white')   // no chip → default chrome unchanged
    expect(html).not.toContain('<span')
    expect(html).toContain('/logo.svg')
  })

  it('frames a custom logo on a white chip so it stays legible', () => {
    const html = renderToStaticMarkup(<BrandIcon src="/brand/library/icon-mark.png" custom size={18} />)
    expect(html).toContain('<span')       // wrapped
    expect(html).toContain('bg-white')    // light chip → navy/coloured marks read
    expect(html).toContain('/brand/library/icon-mark.png')
  })
})
