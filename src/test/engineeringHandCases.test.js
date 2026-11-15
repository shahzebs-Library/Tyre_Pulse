/**
 * The hand-worked engineering cases from the 2026-11-12 audit
 * (docs/commercial-readiness/audit/calculation_test_cases.md), automated.
 *
 * Every expected value was worked by hand from docs/tyre/BUSINESS_RULES.md,
 * not by calling the code. Case ids (C01..C33) match the audit document and
 * docs/commercial-readiness/audit/ENGINEERING_FIXES.md.
 *
 * SQL sides of the same cases run against PGlite in
 * supabase/tests/eng_calculation_cases.test.mjs (never against production).
 *
 * A changed expectation here is a changed business rule. Where the audit's
 * expectation was corrected, the case says why.
 */
import { describe, it, expect } from 'vitest'
import { tyreKmAssessment } from '../lib/tyreKm'
import * as T from '../lib/tyreLifetime'
import * as K from '../lib/kpiEngine'
import * as R from '../lib/tyreRunningLife'
import * as P from '../lib/tyrePriceRules'
import * as A from '../lib/tyreCostAudit'
import * as CI from '../lib/costIntelligence'
import * as G from '../lib/governedCost'
import * as D from '../lib/downtimeTrackerAnalytics'
import * as B from '../lib/classificationBrain'
import { evidenceScopeRows } from '../lib/tyreEvidenceAudit'

const row = (o) => ({ id: o.id ?? `r${Math.random()}`, country: 'KSA', status: 'Removed', ...o })

describe('A. tyre km of one fitment (rule T7)', () => {
  it('C01 measured: 96,500 - 52,000 = 44,500', () => {
    expect(tyreKmAssessment({ km_at_fitment: 52000, km_at_removal: 96500, vehicle_type: 'TR-MIXER' })).toMatchObject({ km: 44500, status: 'measured' })
  })
  it('C02 fitment odometer 1 is a placeholder: km unknown, never the machine odometer', () => {
    expect(tyreKmAssessment({ km_at_fitment: 1, km_at_removal: 184300, total_km: 184299, vehicle_type: 'TR-MIXER' })).toMatchObject({ km: null, status: 'placeholder' })
  })
  it('C03 fitment 0 is a factory fitment: the tyre ran the whole odometer', () => {
    expect(tyreKmAssessment({ km_at_fitment: 0, km_at_removal: 38200, vehicle_type: 'TR-MIXER' })).toMatchObject({ km: 38200, status: 'factory' })
  })
  it('C04 85,000 km on a mixer is over the 80,000 cap: unknown', () => {
    expect(tyreKmAssessment({ km_at_fitment: 10000, km_at_removal: 95000, vehicle_type: 'TR-MIXER' })).toMatchObject({ km: null, status: 'over_cap' })
  })
  it('C05 the same 85,000 km on a trailer is under the 100,000 default cap', () => {
    expect(tyreKmAssessment({ km_at_fitment: 10000, km_at_removal: 95000, vehicle_type: 'TRAILER' }).km).toBe(85000)
  })
  it('C06 57,000 km on a pump is over the 56,000 cap', () => {
    expect(tyreKmAssessment({ km_at_fitment: 20000, km_at_removal: 77000, vehicle_type: 'PUMPS' }).km).toBe(null)
  })
  it('C07 the loader cap of 15,000 is inclusive', () => {
    expect(tyreKmAssessment({ total_km: 15000, vehicle_type: 'WHEEL LOADER' }).km).toBe(15000)
    expect(tyreKmAssessment({ total_km: 15001, vehicle_type: 'WHEEL LOADER' }).km).toBe(null)
  })
  it('C08 a blank row type takes the cap from the fleet class', () => {
    expect(tyreKmAssessment({ km_at_fitment: 10000, km_at_removal: 95000 }, { vehicleClass: 'TR-MIXER' }).km).toBe(null)
    expect(tyreKmAssessment({ km_at_fitment: 10000, km_at_removal: 95000 }).km).toBe(85000)
  })
  it('C09 nothing recorded is null, never 0', () => {
    expect(tyreKmAssessment({})).toMatchObject({ km: null, status: 'missing' })
  })
  it('C10 removal below fitment is not a distance; a recorded total is accepted', () => {
    expect(tyreKmAssessment({ km_at_fitment: 90000, km_at_removal: 60000 }).km).toBe(null)
    expect(tyreKmAssessment({ km_at_fitment: 90000, km_at_removal: 60000, total_km: 30000 }).km).toBe(30000)
  })
})

