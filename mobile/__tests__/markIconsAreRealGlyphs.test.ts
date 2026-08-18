/**
 * Every mark must draw a real icon, and no screen may hand Ionicons a TOKEN.
 *
 * The owner photographed the Workshop Daily Checklist with a "?" on every
 * button - OK, Not OK, Repaired, Adjusted, Added/Top-Up, Lubricated, Changed,
 * Not applicable, all of them. The cause was not a bad icon name: all eight
 * names in MARK_ICONS are valid. The fill screen passed `info.icon`, which is
 * the vocabulary TOKEN ('ok', 'repair', 'topup'), straight to Ionicons instead
 * of MARK_ICONS[token].ionicon. Ionicons does not know "ok", so it drew its
 * unknown-glyph "?" - and an `as IconName` cast stopped the typechecker saying
 * so, which is why it shipped.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { MARK_ICONS } from '../lib/checklistMarks'

// The glyph map that actually ships in the bundle - never a remembered list.
const GLYPHS: Record<string, number> = require(
  '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json',
)

describe('mark icons resolve to glyphs that exist', () => {
  it('the installed glyph map was found', () => {
    expect(Object.keys(GLYPHS).length).toBeGreaterThan(1000)
  })

  for (const [token, def] of Object.entries(MARK_ICONS)) {
    it(`${token} -> ${def.ionicon} is a real Ionicons glyph`, () => {
      expect(GLYPHS[def.ionicon]).toBeDefined()
    })
  }

  it('a token is NEVER itself a glyph, which is why passing one draws "?"', () => {
    for (const token of Object.keys(MARK_ICONS)) {
      expect(GLYPHS[token]).toBeUndefined()
    }
  })
})

describe('the fill screen resolves the token, it does not pass it', () => {
  // SCOPED DELIBERATELY to the screen that had the bug.
  //
  // I first wrote this as an app-wide scan for `.icon` inside an Ionicons
  // `name={}`. It reported TWENTY sites - tab.icon, action.icon, the history
  // screen's r.icon - every one of them already holding a real glyph name,
  // several resolved through MARK_ICONS a few lines earlier where a textual
  // scan cannot see it. A guard that cries wolf twenty times teaches people to
  // ignore it, so it polices the one place the defect actually occurred.
  const src = readFileSync(
    join(__dirname, '..', 'app', '(app)', 'checklists', '[templateId].tsx'), 'utf8',
  )

  it('has a helper that maps a mark token to its glyph', () => {
    expect(src).toMatch(/function markGlyph\(/)
    expect(src).toContain('MARK_ICONS')
  })

  it('the mark button renders through it, never the raw token', () => {
    const btn = src.slice(src.indexOf('styles.markBtn'), src.indexOf('styles.markText'))
    expect(btn).toContain('markGlyph(info)')
    expect(btn).not.toMatch(/name=\{[^}]*info\.icon/)
  })

  it('the icon is tinted by its tone even when not selected', () => {
    // A grey row of identical shapes reads as "nothing here yet". The owner
    // asked for OK to be green; the tone carries that for every mark.
    const btn = src.slice(src.indexOf('styles.markBtn'), src.indexOf('styles.markText'))
    expect(btn).toMatch(/color=\{tone\.fg\}/)
  })
})
