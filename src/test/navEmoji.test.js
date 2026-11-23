import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { navEmojiFor, NAV_EMOJI_ROUTES } from '../lib/navEmoji'
import { NAV_CATALOG } from '../components/Layout'

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
})
