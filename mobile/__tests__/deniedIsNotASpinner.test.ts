/**
 * A permission refusal must never look like loading.
 *
 * Four admin screens wrote `if (guardLoading || !allowed) return <spinner/>`.
 * `allowed` never becomes true for somebody who is denied, so that spinner ran
 * FOREVER - the owner reported it as "I feel is spinner but in actual no
 * access". Loading and denied are opposite states and must render differently:
 * one ends by itself, the other never will.
 *
 * This scans the source rather than rendering, because the defect is the shape
 * of the branch, not the output of a mounted component.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const APP = join(__dirname, '..', 'app')

function screens(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...screens(p))
    else if (name.endsWith('.tsx')) out.push(p)
  }
  return out
}

const FILES = screens(APP).map((p) => ({ path: p.slice(APP.length + 1), src: readFileSync(p, 'utf8') }))

describe('denied is not a spinner', () => {
  it('found the screens to check (a zero-length sweep passes vacuously)', () => {
    expect(FILES.length).toBeGreaterThan(20)
  })

  it('no UNWRAPPED screen fuses "still loading" and "not allowed" into one branch', () => {
    // The exact shape that shipped: `!allowed` OR'd with a loading flag, whose
    // body is what renders. Splitting them is the fix.
    //
    // Scoped to screens WITHOUT withModuleGuard, and that scoping is deliberate
    // rather than lenient: on a wrapped screen the outer guard renders NoAccess
    // before the component runs, so its own fused branch is unreachable. Five
    // screens carry that dead shape today (the four accident screens and
    // maintenance) and flagging them would be a false alarm - the reachable
    // ones were the four admin screens, which had no wrapper. If a wrapper is
    // ever removed, this test starts failing for that screen, which is the
    // point.
    const bad = FILES.filter(({ src }) =>
      !/withModuleGuard\(/.test(src) &&
      (/if\s*\(\s*\w*[Ll]oading\s*\|\|\s*!allowed/.test(src) ||
       /if\s*\(\s*!allowed\s*\|\|\s*\w*[Ll]oading/.test(src)),
    ).map((f) => f.path)
    // Joined into a string so the failure names the offenders - jest's expect
    // takes no message argument (that is vitest).
    expect(`spinner-on-denied: ${bad.join(', ')}`).toBe('spinner-on-denied: ')
  })

  it('no guarded screen renders nothing at all when denied', () => {
    // `return null` is a blank screen - indistinguishable from a crash, and it
    // tells somebody who simply lacks access nothing about why.
    const bad = FILES.filter(({ src }) =>
      /useModuleGuard\(|useAdminGuard\(|useElevatedGuard\(/.test(src) &&
      /if\s*\(\s*!allowed\s*\)\s*return null/.test(src) &&
      !/withModuleGuard\(/.test(src),
    ).map((f) => f.path)
    expect(`blank-on-denied: ${bad.join(', ')}`).toBe('blank-on-denied: ')
  })

  it('the module guard does NOT navigate away when it refuses', () => {
    // It used to call router.replace('/'), which threw the person back to Home.
    // A screen that vanishes and dumps you on the main page reads as the app
    // malfunctioning rather than as a permission boundary - reported twice.
    // The refusal must stay put and say so.
    const guard = readFileSync(join(__dirname, '..', 'hooks', 'useRoleGuard.ts'), 'utf8')
    const start = guard.indexOf('export function useModuleGuard')
    const end = guard.indexOf('export function useRoleGuard')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    // Strip comments first: the body explains WHY the redirect was removed and
    // names router.replace('/') in prose. Matching that would fail on the
    // explanation rather than on the code.
    const body = guard.slice(start, end)
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n')
    expect(body).not.toMatch(/router\.(replace|push|navigate)\(/)
  })

  it('the shared denial view is exported so nobody writes a third one', () => {
    const guard = readFileSync(join(__dirname, '..', 'components', 'ModuleGuard.tsx'), 'utf8')
    expect(guard).toMatch(/export function NoAccess/)
  })
})
