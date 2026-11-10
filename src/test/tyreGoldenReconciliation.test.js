/**
 * Golden reconciliation: every authoritative JS tyre engine is run over ONE
 * hand-computed dataset (src/test/fixtures/tyreGolden.js) and must reproduce
 * the hand-computed figures, and must AGREE with every other engine on the same
 * tyre (same life, same price, same CPK, same distance) wherever both measure it.
 *
 * If a figure here changes, a business rule changed: argue it in
 * docs/tyre/BUSINESS_RULES.md, never just re-baseline the fixture.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import {
  GOLDEN_ROWS, GOLDEN_ROW_KM, GOLDEN_TYRES, GOLDEN_FLEET, GOLDEN_GROUPS,
  GOLDEN_RUNNING_ROWS, GOLDEN_RUNNING,
} from './fixtures/tyreGolden'
import {
  toLifetimeTyres, lifetimeCpk, weightedCpk, lifetimeSummary, withOnePricePerTyre,
  fitmentKm, tyreKey, hasLifetimeCpk, splitFinalProvisional,
} from '../lib/tyreLifetime'
import { tyreKmAssessment } from '../lib/tyreKm'
import {
  computeCpkFleet, computeCpkByBrand, computeCpkBySite, computeCpkByAsset,
  computeAvgTyreLife, computeFleetTyreLife, computeRemovalRate, computeScrapRate,
  computeCostTrend, computeVendorPerformance, computeFailureRate,
} from '../lib/kpiEngine'
import { shapeRunningLife, bandFor } from '../lib/tyreRunningLife'
import { computeAssetsActualTco } from '../lib/tco'
import { measuredKm } from '../lib/vendorIntelligenceAnalytics'
import { savingsOpportunity } from '../lib/executiveReportAnalytics'
import { averageTyreCost } from '../lib/rotationScheduleAnalytics'
import { recordKm as trackerRecordKm } from '../lib/serialTrackerView'
import { serialPrice, serialLifetime } from '../lib/serialTrackerAnalytics'
import { buildPassport } from '../lib/tyrePassport'

const rows = () => GOLDEN_ROWS.map((r) => ({ ...r }))
const byId = (id) => GOLDEN_ROWS.find((r) => r.id === id)
const close = (a, b, digits = 9) => expect(a).toBeCloseTo(b, digits)

describe('golden: per-fitment km rule (tyreKm.js, T7)', () => {
  it('every row is classified and measured as worked out by hand', () => {
    for (const r of GOLDEN_ROWS) {
      const exp = GOLDEN_ROW_KM[r.id]
      const a = tyreKmAssessment(r)
      expect([r.id, a.status]).toEqual([r.id, exp.status])
      expect([r.id, a.km]).toEqual([r.id, exp.km])
      expect([r.id, fitmentKm(r)]).toEqual([r.id, exp.km])
    }
  })
  it('placeholder 1 and over-cap are unknown, never the reported figure', () => {
    expect(tyreKmAssessment(byId('g4')).reportedKm).toBe(229999)
    expect(tyreKmAssessment(byId('g11'))).toMatchObject({ km: null, status: 'over_cap', cap: 80000, reportedKm: 100000 })
  })
})

describe('golden: physical tyres (toLifetimeTyres, T1/T8/T17/T18)', () => {
  const tyres = toLifetimeTyres(rows())
  it('collapses 19 fitment rows into exactly the 14 physical tyres expected', () => {
    expect(tyres).toHaveLength(GOLDEN_FLEET.tyres)
    expect(new Set(tyres.map((t) => t._key))).toEqual(new Set(Object.keys(GOLDEN_TYRES)))
  })
  for (const [key, exp] of Object.entries(GOLDEN_TYRES)) {
    it(`${key}: life, price, status, coverage, attribution`, () => {
      const t = tyres.find((x) => x._key === key)
      expect(t._life_km).toBe(exp.life)
      expect(t._cost).toBe(exp.cost)
      expect(t._qty).toBe(exp.qty)
      expect(t._cost_status).toBe(exp.status)
      expect(t._km_coverage).toBe(exp.coverage)
      expect(t._provisional).toBe(exp.provisional)
      expect(t._active).toBe(exp.active)
      expect(t._fitments).toBe(exp.fitments)
      expect(t._vehicles).toBe(exp.vehicles)
      expect(t._overlapping_fitments).toBe(exp.overlapping)
      expect(t._km_unknown_fitments).toBe(exp.unknownKm)
      expect(t.asset_no).toBe(exp.asset)
      expect(t.site).toBe(exp.site)
      expect(t.brand).toBe(exp.brand)
      if (exp.cpk == null) expect(lifetimeCpk(t)).toBeNull()
      else close(lifetimeCpk(t), exp.cpk)
    })
  }
  it('row order does not change any tyre (input order is not evidence)', () => {
    const reversed = toLifetimeTyres([...rows()].reverse())
    for (const t of tyres) {
      const r = reversed.find((x) => x._key === t._key)
      expect([t._key, r._cost, r._life_km, r._cost_status, r.asset_no]).toEqual([t._key, t._cost, t._life_km, t._cost_status, t.asset_no])
    }
  })
  it('missing is never zero: unknown life / cost stay null', () => {
    for (const t of tyres) {
      expect(t._life_km === 0).toBe(false)
      expect(t._cost === 0).toBe(false)
    }
  })
  it('summary: weighted CPK, coverage and cost-status counts', () => {
    const s = lifetimeSummary(tyres)
    expect(s.tyres).toBe(GOLDEN_FLEET.tyres)
    expect(s.measurable).toBe(GOLDEN_FLEET.measurable)
    expect(s.purchaseCost).toBe(GOLDEN_FLEET.cost)
    expect(s.km).toBe(GOLDEN_FLEET.km)
    close(s.cpkPurchase, GOLDEN_FLEET.cpk)
    expect(s.estimatedCostInCpk).toBe(GOLDEN_FLEET.estimatedCostInCpk)
    close(s.estimatedShare, GOLDEN_FLEET.estimatedShare)
    expect(s.coverage).toEqual(GOLDEN_FLEET.coverage)
    expect(s.costStatus).toEqual(GOLDEN_FLEET.costStatus)
    expect(s.provisional).toBe(GOLDEN_FLEET.provisional)
    expect(s.tyresWithOverlap).toBe(GOLDEN_FLEET.tyresWithOverlap)
    expect(s.refittedTyres).toBe(GOLDEN_FLEET.refittedTyres)
    close(weightedCpk(tyres), GOLDEN_FLEET.cpk)
  })
  it('final vs provisional split: only still-fitted tyres are provisional by activity', () => {
    const { final, provisional } = splitFinalProvisional(tyres)
    expect(provisional.map((t) => t._key).sort()).toEqual(['KSA|PRV120001', 'KSA|PRV120002'])
    expect(final).toHaveLength(12)
  })
})

describe('golden: kpiEngine', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2025-12-15T12:00:00Z')) })
  afterAll(() => { vi.useRealTimers() })

  it('fleet CPK is the weighted lifetime CPK', () => {
    const c = computeCpkFleet(rows())
    close(c.fleetAvgCpk, GOLDEN_FLEET.cpk)
    close(c.weightedCpk, GOLDEN_FLEET.cpk)
    expect(c.validCount).toBe(GOLDEN_FLEET.measurable)
    expect(c.totalCount).toBe(GOLDEN_FLEET.tyres)
    expect(c.fitmentRows).toBe(GOLDEN_FLEET.fitmentRows)
    expect(c.provisionalCount).toBe(GOLDEN_FLEET.provisional)
    expect(c.kmCoverage).toEqual(GOLDEN_FLEET.coverage)
    close(c.estimatedShare, GOLDEN_FLEET.estimatedShare)
    // meanCpk is the plain mean of the 8 per-tyre ratios (distribution only).
    const ratios = Object.values(GOLDEN_TYRES).map((t) => t.cpk).filter((v) => v != null)
    close(c.meanCpk, ratios.reduce((a, b) => a + b, 0) / ratios.length)
  })

  it('CPK by brand / site: weighted per group and reconciles to the fleet', () => {
    const brands = computeCpkByBrand(rows())
    for (const [brand, exp] of Object.entries(GOLDEN_GROUPS.brand)) {
      const g = brands.find((b) => b.brand === brand)
      close(g.avgCpk, exp.cost / exp.km)
      expect(g.validCount).toBe(exp.validCount)
      expect(g.count).toBe(exp.count)
    }
    const sites = computeCpkBySite(rows())
    for (const [site, exp] of Object.entries(GOLDEN_GROUPS.site)) {
      close(sites.find((s) => s.site === site).avgCpk, exp.cost / exp.km)
    }
    // Every measurable tyre sits in exactly one group, and the groups add back to the fleet.
    for (const groups of [brands, sites, computeCpkByAsset(rows())]) {
      expect(groups.reduce((s, g) => s + g.validCount, 0)).toBe(GOLDEN_FLEET.measurable)
    }
    const bCost = Object.values(GOLDEN_GROUPS.brand).reduce((s, g) => s + g.cost, 0)
    const bKm = Object.values(GOLDEN_GROUPS.brand).reduce((s, g) => s + g.km, 0)
    close(bCost / bKm, GOLDEN_FLEET.cpk)
  })

  it('CPK by asset follows the tyre to its latest vehicle (G7 on MP111, G2 on TM205)', () => {
    const assets = computeCpkByAsset(rows())
    close(assets.find((a) => a.asset_no === 'MP111').avgCpk, 766 / 15000)
    close(assets.find((a) => a.asset_no === 'TM205').avgCpk, 0.024)
    expect(assets.find((a) => a.asset_no === 'TM676')).toBeUndefined()
    expect(assets.find((a) => a.asset_no === 'TM102')).toBeUndefined()
  })

  it('average tyre life is per physical tyre and excludes unknown lives', () => {
    const l = computeAvgTyreLife(rows())
    expect(l.validCount).toBe(GOLDEN_FLEET.life.count)
    close(l.avgKm, GOLDEN_FLEET.life.avg, 6)
    expect(l.medianKm).toBe(GOLDEN_FLEET.life.median)
    expect(l.minKm).toBe(GOLDEN_FLEET.life.min)
    expect(l.maxKm).toBe(GOLDEN_FLEET.life.max)
    for (const [brand, avg] of Object.entries(GOLDEN_GROUPS.lifeByBrand)) {
      close(l.byBrand.find((b) => b.brand === brand).avgKm, avg, 6)
    }
    close(computeFleetTyreLife(rows()).avgKm, GOLDEN_FLEET.life.avg, 6)
  })

  it('no measurable life -> null, never 0 km (missing != zero)', () => {
    const none = [byId('g4'), byId('g11'), byId('g13')].map((r) => ({ ...r }))
    const l = computeAvgTyreLife(none)
    expect(l.validCount).toBe(0)
    expect(l.avgKm).toBeNull()
    expect(l.medianKm).toBeNull()
    expect(l.minKm).toBeNull()
    expect(l.maxKm).toBeNull()
    expect(computeFleetTyreLife(none).avgKm).toBeNull()
    expect(computeCpkFleet(none).fleetAvgCpk).toBeNull()
  })

  it('removal rate: placeholder and over-cap readings are not fleet distance', () => {
    const r = computeRemovalRate(rows())
    expect(r.totalRemovals).toBe(GOLDEN_FLEET.removal.stints)
    expect(r.estimatedFleetKm).toBe(GOLDEN_FLEET.removal.km)
    close(r.removalPer1000Km, GOLDEN_FLEET.removal.per1000)
  })

  it('scrap: per physical tyre, purchase cost once (same-day double price -> the id-first 766)', () => {
    const s = computeScrapRate(rows())
    expect(s.scrapCount).toBe(GOLDEN_FLEET.scrap.count)
    expect(s.totalCount).toBe(GOLDEN_FLEET.scrap.total)
    expect(s.scrapRows).toBe(GOLDEN_FLEET.scrap.rows)
    expect(s.estimatedScrapCost).toBe(GOLDEN_FLEET.scrap.cost)
  })

  it('cost trend: every physical tyre bought once', () => {
    const t = computeCostTrend(rows())
    expect(t.byMonth.reduce((s, m) => s + m.totalCost, 0)).toBe(GOLDEN_FLEET.purchaseSpend)
  })

  it('vendor performance: weighted CPK and scrap rate tagged the same way as computeScrapRate', () => {
    const v = computeVendorPerformance(rows())
    for (const [brand, exp] of Object.entries(GOLDEN_GROUPS.brand)) {
      close(v.find((x) => x.brand === brand).avgCpk, exp.cost / exp.km)
    }
    for (const [brand, rate] of Object.entries(GOLDEN_GROUPS.vendorScrapRate)) {
      close(v.find((x) => x.brand === brand).scrapRate, rate)
    }
  })

  it('failure rate is not measured on unrated data (null, not 0%)', () => {
    const f = computeFailureRate(rows())
    expect(f.failureRate).toBeNull()
    expect(f.ratedCount).toBe(0)
  })
})

describe('golden: running & remaining (tyreRunningLife)', () => {
  const shaped = shapeRunningLife({ ok: true, rows: GOLDEN_RUNNING_ROWS })
  it('current stint and band per still-fitted tyre', () => {
    for (const r of shaped.rows) {
      const exp = GOLDEN_RUNNING[r.serial]
      expect([r.serial, r.kmRun]).toEqual([r.serial, exp.kmRun])
      expect([r.serial, bandFor(r)]).toEqual([r.serial, exp.band])
    }
    expect(shaped.summary.measurableKm).toBe(2)
  })
  it('running km run = current odometer - the lifetime layer\'s current fitment odometer', () => {
    const tyres = toLifetimeTyres(rows())
    for (const r of shaped.rows) {
      const t = tyres.find((x) => x.serial_no === r.serial)
      if (!t) continue // PLC999999 is a running-only row
      expect(t._active).toBe(true)
      expect(t.km_at_fitment).toBe(r.kmAtFitment)
      expect(r.kmRun).toBe(r.currentKm - r.kmAtFitment)
    }
  })
  it('life to date = completed lifetime km + current stint, and stays under the class cap', () => {
    const tyres = toLifetimeTyres(rows())
    for (const r of shaped.rows) {
      const exp = GOLDEN_RUNNING[r.serial]
      const t = tyres.find((x) => x.serial_no === r.serial)
      if (!t) { expect(exp.lifeToDate).toBeNull(); continue }
      // No completed stint and nothing unknown -> the completed part is a real 0.
      const completed = t._life_km ?? (t._km_unknown_fitments === 0 ? 0 : null)
      const toDate = completed == null || r.kmRun == null ? null : completed + r.kmRun
      expect([r.serial, toDate]).toEqual([r.serial, exp.lifeToDate])
      expect(toDate).toBeLessThanOrEqual(80000)
    }
  })
})

describe('golden: cross-engine consistency (same tyre -> same numbers everywhere)', () => {
  const tyres = toLifetimeTyres(rows())
  const lifetimeSpend = tyres.reduce((s, t) => s + (t._cost ?? 0) * t._qty, 0)

  it('one price per tyre: withOnePricePerTyre, lifetime, TCO and rotation agree on total purchase', () => {
    expect(lifetimeSpend).toBe(GOLDEN_FLEET.purchaseSpend)
    const kept = withOnePricePerTyre(rows())
    expect(kept.reduce((s, r) => s + (Number(r.cost_per_tyre) > 0 ? r.cost_per_tyre * (r.qty || 1) : 0), 0)).toBe(lifetimeSpend)
    const tco = computeAssetsActualTco(rows())
    expect(tco.reduce((s, a) => s + a.tyre_procurement, 0)).toBe(lifetimeSpend)
    // 14 priced tyre units (G3 counts 2).
    close(averageTyreCost(rows()), lifetimeSpend / 14)
  })

  it('same-day double price: every engine keeps the SAME price regardless of input order', () => {
    const dup = GOLDEN_ROWS.filter((r) => r.serial_no === 'DUP700001').map((r) => ({ ...r }))
    for (const order of [dup, [...dup].reverse()]) {
      const kept = withOnePricePerTyre(order).find((r) => Number(r.cost_per_tyre) > 0)
      expect(kept.id).toBe('g7a')
      expect(kept.cost_per_tyre).toBe(766)
      expect(toLifetimeTyres(order)[0]._cost).toBe(766)
      expect(serialPrice(order)).toBe(766)
      expect(computeScrapRate(order).estimatedScrapCost).toBe(766)
      close(serialLifetime(order).purchaseCpk, 766 / 15000)
      const p = buildPassport(order)
      expect(p.lifetime.purchaseCost).toBe(766)
      expect(p.lifetime.km).toBe(15000)
    }
  })

  it('scrap cost equals the lifetime price of the scrapped tyres', () => {
    const scrapped = tyres.filter((t) => /scrap/i.test(String(t.status)))
    expect(computeScrapRate(rows()).estimatedScrapCost).toBe(scrapped.reduce((s, t) => s + t._cost, 0))
  })

  it('distance: removal rate, vendor saving and executive saving use the same km per stint', () => {
    const removal = computeRemovalRate(rows()).estimatedFleetKm
    expect(measuredKm(rows())).toBe(removal)
    const stint = GOLDEN_ROWS
      .filter((r) => r.km_at_fitment != null && r.km_at_removal != null && r.km_at_removal > r.km_at_fitment)
      .reduce((s, r) => s + (fitmentKm(r) ?? 0), 0)
    expect(removal).toBe(stint)
    // savingsOpportunity = improvement x km x annualisation; first issue 2025-01-01, last 2025-08-01.
    const days = (new Date('2025-08-01') - new Date('2025-01-01')) / 86_400_000 + 1
    close(savingsOpportunity({ fleetAvgCpk: 0.03, p10Cpk: 0.02 }, rows()), 0.01 * removal * (12 / days * 30), 6)
  })

  it('per-fitment km: Serial Tracker shows the shared km rule', () => {
    for (const r of GOLDEN_ROWS) {
      expect([r.id, trackerRecordKm(r)]).toEqual([r.id, GOLDEN_ROW_KM[r.id].km])
    }
  })

  it('passport life, price and CPK match the lifetime layer for each real serial', () => {
    for (const t of tyres) {
      if (!t._key.startsWith('KSA|')) continue
      const serialRows = GOLDEN_ROWS.filter((r) => tyreKey(r) === t._key).map((r) => ({ ...r }))
      const p = buildPassport(serialRows)
      expect([t._key, p.lifetime.km]).toEqual([t._key, t._life_km])
      expect([t._key, p.lifetime.purchaseCost]).toEqual([t._key, t._cost])
      const want = hasLifetimeCpk(t) ? Math.round(lifetimeCpk(t) * 1000) / 1000 : null
      expect([t._key, p.lifetime.purchaseCpk]).toEqual([t._key, want])
    }
  })
})
