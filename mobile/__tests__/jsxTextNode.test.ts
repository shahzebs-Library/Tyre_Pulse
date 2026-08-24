import { readFileSync, readdirSync, statSync } from 'fs'
import { join, sep } from 'path'

/**
 * A block comment written WITHOUT braces in JSX child position is not a comment
 * at all - it is TEXT. React Native then throws "Text strings must be rendered
 * within a <Text> component" the moment that branch renders, the screen unmounts
 * to the error boundary, and pressing Try again remounts the navigator on Home.
 * To the person holding the phone that reads as "the app crashed back to Home".
 *
 * THIS ACTUALLY SHIPPED. `inspection/new.tsx` carried
 *
 *     <>
 *     /* Collapsed: a vehicle is chosen ... *\/
 *     <View ...>
 *
 * inside the `selectedVehicle ? (...)` branch, so New Inspection crashed the
 * instant an asset was picked - by search, by scan, or by arriving from the
 * vehicle list - which is the primary flow in the whole app. Neither `tsc` nor
 * the bundler can see it: the file is valid TypeScript and the build is clean.
 *
 * THE DISTINCTION THIS TEST HAS TO MAKE, or it is useless. A comment in
 * EXPRESSION position is genuinely a comment and must NOT be flagged:
 *
 *     cond ? (
 *       /* fine - grouping parens, the comment is JS *\/
 *       <View/>
 *     )
 *
 * Only CHILD position is a text node, so the rule keys on what the previous
 * line is: a fragment opener or a JSX tag means children, an open paren means
 * an expression. Five safe occurrences of the paren form exist in this app.
 */

const ROOT = join(__dirname, '..')
const SKIP = new Set(['node_modules', '.expo', 'android', 'ios', 'dist', 'build', '__tests__'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx|jsx)$/.test(name)) out.push(p)
  }
  return out
}

/** A JSX children region opens after a fragment or an element tag. */
function isJsxChildPosition(prev: string): boolean {
  if (prev.endsWith('<>')) return true            // fragment opener
  if (prev.endsWith('/>')) return true            // self-closing element
  if (/^<\/[A-Za-z][\w.]*>$/.test(prev)) return true   // closing tag
  // Element opening tag: starts with < and a component/intrinsic name, ends with
  // >. Excludes `=> Promise<void>` style type lines, which also end with ">".
  if (/^<[A-Za-z][\w.]*(\s|$)/.test(prev) && prev.endsWith('>')) return true
  return false
}

const files = walk(ROOT)

describe('no unbraced block comment in JSX child position', () => {
  it('scans the real source tree', () => {
    expect(files.length).toBeGreaterThan(40)
  })

  it('finds none - an unbraced comment there renders as text and crashes the screen', () => {
    const offenders: string[] = []

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line.startsWith('/*') || line.startsWith('{/*')) continue
        let j = i - 1
        while (j >= 0 && !lines[j].trim()) j--
        if (j < 0) continue
        if (!isJsxChildPosition(lines[j].trim())) continue
        const rel = file.slice(ROOT.length + 1).split(sep).join('/')
        offenders.push(`${rel}:${i + 1} - wrap it as {/* ... */}: ${line.slice(0, 60)}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
