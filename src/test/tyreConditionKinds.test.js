/**
 * One colour, one picture, one word per tyre condition, and the "no damage"
 * negation rule. The same cases (docs/document-specs/tyre-layout-cases.json)
 * run on the phone in tyre_layout_spec_parity_test.dart.
 */
import { describe, it, expect, vi } from 'vitest'
import cases from '../../docs/document-specs/tyre-layout-cases.json'
import {
  conditionRisk, conditionKind, kindForWheel, kindForBand, CONDITION_KINDS, CONDITION_KIND,
  neutraliseCondition, kindHex, riskHex,
} from '../lib/tyreLayoutSpec'
import { damagedPositions, isSevereCondition, conditionCounts } from '../lib/inspectionTyreFlags'
import { checklistConditionTally } from '../lib/inspectionsAnalytics'
import { drawConditionGlyph, drawConditionLegendRow } from '../lib/pdfConditionGlyph'

describe('condition kinds (shared cases)', () => {
  for (const [word, kind] of Object.entries(cases.kinds)) {
    it(`"${word}" draws ${kind}`, () => { expect(conditionKind(word)).toBe(kind) })
  }
})

describe('a denied fault is not a fault', () => {
  it('"Good, no damage" is green, never red', () => {
    expect(conditionRisk('Good, no damage')).toBe('good')
    expect(conditionKind('Good, no damage')).toBe('good')
    expect(isSevereCondition('Good, no damage')).toBe(false)
  })
  it('negated phrases read as ok', () => {
    for (const w of ['no damage', 'not damaged', 'Without any damage', 'Undamaged', 'Damage-free', 'No visible damage', 'no cuts']) {
      expect(conditionRisk(w), w).toBe('good')
    }
    expect(neutraliseCondition('Good, no damage')).toMatch(/ok/)
  })
  it('a real fault beside a denied one still counts', () => {
    expect(conditionRisk('Worn, no damage')).toBe('warning')
    expect(conditionKind('Damaged, not punctured')).toBe('damaged')
    expect(isSevereCondition('Damaged, not punctured')).toBe(true)
  })
  it('inspection flags and counts skip a denied fault', () => {
    const insp = { tyre_conditions: { LHF1: 'Good, no damage', RHF1: 'Puncture', LHR1: 'Worn' } }
    expect(damagedPositions(insp).map((d) => d.position).sort()).toEqual(['LHR1', 'RHF1'])
    expect(conditionCounts(insp)).toEqual({ good: 1, wear: 1, damage: 1, other: 0 })
  })
  it('the web checklist counts Flat as critical', () => {
    expect(checklistConditionTally([{ condition: 'Flat' }, { condition: 'Good' }, { condition: 'Wear' }]))
      .toEqual({ good: 1, wear: 1, critical: 1 })
  })
})

describe('safety first: a severe fault beats wear', () => {
  it('"Worn, flat" and "wear + cut" are red', () => {
    expect(conditionRisk('Worn, flat')).toBe('critical')
    expect(conditionKind('Worn, flat')).toBe('flat')
    expect(conditionRisk('wear + cut')).toBe('critical')
    expect(conditionKind('wear + cut')).toBe('damaged')
    expect(conditionRisk('Worn')).toBe('warning')
  })
  it('counts put a worn-and-flat tyre under damage', () => {
    expect(conditionCounts({ tyre_conditions: { A: 'Worn, flat', B: 'Worn' } }))
      .toEqual({ good: 0, wear: 1, damage: 1, other: 0 })
  })
})

describe('kinds agree with colours', () => {
  it('every kind has a band, a label and a glyph', () => {
    expect(CONDITION_KINDS.map((k) => k.kind)).toEqual(['good', 'worn', 'puncture', 'flat', 'damaged', 'missing', 'none'])
    for (const k of CONDITION_KINDS) {
      expect(['good', 'warning', 'critical', 'none']).toContain(k.band)
      expect(k.label).toBeTruthy()
      const g = k.glyph
      expect((g.strokes || []).length + (g.closed || []).length + (g.circles || []).length).toBeGreaterThan(0)
    }
  })
  it('a kind never disagrees with conditionRisk', () => {
    for (const word of Object.keys(cases.kinds)) {
      expect(CONDITION_KIND[conditionKind(word)].band, word).toBe(conditionRisk(word))
    }
  })
  it('three red conditions have three different pictures', () => {
    const red = CONDITION_KINDS.filter((k) => k.band === 'critical')
    expect(red.map((k) => k.kind)).toEqual(['puncture', 'flat', 'damaged'])
    expect(new Set(red.map((k) => JSON.stringify(k.glyph))).size).toBe(3)
  })
  it('a risk level from a tyre record picks the band picture', () => {
    expect(kindForWheel('Good', 'critical')).toBe('damaged')
    expect(kindForWheel('Flat', 'critical')).toBe('flat')
    expect(kindForBand('warning')).toBe('worn')
    expect(kindHex('puncture', 'light')).toBe(riskHex('critical', 'light'))
  })
})

describe('selected buttons keep white ink readable', () => {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  it('every deep band colour gives white text at least 4.5:1', () => {
    for (const band of ['good', 'warning', 'critical', 'none']) {
      const ratio = 1.05 / (lum(riskHex(band, 'light')) + 0.05)
      expect(ratio, band).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('the printed report draws the same glyph', () => {
  const fakeDoc = () => ({
    setDrawColor: vi.fn(), setFillColor: vi.fn(), setLineWidth: vi.fn(), setLineCap: vi.fn(), setLineJoin: vi.fn(),
    line: vi.fn(), circle: vi.fn(), setFontSize: vi.fn(), setFont: vi.fn(), setTextColor: vi.fn(),
    text: vi.fn(), getTextWidth: (t) => String(t).length * 1.5,
  })
  it('a tick is two line segments', () => {
    const doc = fakeDoc()
    drawConditionGlyph(doc, 'good', 10, 10, 6)
    expect(doc.line).toHaveBeenCalledTimes(2)
    expect(doc.circle).not.toHaveBeenCalled()
  })
  it('the legend names every condition', () => {
    const doc = fakeDoc()
    drawConditionLegendRow(doc, 0, 10, 180)
    expect(doc.text.mock.calls.map((c) => c[0])).toEqual(CONDITION_KINDS.map((k) => k.label))
  })
})
