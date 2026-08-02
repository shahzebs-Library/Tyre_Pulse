import { describe, it, expect } from 'vitest'
import {
  decomposeSegment,
  decomposeDrivers,
  waterfallSteps,
  topDrivers,
  managementSentence,
  bestValueBrandFromGroups,
  segmentExportRows,
  fmtCpk,
  fmtCpkDelta,
  CAUSE_META,
} from '../lib/cpkDrivers'

// A clean, fully-comparable synthetic segment whose cause money sums exactly to
// (c1 - c0). Prior: 100 tyres cost 76,600 over 100,000 km -> 0.766. Current: cost
// 90,000 over 100,000 km -> 0.900. deltaC = 13,400 split price 8000 / volume 2000
// / mix 1000 / new_equipment 2400 / stopped 0 (sums to 13,400).
const clean = {
  country: 'KSA', unit: 'km', currency: 'SAR',
  c0: 76600, d0: 100000, c1: 90000, d1: 100000,
  matched_prev: 40, matched_now: 42,
  causes: { price: 8000, volume: 2000, mix: 1000, new_equipment: 2400, stopped_equipment: 0 },
}

// The REAL KSA km shape from live data (V447): the prior window measured only 2
// assets, so this is coverage-limited even though the split closes exactly.
const ksaReal = {
  country: 'KSA', unit: 'km', currency: 'SAR',
  c0: 18742, d0: 15868, c1: 4490664.73, d1: 17011982,
  matched_prev: 2, matched_now: 274,
  causes: { price: 98.75, volume: -6240.75, mix: -3600, new_equipment: 4481664.73, stopped_equipment: 0 },
}

describe('decomposeSegment - the exact-closing identity', () => {
  it('COST effect + UTILIZATION effect equals the CPK delta (clean)', () => {
    const d = decomposeSegment(clean)
    expect(d.cpkPrev).toBeCloseTo(0.766, 6)
    expect(d.cpkNow).toBeCloseTo(0.9, 6)
    expect(d.delta).toBeCloseTo(0.134, 6)
    // the load-bearing assertion: the two halves reconstruct the delta EXACTLY
    expect(d.costEffect + d.utilizationEffect).toBeCloseTo(d.delta, 9)
  })

  it('COST effect + UTILIZATION effect equals the CPK delta (real KSA, denominators change)', () => {
    const d = decomposeSegment(ksaReal)
    expect(d.cpkPrev).toBeCloseTo(18742 / 15868, 6)
    expect(d.cpkNow).toBeCloseTo(4490664.73 / 17011982, 6)
    expect(d.costEffect + d.utilizationEffect).toBeCloseTo(d.delta, 9)
  })

  it('the cause slices sum to the COST effect EXACTLY', () => {
    for (const seg of [clean, ksaReal]) {
      const d = decomposeSegment(seg)
      const sum = d.causes.reduce((s, c) => s + c.cpk, 0)
      expect(sum).toBeCloseTo(d.costEffect, 9)
      expect(d.closes).toBe(true)
    }
  })

  it('cause MONEY sums to (c1 - c0) exactly (clean, no residual)', () => {
    const d = decomposeSegment(clean)
    const money = d.causes.reduce((s, c) => s + c.money, 0)
    expect(money).toBeCloseTo(clean.c1 - clean.c0, 6)
    expect(d.causes.some((c) => c.isResidual)).toBe(false)
  })
})

describe('decomposeSegment - honest residual', () => {
  it('adds an explicit "other" row when the server causes do not hit (c1 - c0), and STILL closes', () => {
    const seg = {
      ...clean,
      // deliberately under-account: parts sum to 10,000 but deltaC is 13,400
      causes: { price: 8000, volume: 2000, mix: 0, new_equipment: 0, stopped_equipment: 0 },
    }
    const d = decomposeSegment(seg)
    const other = d.causes.find((c) => c.key === 'other')
    expect(other).toBeTruthy()
    expect(other.isResidual).toBe(true)
    expect(other.money).toBeCloseTo(3400, 6)
    // closure is still guaranteed by the residual
    const sum = d.causes.reduce((s, c) => s + c.cpk, 0)
    expect(sum).toBeCloseTo(d.costEffect, 9)
    expect(d.closes).toBe(true)
  })
})

describe('decomposeSegment - coverage honesty', () => {
  it('flags the real KSA comparison as NOT comparable (only 2 prior assets)', () => {
    const d = decomposeSegment(ksaReal)
    expect(d.comparable).toBe(false)
    expect(d.trustworthy).toBe(false)
  })

  it('flags the clean segment as comparable (40 prior vs 42 now)', () => {
    const d = decomposeSegment(clean)
    expect(d.comparable).toBe(true)
    expect(d.trustworthy).toBe(true)
  })

  it('returns null CPK (never a fabricated 0) when a denominator is 0', () => {
    const d = decomposeSegment({ ...clean, d0: 0, c0: 0, matched_prev: 0 })
    expect(d.cpkPrev).toBeNull()
    expect(d.delta).toBeNull()
    expect(d.utilizationEffect).toBeNull()
    // cost effect still measurable off the current denominator
    expect(d.costEffect).not.toBeNull()
    expect(d.comparable).toBe(false)
  })

  it('a zero CURRENT denominator makes cost slices null but does not throw', () => {
    const d = decomposeSegment({ ...clean, d1: 0, c1: 0, matched_now: 0 })
    expect(d.cpkNow).toBeNull()
    expect(d.costEffect).toBeNull()
    expect(d.causes.every((c) => c.cpk === null)).toBe(true)
  })
})