describe('B. cost per km', () => {
  it('C11 per fitment: 1,800 / 44,500 = 0.040449', () => {
    expect(T.fitmentCpk({ cost_per_tyre: 1800, km_at_fitment: 52000, km_at_removal: 96500, vehicle_type: 'TR-MIXER' })).toBeCloseTo(0.040449, 6)
  })
  it('C12 no price or a zero price has no CPK', () => {
    expect(T.fitmentCpk({ cost_per_tyre: null, km_at_fitment: 52000, km_at_removal: 96500 })).toBe(null)
    expect(T.fitmentCpk({ cost_per_tyre: 0, km_at_fitment: 52000, km_at_removal: 96500 })).toBe(null)
  })
  it('C13 / C29 (JS side) a placeholder fitment has no CPK', () => {
    expect(T.fitmentCpk({ cost_per_tyre: 1800, km_at_fitment: 1, km_at_removal: 184300, total_km: 184299 })).toBe(null)
  })

  const two = [
    row({ id: 'a', serial_no: 'AAA11111', cost_per_tyre: 1000, km_at_fitment: 5000, km_at_removal: 25000, issue_date: '2025-02-01', removal_date: '2025-06-01', vehicle_type: 'TRAILER' }),
    row({ id: 'b', serial_no: 'BBB22222', cost_per_tyre: 2000, km_at_fitment: 5000, km_at_removal: 105000, issue_date: '2025-02-01', removal_date: '2026-02-01', vehicle_type: 'TRAILER' }),
  ]
  it('C14 fleet CPK is weighted (3,000 / 120,000 = 0.025), not the mean of ratios (0.035)', () => {
    expect(T.weightedCpk(T.toLifetimeTyres(two))).toBeCloseTo(0.025, 9)
    const f = K.computeCpkFleet(two)
    expect(f.fleetAvgCpk).toBeCloseTo(0.025, 9)
    expect(f.meanCpk).toBeCloseTo(0.035, 9)
  })
  it('C15 one serial fitted twice is one tyre with one price: 1,500 / 50,000 = 0.03', () => {
    const refit = [
      row({ id: '1', serial_no: 'S1234567', asset_no: 'A1', cost_per_tyre: 1500, km_at_fitment: 10000, km_at_removal: 40000, issue_date: '2025-02-01', removal_date: '2025-08-01' }),
      row({ id: '2', serial_no: 'S1234567', asset_no: 'B1', cost_per_tyre: 1500, km_at_fitment: 5000, km_at_removal: 25000, issue_date: '2025-09-01', removal_date: '2026-02-01' }),
    ]
    const [t] = T.toLifetimeTyres(refit)
    expect(t._cost).toBe(1500)
    expect(t._life_km).toBe(50000)
    expect(T.lifetimeCpk(t)).toBeCloseTo(0.03, 9)
    expect(t._fitments).toBe(2)
    expect(t._vehicles).toBe(2)
    expect(t._cost_status).toBe('DISPUTED')
    expect(T.withOnePricePerTyre(refit)[1].cost_per_tyre).toBe(null)
  })
  it('C16 an overlapping fitment adds no km (rule T18)', () => {
    const [t] = T.toLifetimeTyres([
      row({ id: '1', serial_no: 'S7654321', asset_no: 'A1', cost_per_tyre: 1500, km_at_fitment: 10000, km_at_removal: 40000, issue_date: '2025-01-10', removal_date: '2025-06-10' }),
      row({ id: '2', serial_no: 'S7654321', asset_no: 'A1', km_at_fitment: 20000, km_at_removal: 32000, issue_date: '2025-03-01', removal_date: '2025-07-01' }),
    ])
    expect(t._life_km).toBe(30000)
    expect(t._overlapping_fitments).toBe(1)
    expect(t._km_coverage).toBe('partial')
  })
  it('C17 SAR and AED are never added: fleet CPK null, per country rows kept', () => {
    const m = T.toLifetimeTyres([two[0], { ...two[1], country: 'UAE' }])
    expect(T.weightedCpk(m)).toBe(null)
    const s = T.lifetimeSummary(m)
    expect(s.cpkPurchase).toBe(null)
    expect(s.mixedCurrency).toBe(true)
    expect(s.byCountry.map((r) => +r.cpk.toFixed(3))).toEqual([0.05, 0.02])
    expect(() => G.addMoney(G.money(1, 'SAR'), G.money(1, 'AED'))).toThrow()
  })
  it('C18 a weak serial honours quantity: (900 x 4) / (30,000 x 4) = 0.03', () => {
    const [t] = T.toLifetimeTyres([row({ id: 'w', serial_no: 'DOT1234', qty: 4, cost_per_tyre: 900, km_at_fitment: 2000, km_at_removal: 32000, vehicle_type: 'TRAILER' })])
    expect(t._qty).toBe(4)
    expect(T.weightedCpk([t])).toBeCloseTo(0.03, 9)
  })
  it('C25 an unpriced tyre has no CPK and is outside the fleet figure', () => {
    const [t] = T.toLifetimeTyres([row({ id: 'u', serial_no: 'U1234567', km_at_fitment: 5000, km_at_removal: 45000 })])
    expect(t._cost).toBe(null)
    expect(t._cost_status).toBe('MISSING')
    expect(T.lifetimeCpk(t)).toBe(null)
    expect(T.weightedCpk([t])).toBe(null)
  })
  it('C26 the trusted date is an explicit, opt in scope (corrected expectation)', () => {
    // The audit expected 0.05 by default (only fitments from 2025-01-01). Rule
    // T20 in BUSINESS_RULES.md, an owner decision, says legacy fitments ARE used
    // for lifetime km and cost. The engine therefore keeps T20 as the default
    // (3,000 / 80,000 = 0.0375) and offers the audit's figure as a named scope
    // (2,000 / 40,000 = 0.05). Changing the default needs an owner ruling.
    const recs = [
      row({ id: 'o', serial_no: 'OLD12345', cost_per_tyre: 1000, km_at_fitment: 5000, km_at_removal: 45000, issue_date: '2024-06-01', removal_date: '2024-12-01' }),
      row({ id: 'n', serial_no: 'NEW12345', cost_per_tyre: 2000, km_at_fitment: 5000, km_at_removal: 45000, issue_date: '2025-06-01', removal_date: '2025-12-01' }),
    ]
    expect(K.computeCpkFleet(recs).fleetAvgCpk).toBeCloseTo(0.0375, 9)
    expect(K.computeCpkFleet(evidenceScopeRows(recs, { scope: 'modern' })).fleetAvgCpk).toBeCloseTo(0.05, 9)
    // an undated fitment cannot be shown to be modern
    expect(evidenceScopeRows([{ id: 'x' }], { scope: 'modern' })).toEqual([])
    expect(evidenceScopeRows(recs)).toHaveLength(2)
  })
})

