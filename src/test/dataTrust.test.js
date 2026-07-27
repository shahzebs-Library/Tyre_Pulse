/**
 * dataTrust engine tests.
 *
 * Every fixture below is a VERBATIM copy of what `get_data_trust_overview`
 * returned from the live database on 2026-07-27 for org Company A. They are not
 * invented shapes: each number is a real property of this customer's data, so a
 * test that breaks here means either the engine changed or the data did.
 */
import { describe, it, expect } from 'vitest'
import {
  CHECKS, CHECK_KEYS, DOMAINS, DOMAIN_KEYS,
  trustBand, runCheck, runAllChecks, scoreDomain, scoreAllDomains,
  buildTrustReport, topActions, trustExportRows,
} from '../lib/dataTrust'

// ── Real measures, live database, 2026-07-27 ────────────────────────────────
const KSA = {
  expense_lines: 29933,
  expense_spend: 6066420.66,
  expense_lines_default: 19116,
  expense_spend_default: 2088749.31,
  expense_lines_no_currency: 0,
  expense_lines_no_item: 0,
  expense_spend_reviewed: 97526.18,
  expense_lines_total: 106646,
  expense_lines_no_date: 0,
  expense_lines_no_uid: 135,
  expense_last_event_date: '2026-07-25',
  expense_days_since: 2,
  expense_spend_linked: 6066420.66,
  expense_assets: 620,
  expense_assets_linked: 620,
  km_assets_measured: 341,
  odometer_rows: 0,
  engine_hours_rows: 0,
  tyre_rows: 6016,
  tyre_no_brand: 149,
  tyre_no_unit_cost: 2173,
  tyre_no_fitment_date: 51,
  tyre_km_span_both: 2228,
  tyre_future_dated: 0,
  tyre_removal_before_fitment: 0,
  tyre_km_backwards: 0,
  fleet_rows: 1019,
  fleet_no_vehicle_type: 417,
  fleet_no_make: 428,
}

const UAE = {
  expense_lines: 25120,
  expense_spend: 6775852.59,
  expense_lines_default: 17383,
  expense_spend_default: 3092255.10,
  expense_lines_no_currency: 0,
  expense_lines_no_item: 0,
  expense_spend_reviewed: 85371.17,
  expense_lines_total: 67615,
  expense_lines_no_date: 0,
  expense_lines_no_uid: 67576,
  expense_last_event_date: '2026-07-26',
  expense_days_since: 1,
  expense_spend_linked: 4775296.41,
  expense_assets: 330,
  expense_assets_linked: 261,
  km_assets_measured: 97,
  odometer_rows: 0,
  engine_hours_rows: 0,
  tyre_rows: 1007,
  tyre_no_brand: 118,
  tyre_no_unit_cost: 1007,
  tyre_no_fitment_date: 0,
  tyre_km_span_both: 572,
  tyre_future_dated: 3,
  tyre_removal_before_fitment: 0,
  tyre_km_backwards: 0,
  fleet_rows: 371,
  fleet_no_vehicle_type: 371,
  fleet_no_make: 238,
}

const EGYPT = {
  expense_lines: 9968,
  expense_spend: 28959626.41,
  expense_lines_default: 7228,
  expense_spend_default: 15687600.78,
  expense_lines_no_currency: 0,
  expense_lines_no_item: 0,
  expense_spend_reviewed: 1883132.59,
  expense_lines_total: 42531,
  expense_lines_no_date: 0,
  expense_lines_no_uid: 42453,
  expense_last_event_date: '2026-07-25',
  expense_days_since: 2,
  expense_spend_linked: 28957301.41,
  expense_assets: 119,
  expense_assets_linked: 118,
  km_assets_measured: 17,
  odometer_rows: 0,
  engine_hours_rows: 0,
  tyre_rows: 475,
  tyre_no_brand: 475,
  tyre_no_unit_cost: 475,
  tyre_no_fitment_date: 1,
  tyre_km_span_both: 93,
  tyre_future_dated: 0,
  tyre_removal_before_fitment: 0,
  tyre_km_backwards: 0,
  fleet_rows: 133,
  fleet_no_vehicle_type: 133,
  fleet_no_make: 102,
}

const LIVE_PAYLOAD = {
  ok: true,
  generated_at: '2026-07-27T05:16:38.255433+00:00',
  window: { from: '2025-07-28', to: '2026-07-27' },
  country: null,
  countries: [
    { country: 'Egypt', currency: 'EGP', measures: EGYPT },
    { country: 'KSA', currency: 'SAR', measures: KSA },
    { country: 'UAE', currency: 'AED', measures: UAE },
  ],
}

