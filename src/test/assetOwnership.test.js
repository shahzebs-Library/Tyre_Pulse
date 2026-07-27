/**
 * assetOwnership tests.
 *
 * Every fixture below is a REAL asset with its REAL figures, measured on the live
 * org (216,792 expense rows) on 2026-07-27. They are kept verbatim so a change to
 * the engine has to survive the actual data, not an invented example:
 *
 *   MP069  a genuine transfer. KSA 2021-03-15..2023-07-09 (102 lines, 29,108.86
 *          SAR) then UAE 2023-08-09..2026-07-11 (533 lines, 241,542.90 AED), with
 *          no month in which both billed.
 *   PL051  a code collision. Egypt and KSA both billed it in 44 shared months, so
 *          one machine cannot be behind it and ownership must come back unknown.
 *   MP057  a dominant operator with a stray tail. Egypt 645 lines, KSA 2 lines on
 *          one day in 2020.
 *   TM241  single country (Egypt only, 525 lines, 873,102.23 EGP) - the ordinary
 *          case, which must be completely unaffected by any of this.
 *   TM514  contested (UAE and KSA share 22 months) AND carries a KSA registration.
 *          It is the reason registration must not decide ownership: the only
 *          country holding registration data is KSA, so letting it vote would
 *          hand KSA an asset the operating evidence says is two machines.
 */
import { describe, it, expect } from 'vitest'
import {
  OWNERSHIP_BASIS,
  UNKNOWN_OWNER,
  basisMeta,
  normalizeAsset,
  normalizeOwnership,
  costBearingSplit,
  totalsByCurrency,
  foreignBorneByCurrency,
  ownershipExplanation,
  filterAssets,
  ownershipExportRows,
} from '../lib/assetOwnership'

// ── real payload fragments, shaped exactly as get_asset_ownership returns them ──

const MP069 = {
  asset_no: 'MP069',
  owning_country: 'UAE',
  ownership_basis: 'sequential_transfer',
  ownership_confidence: 'medium',
  country_count: 2,
  concurrent_months: 0,
  transferred_from: 'KSA',
  identity_conflict: false,
  registration_country: null,
  countries: [
    {
      country: 'UAE', currency: 'AED', cost: 241542.9, tyre_cost: 26104.28, rows: 533,
      months_active: 35, first_date: '2023-08-09', last_date: '2026-07-11',
      is_owner: true, bears_cost_for_other_country: false,
    },
    {
      country: 'KSA', currency: 'SAR', cost: 29108.86, tyre_cost: 11800, rows: 102,
      months_active: 17, first_date: '2021-03-15', last_date: '2023-07-09',
      is_owner: false, bears_cost_for_other_country: true,
    },
  ],
}

const PL051 = {
  asset_no: 'PL051',
  owning_country: null,
  ownership_basis: 'contested_concurrent',
  ownership_confidence: 'none',
  country_count: 2,
  concurrent_months: 44,
  transferred_from: null,
  identity_conflict: false,
  registration_country: null,
  countries: [
    {
      country: 'Egypt', currency: 'EGP', cost: 324303, tyre_cost: 0, rows: 365,
      months_active: 45, first_date: '2022-03-14', last_date: '2026-07-18',
      is_owner: false, bears_cost_for_other_country: false,
    },
    {
      country: 'KSA', currency: 'SAR', cost: 51535, tyre_cost: 0, rows: 262,
      months_active: 44, first_date: '2022-01-27', last_date: '2026-07-04',
      is_owner: false, bears_cost_for_other_country: false,
    },
  ],
}

const MP057 = {
  asset_no: 'MP057',
  owning_country: 'Egypt',
  ownership_basis: 'dominant_operator',
  ownership_confidence: 'medium',
  country_count: 2,
  concurrent_months: 0,
  transferred_from: null,
  identity_conflict: false,
  registration_country: null,
  countries: [
    {
      country: 'Egypt', currency: 'EGP', cost: 1565825, tyre_cost: 0, rows: 645,
      months_active: 57, first_date: '2021-09-30', last_date: '2026-07-23',
      is_owner: true, bears_cost_for_other_country: false,
    },
    {
      country: 'KSA', currency: 'SAR', cost: 201, tyre_cost: 0, rows: 2,
      months_active: 1, first_date: '2020-08-18', last_date: '2020-08-18',
      is_owner: false, bears_cost_for_other_country: true,
    },
  ],
}

