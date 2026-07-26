import { describe, it, expect } from 'vitest'
import {
  MATERIAL_CATEGORIES, MATERIAL_CATEGORY_KEYS, MATERIAL_SUBCATEGORIES,
  categoryFlags, costBucketFor, categoryFromDescription, classifyByMaster,
  normaliseItemCode, deriveMasterFromTransactions, mapLegacyCategory,
  masterCoverage, validateMasterRow,
} from '../lib/materialMaster'

describe('category vocabulary', () => {
  it('every category has a label, a cost bucket and valid flags', () => {
    for (const c of MATERIAL_CATEGORIES) {
      expect(c.key).toBeTruthy()
      expect(c.label).toBeTruthy()
      expect(['tyre', 'spare', 'oil']).toContain(c.costBucket)
      expect(Array.isArray(c.flags)).toBe(true)
    }
    expect(new Set(MATERIAL_CATEGORY_KEYS).size).toBe(MATERIAL_CATEGORY_KEYS.length)
  })

  it('every category has a subcategory list, even if empty', () => {
    for (const k of MATERIAL_CATEGORY_KEYS) {
      expect(Array.isArray(MATERIAL_SUBCATEGORIES[k])).toBe(true)
    }
  })

  it('filters and consumables roll into the SPARE bucket, not tyres', () => {
    // The user's rule: an oil filter is a spare part, never a tyre cost.
    expect(costBucketFor('filter')).toBe('spare')
    expect(costBucketFor('consumable')).toBe('spare')
    expect(costBucketFor('spare_part')).toBe('spare')
  })

  it('fuel and lubricants share the oil bucket; tyres are their own', () => {
    expect(costBucketFor('lubricant')).toBe('oil')
    expect(costBucketFor('fuel')).toBe('oil')
    expect(costBucketFor('tyre')).toBe('tyre')
  })

  it('an unknown category falls back to spare so cost never disappears', () => {
    expect(costBucketFor('nonsense')).toBe('spare')
    expect(costBucketFor(undefined)).toBe('spare')
    expect(costBucketFor('unclassified')).toBe('spare')
  })
})

describe('categoryFlags', () => {
  it('sets exactly the flag a KPI would ask for', () => {
    expect(categoryFlags('tyre').tyre).toBe(true)
    expect(categoryFlags('tyre').spare).toBe(false)
    expect(categoryFlags('lubricant').lubricant).toBe(true)
    expect(categoryFlags('fuel').fuel).toBe(true)
    expect(categoryFlags('service').service).toBe(true)
    expect(categoryFlags('capital').capital).toBe(true)
  })

  it('unclassified carries no flags at all', () => {
    const f = categoryFlags('unclassified')
    expect(Object.values(f).every((v) => v === false)).toBe(true)
  })
})

describe('categoryFromDescription (the fallback only)', () => {
  it('recognises a real tyre from its description', () => {
    expect(categoryFromDescription('TYRE 315/80 R22.5')).toBe('tyre')
  })

  it('recognises engine oil as a lubricant', () => {
    expect(categoryFromDescription('ENGINE OIL 15W-40')).toBe('lubricant')
  })

  it('defaults anything else to a spare part rather than guessing', () => {
    // It must NOT try to guess `filter` or `service` from text: a confident wrong
    // guess is worse than an honest spare_part awaiting review.
    expect(categoryFromDescription('OIL FILTER')).not.toBe('filter')
    expect(categoryFromDescription('BRAKE LINING')).toBe('spare_part')
    expect(categoryFromDescription('')).toBe('spare_part')
    expect(categoryFromDescription(null)).toBe('spare_part')
  })
})

