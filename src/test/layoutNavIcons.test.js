import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as lucide from 'lucide-react'

/**
 * Regression guard for a whole class of production crash: a nav item referencing
 * an icon identifier (`icon: Foo`) that is never imported. Unimported bare
 * identifiers do NOT fail the build — at runtime they silently resolve to a
 * same-named global (e.g. the Web Locks API `Lock`), and React then throws
 * "Illegal constructor" the moment that item renders, taking down the whole
 * authenticated shell. Vite can't catch it and unit tests that never render the
 * admin sidebar won't either, so we assert it statically here.
 *
 * Every `icon:` identifier used in Layout.jsx must be imported — either from
 * lucide-react (and actually exist there) or as one of the custom `*Ic` icons.
 */
const layoutPath = resolve(process.cwd(), 'src/components/Layout.jsx')
const src = readFileSync(layoutPath, 'utf8')

function importedNames(source) {
  const names = new Set()
  // lucide-react named imports: import { A, B, C } from 'lucide-react'
  for (const m of source.matchAll(/import\s*\{([^{}]*?)\}\s*from\s*['"]lucide-react['"]/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim()
      if (name) names.add(name)
    }
  }
  // custom icon default imports: import FooIc from './icons/foo.icon'
  for (const m of source.matchAll(/import\s+([A-Za-z0-9_]+)\s+from\s+['"][^'"]*icons\/[^'"]+['"]/g)) {
    names.add(m[1])
  }
  return names
}

describe('Layout nav icons', () => {
  const imported = importedNames(src)

  // Only real nav-item literals (`to: '/path', ... icon: Name`). This excludes
  // the render-time destructure alias `.map(({ icon: Icon }) => …)`, which is a
  // local variable, not an import.
  const usedIcons = [
    ...new Set(
      [...src.matchAll(/to:\s*['"][^'"]*['"][^}]*?icon:\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map(
        (m) => m[1],
      ),
    ),
  ]

  it('extracts icon references from the nav config', () => {
    expect(usedIcons.length).toBeGreaterThan(20)
  })

  it('every nav icon identifier is imported (never a global fallback)', () => {
    const missing = usedIcons.filter((name) => !imported.has(name))
    expect(missing, `unimported nav icon(s): ${missing.join(', ')}`).toEqual([])
  })

  it('every lucide nav icon actually exists in lucide-react', () => {
    const broken = usedIcons.filter(
      (name) => imported.has(name) && !name.endsWith('Ic') && lucide[name] === undefined,
    )
    expect(broken, `nav icon(s) missing from lucide-react: ${broken.join(', ')}`).toEqual([])
  })
})