describe('C. serial identity (rule T6)', () => {
  it('C19 a real serial has 6+ characters and a digit, and is not a size, a month code or a placeholder', () => {
    expect(['YMA55312', 'FEB-62', '315/80R22.5', '1.25121E+11', '111111', 'NO SERIAL', '12345'].map(T.isStrongSerial))
      .toEqual([true, false, false, false, false, false, false])
  })
})

describe('D. unit selection, km or engine hours', () => {
  it('C20 a loader is costed per engine hour: 12,000 / 1,200 = 10; no hours, no rate', () => {
    expect(CI.cpkUnitForAssetType('WHEEL LOADER')).toBe('engine_hours')
    expect(CI.cpkUnitForAssetType('TR-MIXER')).toBe('km')
    expect(CI.cpkUnitForAssetType('PUMPS')).toBe('engine_hours')
    expect(CI.assetCpk({ vehicle_type: 'WHEEL LOADER', km: 4000, hours: 1200, tyre_cost: 12000, maintenance_cost: 0 }).cpkTyre).toBe(10)
    expect(CI.assetCpk({ vehicle_type: 'WHEEL LOADER', km: 4000, hours: 0, tyre_cost: 12000 }).cpkTyre).toBe(null)
  })
  it('C20b road vehicles another company would register are measured in km (was engine hours)', () => {
    for (const t of ['WATER TANKER', 'LOW LOADER TRAILER', 'CONCRETE MIXER TRUCK', 'CRANE TRUCK', 'ROLLER SHUTTER VAN']) {
      expect(CI.cpkUnitForAssetType(t), t).toBe('km')
    }
  })
  it('C20b the fix changes no vehicle type the current fleet uses (live list, 2026-11-12)', () => {
    const live = {
      'TR-MIXER': 'km', PUMPS: 'engine_hours', 'BT-PLANT': 'km', GENERATOR: 'engine_hours', PICKUP: 'km', BUS: 'km',
      BUILDINGS: 'km', WHEEL_LOADER: 'engine_hours', 'ICE PLANT': 'km', 'HEAVY EQP': 'km', 'SKID LOADER': 'engine_hours',
      'PLACING BOOM': 'km', MACHINERY: 'km', CHILLER: 'km', TRAILER: 'km', 'STATIONARY PUMP': 'engine_hours',
      'LINE PUMP': 'engine_hours', 'MOT-VEH': 'km', RECLAIMER: 'km', 'W TANKER': 'km', 'SPIDER PUMP': 'engine_hours',
      'D TANKER': 'km', RAFT: 'km', EXCAVATOR: 'engine_hours', TANKS: 'km', 'WATER TREATMENT PLANT': 'engine_hours',
      'ST PUMP': 'engine_hours', 'HD-DISTRIBUTOR': 'km', FORKLIFT: 'engine_hours', CARAVANS: 'km',
    }
    for (const [type, unit] of Object.entries(live)) expect(CI.cpkUnitForAssetType(type), type).toBe(unit)
    // a truck mounted pump still runs on its hour meter
    expect(CI.cpkUnitForAssetType('CONCRETE PUMP TRUCK')).toBe('engine_hours')
  })
})