describe('classifyByMaster precedence', () => {
  const line = { item_code: 'ic-1', item_description: 'TYRE 315/80 R22.5' }

  it('a REVIEWED master row overrides the description, even against the text', () => {
    // This is the whole point: a human said this code is a spare part, so it must
    // never land in the tyre column no matter what the description says.
    const master = new Map([['IC-1', { category: 'spare_part', reviewed: true }]])
    const r = classifyByMaster(line, master)
    expect(r.category).toBe('spare_part')
    expect(r.bucket).toBe('spare')
    expect(r.source).toBe('master_reviewed')
    expect(r.reviewed).toBe(true)
    expect(r.flags.tyre).toBe(false)
  })

  it('an UNREVIEWED master row still beats re-reading the text', () => {
    const master = { 'IC-1': { category: 'filter', reviewed: false } }
    const r = classifyByMaster(line, master)
    expect(r.category).toBe('filter')
    expect(r.source).toBe('master_derived')
    expect(r.reviewed).toBe(false)
  })

  it('falls back to the description for a code the master has never seen', () => {
    const r = classifyByMaster(line, new Map())
    expect(r.category).toBe('tyre')
    expect(r.source).toBe('description')
  })

  it('ignores a master row carrying an invalid category', () => {
    const master = new Map([['IC-1', { category: 'not_a_category', reviewed: true }]])
    const r = classifyByMaster(line, master)
    expect(r.source).toBe('description')
    expect(r.category).toBe('tyre')
  })

  it('handles a missing item code and a missing master', () => {
    expect(classifyByMaster({ item_description: 'ENGINE OIL' }, new Map()).category).toBe('lubricant')
    expect(classifyByMaster({ item_code: 'X' }, null).source).toBe('description')
    expect(classifyByMaster(null, null).category).toBe('spare_part')
  })

  it('matches the item code case-insensitively', () => {
    const master = new Map([['IC-1', { category: 'spare_part', reviewed: true }]])
    expect(classifyByMaster({ item_code: ' ic-1 ' }, master).category).toBe('spare_part')
  })
})

describe('normaliseItemCode', () => {
  it('uppercases, trims, and returns null for empty rather than an empty string', () => {
    expect(normaliseItemCode(' ab-1 ')).toBe('AB-1')
    expect(normaliseItemCode('')).toBeNull()
    expect(normaliseItemCode('   ')).toBeNull()
    expect(normaliseItemCode(null)).toBeNull()
  })
})

describe('mapLegacyCategory', () => {
  it('folds the three stored tokens onto the master vocabulary', () => {
    expect(mapLegacyCategory('tyre')).toBe('tyre')
    expect(mapLegacyCategory('oil')).toBe('lubricant')
    expect(mapLegacyCategory('spare')).toBe('spare_part')
  })

  it('returns null for anything unrecognised so the caller falls back to text', () => {
    expect(mapLegacyCategory('other')).toBeNull()
    expect(mapLegacyCategory(null)).toBeNull()
  })
})

