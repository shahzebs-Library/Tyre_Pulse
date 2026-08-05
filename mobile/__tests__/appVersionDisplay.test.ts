/**
 * The version shown in Settings was a hardcoded translation string,
 * "TyrePulse Inspector v1.0.0". It read the same through every release, so an
 * inspector who HAD updated was told they had not - and there was no way to
 * tell a real stale install from a cosmetic lie.
 *
 * These guard the two halves of that: the locale files must not carry a
 * version number again, and the screen must read the number from the build.
 */
import en from '../locales/en.json'
import ar from '../locales/ar.json'
import fs from 'fs'
import path from 'path'

const VERSION_LITERAL = /v?\d+\.\d+\.\d+/

describe('the locale files carry no version number', () => {
  it.each([['en', en], ['ar', ar]])('%s has no hardcoded version', (_name, dict) => {
    const hits: string[] = []
    const walk = (node: unknown, trail: string) => {
      if (typeof node === 'string') {
        if (VERSION_LITERAL.test(node)) hits.push(`${trail} = ${node}`)
        return
      }
      if (node && typeof node === 'object') {
        Object.entries(node as Record<string, unknown>)
          .forEach(([k, v]) => walk(v, trail ? `${trail}.${k}` : k))
      }
    }
    walk(dict, '')
    expect(hits).toEqual([])
  })

  it('still has a product name to render beside the version', () => {
    expect(typeof (en as any).profile.appName).toBe('string')
    expect(typeof (ar as any).profile.appName).toBe('string')
  })
})

describe('the Settings screen reads the build version', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'app', '(app)', 'profile.tsx'), 'utf8')

  it('calls currentVersion() rather than printing a literal', () => {
    expect(src).toContain('currentVersion()')
  })

  it('no longer renders the retired profile.version key', () => {
    expect(src).not.toContain("t('profile.version')")
  })
})