// ── Rule 2: unmeasurable is not zero ────────────────────────────────────────
describe('a KPI with no measurable input returns null, not 0', () => {
  it('scores tyre_life as null for a country with no tyre records', () => {
    // A country that has expense data loaded but whose tyre register was never
    // imported: every check behind tyre life has a zero denominator.
    const noTyres = { ...KSA, tyre_rows: 0, tyre_no_fitment_date: 0, tyre_km_span_both: 0 }
    const d = scoreDomain(noTyres, 'tyre_life')
    expect(d.score).toBeNull()
    expect(d.measurable).toBe(false)
    expect(d.band.key).toBe('unknown')
    expect(d.note).toMatch(/cannot be judged/i)
  })

  it('scores every expense domain as null when no expenses exist at all', () => {
    const empty = {
      expense_lines: 0, expense_spend: 0, expense_lines_total: 0,
      expense_assets: 0, expense_days_since: null,
      odometer_rows: 0, engine_hours_rows: 0,
    }
    expect(scoreDomain(empty, 'tyre_cost').score).toBeNull()
  })

  it('never reports a zero score in place of a missing measurement', () => {
    const d = scoreDomain({ tyre_rows: 0 }, 'tyre_life')
    expect(d.score).not.toBe(0)
    expect(d.score).toBeNull()
  })

  it('returns a null-safe report when the RPC says unauthorized', () => {
    const r = buildTrustReport({ ok: false, reason: 'unauthorized' })
    expect(r.ok).toBe(false)
    expect(r.countries).toEqual([])
    expect(topActions(r)).toEqual([])
  })

  it('individual checks return a null score rather than 0 when undivisible', () => {
    expect(runCheck('tyre_brand', { tyre_rows: 0, tyre_no_brand: 0 }).score).toBeNull()
    expect(runCheck('expense_classification', { expense_spend: 0 }).score).toBeNull()
    expect(runCheck('expense_freshness', {}).score).toBeNull()
  })
})

// ── Rule 1: a check only counts against a KPI it affects ────────────────────
describe('a check that does not bear on a KPI does not change its score', () => {
  it('leaves tyre_cost untouched when the fleet register degrades completely', () => {
    const before = scoreDomain(KSA, 'tyre_cost')
    // Wipe every fleet and tyre register attribute. None of them bear on
    // whether the SPEND figure is right.
    const wrecked = {
      ...KSA,
      fleet_no_make: KSA.fleet_rows,
      fleet_no_vehicle_type: KSA.fleet_rows,
      tyre_no_brand: KSA.tyre_rows,
      tyre_no_unit_cost: KSA.tyre_rows,
      tyre_km_span_both: 0,
      tyre_future_dated: KSA.tyre_rows,
    }
    const after = scoreDomain(wrecked, 'tyre_cost')
    expect(after.score).toBe(before.score)
    expect(after.reasons.map((r) => r.key)).toEqual(before.reasons.map((r) => r.key))
  })

  it('leaves tyre_life untouched when all expense evidence degrades', () => {
    const before = scoreDomain(KSA, 'tyre_life')
    const after = scoreDomain({
      ...KSA,
      expense_spend_default: KSA.expense_spend,
      expense_spend_reviewed: 0,
      expense_lines_no_uid: KSA.expense_lines_total,
      expense_days_since: 400,
    }, 'tyre_life')
    expect(after.score).toBe(before.score)
  })

  it('only ever draws on the checks its domain declares', () => {
    for (const key of DOMAIN_KEYS) {
      const declared = DOMAINS[key].checks.map((c) => c.key)
      const used = scoreDomain(KSA, key).checks.map((c) => c.key)
      expect(used).toEqual(declared)
      for (const c of declared) expect(CHECK_KEYS).toContain(c)
    }
  })

  it('does move the score when a check that DOES bear on it degrades', () => {
    const before = scoreDomain(KSA, 'tyre_cost')
    const after = scoreDomain({ ...KSA, expense_spend_default: KSA.expense_spend }, 'tyre_cost')
    expect(after.score).toBeLessThan(before.score)
  })
})

