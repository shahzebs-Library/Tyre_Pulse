import { describe, it, expect } from 'vitest'
import {
  MIN_USEFUL_LIFT,
  MIN_SUPPORT,
  MIN_DECISIONS_FOR_SHARE,
  liftBand,
  explainProposal,
  impactOf,
  rankProposals,
  isOfferable,
  accuracyTrend,
  describeWeakSpot,
  rankWeakSpots,
  categoryLabel,
} from '../lib/classificationLearning'

// Every case below is a real row or a real measurement from the live data, so a
// change that breaks one of these breaks something that actually happened.

describe('lift is the number that matters', () => {
  it('reads the real petrol proposal as decisive', () => {
    // measured: 4 reviewed items, 100% precision, 7.7% base rate, lift 12.92
    expect(liftBand(12.92).key).toBe('decisive')
  })

  it('rejects the majority-class noise that frequency scoring produced', () => {
    // `with`, `water`, `rear` and `fuel` all claimed spare_part at lift 1.12
    // against an 89.6% base rate - i.e. no better than guessing.
    expect(liftBand(1.12).key).toBe('noise')
    expect(1.12).toBeLessThan(MIN_USEFUL_LIFT)
  })

  it('calls an unmeasured lift unknown, never weak', () => {
    // Defaulting a missing measurement into a real band would invent evidence.
    expect(liftBand(null).key).toBe('unknown')
    expect(liftBand(undefined).key).toBe('unknown')
    expect(liftBand('abc').key).toBe('unknown')
  })

  it('bands the boundaries the way the labels claim', () => {
    expect(liftBand(8).key).toBe('decisive')
    expect(liftBand(7.99).key).toBe('strong')
    expect(liftBand(4).key).toBe('strong')
    expect(liftBand(2).key).toBe('moderate')
    expect(liftBand(1.5).key).toBe('weak')
    expect(liftBand(1.49).key).toBe('noise')
  })
})

describe('explainProposal states the comparison, not the bare percentage', () => {
  it('includes support, precision AND the base rate', () => {
    const s = explainProposal({
      token: 'petrol', category: 'lubricant',
      support: 4, precision_pct: 100, base_rate_pct: 7.7,
    })
    expect(s).toContain('"petrol"')
    expect(s).toContain('4 items')
    expect(s).toContain('100%')
    // the base rate is what makes 100% judgeable rather than impressive
    expect(s).toContain('7.7%')
  })

  it('says item, not items, for a single supporting row', () => {
    const s = explainProposal({ token: 'x', category: 'tyre', support: 1 })
    expect(s).toMatch(/\b1 item\b/)
    expect(s).not.toContain('1 items')
  })

  it('does not print a missing precision as 0%', () => {
    // Number(null) is 0 and 0 is finite, so a careless read turns "we did not
    // measure this" into "0% of them are lubricant", which is a lie.
    const s = explainProposal({ token: 'x', category: 'lubricant', support: 4, precision_pct: null })
    expect(s).not.toContain('0% of them')
  })

  it('omits a figure it does not have rather than printing NaN', () => {
    const s = explainProposal({ token: 'x', category: 'tyre' })
    expect(s).not.toMatch(/NaN|undefined|null/)
  })

  it('returns empty for nothing', () => {
    expect(explainProposal(null)).toBe('')
  })
})

describe('impact', () => {
  it('reports the real post-veto impact of the petrol rule', () => {
    // Before the veto: 3 lines / 7539.89. After: 1 line / 28.57, because `pump`
    // and `hose` are already in the oil_part list.
    expect(impactOf({ affects_lines: 1, affects_value: 28.57 })).toEqual({
      lines: 1, value: 28.57, sample: null,
    })
  })

  it('is null when nothing would move', () => {
    // A rule with no impact is not an opportunity and must not be shown as one.
    expect(impactOf({ affects_lines: 0, affects_value: 0 })).toBeNull()
    expect(impactOf({})).toBeNull()
    expect(impactOf(null)).toBeNull()
  })
})

describe('ranking puts the reviewer on the money first', () => {
  it('sorts by value before lift', () => {
    // A decisive rule worth 28 is true and irrelevant; a moderate one worth
    // 50,000 is what the reviewer should look at first.
    const ranked = rankProposals([
      { token: 'a', lift: 12.9, affects_value: 28.57 },
      { token: 'b', lift: 2.1, affects_value: 50000 },
    ])
    expect(ranked.map((r) => r.token)).toEqual(['b', 'a'])
  })

  it('falls back to lift when the money is equal', () => {
    const ranked = rankProposals([
      { token: 'a', lift: 2, affects_value: 100 },
      { token: 'b', lift: 9, affects_value: 100 },
    ])
    expect(ranked[0].token).toBe('b')
  })

  it('does not mutate its input', () => {
    const input = [{ token: 'a', affects_value: 1 }, { token: 'b', affects_value: 2 }]
    rankProposals(input)
    expect(input[0].token).toBe('a')
  })

  it('survives a non-array', () => {
    expect(rankProposals(null)).toEqual([])
  })
})

