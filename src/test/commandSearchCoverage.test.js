/**
 * Guards that the command-palette search index (NAV_COMMANDS in
 * src/lib/commandSearch.js) stays in sync with the live sidebar navigation
 * (NAV_GROUPS in src/components/Layout.jsx). Because search cannot import
 * Layout.jsx (a render cycle: Layout -> CommandPalette -> commandSearch), the
 * two lists are kept aligned by this source-level check instead: every nav
 * item MUST have a searchable command, so a newly added module is findable in
 * search the moment it appears in the sidebar. If this fails, add the missing
 * path(s) to NAV_COMMANDS.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const layout = readFileSync(resolve(root, 'src/components/Layout.jsx'), 'utf8')
const commands = readFileSync(resolve(root, 'src/lib/commandSearch.js'), 'utf8')

const navPaths = (src) =>
  [...src.matchAll(/\{\s*to:\s*'(\/[^']+)'\s*,\s*label:/g)].map((m) => m[1])
const commandPaths = (src) =>
  new Set([...src.matchAll(/path:\s*'(\/[^']*)'/g)].map((m) => m[1]))

describe('command palette search covers all navigation', () => {
  it('every sidebar nav item has a searchable command', () => {
    const cmds = commandPaths(commands)
    const missing = [...new Set(navPaths(layout))].filter((p) => !cmds.has(p))
    expect(
      missing,
      `Nav items missing from NAV_COMMANDS (src/lib/commandSearch.js): ${missing.join(', ')}`,
    ).toEqual([])
  })
})
