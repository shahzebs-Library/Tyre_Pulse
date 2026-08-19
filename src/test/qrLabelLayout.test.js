/**
 * QR label layout: the sheet must print what the screen promised, and a serial
 * must never be cut.
 *
 * Three defects, each measured before it was changed:
 *  - the PDF drew centred text with NO width constraint, so a long value ran
 *    past the label. The longest live tyre serial is 34 characters and renders
 *    64.8 mm inside a 60 mm label - 2.4 mm out of each side;
 *  - the screen truncated with a CSS ellipsis while the PDF did not, so the
 *    preview and the print disagreed about what was on the label;
 *  - the size control was decorative: it moved a pixel width in the preview
 *    while the sheet always printed 60 mm, under a caption reading "70 mm".
 */

import { describe, it, expect } from 'vitest'
import {
  LABEL_SIZES, labelGrid, pageCount, fitLabelText, PAGE_W, PAGE_H,
} from '../lib/qrLabelLayout'

// A stand-in for jsPDF's getTextWidth: proportional to length and font size.
// The real widths were measured with jsPDF itself; this keeps the RULES
// testable without a PDF engine.
const measure = (text, size) => String(text).length * size * 0.23

describe('the sheet grid', () => {
  it('every offered size fits on A4, across and down', () => {
    for (const key of Object.keys(LABEL_SIZES)) {
      const g = labelGrid(key)
      expect(g.marginX, `${key} margin`).toBeGreaterThanOrEqual(0)
      expect(g.marginX * 2 + g.cols * g.w + (g.cols - 1) * g.gap).toBeLessThanOrEqual(PAGE_W + 0.001)
      expect(g.marginY * 2 + g.rows * g.h + (g.rows - 1) * g.gap).toBeLessThanOrEqual(PAGE_H + 0.001)
      expect(g.perPage).toBeGreaterThan(0)
    }
  })

  it('a smaller label puts MORE on a sheet - the point of offering the choice', () => {
    // The old code fixed 3 x 4 for every size, so Small wasted most of the page.
    expect(labelGrid('sm').perPage).toBeGreaterThan(labelGrid('md').perPage)
    expect(labelGrid('md').perPage).toBeGreaterThan(labelGrid('lg').perPage)
  })

  it('the chosen size is the printed size, in real millimetres', () => {
    expect(labelGrid('sm').w).toBe(40)
    expect(labelGrid('md').w).toBe(55)
    expect(labelGrid('lg').w).toBe(70)
  })

  it('an unknown size falls back rather than producing a zero grid', () => {
    expect(labelGrid('nonsense').perPage).toBe(labelGrid('md').perPage)
    expect(labelGrid().perPage).toBe(labelGrid('md').perPage)
  })

  it('counts sheets honestly, and nothing to print is zero sheets not one', () => {
    const per = labelGrid('md').perPage
    expect(pageCount(0, 'md')).toBe(0)
    expect(pageCount(1, 'md')).toBe(1)
    expect(pageCount(per, 'md')).toBe(1)
    expect(pageCount(per + 1, 'md')).toBe(2)
  })
})

describe('fitting the identifier', () => {
  it('leaves a short serial at full size on one line', () => {
    const r = fitLabelText(measure, 'YMA55312', 51, { mode: 'wrap' })
    expect(r.lines).toEqual(['YMA55312'])
    expect(r.size).toBe(7.5)
    expect(r.clipped).toBe(false)
  })

  it('shrinks a long serial before it wraps', () => {
    // 34 characters is the longest serial in the live table, and the one that
    // overflowed the label by 2.4 mm each side under the old unconstrained draw.
    const r = fitLabelText(measure, 'A'.repeat(34), 51, { mode: 'wrap' })
    expect(r.lines).toHaveLength(1)
    expect(r.size).toBeLessThan(7.5)
  })

  it('NEVER truncates an identifier - it wraps instead', () => {
    // A cut serial is not a shorter serial, it is a different one. Somebody
    // reading it off the label and typing it in finds nothing, or another tyre.
    const serial = 'B'.repeat(60)
    const r = fitLabelText(measure, serial, 51, { mode: 'wrap', maxLines: 2 })
    expect(r.lines.join('')).not.toContain('...')
    expect(r.lines.join('')).toBe(serial.slice(0, r.lines.join('').length))
  })

  it('keeps every character of a serial that fits in two lines', () => {
    const serial = 'EP060420711XYZ98765'
    const r = fitLabelText(measure, serial, 20, { mode: 'wrap', maxLines: 2 })
    expect(r.lines.join('')).toBe(serial)
    expect(r.clipped).toBe(false)
  })

  it('reports clipped when even the smallest size cannot hold it, rather than lying', () => {
    const r = fitLabelText(measure, 'C'.repeat(400), 20, { mode: 'wrap', maxLines: 2 })
    expect(r.clipped).toBe(true)
    expect(r.lines).toHaveLength(2)
  })

  it('every produced line actually fits the width it was given', () => {
    for (const text of ['D'.repeat(34), 'EP060420711', 'A B C D E F G H I J K L']) {
      const r = fitLabelText(measure, text, 51, { mode: 'wrap' })
      for (const line of r.lines) expect(measure(line, r.size)).toBeLessThanOrEqual(51.001)
    }
  })
})

describe('fitting the secondary line', () => {
  it('clips context with an ellipsis, which says it was shortened', () => {
    // Losing the tail of a site name costs nothing, unlike losing part of a serial.
    const r = fitLabelText(measure, 'LONGMARCH . QIDDIYA-UPPER PLATEAU EXTENSION', 30, { mode: 'clip', startSize: 5.5, minSize: 4 })
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].endsWith('...')).toBe(true)
    expect(r.clipped).toBe(true)
    expect(measure(r.lines[0], r.size)).toBeLessThanOrEqual(30.001)
  })

  it('does not clip a line that already fits', () => {
    const r = fitLabelText(measure, 'PIRELLI . NHC', 51, { mode: 'clip', startSize: 5.5 })
    expect(r.lines).toEqual(['PIRELLI . NHC'])
    expect(r.clipped).toBe(false)
  })
})

describe('degrading honestly', () => {
  it('an empty value produces no line at all, never an empty box of text', () => {
    for (const v of ['', null, undefined, '   ']) {
      expect(fitLabelText(measure, v, 51).lines).toEqual([])
    }
  })

  it('with no measurer it returns the text rather than throwing away the label', () => {
    expect(fitLabelText(null, 'YMA55312', 51).lines).toEqual(['YMA55312'])
    expect(fitLabelText(measure, 'YMA55312', 0).lines).toEqual(['YMA55312'])
  })
})
