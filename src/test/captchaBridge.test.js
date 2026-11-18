import { describe, it, expect } from 'vitest'
import { readBridgeParams, buildReturnLink, APP_RETURN_BASE } from '../lib/captchaBridge'

const STATE = 'aB3_x-9QwErTyUiOp1234567890abcd'

describe('captcha bridge (Expo system-browser CAPTCHA)', () => {
  it('accepts a random-looking state and reads the language', () => {
    expect(readBridgeParams(`?state=${STATE}&lang=ar`)).toEqual({ state: STATE, lang: 'ar' })
    expect(readBridgeParams(`?state=${STATE}`).lang).toBe('en')
  })

  it('refuses short, missing or odd states', () => {
    for (const q of ['', '?state=short', '?state=' + 'a'.repeat(129), '?state=abc%20def%20ghi%20jkl', '?state=<script>alert(1)</script>']) {
      expect(readBridgeParams(q).state).toBeNull()
    }
  })

  it('always returns to the fixed app link, whatever the page URL says', () => {
    const link = buildReturnLink(STATE, '0.abcDEF123_tok-en')
    expect(link.startsWith(`${APP_RETURN_BASE}?`)).toBe(true)
    // a return/redirect parameter in the page URL has no effect: it is never read
    expect(readBridgeParams(`?state=${STATE}&return=https://evil.example/`)).toEqual({ state: STATE, lang: 'en' })
  })

  it('refuses to build a link from a bad state or token', () => {
    expect(buildReturnLink('short', '0.validtoken123')).toBeNull()
    expect(buildReturnLink(STATE, '')).toBeNull()
    expect(buildReturnLink(STATE, 'bad token with spaces')).toBeNull()
    expect(buildReturnLink(STATE, 'x"><script>')).toBeNull()
  })
})
