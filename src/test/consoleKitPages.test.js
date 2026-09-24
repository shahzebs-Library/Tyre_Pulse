/**
 * Console kit conversion guard for the configuration pages.
 *
 * These pages were hand-rolled in slate and indigo, which the console light
 * theme does not re-colour (it keys on the gray and orange families), so they
 * stayed dark for light-mode users. They now sit on the shared console UI kit.
 * This scan keeps them there: a revert to slate/indigo, or a return of the
 * hard-coded white frame around hosted main-app pages, fails here.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (f) => readFileSync(resolve(__dirname, '../console/pages', f), 'utf8').replace(/\r\n/g, '\n')

const PAGES = [
  'ConsoleModuleControl.jsx',
  'ConsoleNavigation.jsx',
  'ConsoleReportAppearance.jsx',
  'ConsoleVehicleDesigner.jsx',
  'ConsoleSecurity.jsx',
  'ConsoleAccessControl.jsx',
]

/** JSX text and string literals only, comments stripped. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('console configuration pages use the console UI kit', () => {
  for (const page of PAGES) {
    const src = read(page)

    it(`${page} imports the shared kit`, () => {
      expect(src).toMatch(/from '\.\.\/components\/ui'/)
    })

    it(`${page} has no slate or indigo classes (they ignore the light theme)`, () => {
      expect(codeOnly(src)).not.toMatch(/\b(?:bg|text|border|placeholder|hover:bg|focus:border)-(?:slate|indigo)-/)
    })

    it(`${page} has no em or en dash in user-facing code`, () => {
      expect(codeOnly(src)).not.toMatch(/[–—]/)
    })
  }

  it('ConsoleSecurity no longer frames hosted pages on a hard-coded white surface', () => {
    // Inside .console-root the theme tokens are the dark console palette, so a
    // white frame put near-white headings on white.
    expect(codeOnly(read('ConsoleSecurity.jsx'))).not.toMatch(/bg-white/)
  })

  it('Module Control charts modules by status and no longer claims status is unenforced', () => {
    const src = read('ConsoleModuleControl.jsx')
    expect(src).toMatch(/<ShareChart/)
    expect(src).not.toMatch(/does not\s+yet remove the pages/)
  })

  it('Access Control keeps every tab deep-linkable through ?tab=', () => {
    const src = read('ConsoleAccessControl.jsx')
    expect(src).toMatch(/useSearchParams/)
    expect(src).toMatch(/next\.set\('tab', key\)/)
  })
})