const TM241 = {
  asset_no: 'TM241',
  owning_country: 'Egypt',
  ownership_basis: 'single_country',
  ownership_confidence: 'high',
  country_count: 1,
  concurrent_months: 0,
  transferred_from: null,
  identity_conflict: false,
  registration_country: null,
  countries: [
    {
      country: 'Egypt', currency: 'EGP', cost: 873102.23, tyre_cost: 338454.94, rows: 525,
      months_active: 51, first_date: '2021-10-31', last_date: '2026-04-22',
      is_owner: true, bears_cost_for_other_country: false,
    },
  ],
}

const TM514 = {
  asset_no: 'TM514',
  owning_country: null,
  ownership_basis: 'contested_concurrent',
  ownership_confidence: 'none',
  country_count: 2,
  concurrent_months: 22,
  transferred_from: null,
  identity_conflict: false,
  registration_country: 'KSA',
  countries: [
    {
      country: 'UAE', currency: 'AED', cost: 73497.29, tyre_cost: 54359.37, rows: 263,
      months_active: 28, first_date: '2024-03-14', last_date: '2026-07-16',
      is_owner: false, bears_cost_for_other_country: false,
    },
    {
      country: 'KSA', currency: 'SAR', cost: 36525.45, tyre_cost: 30583, rows: 156,
      months_active: 26, first_date: '2023-08-13', last_date: '2026-07-24',
      is_owner: false, bears_cost_for_other_country: false,
    },
  ],
}

const PAYLOAD = {
  ok: true,
  generated_at: '2026-07-27T00:00:00Z',
  rule: 'A country owns an asset when it is the only country operating it, ...',
  basis_of_evidence: 'Operating history in the expense ledger.',
  summary: {
    assets_total: 1300,
    cross_country: 221,
    single_country: 1079,
    dominant_operator: 29,
    sequential_transfer: 136,
    contested: 56,
    unknown: 56,
    identity_conflicts: 10,
    by_country: [
      { country: 'Egypt', currency: 'EGP', own_asset_cost: 76474635.92, foreign_owned_cost: 571704.54, contested_cost: 2295087.58, total_cost: 79341428.04, foreign_owned_assets: 4 },
      { country: 'KSA', currency: 'SAR', own_asset_cost: 36907637.46, foreign_owned_cost: 1628997.74, contested_cost: 2071714.45, total_cost: 40608349.65, foreign_owned_assets: 144 },
      { country: 'UAE', currency: 'AED', own_asset_cost: 17213213.59, foreign_owned_cost: 92145.45, contested_cost: 1188182.34, total_cost: 18493541.38, foreign_owned_assets: 17 },
    ],
  },
  assets: [MP069, PL051, MP057, TM241],
}

// ── currencies are never summed ───────────────────────────────────────────────

describe('currencies are never summed', () => {
  it('groups a mixed-currency asset into one total per currency, never one number', () => {
    const a = normalizeAsset(MP069)
    const totals = totalsByCurrency(a.countries)
    expect(totals).toEqual([
      { currency: 'AED', total: 241542.9, count: 1 },
      { currency: 'SAR', total: 29108.86, count: 1 },
    ])
    // the blended figure that must never appear anywhere
    const blended = 241542.9 + 29108.86
    expect(totals.some((t) => t.total === blended)).toBe(false)
  })

  it('keeps each country total distinct in the summary rather than a group total', () => {
    const p = normalizeOwnership(PAYLOAD)
    expect(p.summary.byCountry.map((c) => [c.currency, c.totalCost])).toEqual([
      ['EGP', 79341428.04],
      ['SAR', 40608349.65],
      ['AED', 18493541.38],
    ])
    // each country's split reconciles to its own total, in its own currency
    for (const c of p.summary.byCountry) {
      expect(c.ownAssetCost + c.foreignOwnedCost + c.contestedCost).toBeCloseTo(c.totalCost, 2)
    }
  })

  it('reports foreign borne cost per currency across a mixed set of assets', () => {
    const p = normalizeOwnership(PAYLOAD)
    // MP069 -> KSA bears 29,108.86 SAR for UAE; MP057 -> KSA bears 201 SAR for Egypt
    expect(foreignBorneByCurrency(p.assets)).toEqual([
      { currency: 'SAR', total: 29309.86, count: 2 },
    ])
  })

  it('labels an unmapped currency rather than folding it into another', () => {
    expect(totalsByCurrency([{ currency: '', cost: 10 }, { currency: 'SAR', cost: 5 }])).toEqual([
      { currency: 'N/A', total: 10, count: 1 },
      { currency: 'SAR', total: 5, count: 1 },
    ])
  })
})

