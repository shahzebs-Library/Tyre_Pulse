import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * An infinite-scroll list must fetch each page exactly once, and only the newest
 * query may paint.
 *
 * WHY THIS EXISTS. The Tyre Records screen had two effects that both fired on
 * mount:
 *
 *   useEffect(() => { reset() }, [debouncedSearch, siteFilter, riskFilter])
 *   useEffect(() => { loadPage(page) }, [page])         // page === 0
 *
 * reset() already calls loadPage(0, true). The second effect therefore ran
 * loadPage(0) with fresh=false, whose branch is
 * `setRecords(prev => [...prev, ...rows])` - so page 0 was fetched twice and
 * APPENDED to itself. Every record on the first page appeared twice, with
 * duplicate React keys, on every single open of the screen, and again on every
 * filter change made after scrolling past page 0. The header's record count came
 * from the server and stayed right, so the list and its own total disagreed.
 *
 * The second half is ordering: neither request carried a sequence, so on a weak
 * link (the normal case in a yard) a slower earlier query could resolve last and
 * repaint the PREVIOUS filter's rows underneath the new filter chips.
 *
 * Neither is visible to tsc, to a render test, or in review - the two effects
 * look independent and each is individually correct. Hence a source scan.
 */

const ROOT = join(__dirname, '..')
const SKIP = new Set(['node_modules', '.expo', 'android', 'ios', 'dist', '.git', '__tests__'])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    let isDir = false
    try { isDir = statSync(full).isDirectory() } catch { continue }
    if (isDir) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const FILES = walk(ROOT).map(f => ({ path: f.slice(ROOT.length + 1), src: readFileSync(f, 'utf8') }))
const RECORDS = 'app/(app)/records/index.tsx'
const records = FILES.find(f => f.path === RECORDS)

/** Strip line and block comments so an explanation of the bad form is never
 *  mistaken for the bad form. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('paged list lifecycle', () => {
  it('finds the files it is meant to police', () => {
    // A scan that silently matches nothing is worse than no scan at all.
    expect(FILES.length).toBeGreaterThan(20)
    expect(records).toBeDefined()
  })

  it('no screen re-fetches page 0 from a bare [page] effect', () => {
    const offenders: string[] = []
    for (const { path, src } of FILES) {
      const body = code(src)
      // Every `useEffect(... , [page])`. Page 0 is owned by the reset/filter
      // path, so such an effect MUST exclude it or it duplicates the first page.
      const re = /useEffect\(\s*\(\)\s*=>\s*\{([\s\S]{0,400}?)\}\s*,\s*\[\s*page\s*\]\s*\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(body)) !== null) {
        const effect = m[1]
        if (!/page\s*>\s*0/.test(effect)) {
          offenders.push(`${path}: useEffect(..., [page]) does not exclude page 0, so it re-fetches and appends the first page`)
        }
      }
    }
    expect(offenders.join('\n')).toBe('')
  })

  it('the records query takes a sequence ticket and refuses a superseded answer', () => {
    const body = code(records!.src)
    // Take a ticket at the start of the load...
    expect(body).toMatch(/const\s+seq\s*=\s*\+\+\s*reqRef\.current/)
    // ...and refuse to paint unless it is still the newest. At least two checks:
    // one on the success path, one on the failure path - a stale error must not
    // blank a list the current query has already filled.
    const checks = body.match(/seq\s*!==\s*reqRef\.current/g) ?? []
    expect(checks.length).toBeGreaterThanOrEqual(2)
  })

  it('page 0 is fetched by exactly one call site', () => {
    const body = code(records!.src)
    const pageZeroFetches = body.match(/loadPage\(\s*0\s*,/g) ?? []
    expect(pageZeroFetches).toHaveLength(1)
  })
})