describe('waterfallSteps + topDrivers', () => {
  it('the waterfall steps sum to the full CPK delta and run from prior to current', () => {
    const d = decomposeSegment(clean)
    const wf = waterfallSteps(d)
    expect(wf.start).toBeCloseTo(d.cpkPrev, 9)
    expect(wf.end).toBeCloseTo(d.cpkNow, 9)
    const total = wf.steps.reduce((s, x) => s + x.amount, 0)
    expect(total).toBeCloseTo(d.delta, 9)
    // running levels chain correctly
    expect(wf.steps[wf.steps.length - 1].to).toBeCloseTo(d.cpkNow, 9)
  })

  it('utilization is the last step and carries the right sign', () => {
    const d = decomposeSegment(clean)
    const wf = waterfallSteps(d)
    const util = wf.steps.find((s) => s.key === 'utilization')
    // clean segment has equal denominators, so utilization is 0 and dropped
    expect(util).toBeUndefined()
    const dReal = decomposeSegment(ksaReal)
    const wfReal = waterfallSteps(dReal)
    const utilReal = wfReal.steps[wfReal.steps.length - 1]
    expect(utilReal.key).toBe('utilization')
    expect(utilReal.direction).toBe('down') // huge km rise lowers CPK
  })

  it('topDrivers ranks by absolute CPK impact', () => {
    const d = decomposeSegment(ksaReal)
    const top = topDrivers(d, 2)
    expect(top.length).toBe(2)
    expect(Math.abs(top[0].amount)).toBeGreaterThanOrEqual(Math.abs(top[1].amount))
  })
})

describe('managementSentence', () => {
  it('leads with the coverage caveat when not comparable and never overclaims', () => {
    const s = managementSentence(decomposeSegment(ksaReal))
    expect(s.toLowerCase()).toContain('coverage limited')
    expect(s).toContain('2 assets')
    expect(s).toContain('274')
  })

  it('names the top movers with numbers when comparable', () => {
    const s = managementSentence(decomposeSegment(clean))
    expect(s.toLowerCase()).toContain('rose')
    expect(s.toLowerCase()).toContain('from tyre price')
    // no dash characters used as separators
    expect(s.includes('–')).toBe(false)
    expect(s.includes('—')).toBe(false)
  })
})

describe('decomposeDrivers', () => {
  it('handles an ok payload and maps every segment', () => {
    const out = decomposeDrivers({ ok: true, windows: { current: {}, previous: {} }, segments: [clean, ksaReal] })
    expect(out.ok).toBe(true)
    expect(out.segments.length).toBe(2)
  })

  it('degrades a not-ok payload to an empty shaped result', () => {
    expect(decomposeDrivers({ ok: false, reason: 'no_org' })).toMatchObject({ ok: false, segments: [] })
    expect(decomposeDrivers(null)).toMatchObject({ ok: false, segments: [] })
  })
})

describe('bestValueBrandFromGroups', () => {
  it('picks the lowest-CPK winner among non-thin groups', () => {
    const groups = [
      { size: '315/80R22.5', currency: 'SAR', thin: false, brands: [{ brand: 'Techking', cpk: 0.6, tyres: 30, isBestValue: true }, { brand: 'X', cpk: 0.9, tyres: 5 }] },
      { size: '11R22.5', currency: 'SAR', thin: false, brands: [{ brand: 'Double Coin', cpk: 0.4, tyres: 12, isBestValue: true }, { brand: 'Y', cpk: 0.7, tyres: 8 }] },
      { size: '385/65R22.5', currency: 'SAR', thin: true, brands: [{ brand: 'Solo', cpk: 0.2, tyres: 3, isBestValue: true }] },
    ]
    const best = bestValueBrandFromGroups(groups)
    expect(best.brand).toBe('Double Coin') // 0.4 beats 0.6; thin 0.2 ignored
    expect(best.size).toBe('11R22.5')
  })

  it('returns null when nothing is measurable', () => {
    expect(bestValueBrandFromGroups([{ thin: true, brands: [] }])).toBeNull()
    expect(bestValueBrandFromGroups([])).toBeNull()
  })
})

describe('formatters + exports', () => {
  it('fmtCpk / fmtCpkDelta stay honest about null', () => {
    expect(fmtCpk(null, 'SAR', 'km')).toBe('N/A')
    expect(fmtCpk(0.2640, 'SAR', 'km')).toBe('SAR 0.2640/km')
    expect(fmtCpk(0.5, 'SAR', 'engine_hours')).toBe('SAR 0.5000/hour')
    expect(fmtCpkDelta(null)).toBe('N/A')
    expect(fmtCpkDelta(0.0152)).toBe('+0.0152')
    expect(fmtCpkDelta(-0.003)).toBe('-0.0030')
  })

  it('segmentExportRows lists endpoints, effects and every cause', () => {
    const rows = segmentExportRows(decomposeSegment(clean))
    expect(rows[0].item).toContain('Prior cost per km')
    expect(rows.some((r) => r.item.trim() === 'Tyre price')).toBe(true)
    expect(rows.some((r) => r.item.trim() === 'Utilization effect')).toBe(true)
  })

  it('CAUSE_META covers the five causes plus the other residual', () => {
    expect(CAUSE_META.map((m) => m.key)).toEqual([
      'price', 'mix', 'volume', 'new_equipment', 'stopped_equipment', 'other',
    ])
  })
})
