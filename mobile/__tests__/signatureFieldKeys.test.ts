/**
 * Every string the signature field prints must exist in every locale.
 *
 * A MISSING KEY DOES NOT FALL BACK TO ENGLISH ON MOBILE unless the key exists in
 * en.json - absent there too and the app renders the RAW KEY PATH on screen. So
 * a supervisor in Arabic would be asked to approve under the words
 * "signatureField.usingSaved".
 */
import fs from 'fs'
import path from 'path'

const KEYS = [
  'usingSaved', 'drawNew', 'rememberThis', 'replaceSaved', 'remembered', 'notRemembered',
]

const load = (l: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', `${l}.json`), 'utf8'))

describe('signatureField locale keys', () => {
  it.each(['en', 'ar', 'ur'])('%s carries every key the component asks for', (lang) => {
    const d = load(lang)
    expect(d.signatureField).toBeDefined()
    for (const k of KEYS) {
      expect(typeof d.signatureField[k]).toBe('string')
      expect(d.signatureField[k].trim().length).toBeGreaterThan(0)
    }
  })

  it('the component asks for exactly these keys and no others', () => {
    // A key added to the component but not to the locales is the defect above;
    // this catches it at the source rather than waiting for a screenshot.
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'SignatureField.tsx'), 'utf8')
    const asked = Array.from(src.matchAll(/t\('signatureField\.([a-zA-Z]+)'\)/g)).map((m) => m[1])
    expect(new Set(asked)).toEqual(new Set(KEYS))
  })
})
