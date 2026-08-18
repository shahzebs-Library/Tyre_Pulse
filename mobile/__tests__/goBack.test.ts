/**
 * Pure-logic tests for lib/goBack.ts.
 *
 * The defect this guards against: a bare `router.back()` is a SILENT NO-OP when
 * there is no history (deep link / notification tap / after router.replace), so
 * pressing Back does nothing. `backTo` must therefore ALWAYS move the user -
 * both branches below are load-bearing.
 */
import { APP_HOME, BackCapableRouter, backTo } from '../lib/goBack'

function makeRouter(hasHistory: boolean) {
  const calls: string[] = []
  const router: BackCapableRouter & { calls: string[]; replacedWith: string | null } = {
    calls,
    replacedWith: null,
    canGoBack: () => hasHistory,
    back: () => { calls.push('back') },
    replace: (href: any) => { calls.push('replace'); router.replacedWith = href },
  }
  return router
}

describe('backTo - with history', () => {
  it('pops history and never replaces', () => {
    const r = makeRouter(true)
    expect(backTo(r)).toBe('back')
    expect(r.calls).toEqual(['back'])
    expect(r.replacedWith).toBeNull()
  })

  it('ignores the fallback entirely when history exists', () => {
    const r = makeRouter(true)
    expect(backTo(r, '/(app)/admin')).toBe('back')
    expect(r.calls).toEqual(['back'])
    expect(r.replacedWith).toBeNull()
  })
})

describe('backTo - with NO history (the no-op bug)', () => {
  it('replaces to the Home hub by default instead of doing nothing', () => {
    const r = makeRouter(false)
    expect(backTo(r)).toBe('replace')
    expect(r.calls).toEqual(['replace'])
    expect(r.replacedWith).toBe(APP_HOME)
    expect(APP_HOME).toBe('/(app)')
  })

  it('replaces to an explicit parent fallback', () => {
    const r = makeRouter(false)
    expect(backTo(r, '/(app)/admin')).toBe('replace')
    expect(r.replacedWith).toBe('/(app)/admin')
  })

  it('falls back to Home when the fallback is blank', () => {
    const r = makeRouter(false)
    backTo(r, '   ')
    expect(r.replacedWith).toBe(APP_HOME)
  })

  it('never calls back() when there is no history', () => {
    const r = makeRouter(false)
    backTo(r, '/(app)/admin')
    expect(r.calls).not.toContain('back')
  })
})

describe('backTo - defensive', () => {
  it('treats a throwing canGoBack as no history and still moves', () => {
    const r = makeRouter(false)
    r.canGoBack = () => { throw new Error('router not mounted') }
    expect(backTo(r, '/(app)/admin')).toBe('replace')
    expect(r.replacedWith).toBe('/(app)/admin')
  })

  it('reports unavailable rather than throwing on a missing router', () => {
    expect(backTo(null)).toBe('unavailable')
    expect(backTo(undefined)).toBe('unavailable')
  })
})