describe('E. running and remaining life bands', () => {
  const rl = (o) => ({ unit: 'km', expectedLifeKm: null, expectedLifeHours: null, remainingKm: null, lifeUsedPct: null, remainingHours: null, hoursUsedPct: null, ...o })
  it('C21a due soon under min(10,000, 10% of expected)', () => expect(R.bandFor(rl({ expectedLifeKm: 80000, remainingKm: 7500, lifeUsedPct: 91 }))).toBe('due-soon'))
  it('C21b 9,000 remaining and 89% used is mid life', () => expect(R.bandFor(rl({ expectedLifeKm: 80000, remainingKm: 9000, lifeUsedPct: 89 }))).toBe('mid-life'))
  it('C21c nothing remaining is overdue', () => expect(R.bandFor(rl({ expectedLifeKm: 80000, remainingKm: 0, lifeUsedPct: 101 }))).toBe('overdue'))
  it('C21d hours budget: 400 h remaining of 5,000 is due soon', () => expect(R.bandFor(rl({ unit: 'engine_hours', expectedLifeHours: 5000, remainingHours: 400, hoursUsedPct: 92 }))).toBe('due-soon'))
  it('C21e the worst budget wins', () => expect(R.bandFor(rl({ unit: 'engine_hours', expectedLifeKm: 30000, remainingKm: 20000, lifeUsedPct: 33, expectedLifeHours: 5000, remainingHours: 0, hoursUsedPct: 102 }))).toBe('overdue'))
  it('C21f no meter is unknown, not healthy', () => expect(R.bandFor(rl({}))).toBe('unknown'))
})

