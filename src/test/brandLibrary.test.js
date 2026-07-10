import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  BRAND_LOGOS, BRAND_LOGO_BY_ID, LOGO_SLOTS, LOGO_SLOT_KEYS,
  assetUrl, isUrlValue, resolveLogoValue, resolveBrandLogo,
} from '../lib/brand/library'

const PUBLIC_DIR = path.resolve(__dirname, '../../public/brand/library')

describe('brand logo library', () => {
  it('ships a non-empty, well-formed manifest', () => {
    expect(BRAND_LOGOS.length).toBeGreaterThan(0)
    for (const l of BRAND_LOGOS) {
      expect(l.id).toMatch(/^[a-z0-9-]{1,64}$/)      // matches the server-side asset-id rule
      expect(l.file).toBe(`${l.id}.png`)
      expect(l.width).toBeGreaterThan(0)
      expect(l.height).toBeGreaterThan(0)
      expect(typeof l.label).toBe('string')
    }
  })

  it('has unique ids and a matching physical file for each', () => {
    const ids = BRAND_LOGOS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const l of BRAND_LOGOS) {
      expect(fs.existsSync(path.join(PUBLIC_DIR, l.file))).toBe(true)
    }
  })

  it('resolves asset ids, URLs and paths; rejects junk', () => {
    const first = BRAND_LOGOS[0]
    expect(assetUrl(first.id)).toBe(`/brand/library/${first.file}`)
    expect(resolveLogoValue(first.id)).toBe(`/brand/library/${first.file}`)
    expect(resolveLogoValue('https://x/y.png')).toBe('https://x/y.png')
    expect(resolveLogoValue('/uploads/a.png')).toBe('/uploads/a.png')
    expect(resolveLogoValue('unknown-id')).toBeNull()
    expect(resolveLogoValue('')).toBeNull()
    expect(resolveLogoValue(null)).toBeNull()
  })

  it('classifies URL vs asset-id values', () => {
    expect(isUrlValue('https://a/b.png')).toBe(true)
    expect(isUrlValue('/a/b.png')).toBe(true)
    expect(isUrlValue('horizontal-classic')).toBe(false)
  })

  it('resolves a placement from a branding object with fallback to null', () => {
    const id = BRAND_LOGOS[0].id
    const branding = { logos: { app_icon: id } }
    expect(resolveBrandLogo(branding, 'app_icon')).toBe(assetUrl(id))
    expect(resolveBrandLogo(branding, 'favicon')).toBeNull()
    expect(resolveBrandLogo(null, 'app_icon')).toBeNull()
  })

  it('slot keys align with the server-side allow-list (V120)', () => {
    // Keep in sync with _clean_brand_logos in MIGRATIONS_V120.
    const serverSlots = [
      'app_icon', 'login', 'favicon', 'report_cover',
      'email_header', 'mobile_splash', 'pdf_watermark',
    ]
    expect([...LOGO_SLOT_KEYS].sort()).toEqual([...serverSlots].sort())
    for (const s of LOGO_SLOTS) {
      expect(['dark', 'light', 'any']).toContain(s.surface)
      expect(Array.isArray(s.recommend)).toBe(true)
    }
  })

  it('every recommended layout exists in the library', () => {
    const layouts = new Set(BRAND_LOGOS.map((l) => l.layout))
    for (const s of LOGO_SLOTS) {
      for (const rec of s.recommend) {
        // recommendations reference real layout names so filters can surface them
        expect(layouts.has(rec) || ['wordmark', 'monogram'].includes(rec)).toBe(true)
      }
    }
  })

  it('exposes a fast id lookup', () => {
    for (const l of BRAND_LOGOS) expect(BRAND_LOGO_BY_ID[l.id]).toBe(l)
  })
})
