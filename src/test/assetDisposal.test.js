import { describe, it, expect } from 'vitest'
import {
  DISPOSITIONS,
  DISPOSAL_STATUSES,
  CONDITIONS,
  REGIONS,
  VERDICTS,
  IDLE_JOB_CARD_DAYS,
  dispositionMeta,
  disposalStatusMeta,
  conditionMeta,
  regionMeta,
  shapeDisposalRegister,
  normalizeServerTotals,
  meterBasis,
  meterUnread,
  assetAge,
  spendBaselines,
  assetEconomics,
  filterDisposals,
  disposalSummary,
  byGroup,
  ageBands,
  disposalExportRows,
  disposalFindings,
} from '../lib/assetDisposal'

// Pinned "now" so ages and idle windows never drift with the wall clock.
const NOW = Date.parse('2026-08-12T00:00:00Z')

/** A committee row with the shape the RPC returns. */
function row(over = {}) {
  return {
    asset_no: 'TM100',
    sr_no: 1,
    register_status: 'SCRAP',
    region: 'C-REGION',
    asset_type: 'M-PUMP',
    model_year: 2014,
    brand: 'SANY',
    condition: 'Running',
    disposition: 'scrap',
    site: 'RIYADH',
    remarks: '',
    meter_text: 'KM 120140',
    meter_km: 120140,
    meter_hours: null,
    estimated_value: null,
    sale_proceeds: null,
    currency: 'SAR',
    status: 'proposed',
    in_register: true,
    fleet_status: 'Active',
    fleet_model_year: null,
    job_cards: 60,
    first_job_card: '2019-01-04',
    last_job_card: '2026-07-30',
    spend: 60000,
    tyres_total: 0,
    tyres_active: 0,
    serials: [],
    ...over,
  }
}

/** BP022 / BP023 / TM192: on the committee list, never entered in KSA. */
const notRegistered = row({
  asset_no: 'BP022',
  asset_type: 'BT-PLANT',
  in_register: false,
  fleet_status: null,
  job_cards: 0,
  first_job_card: null,
  last_job_card: null,
  spend: null,
  meter_text: 'N/A',
  meter_km: null,
  model_year: null,
  tyres_total: 0,
  tyres_active: 0,
})

/** A machine whose meter box was filled in but produced no number. */
const meterBroken = row({
  asset_no: 'TIP044',
  asset_type: 'TIPPER TRAILER',
  meter_text: 'Km Not working',
  meter_km: null,
  meter_hours: null,
  spend: 40000,
})

/** Hour-metered plant. */
const hoursOnly = row({
  asset_no: 'GEN012',
  asset_type: 'GENERATOR',
  meter_text: '9000 H',
  meter_km: null,
  meter_hours: 9000,
  spend: 45000,
})

/** MP049 carries BOTH a km and an hour reading; 'both' is a real state. */
const bothMeters = row({
  asset_no: 'MP049',
  asset_type: 'M-PUMP',
  meter_text: '23019 H  / KM 120140',
  meter_km: 120140,
  meter_hours: 23019,
  spend: 230190,
})

/** Ten of the assets still have tyres fitted, with real serials. */
const withTyres = row({
  asset_no: 'TIP009',
  asset_type: 'TIPPER TRAILER',
  disposition: 'sell',
  region: 'W-REGION',
  tyres_total: 6,
  tyres_active: 4,
  serials: [
    { serial: 'A1234', position: 'LHF1', brand: 'TRIANGLE', size: '315/80R22.5', fitted: '2024-02-01', km: 30000 },
    { serial: 'A1235', position: 'RHF1', brand: 'TRIANGLE', size: '315/80R22.5', fitted: '2024-02-01', km: 30000 },
    { serial: 'A1236', position: 'LHR1', brand: 'TRIANGLE', size: '315/80R22.5', fitted: '2024-02-01', km: 30000 },
    { serial: 'A1237', position: 'RHR1', brand: 'TRIANGLE', size: '315/80R22.5', fitted: '2024-02-01', km: 30000 },
  ],
})