describe('isOfferable filters what is not worth a decision', () => {
  const good = { token: 'petrol', category: 'lubricant', support: 4, lift: 12.92, affects_lines: 1, affects_value: 28.57 }

  it('offers the real proposal', () => {
    expect(isOfferable(good)).toBe(true)
  })

  it('refuses majority-class noise even with big support', () => {
    expect(isOfferable({ ...good, token: 'water', lift: 1.12, support: 40 })).toBe(false)
  })

  it('refuses a coincidence', () => {
    expect(isOfferable({ ...good, support: MIN_SUPPORT - 1 })).toBe(false)
  })

  it('refuses a rule that would move nothing', () => {
    expect(isOfferable({ ...good, affects_lines: 0 })).toBe(false)
  })

  it('refuses a rule with no category to apply', () => {
    expect(isOfferable({ ...good, category: null })).toBe(false)
  })
})

describe('accuracyTrend', () => {
  it('is null for a single period, never a flat zero', () => {
    // One point has no direction. Reporting "no change" would be a claim the
    // data cannot support - and today there IS only one period.
    expect(accuracyTrend([{ period: '2026-07', agreement_pct: 92.4 }])).toBeNull()
    expect(accuracyTrend([])).toBeNull()
    expect(accuracyTrend(null)).toBeNull()
  })

  it('measures oldest to newest regardless of input order', () => {
    const t = accuracyTrend([
      { period: '2026-08', agreement_pct: 95 },
      { period: '2026-07', agreement_pct: 92.4 },
    ])
    expect(t.from).toBe(92.4)
    expect(t.to).toBe(95)
    expect(t.delta).toBe(2.6)
    expect(t.improving).toBe(true)
  })

  it('reports a decline honestly', () => {
    const t = accuracyTrend([
      { period: '2026-07', agreement_pct: 92.4 },
      { period: '2026-08', agreement_pct: 88 },
    ])
    expect(t.improving).toBe(false)
    expect(t.delta).toBe(-4.4)
  })

  it('ignores periods with no measurement', () => {
    const t = accuracyTrend([
      { period: '2026-07', agreement_pct: 90 },
      { period: '2026-08', agreement_pct: null },
      { period: '2026-09', agreement_pct: 94 },
    ])
    expect(t.periods).toBe(2)
    expect(t.to).toBe(94)
  })
})

describe('weak spots point at the broken layer', () => {
  it('describes the real worst layer in full', () => {
    // measured: description-tyre called 22 items tyre that a human called spare,
    // which is 56.4% of everything that layer decided.
    const s = describeWeakSpot({
      machine_source: 'description-tyre', machine_said: 'tyre',
      human_said: 'spare', items: 22, share_of_source_pct: 56.4,
    })
    expect(s).toContain('description-tyre')
    expect(s).toContain('22 items')
    expect(s).toContain('56.4%')
  })

  it('omits the share when it is not known', () => {
    const s = describeWeakSpot({ machine_source: 'default', machine_said: 'spare', human_said: 'oil', items: 16 })
    expect(s).toContain('16 items')
    expect(s).not.toMatch(/NaN|%/)
  })

  it('ranks the unreliable layer above the merely busy one', () => {
    // description-tyre is wrong 56.4% of the time it fires (22 items).
    // default is wrong 16 times but that is only 5.9% of its decisions.
    // Counting alone would rank them the same way round and point the
    // maintainer at the wrong layer.
    const ranked = rankWeakSpots([
      { machine_source: 'default', items: 16, share_of_source_pct: 5.9 },
      { machine_source: 'description-tyre', items: 22, share_of_source_pct: 56.4 },
    ])
    expect(ranked[0].machine_source).toBe('description-tyre')
  })

  it('does not let a single decision top the list on share alone', () => {
    // 1 of 1 is 100% and means nothing.
    const ranked = rankWeakSpots([
      { machine_source: 'code-range', items: 1, share_of_source_pct: 100 },
      { machine_source: 'description-tyre', items: 22, share_of_source_pct: 56.4 },
    ])
    expect(ranked[0].machine_source).toBe('description-tyre')
    expect(MIN_DECISIONS_FOR_SHARE).toBeGreaterThan(1)
  })

  it('returns empty for a non-array', () => {
    expect(rankWeakSpots(undefined)).toEqual([])
  })
})

describe('category labels', () => {
  it('reads spare_part as words', () => {
    expect(categoryLabel('spare_part')).toBe('Spare part')
    expect(categoryLabel('lubricant')).toBe('Oil and lubricant')
  })

  it('passes an unknown category through rather than blanking it', () => {
    expect(categoryLabel('something_new')).toBe('something_new')
    expect(categoryLabel(null)).toBe('Unclassified')
  })
})