describe('G. cost classification, warranty, repair', () => {
  it('C23 a warranty tyre costs zero, known, and has no CPK', () => {
    expect(P.isTyreWarranty('TYRE 315/80R22.5 FOC WARRANTY REPLACEMENT')).toBe(true)
    const [t] = T.toLifetimeTyres([row({ id: 'z', serial_no: 'W1234567', cost_per_tyre: null, price_source: 'warranty', km_at_fitment: 5000, km_at_removal: 45000 })])
    expect(t._cost_status).toBe('CONFIRMED_ZERO')
    expect(T.lifetimeCpk(t)).toBe(null)
  })
  it('C23b the ERP spelling WARRENTY is a warranty line (was missed)', () => {
    expect(P.isTyreWarranty('TIRE -WARRENTY -315/80 R 22.5')).toBe(true)
    expect(A.lineKind('TIRE -WARRENTY -315/80 R 22.5')).toBe('warranty')
    for (const d of ['TYRE WARANTY CLAIM', 'TYRE 315/80R22.5 FREE ISSUE', 'TYRE UNDER GAURANTEE']) expect(P.isTyreWarranty(d), d).toBe(true)
    // whole words only: a plain tyre is still a purchase
    expect(P.isTyreWarranty('TYRE 315/80R22.5 BRIDGESTONE')).toBe(false)
  })
  it('C24 a repair is never a tyre price', () => {
    expect(P.isTyreRepair('Repair TIRE 315/80R22.5')).toBe(true)
    expect(P.isTyreRepair('TYRE 315/80R22.5 BRIDGESTONE')).toBe(false)
    expect(A.lineKind('Repair TIRE 315/80R22.5')).toBe('repair')
    expect(A.costBucket('repair')).toBe('repair')
  })
  it('C24b tube and flap are spares; a combined line is mixed', () => {
    expect(A.lineKind('TUBE 12.00R24')).toBe('tube')
    expect(A.lineKind('TYRE FLAP 1200-24')).toBe('flap')
    expect(A.lineKind('TYRE 12.00R24 WITH TUBE & FLAP')).toBe('mixed')
    expect(A.costBucket('tube')).toBe('spare')
  })
  it('C24c repair, retread, fitting and warranty are not tyre PURCHASE spend (corrected expectation)', () => {
    // The audit expected the grid classifier to move these lines out of the
    // tyre bucket. The bucket is the expense grid total (rule T9) and moving
    // lines would change every reported tyre total, so the bucket is left as
    // it is and each tyre bucket line is given a spend kind instead. Purchase
    // spend is the tyre bucket minus the non purchase kinds.
    expect(B.classifyLine({ description: 'TUBE 12.00R24' }).bucket).toBe('spare')
    expect(B.classifyLine({ description: 'TYRE 315/80R22.5 20PR' }).bucket).toBe('tyre')
    expect(A.tyreSpendKind('TYRE 315/80R22.5 20PR')).toBe('purchase')
    expect(A.tyreSpendKind('Repair TIRE 315/80R22.5')).toBe('repair')
    expect(A.tyreSpendKind('RETREAD TYRE 315/80R22.5')).toBe('repair')
    expect(A.tyreSpendKind('TYRE FITTING CHARGES')).toBe('service')
    expect(A.tyreSpendKind('TIRE -WARRENTY -315/80 R 22.5')).toBe('warranty')
    expect(A.tyreSpendKind('TUBE 12.00R24')).toBe('accessory')
    const s = A.splitTyreSpend([
      { description: 'TYRE 315/80R22.5 20PR', amount: 1800 },
      { description: 'Repair TIRE 315/80R22.5', amount: 150 },
      { description: 'TYRE FITTING CHARGES', amount: 50 },
      { description: 'TYRE 315/80R22.5 20PR', amount: null },
    ])
    expect(s.total).toBe(2000)
    expect(s.purchase).toEqual({ amount: 1800, lines: 1 })
    expect(s.repair.amount).toBe(150)
    expect(s.service.amount).toBe(50)
    expect(s.nonPurchaseAmount).toBe(200)
  })
  it('C32 unit price: 14,000 / 20 = 700; no quantity, no unit price', () => {
    expect(P.unitPrice(14000, 20)).toBe(700)
    expect(P.unitPrice(14000, 0)).toBe(null)
  })
  it('C33 a zero denominator is unknown; 733,308 / 55,560 m3 = 13.1985', () => {
    expect(G.perUnitCost(G.money(1000, 'SAR'), 0).value).toBe(null)
    expect(CI.costPerUnit({ expenses: 733308, m3: 55560, unit: 'm3' }).value).toBeCloseTo(13.1985, 3)
  })
})