describe('vocabulary', () => {
  it('covers every value the register can carry', () => {
    expect(Object.keys(DISPOSITIONS).sort()).toEqual(['scrap', 'sell', 'undecided'])
    expect(Object.keys(DISPOSAL_STATUSES).sort()).toEqual(['approved', 'disposed', 'proposed', 'rejected'])
    expect(Object.keys(CONDITIONS)).toContain('Missing Parts')
    expect(Object.keys(CONDITIONS)).toContain('Major Accident')
    expect(Object.keys(REGIONS).sort()).toEqual(['C-REGION', 'W-REGION'])
    expect(Object.keys(VERDICTS)).toContain('never-registered')
  })

  it('never renders a blank for an unknown or missing value', () => {
    expect(dispositionMeta('scrap').label).toBe('Scrap')
    expect(dispositionMeta('').label).toBe('Not recorded')
    expect(dispositionMeta('mystery').label).toBe('mystery')
    expect(disposalStatusMeta('disposed').tone).toBe('good')
    expect(conditionMeta('Dismantled').tone).toBe('danger')
    expect(regionMeta('W-REGION').label).toBe('Western region')
    expect(regionMeta(null).label).toBe('Not recorded')
  })

  it('carries no dash punctuation or curly quotes in any user-facing string', () => {
    const strings = [
      ...Object.values(DISPOSITIONS),
      ...Object.values(DISPOSAL_STATUSES),
      ...Object.values(CONDITIONS),
      ...Object.values(REGIONS),
      ...Object.values(VERDICTS),
    ].flatMap((m) => [m.label, m.note].filter(Boolean))
    for (const s of strings) expect(s).not.toMatch(/[‐-―‘’“”→]/)
  })
})

describe('shapeDisposalRegister', () => {
  it('a failed read is not an empty register', () => {
    const failed = shapeDisposalRegister({ ok: false, reason: 'forbidden' })
    expect(failed.ok).toBe(false)
    expect(failed.reason).toBe('forbidden')
    expect(failed.rows).toEqual([])

    const missing = shapeDisposalRegister(null)
    expect(missing.ok).toBe(false)
    expect(missing.reason).toBe('unavailable')
  })

  it('an empty register is ok with zero rows and no reason', () => {
    const empty = shapeDisposalRegister({ ok: true, country: 'KSA', rows: [], totals: null })
    expect(empty.ok).toBe(true)
    expect(empty.reason).toBeNull()
    expect(empty.rows).toEqual([])
    expect(empty.totals.assets).toBe(0)
    expect(empty.totals.lifetimeSpend).toBeNull()
    expect(empty.totals.avgAgeYears).toBeNull()
  })

  it('recomputes totals from the rows and keeps the server totals for reconciling', () => {
    const shaped = shapeDisposalRegister({
      ok: true,
      country: 'KSA',
      rows: [row(), notRegistered],
      totals: { assets: 37, to_scrap: 27, to_sell: 10, lifetime_spend: 2260917, job_cards: 2026, active_tyres: 37 },
    })
    expect(shaped.rows).toHaveLength(2)
    expect(shaped.totals.assets).toBe(2)
    expect(shaped.serverTotals.assets).toBe(37)
    expect(shaped.serverTotals.toScrap).toBe(27)
    expect(shaped.serverTotals.lifetimeSpend).toBe(2260917)
  })

  it('normalizeServerTotals returns null when there is nothing to normalize', () => {
    expect(normalizeServerTotals(null)).toBeNull()
  })
})