// ── no ownership evidence returns unknown, never a guess ──────────────────────

describe('an asset with no ownership evidence returns unknown, not a guess', () => {
  it('PL051 bills concurrently for 44 months, so no owner is named', () => {
    const a = normalizeAsset(PL051)
    expect(a.owningCountry).toBeNull()
    expect(a.owningCountryLabel).toBe(UNKNOWN_OWNER)
    expect(a.basis).toBe('contested_concurrent')
    expect(basisMeta(a.basis).decides).toBe(false)
    expect(a.confidence).toBe('none')
  })

  it('does not label either country foreign when there is no owner', () => {
    // calling one side "foreign" would assert the ownership we just refused to name
    const split = costBearingSplit(normalizeAsset(PL051))
    expect(split.owner).toEqual([])
    expect(split.foreign).toEqual([])
    expect(split.contested.map((c) => c.country)).toEqual(['Egypt', 'KSA'])
    expect(foreignBorneByCurrency([normalizeAsset(PL051)])).toEqual([])
  })

  it('explains the refusal with the concurrent month count', () => {
    expect(ownershipExplanation(normalizeAsset(PL051))).toContain('44 months')
  })

  it('falls back to unknown for an unrecognised or missing basis', () => {
    const a = normalizeAsset({ asset_no: 'X1', ownership_basis: 'something_new' })
    expect(a.basis).toBe('unknown')
    expect(a.owningCountryLabel).toBe(UNKNOWN_OWNER)
    expect(basisMeta('nope')).toBe(OWNERSHIP_BASIS.unknown)
  })

  it('degrades an unauthorised or malformed payload to an empty, safe shape', () => {
    for (const bad of [null, undefined, {}, { ok: false, reason: 'unauthorized' }, 'nope']) {
      const p = normalizeOwnership(bad)
      expect(p.ok).toBe(false)
      expect(p.assets).toEqual([])
      expect(p.summary.byCountry).toEqual([])
      expect(p.summary.assetsTotal).toBe(0)
    }
  })
})

// ── a single-country asset behaves exactly as before ──────────────────────────

describe('an asset present in one country only behaves unchanged', () => {
  it('names its only country as owner with high confidence', () => {
    const a = normalizeAsset(TM241)
    expect(a.owningCountry).toBe('Egypt')
    expect(a.basis).toBe('single_country')
    expect(a.confidence).toBe('high')
    expect(a.isCrossCountry).toBe(false)
    expect(a.concurrentMonths).toBe(0)
  })

  it('has no foreign borne cost and no contested cost', () => {
    const split = costBearingSplit(normalizeAsset(TM241))
    expect(split.owner.map((c) => [c.country, c.currency, c.cost])).toEqual([['Egypt', 'EGP', 873102.23]])
    expect(split.foreign).toEqual([])
    expect(split.contested).toEqual([])
  })

  it('is excluded by the cross-country filter but kept by the default view', () => {
    const p = normalizeOwnership(PAYLOAD)
    expect(filterAssets(p.assets, {}).map((a) => a.assetNo)).toEqual(['MP069', 'PL051', 'MP057', 'TM241'])
    expect(filterAssets(p.assets, { crossOnly: true }).map((a) => a.assetNo)).toEqual(['MP069', 'PL051', 'MP057'])
  })
})