// ── Rule 3: a score below 100 always carries its reasons ────────────────────
describe('the reasons list is never empty when the score is below 100', () => {
  it('holds for every real country and every domain', () => {
    for (const c of LIVE_PAYLOAD.countries) {
      const domains = scoreAllDomains(c.measures)
      for (const key of DOMAIN_KEYS) {
        const d = domains[key]
        if (d.score == null) continue
        if (d.score < 100) {
          expect(d.reasons.length, `${c.country}/${key} scored ${d.score} with no reasons`).toBeGreaterThan(0)
        } else {
          expect(d.reasons.length, `${c.country}/${key} scored 100 but listed reasons`).toBe(0)
        }
      }
    }
  })

  it('reports 99 rather than rounding a near-perfect score up to a silent 100', () => {
    // One impossible tyre record out of 6,016 is a rounding-level defect. It
    // must still be visible, because the alternative is a 100 that hides a
    // known fault.
    const nearlyPerfect = {
      tyre_rows: 6016,
      tyre_no_fitment_date: 0,
      tyre_km_span_both: 6016,
      tyre_future_dated: 1,
      tyre_removal_before_fitment: 0,
      tyre_km_backwards: 0,
    }
    const d = scoreDomain(nearlyPerfect, 'tyre_life')
    expect(d.score).toBe(99)
    expect(d.reasons.length).toBeGreaterThan(0)
    expect(d.reasons[0].detail).toMatch(/impossible/i)
  })

  it('awards a true 100 only when every bearing check is perfect', () => {
    const perfect = {
      tyre_rows: 100,
      tyre_no_fitment_date: 0,
      tyre_km_span_both: 100,
      tyre_future_dated: 0,
      tyre_removal_before_fitment: 0,
      tyre_km_backwards: 0,
    }
    const d = scoreDomain(perfect, 'tyre_life')
    expect(d.score).toBe(100)
    expect(d.reasons).toEqual([])
  })

  it('gives every reason a human explanation, never a bare number', () => {
    const d = scoreDomain(UAE, 'cost_per_km')
    expect(d.reasons.length).toBeGreaterThan(0)
    for (const r of d.reasons) {
      expect(typeof r.detail).toBe('string')
      expect(r.detail.length).toBeGreaterThan(20)
      expect(r.impact).toBeGreaterThan(0)
    }
  })

  it('ranks reasons by how many points they actually cost', () => {
    const d = scoreDomain(UAE, 'cost_per_km')
    const impacts = d.reasons.map((r) => r.impact)
    expect([...impacts].sort((a, b) => b - a)).toEqual(impacts)
  })
})

// ── The findings this engine exists to surface ──────────────────────────────
describe('real findings in this customer data', () => {
  it('rates Egypt brand performance as near worthless: no brand, no unit cost', () => {
    // All 475 Egyptian tyre records are missing brand AND price.
    const d = scoreDomain(EGYPT, 'brand_performance')
    expect(d.score).toBeLessThan(15)
    expect(d.band.tone).toBe('bad')
    expect(d.reasons.map((r) => r.key)).toContain('tyre_brand')
    expect(d.reasons.map((r) => r.key)).toContain('tyre_unit_cost')
  })

  it('flags that only KSA expense rows are protected against a re-import', () => {
    // KSA 135 of 106,646 unprotected; Egypt 42,453 of 42,531; UAE 67,576 of 67,615.
    expect(runCheck('import_identity', KSA).score).toBeGreaterThan(99)
    expect(runCheck('import_identity', EGYPT).score).toBeLessThan(1)
    expect(runCheck('import_identity', UAE).score).toBeLessThan(1)
    expect(runCheck('import_identity', EGYPT).detail).toMatch(/duplicate|again/i)
  })

  it('scores UAE cost per km below KSA because far less of it is measured', () => {
    // KSA can measure 341 of 620 spending assets; UAE only 97 of 330, and 29.5%
    // of UAE spend sits on assets missing from the fleet register.
    const ksa = scoreDomain(KSA, 'cost_per_km').score
    const uae = scoreDomain(UAE, 'cost_per_km').score
    expect(uae).toBeLessThan(ksa)
    expect(scoreDomain(UAE, 'fleet_register').reasons.map((r) => r.key))
      .toContain('expense_asset_link')
  })

  it('says plainly that no meter feed exists, in every country', () => {
    for (const m of [KSA, UAE, EGYPT]) {
      const c = runCheck('meter_source', m)
      expect(c.score).toBe(0)
      expect(c.detail).toMatch(/inferred/i)
    }
    // and it recovers the moment readings are logged
    expect(runCheck('meter_source', { ...KSA, odometer_rows: 12 }).score).toBe(100)
  })

  it('treats a fresh feed as current and a stale one as a real gap', () => {
    expect(runCheck('expense_freshness', { expense_days_since: 2 }).score).toBe(100)
    expect(runCheck('expense_freshness', { expense_days_since: 120 }).score).toBe(0)
    const mid = runCheck('expense_freshness', { expense_days_since: 48 }).score
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(100)
  })

  it('does not let unreviewed Material Master rows count as human confirmation', () => {
    // 22,089 codes exist but only a fraction of spend is reviewed; the check
    // must reflect the reviewed share, not the existence of the master.
    const c = runCheck('master_review', EGYPT)
    expect(c.score).toBeLessThan(20)
    expect(c.detail).toMatch(/Material Master/i)
  })
})