describe('meters', () => {
  it('classifies km, hours, both and unreadable', () => {
    expect(meterBasis(row())).toBe('km')
    expect(meterBasis(hoursOnly)).toBe('hours')
    expect(meterBasis(bothMeters)).toBe('both')
    expect(meterBasis(meterBroken)).toBe('none')
    expect(meterUnread(meterBroken)).toBe(true)
    expect(meterUnread(row())).toBe(false)
  })

  it('treats a zero meter as unread rather than as a real reading', () => {
    expect(meterBasis(row({ meter_km: 0 }))).toBe('none')
  })
})

describe('assetAge', () => {
  it('prefers the committee year and reports its basis', () => {
    expect(assetAge(row({ model_year: 2014 }), { now: NOW })).toEqual({
      ageYears: 12, modelYear: 2014, basis: 'committee',
    })
    expect(assetAge(row({ model_year: null, fleet_model_year: 2020 }), { now: NOW })).toEqual({
      ageYears: 6, modelYear: 2020, basis: 'register',
    })
  })

  it('is null, not zero, when no year is recorded anywhere', () => {
    const a = assetAge(row({ model_year: null, fleet_model_year: null }), { now: NOW })
    expect(a.ageYears).toBeNull()
    expect(a.basis).toBeNull()
  })
})

describe('assetEconomics', () => {
  it('works out per-year and per-km cost for a km machine', () => {
    const e = assetEconomics(row(), { now: NOW })
    expect(e.ageYears).toBe(12)
    expect(e.spendPerYear).toBe(5000)
    expect(e.spendPerKm).toBe(0.499)
    expect(e.spendPerHour).toBeNull()
    expect(e.verdict).toBe('in-use')
  })

  it('refuses a rate when the meter could not be read', () => {
    const e = assetEconomics(meterBroken, { now: NOW })
    expect(e.meterBasis).toBe('none')
    expect(e.meterUnread).toBe(true)
    expect(e.meterText).toBe('Km Not working')
    expect(e.spendPerKm).toBeNull()
    expect(e.spendPerHour).toBeNull()
    // The totals it does have are still real.
    expect(e.spend).toBe(40000)
    expect(e.basis).toMatch(/meter could not be read/)
  })

  it('rates an hour-metered machine per hour and never per km', () => {
    const e = assetEconomics(hoursOnly, { now: NOW })
    expect(e.spendPerHour).toBe(5)
    expect(e.spendPerKm).toBeNull()
  })

  it('rates MP049 on both meters because it carries both readings', () => {
    const e = assetEconomics(bothMeters, { now: NOW })
    expect(e.meterBasis).toBe('both')
    expect(e.spendPerKm).toBeGreaterThan(0)
    expect(e.spendPerHour).toBe(10)
  })

  it('marks a machine the register never held and reads nothing into its silence', () => {
    const e = assetEconomics(notRegistered, { now: NOW })
    expect(e.inRegister).toBe(false)
    expect(e.verdict).toBe('never-registered')
    expect(e.spend).toBeNull()
    expect(e.spendPerYear).toBeNull()
    expect(e.ageYears).toBeNull()
    expect(e.fleetStatus).toBeNull()
    expect(e.basis).toMatch(/Not in the fleet register/)
  })

  it('never invents a value or a saving', () => {
    const e = assetEconomics(row(), { now: NOW })
    expect(e.estimatedValue).toBeNull()
    expect(e.saleProceeds).toBeNull()
    expect(e).not.toHaveProperty('savings')
    expect(e).not.toHaveProperty('scrapValue')
  })

  it('names the tyres still fitted so somebody can go and recover them', () => {
    const e = assetEconomics(withTyres, { now: NOW })
    expect(e.tyresActive).toBe(4)
    expect(e.costRecoveryNote).toMatch(/4 tyres still fitted/)
    expect(e.costRecoveryNote).toMatch(/4 with a recorded serial/)
    expect(assetEconomics(row(), { now: NOW }).costRecoveryNote).toBeNull()
  })

  it('flags a machine with no job card for over a year as idle', () => {
    const e = assetEconomics(row({ last_job_card: '2024-01-01' }), { now: NOW })
    expect(e.daysSinceJobCard).toBeGreaterThan(IDLE_JOB_CARD_DAYS)
    expect(e.verdict).toBe('idle')
  })

  it('calls a machine heavy-spending ONLY against its own class median', () => {
    const heavy = row({ spend: 600000 })
    const noPeer = assetEconomics(heavy, { now: NOW })
    expect(noPeer.verdict).toBe('in-use')
    expect(noPeer.basis).toMatch(/no class median available/)

    const withPeer = assetEconomics(heavy, { now: NOW, peerSpendPerYear: 5000 })
    expect(withPeer.verdict).toBe('heavy-spend')
    expect(withPeer.flags).toContain('heavy-spend')
  })

  it('reports a registered machine with no job cards as history-less, not idle', () => {
    const e = assetEconomics(row({ job_cards: 0, last_job_card: null, spend: null }), { now: NOW })
    expect(e.verdict).toBe('no-history')
    expect(e.daysSinceJobCard).toBeNull()
  })
})

