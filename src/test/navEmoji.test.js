import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { navEmojiFor, NAV_EMOJI_ROUTES } from '../lib/navEmoji'
import { NAV_CATALOG } from '../components/Layout'
import { SECTION_KEYS } from '../lib/inventory/hubSections'

const sprite = fs.readFileSync(path.join(__dirname, '../../public/nav-emoji.svg'), 'utf8')
const symbols = new Set([...sprite.matchAll(/<symbol id="ne-([^"]+)"/g)].map((m) => m[1]))

describe('page emoji', () => {
  it('gives every sidebar page an emoji that exists in the sprite', () => {
    const routes = NAV_CATALOG.flatMap((g) => g.items.map((i) => i.key))
    expect(routes.length).toBeGreaterThan(150)
    const missing = routes.filter((r) => !navEmojiFor(r))
    expect(missing).toEqual([])
    const broken = NAV_EMOJI_ROUTES.map(navEmojiFor).filter((n) => !symbols.has(n))
    expect(broken).toEqual([])
  })

  it('matches a route with a hash or extra query back to its page', () => {
    expect(navEmojiFor('/tyres')).toBe('wheel')
    expect(navEmojiFor('/tyres#x')).toBe('wheel')
    expect(navEmojiFor('/nope')).toBeNull()
    expect(navEmojiFor(null)).toBeNull()
  })

  it('keeps the first matching key param when a link carries more', () => {
    expect(navEmojiFor('/stock?section=physical&tab=review')).toBe(navEmojiFor('/stock?section=physical'))
    expect(navEmojiFor('/stock?tab=review&section=audits')).toBe(navEmojiFor('/stock?section=audits'))
    expect(navEmojiFor('/stock?section=unknown')).toBe(navEmojiFor('/stock'))
  })

  it('gives every inventory hub section an emoji that exists in the sprite', () => {
    const names = SECTION_KEYS.map((k) => [k, navEmojiFor(`/stock?section=${k}`)])
    expect(names.filter(([, n]) => !n).map(([k]) => k)).toEqual([])
    expect(names.filter(([, n]) => !symbols.has(n)).map(([k]) => k)).toEqual([])
  })

  it('uses only sprite emoji on the inventory KPI tiles', () => {
    const src = fs.readFileSync(path.join(__dirname, '../components/inventory/InventoryKpiRow.jsx'), 'utf8')
    const used = [...src.matchAll(/emoji="([^"]+)"/g)].map((m) => m[1])
    expect(used.length).toBe(4)
    expect(used.filter((n) => !symbols.has(n))).toEqual([])
  })
})