// ── registration must never decide ownership ──────────────────────────────────

describe('a KSA registration does not win ownership on its own', () => {
  it('TM514 stays contested even though only KSA holds a registration for it', () => {
    // registration_no exists for 391 fleet rows and every one is KSA, so a rule
    // that trusted it would hand KSA every contested asset in the fleet
    const a = normalizeAsset(TM514)
    expect(a.registrationCountry).toBe('KSA')
    expect(a.owningCountry).toBeNull()
    expect(a.owningCountryLabel).toBe(UNKNOWN_OWNER)
    expect(a.basis).toBe('contested_concurrent')
    expect(a.concurrentMonths).toBe(22)
  })

  it('still surfaces the registration to the reviewer as context', () => {
    const [row] = ownershipExportRows([normalizeAsset(TM514)])
    expect(row.owning_country).toBe(UNKNOWN_OWNER)
    expect(row.cost_by_country).toBe('UAE 73,497 AED  |  KSA 36,525 SAR')
  })
})

// ── transfer and dominance ────────────────────────────────────────────────────

describe('transfer and dominance', () => {
  it('MP069 transferred KSA to UAE and the current holder owns it', () => {
    const a = normalizeAsset(MP069)
    expect(a.owningCountry).toBe('UAE')
    expect(a.basis).toBe('sequential_transfer')
    expect(a.transferredFrom).toBe('KSA')
    expect(a.concurrentMonths).toBe(0)
    expect(ownershipExplanation(a)).toBe(
      'Moved from KSA to UAE with no overlapping month, so UAE holds it now.',
    )
  })

  it('MP069 shows KSA as bearing cost for another country, in SAR', () => {
    const { owner, foreign } = costBearingSplit(normalizeAsset(MP069))
    expect(owner.map((c) => [c.country, c.currency, c.cost])).toEqual([['UAE', 'AED', 241542.9]])
    expect(foreign.map((c) => [c.country, c.currency, c.cost])).toEqual([['KSA', 'SAR', 29108.86]])
  })

  it('MP057 gives the stray 2-line KSA tail to the dominant Egypt operator', () => {
    const a = normalizeAsset(MP057)
    expect(a.owningCountry).toBe('Egypt')
    expect(a.basis).toBe('dominant_operator')
    const { foreign } = costBearingSplit(a)
    expect(foreign.map((c) => [c.country, c.cost, c.rows])).toEqual([['KSA', 201, 2]])
  })
})

// ── filters and export ────────────────────────────────────────────────────────

describe('filters and export', () => {
  it('filters by basis, country, search and identity conflict', () => {
    const p = normalizeOwnership(PAYLOAD)
    expect(filterAssets(p.assets, { basis: 'contested_concurrent' }).map((a) => a.assetNo)).toEqual(['PL051'])
    expect(filterAssets(p.assets, { country: 'UAE' }).map((a) => a.assetNo)).toEqual(['MP069'])
    expect(filterAssets(p.assets, { query: 'mp0' }).map((a) => a.assetNo)).toEqual(['MP069', 'MP057'])
    expect(filterAssets(p.assets, { conflictsOnly: true })).toEqual([])
    expect(filterAssets(null, {})).toEqual([])
  })

  it('exports cost per country as text so no two currencies are added', () => {
    const [row] = ownershipExportRows([normalizeAsset(MP069)])
    expect(row.asset_no).toBe('MP069')
    expect(row.owning_country).toBe('UAE')
    expect(row.cost_by_country).toBe('UAE 241,543 AED  |  KSA 29,109 SAR')
    expect(row.cost_borne_for_other_country).toBe('KSA 29,109 SAR')
  })

  it('writes N/A rather than a blank for a contested or empty asset', () => {
    const [row] = ownershipExportRows([normalizeAsset(PL051)])
    expect(row.owning_country).toBe(UNKNOWN_OWNER)
    expect(row.transferred_from).toBe('N/A')
    expect(row.cost_borne_for_other_country).toBe('N/A')
  })
})