describe('spendBaselines', () => {
  it('uses a median and refuses a class of one', () => {
    const rows = [
      row({ asset_type: 'M-PUMP', spend: 12000, model_year: 2014 }),
      row({ asset_type: 'M-PUMP', spend: 24000, model_year: 2014 }),
      row({ asset_type: 'M-PUMP', spend: 120000, model_year: 2014 }),
      row({ asset_type: 'BUS', spend: 60000, model_year: 2014 }),
    ]
    const base = spendBaselines(rows, { now: NOW })
    expect(base['M-PUMP']).toBe(2000) // median of 1000 / 2000 / 10000 per year
    expect(base.BUS).toBeNull()
  })
})

describe('filterDisposals', () => {
  const rows = [row(), notRegistered, withTyres, hoursOnly]

  it('filters by every facet', () => {
    expect(filterDisposals(rows, { disposition: 'sell' })).toHaveLength(1)
    expect(filterDisposals(rows, { region: 'W-REGION' })).toHaveLength(1)
    expect(filterDisposals(rows, { assetType: 'GENERATOR' })).toHaveLength(1)
    expect(filterDisposals(rows, { status: 'proposed' })).toHaveLength(4)
    expect(filterDisposals(rows, { condition: 'Running' })).toHaveLength(4)
    expect(filterDisposals(rows, { site: 'RIYADH' })).toHaveLength(4)
    expect(filterDisposals(rows, { site: 'JEDDAH' })).toHaveLength(0)
  })

  it('treats inRegister as tri-state', () => {
    expect(filterDisposals(rows, { inRegister: 'all' })).toHaveLength(4)
    expect(filterDisposals(rows, { inRegister: 'yes' })).toHaveLength(3)
    expect(filterDisposals(rows, { inRegister: 'no' })[0].asset_no).toBe('BP022')
  })

  it('filters by downtime, keeping "no record" as its own answer', () => {
    // The three states are genuinely different: down now, down a long time, and
    // nobody has told us anything. Folding the third into "not down" would let
    // a machine we know nothing about pass as healthy.
    const withDowntime = [
      { ...row(), breakdown: { open: 1, currentDays: 5 } },
      { ...notRegistered, breakdown: { open: 1, currentDays: 218 } },
      { ...withTyres, breakdown: { open: 0, breakdowns: 2 } },
      hoursOnly,
    ]
    expect(filterDisposals(withDowntime, { downtime: 'down' })).toHaveLength(2)
    expect(filterDisposals(withDowntime, { downtime: 'long' })).toHaveLength(1)
    expect(filterDisposals(withDowntime, { downtime: 'unknown' })).toHaveLength(1)
    expect(filterDisposals(withDowntime, { downtime: '' })).toHaveLength(4)
  })

  it('searches asset, brand, type, site and tyre serials', () => {
    expect(filterDisposals(rows, { search: 'bp022' })).toHaveLength(1)
    expect(filterDisposals(rows, { search: 'sany' })).toHaveLength(4)
    expect(filterDisposals(rows, { search: 'generator' })).toHaveLength(1)
    expect(filterDisposals(rows, { search: 'A1236' })[0].asset_no).toBe('TIP009')
    expect(filterDisposals(rows, { search: 'nothing here' })).toHaveLength(0)
  })

  it('is safe on a missing list', () => {
    expect(filterDisposals(null, {})).toEqual([])
    expect(filterDisposals(rows)).toHaveLength(4)
  })
})

