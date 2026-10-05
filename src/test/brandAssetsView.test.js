import { describe, it, expect } from 'vitest'
import { buildCatalog, filterCatalog, tabCounts, governance, brokenPlacements, urlFormat, fmtBytes } from '../lib/brandAssetsView'

const logos = [
  { id: 'emblem-green', label: 'Emblem Green', layout: 'horizontal', color: 'green', file: 'emblem-green.png', width: 1000, height: 280, bytes: 60000 },
  { id: 'icon-green', label: 'Icon Green', layout: 'icon', color: 'green', file: 'icon-green.png', width: 512, height: 512, bytes: 9000 },
]
const slots = [
  { key: 'app_icon', label: 'App Icon' }, { key: 'report_cover', label: 'Report Cover' },
  { key: 'email_header', label: 'Email Header' }, { key: 'mobile_splash', label: 'Mobile Splash' },
]

describe('brandAssetsView', () => {
  it('builds library, registry and tenant assets with usage', () => {
    const branding = { logos: { app_icon: 'icon-green', report_cover: 'emblem-green', email_header: 'https://x.test/mail.svg' }, logo_url: '' }
    const cat = buildCatalog({ logos, illustrations: ['state/no-data'], icons: ['tyre'], branding, companyLogo: 'https://x.test/logo.png', slots })
    expect(cat.filter((a) => a.kind === 'logo')).toHaveLength(2)
    expect(cat.find((a) => a.id === 'state/no-data').category).toBe('state')
    expect(cat.find((a) => a.id === 'tyre').snippet).toBe('<TpIcon name="tyre" />')
    const tenant = cat.filter((a) => a.kind === 'tenant')
    expect(tenant.map((t) => t.id)).toEqual(['company_logo', 'upload:email_header'])
    expect(cat.find((a) => a.id === 'emblem-green').usage[0].channel).toBe('reports')
    const counts = tabCounts(cat)
    expect(counts.reports).toBe(2)
    expect(counts.email).toBe(1)
    expect(counts.mobile).toBe(0)
    expect(filterCatalog(cat, 'all', 'icon green').map((a) => a.id)).toEqual(['icon-green'])
  })

  it('no branding means no usage and no tenant marks, never invented', () => {
    const cat = buildCatalog({ logos, illustrations: [], icons: [], branding: null, companyLogo: '', slots })
    expect(cat.every((a) => a.usage.length === 0)).toBe(true)
    expect(cat.some((a) => a.kind === 'tenant')).toBe(false)
  })

  it('governance figures come from the placement map', () => {
    const branding = { logos: { app_icon: 'icon-green', report_cover: 'icon-green', email_header: 'old-logo' } }
    expect(brokenPlacements(branding, logos, slots)).toEqual([{ slot: 'email_header', label: 'Email Header', value: 'old-logo' }])
    const g = governance({ branding, logos, slots, companyLogo: '', registry: [{ asset_id: 'icon-green', status: 'deprecated' }] })
    expect(g.broken).toBe(1)
    expect(g.unassigned).toBe(1)
    expect(g.assigned).toBe(2)
    expect(g.consistencyPct).toBe(67)
    expect(g.deprecatedInUse).toBe(2)
    expect(g.warnings).toBe(1 + 1 + 2)
  })

  it('governance is unknown without branding and without a registry', () => {
    expect(governance({ branding: null, logos, slots }).warnings).toBeNull()
    expect(governance({ branding: { logos: {} }, logos, slots, registry: null }).deprecatedInUse).toBeNull()
    expect(governance({ branding: { logos: {} }, logos, slots }).consistencyPct).toBeNull()
  })

  it('formats', () => {
    expect(urlFormat('data:image/svg+xml;base64,AA')).toBe('SVG')
    expect(urlFormat('https://a.b/c.PNG?x=1')).toBe('PNG')
    expect(fmtBytes(2048)).toBe('2.0 KB')
    expect(fmtBytes(null)).toBeNull()
  })
})