// ── Currency safety ─────────────────────────────────────────────────────────
describe('currency safety', () => {
  it('averages unitless scores across countries, never money', () => {
    const r = buildTrustReport(LIVE_PAYLOAD)
    expect(r.ok).toBe(true)
    expect(r.countries).toHaveLength(3)
    const per = r.countries.map((c) => c.domains.tyre_cost.score)
    const expected = Math.round(per.reduce((a, b) => a + b, 0) / per.length)
    expect(r.overall.tyre_cost.score).toBe(expected)
    expect(r.overall.tyre_cost.countries).toBe(3)
    // the roll-up must never be big enough to be a summed money figure
    expect(r.overall.tyre_cost.score).toBeLessThanOrEqual(100)
  })

  it('keeps each country on its own currency', () => {
    const r = buildTrustReport(LIVE_PAYLOAD)
    expect(r.countries.map((c) => c.currency).sort()).toEqual(['AED', 'EGP', 'SAR'])
  })

  it('excludes unmeasurable countries from the roll-up instead of scoring them 0', () => {
    const r = buildTrustReport({
      ...LIVE_PAYLOAD,
      countries: [
        { country: 'KSA', currency: 'SAR', measures: KSA },
        { country: 'Oman', currency: 'OMR', measures: { tyre_rows: 0 } },
      ],
    })
    expect(r.overall.tyre_life.countries).toBe(1)
    expect(r.overall.tyre_life.score).toBe(scoreDomain(KSA, 'tyre_life').score)
  })
})

// ── Structural guarantees ───────────────────────────────────────────────────
describe('engine structure', () => {
  it('bands a score honestly, including the unknown case', () => {
    expect(trustBand(92).key).toBe('high')
    expect(trustBand(75).key).toBe('good')
    expect(trustBand(55).key).toBe('moderate')
    expect(trustBand(35).key).toBe('low')
    expect(trustBand(5).key).toBe('very_low')
    expect(trustBand(null).key).toBe('unknown')
    expect(trustBand(null).label).toBe('Not measurable')
  })

  it('clamps every check into 0..100', () => {
    for (const c of runAllChecks(KSA)) {
      if (c.score == null) continue
      expect(c.score).toBeGreaterThanOrEqual(0)
      expect(c.score).toBeLessThanOrEqual(100)
    }
  })

  it('declares a dimension and a plain-English purpose for every check', () => {
    for (const key of CHECK_KEYS) {
      const c = CHECKS[key]
      expect(c.label.length).toBeGreaterThan(0)
      expect(['completeness', 'consistency', 'timeliness', 'provenance', 'coverage'])
        .toContain(c.dimension)
      expect(c.measures.length).toBeGreaterThan(20)
    }
  })

  it('uses no dash punctuation in any user-facing string', () => {
    const strings = []
    for (const key of CHECK_KEYS) {
      strings.push(CHECKS[key].label, CHECKS[key].measures)
      for (const m of [KSA, UAE, EGYPT, {}]) {
        const r = runCheck(key, m)
        if (r) strings.push(r.detail)
      }
    }
    for (const key of DOMAIN_KEYS) strings.push(DOMAINS[key].label, DOMAINS[key].question)
    for (const s of strings) expect(s).not.toMatch(/[–—]/)
  })

  it('ranks the work list by total confidence cost across domains', () => {
    const actions = topActions(buildTrustReport(LIVE_PAYLOAD), 5)
    expect(actions.length).toBeGreaterThan(0)
    expect(actions.length).toBeLessThanOrEqual(5)
    const impacts = actions.map((a) => a.impact)
    expect([...impacts].sort((a, b) => b - a)).toEqual(impacts)
    for (const a of actions) {
      expect(a.country).toBeTruthy()
      expect(a.affects.length).toBeGreaterThan(0)
    }
  })

  it('exports every domain and check per country with N/A for the unmeasurable', () => {
    const { rows, columns, headers } = trustExportRows(buildTrustReport(LIVE_PAYLOAD))
    expect(columns).toHaveLength(headers.length)
    expect(rows.length).toBe(3 * (DOMAIN_KEYS.length + CHECK_KEYS.length))
    const empty = trustExportRows(buildTrustReport({
      ok: true, countries: [{ country: 'Oman', currency: 'OMR', measures: {} }],
    }))
    expect(empty.rows.some((r) => r.confidence === 'N/A')).toBe(true)
    expect(empty.rows.every((r) => !String(r.confidence).includes('-'))).toBe(true)
  })

  it('returns null for an unknown domain or check rather than throwing', () => {
    expect(scoreDomain(KSA, 'not_a_domain')).toBeNull()
    expect(runCheck('not_a_check', KSA)).toBeNull()
  })
})