describe('disposalSummary', () => {
  it('counts the register the way the committee reads it', () => {
    const rows = [row(), notRegistered, withTyres, hoursOnly]
    const s = disposalSummary(rows)
    expect(s.assets).toBe(4)
    expect(s.toScrap).toBe(3)
    expect(s.toSell).toBe(1)
    expect(s.inRegister).toBe(3)
    expect(s.notInRegister).toBe(1)
    expect(s.stillActive).toBe(3)
    expect(s.jobCards).toBe(180)
    expect(s.activeTyres).toBe(4)
    expect(s.meterUnreadable).toBe(1) // the not-registered row has no meter
    expect(s.lifetimeSpend).toBe(165000)
    expect(s.currency).toBe('SAR')
    expect(s.mixedCurrency).toBe(false)
  })

  it('averages age only over the machines that have a year, and says how many', () => {
    const s = disposalSummary([row({ model_year: 2014 }), row({ model_year: 2006 }), notRegistered])
    expect(s.avgAgeYears).toBe(16) // (12 + 20) / 2
    expect(s.agedKnown).toBe(2)
  })

  it('reports value as unmeasured rather than zero when nobody valued anything', () => {
    const s = disposalSummary([row(), notRegistered])
    expect(s.estimatedValue).toBeNull()
    expect(s.valued).toBe(0)
    expect(s.notValued).toBe(2)
  })

  it('never blends currencies', () => {
    const s = disposalSummary([
      row({ spend: 100, currency: 'SAR' }),
      row({ spend: 50, currency: 'AED' }),
    ])
    expect(s.lifetimeSpend).toBeNull()
    expect(s.mixedCurrency).toBe(true)
    expect(s.currency).toBeNull()
    expect(s.money.spend.byCurrency).toEqual({ SAR: 100, AED: 50 })
  })

  it('is safe and honest on an empty list', () => {
    const s = disposalSummary([])
    expect(s.assets).toBe(0)
    expect(s.avgAgeYears).toBeNull()
    expect(s.lifetimeSpend).toBeNull()
  })
})

describe('byGroup', () => {
  it('groups, totals and sorts by count', () => {
    const g = byGroup([row(), row({ asset_no: 'TM101' }), hoursOnly], 'asset_type')
    expect(g[0]).toMatchObject({ key: 'M-PUMP', count: 2, spend: 120000, jobCards: 120 })
    expect(g[1].key).toBe('GENERATOR')
  })

  it('labels regions and dispositions in plain English and buckets blanks explicitly', () => {
    const g = byGroup([row({ region: 'W-REGION' }), row({ region: null })], 'region')
    expect(g.map((x) => x.label).sort()).toEqual(['Not recorded', 'Western region'])
  })

  it('refuses a key it does not group by', () => {
    expect(byGroup([row()], 'remarks')).toEqual([])
  })

  it('returns a null group total when a group mixes currencies', () => {
    const g = byGroup([row({ spend: 10, currency: 'SAR' }), row({ spend: 5, currency: 'AED' })], 'asset_type')
    expect(g[0].spend).toBeNull()
    expect(g[0].mixedCurrency).toBe(true)
  })
})

