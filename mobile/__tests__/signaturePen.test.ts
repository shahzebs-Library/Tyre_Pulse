/**
 * The pen colour is BAKED INTO the stored signature SVG (`buildSvg` writes
 * stroke="${color}"), so an illegible pen is not a display bug: it stores a
 * signature nobody can ever see, in the app or in any PDF rendered from it.
 *
 * This is not hypothetical. Two APPROVED KSA inspections carry ink #F1F5F9 -
 * the dark theme's text colour - drawn on the pad's fixed #f8fafc surface:
 *   TM371 / AMAALA / 2026-07-21 (4 strokes)
 *   TM504 / JEDDAH / 2026-07-22 (1 stroke)
 * Four screens were passing a theme text colour straight through.
 *
 * These tests pin the guard that makes it unreachable.
 */
import { legiblePen, PAD_SURFACE, DEFAULT_PEN } from '../components/SignaturePad'

describe('legiblePen', () => {
  it('refuses the exact ink that produced the two invisible signatures', () => {
    // #F1F5F9 on #f8fafc is a contrast ratio of about 1.05 to 1.
    expect(legiblePen('#F1F5F9')).toBe(DEFAULT_PEN)
  })

  it('refuses a dark theme text colour, the shape of the original defect', () => {
    for (const pen of ['#f8fafc', '#e2e8f0', '#ffffff', '#FFF', '#cbd5e1']) {
      expect(legiblePen(pen)).toBe(DEFAULT_PEN)
    }
  })

  it('keeps a pen that is genuinely legible on the pad', () => {
    for (const pen of ['#0f172a', '#000000', '#1e293b', '#7f1d1d', '#0a3d2e']) {
      expect(legiblePen(pen)).toBe(pen)
    }
  })

  it('falls back rather than guessing when the pen cannot be parsed', () => {
    // A colour we cannot measure is not trusted: `rgb()`, a named colour or a
    // CSS variable would otherwise sail past a naive check.
    for (const pen of [undefined, null, '', 'white', 'rgb(255,255,255)', 'var(--text)', '#12', 'nonsense']) {
      expect(legiblePen(pen as any)).toBe(DEFAULT_PEN)
    }
  })

  it('handles 3 and 8 digit hex, so a shorthand or alpha pen is still judged', () => {
    expect(legiblePen('#000')).toBe('#000')          // legible shorthand survives
    expect(legiblePen('#eee')).toBe(DEFAULT_PEN)     // pale shorthand refused
    expect(legiblePen('#0f172aff')).toBe('#0f172aff') // alpha ignored, judged on rgb
    expect(legiblePen('#f1f5f9ff')).toBe(DEFAULT_PEN)
  })

  it('judges against the pad it is actually drawn on', () => {
    // Same pen, opposite verdicts, because the surface differs. This is what
    // stops the guard being a hardcoded blacklist of pale colours.
    expect(legiblePen('#ffffff', '#000000')).toBe('#ffffff')
    expect(legiblePen('#ffffff', PAD_SURFACE)).toBe(DEFAULT_PEN)
  })

  it('the default pen is legible on the default surface', () => {
    // Guards the pair together: changing PAD_SURFACE without revisiting
    // DEFAULT_PEN would silently make every signature unreadable.
    expect(legiblePen(DEFAULT_PEN, PAD_SURFACE)).toBe(DEFAULT_PEN)
  })
})

describe('no screen overrides the pen any more', () => {
  const fs = require('fs')
  const path = require('path')
  const APP = path.join(__dirname, '..', 'app')

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (/\.tsx?$/.test(e.name)) out.push(p)
    }
    return out
  }

  it('finds no penColor prop passed from any screen', () => {
    const files = walk(APP)
    expect(files.length).toBeGreaterThan(20) // the scan actually looked
    const offenders = files.filter((f) => /penColor\s*=\s*\{/.test(fs.readFileSync(f, 'utf8')))
    expect(offenders.map((f) => path.relative(APP, f))).toEqual([])
  })
})
