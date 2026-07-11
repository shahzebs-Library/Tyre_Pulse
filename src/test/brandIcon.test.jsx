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

  it('renders a custom logo transparent (no chip) when chip=false', () => {
    const html = renderToStaticMarkup(<BrandIcon src="/brand/library/emblem-blue.png" custom chip={false} size={30} />)
    expect(html).not.toContain('bg-white') // blends with the page background
    expect(html).not.toContain('<span')
    expect(html).toContain('<img')
    expect(html).toContain('/brand/library/emblem-blue.png')
  })
})