describe('H. reliability, downtime, inspection', () => {
  it('C27 MTTR over closed job cards: (6 + 27) / 2 = 16.5 h; an open card is excluded', () => {
    const m = D.actualHoursByAsset([
      { asset_no: 'X', opened_at: '2026-01-05T08:00:00Z', completed_at: '2026-01-05T14:00:00Z' },
      { asset_no: 'X', opened_at: '2026-01-06T09:00:00Z', completed_at: '2026-01-07T12:00:00Z' },
      { asset_no: 'X', opened_at: '2026-01-08T09:00:00Z', completed_at: null },
    ])
    expect(m.get('X')).toBe(16.5)
  })
  it('C27b a job card with an impossible date measures nothing (ENG-7)', () => {
    const now = new Date('2026-11-12T00:00:00Z')
    // two digit year import (year 0024), completed before opened, over 720 h, opened in the future
    expect(D.workOrderHours({ opened_at: '0024-03-01T08:00:00Z', completed_at: '2024-03-01T12:00:00Z' }, { now })).toBe(null)
    expect(D.workOrderHours({ opened_at: '1900-01-01T00:00:00Z', completed_at: '2026-01-01T00:00:00Z' }, { now })).toBe(null)
    expect(D.workOrderHours({ opened_at: '2026-02-02T08:00:00Z', completed_at: '2026-02-01T08:00:00Z' }, { now })).toBe(null)
    expect(D.workOrderHours({ opened_at: '2025-01-01T00:00:00Z', completed_at: '2026-06-01T00:00:00Z' }, { now })).toBe(null)
    expect(D.workOrderHours({ opened_at: '2026-12-01T08:00:00Z', completed_at: '2026-12-01T12:00:00Z' }, { now })).toBe(null)
    expect(D.workOrderHours({ opened_at: '2026-10-01T08:00:00Z', completed_at: '2026-10-01T12:00:00Z' }, { now })).toBe(4)
    // exactly the limit is still a measurement; one hour more is not
    expect(D.workOrderHours({ opened_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-31T00:00:00Z' }, { now })).toBe(720)
    expect(D.workOrderHours({ opened_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-31T01:00:00Z' }, { now })).toBe(null)
  })
  it('C28 mean time between tyre events: gaps of 48 h and 72 h give 60 h', () => {
    const k = D.downtimeKpis([{ asset_no: 'X', issue_date: '2026-01-01' }, { asset_no: 'X', issue_date: '2026-01-03' }, { asset_no: 'X', issue_date: '2026-01-06' }], { now: new Date('2026-01-31') })
    expect(k.mtbeHours).toBe(60)
  })
  it('C28b an event with no job card has no measured downtime (was 2 assumed hours)', () => {
    const k = D.downtimeKpis([{ asset_no: 'X', issue_date: '2026-01-01' }], { cutoff: '2026-01-01', now: new Date('2026-01-31') })
    expect(k.totalHours).toBe(null)
    expect(k.availability).toBe(null)
    expect(k.totalCost).toBe(null)
    // the assumption still exists, separately and by name
    expect(k.assumedHours).toBe(2)
    expect(k.modelledHours).toBe(2)
    expect(k.unmeasuredEvents).toBe(1)
    expect(D.downtimeHours({ asset_no: 'X' }, new Map())).toMatchObject({ hours: null, actual: false, assumedHours: 2 })
  })
  it('C28c measured and assumed hours are never added into the measured figure', () => {
    const actualByAsset = new Map([['A', 6]])
    const events = [{ asset_no: 'A', issue_date: '2026-01-02' }, { asset_no: 'B', issue_date: '2026-01-03' }]
    const k = D.downtimeKpis(events, { cutoff: '2026-01-01', now: new Date('2026-01-31'), actualByAsset, rate: 100 })
    expect(k.totalHours).toBe(6)
    expect(k.assumedHours).toBe(2)
    expect(k.modelledHours).toBe(8)
    expect(k.totalCost).toBe(600)
    expect(k.modelledCost).toBe(800)
    // one event is assumed, so availability is a model, not a measurement
    expect(k.availability).toBe(null)
    expect(k.availabilityAssumed).not.toBe(null)
    // all measured: availability is measured
    const all = D.downtimeKpis([events[0]], { cutoff: '2026-01-01', now: new Date('2026-01-31'), actualByAsset })
    expect(all.availability).toBeCloseTo(((30 - 6 / 8) / 30) * 100, 9)
    // no rate configured: no cost, never a default rate
    expect(all.totalCost).toBe(null)
    expect(D.DEFAULT_DOWNTIME_RATE).toBe(null)
  })
  it('C28d the removal cause reads removal_reason, the populated column', () => {
    expect(D.causeLabel({ removal_reason: 'WORN OUT' })).toBe('Wear-Related')
    expect(D.causeLabel({ removal_reason: 'TYRE BURST' })).toBe('Pressure Issue')
    expect(D.causeLabel({})).toBe('Unknown')
  })
  it('C30 honest nulls: unrated, unmeasured, unpriced', () => {
    const u = [row({ id: 'q', serial_no: 'Q1234567' })]
    expect(K.computeFailureRate(u).failureRate).toBe(null)
    expect(K.computeAvgTyreLife(u).avgKm).toBe(null)
    expect(K.computeFleetAvailability(u, 10).availabilityPct).toBe(null)
    expect(K.computeCpkFleet(u).fleetAvgCpk).toBe(null)
  })
  it('C30b an unrated, unmeasured brand has no failure rate, no score and no rank (was rank 1 at 0.3)', () => {
    const [v] = K.computeVendorPerformance([row({ id: 'v', serial_no: 'V1234567', brand: 'X' })])
    expect(v.failureRate).toBe(null)
    expect(v.avgLife).toBe(null)
    expect(v.score).toBe(null)
    expect(v.rank).toBe(null)
    // a measured brand outranks it, and unknown quality earns nothing
    const out = K.computeVendorPerformance([
      row({ id: 'v', serial_no: 'V1234567', brand: 'X' }),
      row({ id: 'm', serial_no: 'M1234567', brand: 'Y', cost_per_tyre: 2000, km_at_fitment: 5000, km_at_removal: 45000, risk_level: 'Low' }),
    ])
    expect(out.map((b) => [b.brand, b.rank])).toEqual([['Y', 1], ['X', null]])
    expect(out[0].failureRate).toBe(0)
  })
  it('C30c tyre records carry no downtime: hours are null, the assumption is named', () => {
    const d = K.computeVehicleDowntimeImpact([row({ asset_no: 'A' })])
    expect(d.totalDowntimeHours).toBe(null)
    expect(d.avgDowntimePerVehicle).toBe(null)
    expect(d.measured).toBe(false)
    expect(d.basis).toBe('assumed')
    expect(d.assumedDowntimeHours).toBe(2)
    expect(d.assumption).toMatch(/assumed/)
  })
  it('C31 pressure consistency: one of five readings is 20% off the median, so 80%', () => {
    const p = K.computePressureCompliance([{ site: 'S', tyre_conditions: { a: { pressure_psi: 100 }, b: { pressure_psi: 100 }, c: { pressure_psi: 100 }, d: { pressure_psi: 100 }, e: { pressure_psi: 80 } } }])
    expect(p.consistencyPct).toBeCloseTo(80, 6)
    expect(p.compliancePct).toBeCloseTo(80, 6)
  })
  it('C31b four tyres at 60 psi are consistent, not compliant (corrected expectation)', () => {
    // The audit expected the figure not to read 100%. With no target pressure
    // in the schema the engine cannot know 60 psi is half the requirement, so
    // the honest resolution is to NAME the figure: it is pressure consistency
    // (100% here) and compliance against a target is null until a target
    // exists. With the 120 psi target supplied, compliance is 0%.
    const insp = [{ site: 'S', tyre_conditions: { a: { pressure_psi: 60 }, b: { pressure_psi: 60 }, c: { pressure_psi: 60 }, d: { pressure_psi: 60 } } }]
    const p = K.computePressureCompliance(insp)
    expect(p.metric).toBe('consistency')
    expect(p.label).toBe('Pressure consistency')
    expect(p.consistencyPct).toBe(100)
    expect(p.targetCompliancePct).toBe(null)
    expect(p.basis).toMatch(/not compliance with a target pressure/)
    const withTarget = K.computePressureCompliance(insp, 90, { targetPsiFor: () => 120 })
    expect(withTarget.targetCompliancePct).toBe(0)
    expect(K.computePressureCompliance(insp, 90, { targetPsiFor: () => 62 }).targetCompliancePct).toBe(100)
  })
})
