import { describe, it, expect } from 'vitest'
import {
  classifyTyre,
  batchClassify,
  CATEGORIES,
  RISK_COLOUR,
  CONFIDENCE_COLOUR,
  ALL_CATEGORY_LABELS,
} from '../lib/tyreClassifier'

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORIES export
// ─────────────────────────────────────────────────────────────────────────────
describe('CATEGORIES export', () => {
  it('contains all expected category keys', () => {
    const keys = Object.keys(CATEGORIES)
    expect(keys).toContain('BLOWOUT')
    expect(keys).toContain('SEPARATION')
    expect(keys).toContain('SIDEWALL')
    expect(keys).toContain('CUT')
    expect(keys).toContain('HEAT')
    expect(keys).toContain('IMPACT')
    expect(keys).toContain('PUNCTURE')
    expect(keys).toContain('IRREGULAR_WEAR')
    expect(keys).toContain('CHEMICAL')
    expect(keys).toContain('BEAD')
    expect(keys).toContain('VALVE')
    expect(keys).toContain('WEAR')
    expect(keys).toContain('REPLACEMENT')
  })

  it('each category has label, risk_level, weight, and patterns', () => {
    for (const [, def] of Object.entries(CATEGORIES)) {
      expect(def).toHaveProperty('label')
      expect(def).toHaveProperty('risk_level')
      expect(def).toHaveProperty('weight')
      expect(Array.isArray(def.patterns)).toBe(true)
      expect(def.patterns.length).toBeGreaterThan(0)
    }
  })

  it('ALL_CATEGORY_LABELS includes Unclassified and all category labels', () => {
    expect(ALL_CATEGORY_LABELS).toContain('Unclassified')
    expect(ALL_CATEGORY_LABELS).toContain('Blowout')
    expect(ALL_CATEGORY_LABELS).toContain('Puncture')
    expect(ALL_CATEGORY_LABELS).toContain('Normal Wear')
    expect(ALL_CATEGORY_LABELS).toContain('Sidewall Damage')
    expect(ALL_CATEGORY_LABELS).toContain('Tread Separation')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — BLOWOUT (Critical)
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — BLOWOUT (Critical)', () => {
  it('classifies "blowout" in remarks', () => {
    const result = classifyTyre('', 'tyre blowout on highway')
    expect(result.category).toBe('Blowout')
    expect(result.risk_level).toBe('Critical')
  })

  it('classifies "blown out" hyphen variant', () => {
    const result = classifyTyre('', 'blown-out rear tyre')
    expect(result.category).toBe('Blowout')
    expect(result.risk_level).toBe('Critical')
  })

  it('classifies "burst" tyre description', () => {
    const result = classifyTyre('front tyre burst', '')
    expect(result.category).toBe('Blowout')
    expect(result.risk_level).toBe('Critical')
  })

  it('classifies "sudden deflation" as Blowout', () => {
    const result = classifyTyre('', 'sudden deflation while driving')
    expect(result.category).toBe('Blowout')
    expect(result.risk_level).toBe('Critical')
  })

  it('classifies abbreviated b/o as Blowout', () => {
    const result = classifyTyre('', 'b/o on front axle')
    expect(result.category).toBe('Blowout')
    expect(result.risk_level).toBe('Critical')
  })

  it('classifies real-world: "Goodyear Eagle F1 225/45R17 blown out"', () => {
    const result = classifyTyre('Goodyear Eagle F1 225/45R17', 'blown out at high speed')
    expect(result.category).toBe('Blowout')
    expect(result.risk_level).toBe('Critical')
  })

  it('classifies "exploded" as Blowout', () => {
    const result = classifyTyre('', 'tyre exploded on motorway')
    expect(result.category).toBe('Blowout')
    expect(result.risk_level).toBe('Critical')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — SEPARATION (Critical)
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — SEPARATION (Critical)', () => {
  it('classifies "tread separation"', () => {
    const result = classifyTyre('', 'tread separation on rear tyre')
    expect(result.category).toBe('Tread Separation')
    expect(result.risk_level).toBe('Critical')
  })

  it('classifies "delaminating"', () => {
    const result = classifyTyre('', 'tyre delaminating on inner face')
    expect(result.category).toBe('Tread Separation')
    expect(result.risk_level).toBe('Critical')
  })

  it('classifies "chunking off"', () => {
    const result = classifyTyre('', 'tread chunking off from the carcass')
    expect(result.category).toBe('Tread Separation')
    expect(result.risk_level).toBe('Critical')
  })

  it('classifies "tread peel"', () => {
    const result = classifyTyre('', 'tread peel observed on outer face')
    expect(result.category).toBe('Tread Separation')
    expect(result.risk_level).toBe('Critical')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — SIDEWALL (High)
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — SIDEWALL (High)', () => {
  it('classifies "sidewall damage"', () => {
    const result = classifyTyre('', 'sidewall damage noted on inspection')
    expect(result.category).toBe('Sidewall Damage')
    expect(result.risk_level).toBe('High')
  })

  it('classifies "bulge" on tyre', () => {
    const result = classifyTyre('Continental EcoContact', 'bulge visible on sidewall')
    expect(result.category).toBe('Sidewall Damage')
    expect(result.risk_level).toBe('High')
  })

  it('classifies "bubble" as Sidewall Damage', () => {
    const result = classifyTyre('', 'bubble on outer wall')
    expect(result.category).toBe('Sidewall Damage')
    expect(result.risk_level).toBe('High')
  })

  it('classifies "cord exposed" as Sidewall Damage', () => {
    const result = classifyTyre('', 'cord exposed on sidewall')
    expect(result.category).toBe('Sidewall Damage')
    expect(result.risk_level).toBe('High')
  })

  it('classifies "pinch" as Sidewall Damage', () => {
    const result = classifyTyre('', 'pinch damage noted on lower sidewall')
    expect(result.category).toBe('Sidewall Damage')
    expect(result.risk_level).toBe('High')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — PUNCTURE (Medium)
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — PUNCTURE (Medium)', () => {
  it('classifies "puncture" in remarks', () => {
    const result = classifyTyre('', 'puncture on rear left tyre')
    expect(result.category).toBe('Puncture')
    expect(result.risk_level).toBe('Medium')
  })

  it('classifies "nail" in tyre', () => {
    const result = classifyTyre('', 'nail found in tread')
    expect(result.category).toBe('Puncture')
    expect(result.risk_level).toBe('Medium')
  })

  it('classifies "flat tyre"', () => {
    const result = classifyTyre('', 'flat tyre on front axle')
    expect(result.category).toBe('Puncture')
    expect(result.risk_level).toBe('Medium')
  })

  it('classifies "slow puncture"', () => {
    const result = classifyTyre('', 'slow puncture detected during inspection')
    expect(result.category).toBe('Puncture')
    expect(result.risk_level).toBe('Medium')
  })

  it('classifies f/t abbreviation as flat tyre / puncture', () => {
    const result = classifyTyre('', 'f/t on unit 204')
    expect(result.category).toBe('Puncture')
    expect(result.risk_level).toBe('Medium')
  })

  it('classifies "screw in tread"', () => {
    const result = classifyTyre('', 'screw found embedded in tread')
    expect(result.category).toBe('Puncture')
    expect(result.risk_level).toBe('Medium')
  })

  it('classifies "foreign object" penetration', () => {
    const result = classifyTyre('', 'foreign object penetration causing flat')
    expect(result.category).toBe('Puncture')
    expect(result.risk_level).toBe('Medium')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — WEAR (Low)
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — WEAR (Low)', () => {
  it('classifies "worn out" tyre', () => {
    const result = classifyTyre('', 'worn out, replace immediately')
    expect(result.category).toBe('Normal Wear')
    expect(result.risk_level).toBe('Low')
  })

  it('classifies "bald" tyre', () => {
    const result = classifyTyre('', 'tyre completely bald')
    expect(result.category).toBe('Normal Wear')
    expect(result.risk_level).toBe('Low')
  })

  it('classifies "end of life"', () => {
    const result = classifyTyre('', 'end of life replacement required')
    expect(result.category).toBe('Normal Wear')
    expect(result.risk_level).toBe('Low')
  })

  it('classifies "Continental EcoContact worn tread" as Normal Wear', () => {
    const result = classifyTyre('Continental EcoContact', 'worn tread depth below minimum')
    expect(result.category).toBe('Normal Wear')
    expect(result.risk_level).toBe('Low')
  })

  it('classifies eol abbreviation as Normal Wear', () => {
    const result = classifyTyre('', 'eol tyre 245/70R17.5')
    expect(result.category).toBe('Normal Wear')
    expect(result.risk_level).toBe('Low')
  })

  it('classifies "condemned" tyre', () => {
    const result = classifyTyre('', 'tyre condemned at inspection')
    expect(result.category).toBe('Normal Wear')
    expect(result.risk_level).toBe('Low')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — HEAT (High)
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — HEAT (High)', () => {
  it('classifies "overheat" damage', () => {
    const result = classifyTyre('', 'tyre overheated due to long run')
    expect(result.category).toBe('Heat / Overload Damage')
    expect(result.risk_level).toBe('High')
  })

  it('classifies "under inflated" as Heat category', () => {
    const result = classifyTyre('', 'under inflated causing heat build-up')
    expect(result.category).toBe('Heat / Overload Damage')
    expect(result.risk_level).toBe('High')
  })

  it('classifies "overloaded" as Heat category', () => {
    const result = classifyTyre('', 'vehicle overloaded, tyre failure')
    expect(result.category).toBe('Heat / Overload Damage')
    expect(result.risk_level).toBe('High')
  })

  it('classifies "run flat" damage', () => {
    const result = classifyTyre('', 'driven run flat causing internal heat damage')
    expect(result.category).toBe('Heat / Overload Damage')
    expect(result.risk_level).toBe('High')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — IMPACT (High)
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — IMPACT (High)', () => {
  it('classifies "pothole" impact', () => {
    const result = classifyTyre('', 'tyre damaged by pothole')
    expect(result.category).toBe('Impact Damage')
    expect(result.risk_level).toBe('High')
  })

  it('classifies "kerb damage"', () => {
    const result = classifyTyre('', 'kerb damage on outer sidewall')
    expect(result.category).toBe('Impact Damage')
    expect(result.risk_level).toBe('High')
  })

  it('classifies "road hazard"', () => {
    const result = classifyTyre('', 'road hazard impact on rear tyre')
    expect(result.category).toBe('Impact Damage')
    expect(result.risk_level).toBe('High')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — REPLACEMENT (Low)
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — REPLACEMENT (Low)', () => {
  it('classifies "scheduled replacement"', () => {
    const result = classifyTyre('', 'scheduled replacement at 60k km')
    expect(result.category).toBe('Scheduled Replacement')
    expect(result.risk_level).toBe('Low')
  })

  it('classifies "new tyre" installation', () => {
    const result = classifyTyre('', 'new tyre fitted on front left')
    expect(result.category).toBe('Scheduled Replacement')
    expect(result.risk_level).toBe('Low')
  })

  it('classifies "rotation"', () => {
    const result = classifyTyre('', 'routine tyre rotation completed')
    expect(result.category).toBe('Scheduled Replacement')
    expect(result.risk_level).toBe('Low')
  })

  it('classifies "swapped" as Scheduled Replacement', () => {
    const result = classifyTyre('', 'tyres swapped front to rear')
    expect(result.category).toBe('Scheduled Replacement')
    expect(result.risk_level).toBe('Low')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — Confidence levels
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — Confidence levels', () => {
  it('returns Low confidence when only 1 pattern matches', () => {
    const result = classifyTyre('', 'sidewall damage')
    expect(result.confidence).toBe('Low')
  })

  it('returns Medium confidence when exactly 2 patterns match', () => {
    // Both "sidewall" and "bulge" match SIDEWALL category
    const result = classifyTyre('', 'sidewall damage with bulge visible')
    expect(result.confidence).toBe('Medium')
  })

  it('returns High confidence when 3+ patterns match', () => {
    // "blowout", "burst", "blown out", "explod" all match BLOWOUT
    const result = classifyTyre('tyre burst blowout', 'blown out completely exploded')
    expect(result.confidence).toBe('High')
  })

  it('returns Low confidence for Unclassified result', () => {
    const result = classifyTyre('', 'xyz 999 ###')
    expect(result.confidence).toBe('Low')
    expect(result.category).toBe('Unclassified')
  })

  it('matched_keywords array length drives confidence calculation', () => {
    // Single keyword match
    const singleMatch = classifyTyre('', 'nail in tread')
    expect(singleMatch.confidence).toBe('Low')
    expect(singleMatch.matched_keywords.length).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — Edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — Edge cases', () => {
  it('returns Unclassified for empty string inputs', () => {
    const result = classifyTyre('', '')
    expect(result.category).toBe('Unclassified')
    expect(result.risk_level).toBe('Medium')
  })

  it('returns Unclassified for null/undefined inputs', () => {
    const result = classifyTyre(null, undefined)
    expect(result.category).toBe('Unclassified')
  })

  it('returns Unclassified for numbers-only input', () => {
    const result = classifyTyre('', '12345 6789')
    expect(result.category).toBe('Unclassified')
  })

  it('returns Unclassified for special characters only', () => {
    const result = classifyTyre('', '@@@ ### $$$')
    expect(result.category).toBe('Unclassified')
  })

  it('handles all-uppercase description correctly (case-insensitive matching)', () => {
    const result = classifyTyre('BLOWOUT ON HIGHWAY', '')
    expect(result.category).toBe('Blowout')
  })

  it('handles mixed upper/lower case remarks', () => {
    const result = classifyTyre('', 'Puncture On Left REAR')
    expect(result.category).toBe('Puncture')
  })

  it('remarks_cleaned starts with uppercase and ends with period', () => {
    const result = classifyTyre('', 'flat tyre on rear axle')
    expect(result.remarks_cleaned.charAt(0)).toMatch(/[A-Z]/)
    expect(result.remarks_cleaned.endsWith('.')).toBe(true)
  })

  it('handles very short single-word description', () => {
    const result = classifyTyre('puncture', '')
    expect(result.category).toBe('Puncture')
  })

  it('handles long, real-world description with multiple signals', () => {
    const result = classifyTyre(
      'Bridgestone 315/80R22.5 rear axle steer axle',
      'tyre blowout on highway sudden deflation burst tread, driver lost control'
    )
    expect(result.category).toBe('Blowout')
    expect(result.confidence).toBe('High')
  })

  it('returns matched_keywords as empty array when Unclassified', () => {
    const result = classifyTyre('', '')
    expect(result.matched_keywords).toEqual([])
  })

  it('description alone (no remarks) can drive classification', () => {
    const result = classifyTyre('Blowout on left rear', '')
    expect(result.category).toBe('Blowout')
  })

  it('remarks alone (no description) can drive classification', () => {
    const result = classifyTyre('', 'cord damaged on sidewall')
    expect(result.category).toBe('Sidewall Damage')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — Competing pattern matches (higher-weight wins)
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — Competing pattern matches', () => {
  it('BLOWOUT wins over PUNCTURE when both present (weight 10 vs 5)', () => {
    const result = classifyTyre('', 'nail puncture caused blowout on highway')
    expect(result.category).toBe('Blowout')
  })

  it('BLOWOUT wins over WEAR when both present (weight 10 vs 2)', () => {
    const result = classifyTyre('', 'worn tyre burst and blowout occurred')
    expect(result.category).toBe('Blowout')
  })

  it('SIDEWALL wins over REPLACEMENT when both present (weight 8 vs 1)', () => {
    const result = classifyTyre('', 'installed new tyre but sidewall bulge found')
    expect(result.category).toBe('Sidewall Damage')
  })

  it('matched_keywords is non-empty array when classified', () => {
    const result = classifyTyre('', 'tyre blowout on rear axle')
    expect(Array.isArray(result.matched_keywords)).toBe(true)
    expect(result.matched_keywords.length).toBeGreaterThan(0)
  })

  it('winner has highest cumulative score (matched count × weight)', () => {
    // SEPARATION weight=10 should beat WEAR weight=2 even with same keyword count
    const result = classifyTyre('', 'tread separation on worn tyre')
    expect(result.category).toBe('Tread Separation')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — Abbreviation expansion
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — Abbreviation expansion', () => {
  it('expands s/w to Sidewall → classifies as Sidewall Damage', () => {
    const result = classifyTyre('', 's/w cut on driver side')
    expect(result.category).toBe('Sidewall Damage')
  })

  it('expands p/c to Puncture cut → classifies as Puncture', () => {
    const result = classifyTyre('', 'p/c noted on inner tread')
    expect(result.category).toBe('Puncture')
  })

  it('expands w/o to Worn out → classifies as Normal Wear', () => {
    const result = classifyTyre('', 'w/o tyre needs replacement')
    expect(result.category).toBe('Normal Wear')
  })

  it('expands n/t to New tyre → classifies as Scheduled Replacement', () => {
    const result = classifyTyre('', 'n/t fitted on all four axles')
    expect(result.category).toBe('Scheduled Replacement')
  })

  it('expands i/r to Irregular wear → classifies as Irregular Wear', () => {
    const result = classifyTyre('', 'i/r on front axle tyres')
    expect(result.category).toBe('Irregular Wear')
  })

  it('expands dmg to Damage, visible in remarks_cleaned', () => {
    const result = classifyTyre('', 'sidewall dmg noted')
    // Expansion of "dmg" → "Damage" and "sidewall" should match Sidewall Damage
    expect(result.category).toBe('Sidewall Damage')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyTyre — Text cleaning (junk removal)
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyTyre — Text cleaning', () => {
  it('strips repeated slashes from remarks_cleaned', () => {
    const result = classifyTyre('', '/// flat tyre on rear')
    expect(result.remarks_cleaned).not.toMatch(/\/{2,}/)
  })

  it('strips repeated dashes from remarks_cleaned', () => {
    const result = classifyTyre('', '----puncture---- in tread')
    expect(result.remarks_cleaned).not.toMatch(/-{4,}/)
  })

  it('strips repeated equals signs', () => {
    const result = classifyTyre('', '====inspection overdue====')
    expect(result.remarks_cleaned).not.toMatch(/={4,}/)
  })

  it('collapses multiple spaces into one', () => {
    const result = classifyTyre('', 'flat    tyre     on   rear')
    expect(result.remarks_cleaned).not.toMatch(/\s{2,}/)
  })

  it('capitalises first character of remarks_cleaned', () => {
    const result = classifyTyre('', 'worn tyre on left front')
    expect(result.remarks_cleaned.charAt(0)).toMatch(/[A-Z]/)
  })

  it('adds trailing period if punctuation absent', () => {
    const result = classifyTyre('', 'flat tyre on rear axle')
    expect(result.remarks_cleaned.endsWith('.')).toBe(true)
  })

  it('does not add extra period if already ends with period', () => {
    const result = classifyTyre('', 'flat tyre on rear axle.')
    const periodCount = (result.remarks_cleaned.match(/\.$/g) || []).length
    expect(periodCount).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// batchClassify
// ─────────────────────────────────────────────────────────────────────────────
describe('batchClassify', () => {
  it('returns an array of results with id preserved', () => {
    const records = [
      { id: 'A1', description: 'Blowout on highway', remarks: '' },
      { id: 'B2', description: '', remarks: 'flat tyre on rear' },
    ]
    const results = batchClassify(records)
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('A1')
    expect(results[1].id).toBe('B2')
  })

  it('each batch result contains category, risk_level, confidence', () => {
    const records = [{ id: '1', description: 'puncture', remarks: '' }]
    const results = batchClassify(records)
    expect(results[0]).toHaveProperty('category')
    expect(results[0]).toHaveProperty('risk_level')
    expect(results[0]).toHaveProperty('confidence')
  })

  it('preserves original_description and original_remarks', () => {
    const records = [{ id: '1', description: 'My desc', remarks: 'My remarks' }]
    const results = batchClassify(records)
    expect(results[0].original_description).toBe('My desc')
    expect(results[0].original_remarks).toBe('My remarks')
  })

  it('handles empty array input gracefully', () => {
    const results = batchClassify([])
    expect(results).toEqual([])
  })

  it('classifies each record independently', () => {
    const records = [
      { id: '1', description: 'blowout', remarks: '' },
      { id: '2', description: '', remarks: 'worn out tyre' },
    ]
    const results = batchClassify(records)
    expect(results[0].category).toBe('Blowout')
    expect(results[1].category).toBe('Normal Wear')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RISK_COLOUR and CONFIDENCE_COLOUR constants
// ─────────────────────────────────────────────────────────────────────────────
describe('RISK_COLOUR and CONFIDENCE_COLOUR constants', () => {
  it('RISK_COLOUR has entries for all four risk levels', () => {
    expect(RISK_COLOUR).toHaveProperty('Critical')
    expect(RISK_COLOUR).toHaveProperty('High')
    expect(RISK_COLOUR).toHaveProperty('Medium')
    expect(RISK_COLOUR).toHaveProperty('Low')
  })

  it('RISK_COLOUR strings are non-empty CSS class strings', () => {
    for (const val of Object.values(RISK_COLOUR)) {
      expect(typeof val).toBe('string')
      expect(val.length).toBeGreaterThan(0)
    }
  })

  it('CONFIDENCE_COLOUR has entries for High, Medium, Low', () => {
    expect(CONFIDENCE_COLOUR).toHaveProperty('High')
    expect(CONFIDENCE_COLOUR).toHaveProperty('Medium')
    expect(CONFIDENCE_COLOUR).toHaveProperty('Low')
  })

  it('CONFIDENCE_COLOUR strings are non-empty CSS class strings', () => {
    for (const val of Object.values(CONFIDENCE_COLOUR)) {
      expect(typeof val).toBe('string')
      expect(val.length).toBeGreaterThan(0)
    }
  })
})
