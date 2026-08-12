import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'

// Guard: --surface and --border were USED in 49 places and DEFINED nowhere, so
// every one of those panels rendered with no background (see-through) and every
// border fell back to currentColor. This pins that they stay defined.
describe('unsuffixed theme aliases', () => {
  let css
  beforeAll(() => { css = fs.readFileSync('src/index.css', 'utf8') })

  it('defines --surface and --border', () => {
    expect(css).toMatch(/--surface:\s*var\(--surface-1\)/)
    expect(css).toMatch(/--border:\s*var\(--border-dim\)/)
  })

  it('resolves them in both themes via the numbered scale', () => {
    // Both themes must define what the aliases point at, or the alias is dead.
    const dark = css.slice(css.indexOf(':root'), css.indexOf('html.light'))
    const light = css.slice(css.indexOf('html.light'))
    for (const block of [dark, light]) {
      expect(block).toMatch(/--surface-1:/)
      expect(block).toMatch(/--border-dim:/)
    }
  })
})
