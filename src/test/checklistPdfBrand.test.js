/**
 * The checklist sheet's branding contract.
 *
 * Three things the owner asked for, each of which was a real gap rather than a
 * preference: the logo did not print at all on most sheets, it was too small
 * when it did, the company name was set in type above a logo that already says
 * it, and the table headers were the app-wide dark slate rather than the green
 * in the mark.
 *
 * These assert the plumbing that carries those, because the failure mode is
 * silent: `pdfHeader` accepted a logo size and an eyebrow flag that it then
 * dropped on the floor, so a caller could ask for a bigger logo, see no error,
 * and still get 14 mm.
 */

import { describe, it, expect } from 'vitest'
import { pdfTableTheme, pdfHeader, PDF_COLORS } from '../lib/exportUtils'

describe('checklist PDF branding', () => {
  it('exposes the brand green, matched to the logo mark', () => {
    // #15803D. Named once so a document can reference it instead of retyping a
    // hex that then drifts from the app.
    expect(PDF_COLORS.green).toEqual([21, 128, 61])
    expect(PDF_COLORS.greenDk).toEqual([22, 101, 52])
  })

  it('table headers stay dark slate by default, so no other report moves', () => {
    const theme = pdfTableTheme([1, 2, 3])
    expect(theme.headStyles.fillColor).toEqual(PDF_COLORS.slate)
  })

  it('a document can brand its table headers green', () => {
    const theme = pdfTableTheme([1, 2, 3], { headFill: PDF_COLORS.green })
    expect(theme.headStyles.fillColor).toEqual(PDF_COLORS.green)
    // The rule under the header must follow the fill, or a green header sits on
    // a slate hairline.
    expect(theme.headStyles.lineColor).toEqual(PDF_COLORS.green)
    // White text on #15803D clears AA comfortably; the header must not go dark.
    expect(theme.headStyles.textColor).toEqual(PDF_COLORS.white)
  })

  it('pdfHeader forwards logoSize and hideEyebrow instead of dropping them', () => {
    // The wrapper used to call _pageHeader with only { accent, logoData }, so
    // both options were accepted by the caller and silently ignored. Draw
    // against a recording stub and assert what actually reached the page.
    const calls = []
    const rec = (name) => (...args) => { calls.push([name, ...args]) }
    const doc = {
      internal: { pageSize: { width: 210, height: 297 } },
      setFillColor: rec('setFillColor'),
      setDrawColor: rec('setDrawColor'),
      setTextColor: rec('setTextColor'),
      setFontSize: rec('setFontSize'),
      setFont: rec('setFont'),
      setLineWidth: rec('setLineWidth'),
      rect: rec('rect'),
      line: rec('line'),
      text: rec('text'),
      addImage: rec('addImage'),
    }
    const logo = 'data:image/png;base64,AAAA'

    pdfHeader(doc, 'Workshop Daily Checklist', 'Asset: TM514', 'GCC', { logoData: logo },
      { logoSize: 18, hideEyebrow: true })

    const img = calls.find((c) => c[0] === 'addImage')
    expect(img, 'the logo must be drawn').toBeTruthy()
    // calls record [name, ...args], so with addImage(data, fmt, x, y, w, h)
    // the width is img[5] and the height img[6]. My first version asserted
    // img[4] and read back 3 - which is the Y the header centres the logo at,
    // not a size.
    expect(img[5]).toBe(18)
    expect(img[6]).toBe(18)
    // It must sit inside the 23 mm header band, not on the rule that closes it.
    expect(img[4] + img[6]).toBeLessThan(23)

    // The company name must NOT appear anywhere in type: the logo carries it.
    const printed = calls.filter((c) => c[0] === 'text').map((c) => String(c[1]))
    expect(printed.some((s) => /GCC/i.test(s))).toBe(false)
    // The title still prints.
    expect(printed).toContain('Workshop Daily Checklist')
  })

  it('still prints the eyebrow when a document does not suppress it', () => {
    const printed = []
    const doc = {
      internal: { pageSize: { width: 210, height: 297 } },
      setFillColor() {}, setDrawColor() {}, setTextColor() {}, setFontSize() {},
      setFont() {}, setLineWidth() {}, rect() {}, line() {}, addImage() {},
      text: (s) => printed.push(String(s)),
    }
    pdfHeader(doc, 'Fleet Report', '', 'GCC', {})
    expect(printed.some((s) => /GCC/i.test(s))).toBe(true)
  })
})
