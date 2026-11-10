/**
 * Two migration files with the same timestamp make `supabase db push` order them
 * by name and record only one version, so the second can be skipped silently.
 * Eight pairs existed until 2026-11-11 (enterprise pack 23/29). This keeps it at zero.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

describe('supabase/migrations timestamps', () => {
  it('every migration file has a unique 14-digit timestamp', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations')
    const stamps = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, 14))
    const dupes = stamps.filter((s, i) => stamps.indexOf(s) !== i)
    expect(dupes).toEqual([])
    expect(stamps.length).toBeGreaterThan(100)
  })
})
