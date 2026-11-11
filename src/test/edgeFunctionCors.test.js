import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * F-D-01 CORS ratchet. The production app host is https://app.tyrepulse.app.
 * Every edge function that declares its OWN CORS origin allow-list
 * ((DEFAULT_)ALLOWED_ORIGINS = [...]) must list the app host, or it would reject
 * browser calls from app.tyrepulse.app with an opaque "Failed to send a request
 * to the Edge Function". Functions that import _shared/auth.ts instead get the
 * host from the shared helper (asserted once below); their own https://tyrepulse
 * .app references (Stripe redirect URLs, APP_URL defaults) are not CORS lists.
 * Cron / webhook / worker functions reference the brand only through an email
 * address (reports@tyrepulse.app) and are out of scope.
 */
const DIR = 'supabase/functions'
const OWN_CORS_LIST = /(?:DEFAULT_)?ALLOWED_ORIGINS\s*=/
const APP_HOST = 'https://app.tyrepulse.app'

function fnSources() {
  return readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_shared')
    .map((d) => d.name)
    .map((name) => {
      try { return { name, src: readFileSync(join(DIR, name, 'index.ts'), 'utf8') } }
      catch { return null }
    })
    .filter(Boolean)
}

describe('edge functions allow the production app host (F-D-01)', () => {
  const sources = fnSources()
  const inScope = sources.filter(({ src }) => OWN_CORS_LIST.test(src))

  it('the shared CORS helper carries the app host', () => {
    const shared = readFileSync(join(DIR, '_shared', 'auth.ts'), 'utf8')
    expect(shared.includes(APP_HOST)).toBe(true)
  })

  it('the guard is not vacuous (several functions declare a CORS origin list)', () => {
    expect(inScope.length).toBeGreaterThanOrEqual(5)
  })

  for (const { name, src } of inScope) {
    it(`${name} lists ${APP_HOST}`, () => {
      expect(src.includes(APP_HOST), `${name}/index.ts lists https://tyrepulse.app but not ${APP_HOST}`).toBe(true)
    })
  }
})
