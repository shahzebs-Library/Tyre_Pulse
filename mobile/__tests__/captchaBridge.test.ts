import {
  APP_SCHEME, BRIDGE_URL, CHECK_TTL_MS,
  isCaptchaError, isNetworkError, makeState, buildBridgeUrl, parseReturnUrl,
  startCheck, acceptReturnUrl, hasPendingCheck, pendingState, cancelCheck,
  deliverReturnUrl, takeOutcome, subscribe, clearAll, shouldRecordFailure,
  __resetForTests,
} from '../lib/captchaBridge'

const STATE = 'a'.repeat(64)
const TOKEN = '0.AbCdEf_GhIj-KlMnOp.qrst'
const link = (q: string) => `${APP_SCHEME}://captcha?${q}`

/** A deterministic CSPRNG stand-in: fills with a counter. */
let n = 1
function fakeCrypto() {
  return { crypto: { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = (n++ * 37) & 0xff; return a } } }
}

beforeEach(() => __resetForTests())

describe('makeState (randomness)', () => {
  it('uses crypto.getRandomValues when present (256 bits)', () => {
    const r = makeState(fakeCrypto())
    expect(r?.source).toBe('getRandomValues')
    expect(r?.state).toMatch(/^[0-9a-f]{64}$/)
  })

  it('falls back to the native expo.uuidv4 (2 x 122 bits)', () => {
    let i = 0
    const ids = ['3f2504e0-4f89-41d3-9a0c-0305e82c3301', '7c9e6679-7425-40de-944b-e07fc1f90ae7']
    const r = makeState({ expo: { uuidv4: () => ids[i++] } })
    expect(r?.source).toBe('expo-uuidv4')
    expect(r?.state).toBe('3f2504e04f8941d39a0c0305e82c3301' + '7c9e6679742540de944be07fc1f90ae7')
  })

  it('refuses rather than using Math.random when no secure source exists', () => {
    const spy = jest.spyOn(Math, 'random')
    expect(makeState({})).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('rejects a getRandomValues stub that does not fill the buffer', () => {
    expect(makeState({ crypto: { getRandomValues: () => undefined } })).toBeNull()
  })

  it('rejects malformed or repeated uuids', () => {
    expect(makeState({ expo: { uuidv4: () => 'not-a-uuid' } })).toBeNull()
    const same = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    expect(makeState({ expo: { uuidv4: () => same } })).toBeNull()
  })

  it('startCheck refuses with no_random and keeps nothing pending', () => {
    expect(startCheck('u', 'p', 0, {})).toEqual({ ok: false, reason: 'no_random' })
    expect(hasPendingCheck(0)).toBe(false)
  })
})

describe('buildBridgeUrl', () => {
  it('is the fixed page with only state and lang', () => {
    expect(buildBridgeUrl(STATE, 'ar')).toBe(`${BRIDGE_URL}?state=${STATE}&lang=ar`)
  })
  it('never passes an unknown language through', () => {
    expect(buildBridgeUrl(STATE, 'x"><script>')).toBe(`${BRIDGE_URL}?state=${STATE}&lang=en`)
  })
})

describe('parseReturnUrl', () => {
  it('accepts the exact return link', () => {
    expect(parseReturnUrl(link(`state=${STATE}&token=${TOKEN}`))).toEqual({ state: STATE, token: TOKEN })
  })
  it('accepts parameters in either order and percent-encoding', () => {
    expect(parseReturnUrl(link(`token=${encodeURIComponent(TOKEN)}&state=${STATE}`))).toEqual({ state: STATE, token: TOKEN })
  })
  it('rejects a wrong host or path', () => {
    expect(parseReturnUrl(`${APP_SCHEME}://login?state=${STATE}&token=${TOKEN}`)).toBeNull()
    expect(parseReturnUrl(`${APP_SCHEME}://captcha/extra?state=${STATE}&token=${TOKEN}`)).toBeNull()
  })
  it('rejects another scheme', () => {
    expect(parseReturnUrl(`https://captcha?state=${STATE}&token=${TOKEN}`)).toBeNull()
    expect(parseReturnUrl(`evil-app://captcha?state=${STATE}&token=${TOKEN}`)).toBeNull()
  })
  it('rejects a missing or malformed state or token', () => {
    expect(parseReturnUrl(link(`state=${STATE}`))).toBeNull()
    expect(parseReturnUrl(link(`token=${TOKEN}`))).toBeNull()
    expect(parseReturnUrl(link(`state=short&token=${TOKEN}`))).toBeNull()
    expect(parseReturnUrl(link(`state=${STATE}&token=bad%20token%3Cx%3E`))).toBeNull()
    expect(parseReturnUrl(link(`state=${STATE}&token=`))).toBeNull()
  })
  it('rejects extra, duplicated or valueless parameters and fragments', () => {
    expect(parseReturnUrl(link(`state=${STATE}&token=${TOKEN}&redirect=https://x.com`))).toBeNull()
    expect(parseReturnUrl(link(`state=${STATE}&state=${STATE}&token=${TOKEN}`))).toBeNull()
    expect(parseReturnUrl(link(`state=${STATE}&token=${TOKEN}&flag`))).toBeNull()
    expect(parseReturnUrl(link(`state=${STATE}&token=${TOKEN}#x`))).toBeNull()
  })
  it('rejects non-strings and a link with no query', () => {
    expect(parseReturnUrl(null)).toBeNull()
    expect(parseReturnUrl(`${APP_SCHEME}://captcha`)).toBeNull()
  })
})

describe('state matching, expiry, single use', () => {
  function begin(now = 1000) {
    const r = startCheck('user1', 'secret', now, fakeCrypto())
    if (!r.ok) throw new Error('could not start')
    return r.state
  }

  it('accepts the matching state once, then never again', () => {
    const state = begin()
    const first = acceptReturnUrl(link(`state=${state}&token=${TOKEN}`), 2000)
    expect(first).toEqual({ status: 'accepted', identifier: 'user1', password: 'secret', token: TOKEN })
    expect(hasPendingCheck(2000)).toBe(false)
    expect(acceptReturnUrl(link(`state=${state}&token=${TOKEN}`), 2001).status).toBe('duplicate')
  })

  it('reports a different state as a mismatch and keeps the real one pending', () => {
    const state = begin()
    expect(acceptReturnUrl(link(`state=${'b'.repeat(64)}&token=${TOKEN}`), 2000).status).toBe('mismatch')
    expect(pendingState(2000)).toBe(state)
  })

  it('expires after 5 minutes and drops the password', () => {
    const state = begin(1000)
    expect(acceptReturnUrl(link(`state=${state}&token=${TOKEN}`), 1000 + CHECK_TTL_MS + 1).status).toBe('expired')
    expect(hasPendingCheck(1000 + CHECK_TTL_MS + 2)).toBe(false)
  })

  it('accepts right at the 5 minute edge', () => {
    const state = begin(1000)
    expect(acceptReturnUrl(link(`state=${state}&token=${TOKEN}`), 1000 + CHECK_TTL_MS).status).toBe('accepted')
  })

  it('treats a clock that went backwards as expired', () => {
    const state = begin(5000)
    expect(acceptReturnUrl(link(`state=${state}&token=${TOKEN}`), 4000).status).toBe('expired')
  })

  it('a new check replaces the old state', () => {
    const old = begin(1000)
    const fresh = begin(1100)
    expect(fresh).not.toBe(old)
    expect(acceptReturnUrl(link(`state=${old}&token=${TOKEN}`), 1200).status).toBe('mismatch')
    expect(acceptReturnUrl(link(`state=${fresh}&token=${TOKEN}`), 1200).status).toBe('accepted')
  })

  it('cancel clears the pending check', () => {
    const state = begin()
    cancelCheck()
    expect(acceptReturnUrl(link(`state=${state}&token=${TOKEN}`), 1100).status).toBe('expired')
  })

  it('ignores links that are not captcha returns without touching the pending check', () => {
    const state = begin()
    expect(acceptReturnUrl(`${APP_SCHEME}://inspection/123`, 1100).status).toBe('ignored')
    expect(pendingState(1100)).toBe(state)
  })
})

describe('hand-off to the screen', () => {
  it('parks an accepted outcome, notifies, and hands it over once', () => {
    const r = startCheck('u', 'p', 1000, fakeCrypto())
    if (!r.ok) throw new Error('start')
    const fn = jest.fn()
    const off = subscribe(fn)
    expect(deliverReturnUrl(link(`state=${r.state}&token=${TOKEN}`), 1100)).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(takeOutcome(1100)).toEqual({ type: 'accepted', identifier: 'u', password: 'p', token: TOKEN })
    expect(takeOutcome(1100)).toBeNull()
    off()
  })

  it('a duplicate delivery after accept is silent (no expired notice)', () => {
    const r = startCheck('u', 'p', 1000, fakeCrypto())
    if (!r.ok) throw new Error('start')
    deliverReturnUrl(link(`state=${r.state}&token=${TOKEN}`), 1100)
    takeOutcome(1100)
    expect(deliverReturnUrl(link(`state=${r.state}&token=${TOKEN}`), 1101)).toBe(true)
    expect(takeOutcome(1101)).toBeNull()
  })

  it('a cold-start return with nothing pending becomes an expired notice', () => {
    expect(deliverReturnUrl(link(`state=${STATE}&token=${TOKEN}`), 1000)).toBe(true)
    expect(takeOutcome(1000)).toEqual({ type: 'rejected', reason: 'expired' })
  })

  it('does not keep a parked password past the time limit', () => {
    const r = startCheck('u', 'p', 1000, fakeCrypto())
    if (!r.ok) throw new Error('start')
    deliverReturnUrl(link(`state=${r.state}&token=${TOKEN}`), 1100)
    expect(takeOutcome(1100 + CHECK_TTL_MS + 1)).toBeNull()
  })

  it('a foreign link is not ours', () => {
    expect(deliverReturnUrl('https://example.com', 1000)).toBe(false)
    expect(takeOutcome(1000)).toBeNull()
  })

  it('clearAll forgets both the pending check and any parked outcome', () => {
    const r = startCheck('u', 'p', 1000, fakeCrypto())
    if (!r.ok) throw new Error('start')
    deliverReturnUrl(link(`state=${r.state}&token=${TOKEN}`), 1100)
    clearAll()
    expect(takeOutcome(1100)).toBeNull()
  })
})

describe('error classification and lockout', () => {
  it('recognises the Supabase captcha refusal', () => {
    expect(isCaptchaError({ code: 'captcha_failed', message: 'x', status: 400 })).toBe(true)
    expect(isCaptchaError({ message: 'captcha protection: request disallowed (no captcha response)' })).toBe(true)
    expect(isCaptchaError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(false)
    expect(isCaptchaError(null)).toBe(false)
  })

  it('recognises a dropped connection but not a 503', () => {
    expect(isNetworkError({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true)
    expect(isNetworkError({ name: 'AuthRetryableFetchError', status: 503 })).toBe(false)
    expect(isNetworkError({ message: 'TypeError: Network request failed' })).toBe(true)
    expect(isNetworkError({ code: 'invalid_credentials' })).toBe(false)
  })

  it('a captcha refusal is never recorded as a failed login', () => {
    expect(shouldRecordFailure({ error: new Error('x'), captchaRequired: true })).toBe(false)
  })
  it('an offline failure is not recorded either', () => {
    expect(shouldRecordFailure({ error: new Error('x'), offline: true })).toBe(false)
  })
  it('a real wrong password still is', () => {
    expect(shouldRecordFailure({ error: new Error('x') })).toBe(true)
    expect(shouldRecordFailure({ error: null })).toBe(false)
  })
})