describe('ageBands', () => {
  it('keeps unknown as its own band and never folds it into a number', () => {
    const bands = ageBands([
      row({ model_year: 2024 }), // 2
      row({ model_year: 2021 }), // 5
      row({ model_year: 2017 }), // 9
      row({ model_year: 2006 }), // 20
      notRegistered,             // no year
    ], { now: NOW })
    const by = Object.fromEntries(bands.map((b) => [b.key, b.count]))
    expect(by['0-3']).toBe(1)
    expect(by['4-6']).toBe(1)
    expect(by['7-10']).toBe(1)
    expect(by['10+']).toBe(1)
    expect(by.unknown).toBe(1)
    expect(bands.find((b) => b.key === 'unknown').label).toBe('Year not recorded')
  })

  it('returns every band even for an empty register', () => {
    expect(ageBands([]).map((b) => b.count)).toEqual([0, 0, 0, 0, 0])
  })
})

describe('disposalExportRows', () => {
  it('carries the serials into the download', () => {
    const { head, body, columns, rows } = disposalExportRows([withTyres], { now: NOW })
    expect(head).toContain('Fitted tyre serials')
    expect(head.length).toBe(columns.length)
    expect(body[0].length).toBe(head.length)
    expect(rows[0].serials).toBe('A1234 | A1235 | A1236 | A1237')
  })

  it('prints an honest word rather than a zero for anything missing', () => {
    const { rows } = disposalExportRows([notRegistered], { now: NOW })
    expect(rows[0].in_register).toBe('No')
    expect(rows[0].fleet_status).toBe('Not in register')
    expect(rows[0].spend).toBe('N/A')
    expect(rows[0].estimated_value).toBe('Not valued')
    expect(rows[0].model_year).toBe('N/A')
    expect(rows[0].serials).toBe('None')
  })

  it('leaves the meter cell exactly as it was written', () => {
    const { rows } = disposalExportRows([meterBroken], { now: NOW })
    expect(rows[0].meter_text).toBe('Km Not working')
    expect(rows[0].spend_per_km).toBe('N/A')
  })

  it('handles an empty register', () => {
    const out = disposalExportRows([])
    expect(out.body).toEqual([])
    expect(out.head.length).toBeGreaterThan(0)
  })
})

describe('disposalFindings', () => {
  it('says nothing when there is nothing to say', () => {
    expect(disposalFindings([], null, { now: NOW })).toEqual([])
  })

  it('leads on machines still counted as live fleet', () => {
    const rows = [row(), notRegistered, withTyres, meterBroken]
    const f = disposalFindings(rows, disposalSummary(rows), { now: NOW })
    const keys = f.map((x) => x.key)
    expect(keys).toContain('still-active')
    expect(keys).toContain('not-in-register')
    expect(keys).toContain('tyres-fitted')
    expect(keys).toContain('meter-unreadable')
    expect(keys).toContain('top-spend')
    expect(f.find((x) => x.key === 'not-in-register').text).toMatch(/BP022/)
    expect(f.find((x) => x.key === 'still-active').tone).toBe('danger')
  })

  it('names the biggest spender with its own currency', () => {
    const rows = [row({ asset_no: 'A', spend: 10 }), row({ asset_no: 'B', spend: 900000, job_cards: 300 })]
    const f = disposalFindings(rows, null, { now: NOW })
    const top = f.find((x) => x.key === 'top-spend')
    expect(top.text).toMatch(/^B carries the most/)
    expect(top.text).toMatch(/SAR/)
    expect(top.text).toMatch(/300 job cards/)
  })

  it('reports idle machines separately from unregistered ones', () => {
    const f = disposalFindings([row({ last_job_card: '2023-05-01' })], null, { now: NOW })
    expect(f.map((x) => x.key)).toContain('idle')
  })

  it('writes no dash punctuation or curly quotes', () => {
    const rows = [row(), notRegistered, withTyres, meterBroken]
    for (const f of disposalFindings(rows, null, { now: NOW })) {
      expect(f.text).not.toMatch(/[‐-―‘’“”→]/)
    }
  })
})