describe('deriveMasterFromTransactions', () => {
  const rows = [
    { item_code: 'T1', item_description: 'TYRE 315/80 R22.5', cost_category: 'tyre', line_cost: 1000 },
    { item_code: 'T1', item_description: 'TYRE 315/80 R22.5', cost_category: 'tyre', line_cost: 1000 },
    { item_code: 'S1', item_description: 'BRAKE LINING', cost_category: 'spare', line_cost: 1850 },
    { item_code: 'O1', item_description: 'ENGINE OIL 15W-40', cost_category: 'oil', line_cost: 540 },
  ]

  it('proposes one row per code with rows and value behind it', () => {
    const m = deriveMasterFromTransactions(rows)
    expect(m).toHaveLength(3)
    const t1 = m.find((x) => x.item_code === 'T1')
    expect(t1).toMatchObject({ category: 'tyre', txn_rows: 2, txn_value: 2000, reviewed: false })
    expect(t1.tyre).toBe(true)
  })

  it('orders by value so a reviewer starts where the money is', () => {
    const m = deriveMasterFromTransactions(rows)
    expect(m.map((x) => x.item_code)).toEqual(['T1', 'S1', 'O1'])
  })

  it('flags a code whose own rows disagree, and keeps the majority', () => {
    const conflicted = deriveMasterFromTransactions([
      { item_code: 'C1', item_description: 'ODD ITEM', cost_category: 'tyre', line_cost: 10 },
      { item_code: 'C1', item_description: 'ODD ITEM', cost_category: 'spare', line_cost: 10 },
      { item_code: 'C1', item_description: 'ODD ITEM', cost_category: 'spare', line_cost: 10 },
    ])
    expect(conflicted[0].conflicting).toBe(true)
    expect(conflicted[0].category).toBe('spare_part')
    expect(conflicted[0].proposed_from).toMatch(/conflicting/)
  })

  it('does not flag a consistent code', () => {
    expect(deriveMasterFromTransactions(rows).every((x) => x.conflicting === false)).toBe(true)
  })

  it('derives the category from text when the row carries no stored category', () => {
    const m = deriveMasterFromTransactions([
      { item_code: 'N1', item_description: 'TYRE 385/65 R22.5', line_cost: 5 },
    ])
    expect(m[0].category).toBe('tyre')
  })

  it('skips rows with no item code and survives junk input', () => {
    expect(deriveMasterFromTransactions([{ item_description: 'x' }, null])).toEqual([])
    expect(deriveMasterFromTransactions(null)).toEqual([])
  })

  it('picks the most common description as the item name', () => {
    const m = deriveMasterFromTransactions([
      { item_code: 'D1', item_description: 'PREFERRED NAME', cost_category: 'spare', line_cost: 1 },
      { item_code: 'D1', item_description: 'PREFERRED NAME', cost_category: 'spare', line_cost: 1 },
      { item_code: 'D1', item_description: 'typo name', cost_category: 'spare', line_cost: 1 },
    ])
    expect(m[0].item_name).toBe('PREFERRED NAME')
  })

  it('ignores a non-numeric cost instead of producing NaN', () => {
    const m = deriveMasterFromTransactions([
      { item_code: 'Z1', item_description: 'X', cost_category: 'spare', line_cost: 'abc' },
    ])
    expect(m[0].txn_value).toBe(0)
  })
})

describe('masterCoverage', () => {
  const rows = [
    { item_code: 'A', item_description: 'TYRE 315/80 R22.5', line_cost: 800 },
    { item_code: 'B', item_description: 'BRAKE LINING', line_cost: 200 },
  ]

  it('reports the share of MONEY decided by a human, not just row counts', () => {
    const master = new Map([['A', { category: 'tyre', reviewed: true }]])
    const c = masterCoverage(rows, master)
    expect(c.rows).toBe(2)
    expect(c.value).toBe(1000)
    expect(c.bySource.master_reviewed.value).toBe(800)
    expect(c.bySource.description.value).toBe(200)
    expect(c.reviewedValueShare).toBe(80)
  })

  it('returns null share when there is no money to divide by', () => {
    const c = masterCoverage([{ item_code: 'A', line_cost: 0 }], new Map())
    expect(c.reviewedValueShare).toBeNull()
  })

  it('counts distinct unclassified codes', () => {
    const master = new Map([
      ['A', { category: 'unclassified', reviewed: false }],
      ['B', { category: 'unclassified', reviewed: false }],
    ])
    expect(masterCoverage(rows, master).unclassifiedCodes).toBe(2)
  })

  it('handles empty input', () => {
    const c = masterCoverage([], new Map())
    expect(c.rows).toBe(0)
    expect(c.reviewedValueShare).toBeNull()
  })
})

describe('validateMasterRow', () => {
  it('requires an item code and a valid category', () => {
    expect(validateMasterRow({ item_code: 'A', category: 'tyre' }).ok).toBe(true)
    expect(validateMasterRow({ category: 'tyre' }).ok).toBe(false)
    expect(validateMasterRow({ item_code: 'A', category: 'bogus' }).ok).toBe(false)
  })

  it('reports every problem at once rather than one at a time', () => {
    const r = validateMasterRow({})
    expect(r.errors.length).toBe(2)
  })
})
