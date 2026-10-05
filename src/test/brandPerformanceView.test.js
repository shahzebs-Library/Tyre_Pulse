import { describe, it, expect } from 'vitest'
import {
  brandFilterOptions, filterByClassAndSize, warrantyByBrand, brandScoreboard, brandHeadlines,
  brandInsight, rankingBars, failureBars, brandInitials, scoreTone, failureTone, scoreboardExportRows,
} from '../lib/brandPerformanceView'

const t = (brand, extra = {}) => ({ brand, site: 'NHC', size: '315/80R22.5', vehicle_type: 'TR-MIXER', ...extra })
const rows = [
  t('Alpha', { risk_level: 'Low', cost_per_tyre: 1000, km_at_fitment: 1000, km_at_removal: 101000, category: 'New' }),
  t('Alpha', { risk_level: 'High', cost_per_tyre: 1000, km_at_fitment: 1000, km_at_removal: 81000, category: 'Retread' }),
  t('Beta', { risk_level: 'Critical', cost_per_tyre: 1200, km_at_fitment: 500, km_at_removal: 40500 }),
  t('Beta', { risk_level: 'High', cost_per_tyre: 1200, km_at_fitment: 500, km_at_removal: 60500, size: '385/65R22.5' }),
  t('Gamma', { vehicle_type: 'PUMPS' }),
]
const claims = [
  { brand: 'Alpha', claim_status: 'Credit Issued', credit_amount: 500 },
  { brand: 'Alpha', claim_status: 'Rejected', credit_amount: 0 },
  { brand: 'Beta', claim_status: 'Submitted' },
]

describe('brandPerformanceView', () => {
  it('offers distinct classes and sizes and filters by them', () => {
    const o = brandFilterOptions(rows)
    expect(o.classes).toEqual(['PUMPS', 'TR-MIXER'])
    expect(o.sizes).toEqual(['315/80R22.5', '385/65R22.5'])
    expect(filterByClassAndSize(rows, { assetClass: 'PUMPS' })).toHaveLength(1)
    expect(filterByClassAndSize(rows, { size: '385/65R22.5' })).toHaveLength(1)
    expect(filterByClassAndSize(rows)).toHaveLength(5)
  })

  it('groups warranty claims: decided, accepted and credited money', () => {
    const w = warrantyByBrand(claims)
    expect(w.get('Alpha')).toMatchObject({ claims: 2, decided: 2, accepted: 1, credit: 500, credited: 1 })
    expect(w.get('Beta')).toMatchObject({ claims: 1, decided: 0, credit: 0 })
  })

  it('builds measured rows and nulls what has no source', () => {
    const b = brandScoreboard(rows, { claims })
    const alpha = b.find((r) => r.brand === 'Alpha')
    expect(alpha.tyres).toBe(2)
    expect(alpha.avgLifeKm).toBe(90000)
    expect(alpha.failurePct).toBe(50)
    expect(alpha.retreadPct).toBe(50)
    expect(alpha.purchaseCost).toBe(2000)
    expect(alpha.warrantyAcceptPct).toBe(50)
    expect(alpha.warrantyRecovery).toBe(500)
    const gamma = b.find((r) => r.brand === 'Gamma')
    expect(gamma.avgLifeKm).toBeNull()
    expect(gamma.failurePct).toBeNull()
    expect(gamma.avgCpk).toBeNull()
    expect(gamma.retreadPct).toBeNull()
    expect(gamma.score).toBeNull()
    expect(b.find((r) => r.brand === 'Beta').warrantyAcceptPct).toBeNull()
  })

  it('scores only with two or more components and ranks best first', () => {
    const b = brandScoreboard(rows, { claims })
    expect(b[0].brand).toBe('Alpha')
    expect(b[0].scoreParts).toEqual(expect.arrayContaining(['life', 'cpk', 'failure', 'warranty']))
    expect(b[0].score).toBeGreaterThan(b[1].score)
    expect(b[b.length - 1].brand).toBe('Gamma')
  })

  it('nulls every money figure on a mixed-currency scope', () => {
    const b = brandScoreboard(rows, { claims, money: false })
    const alpha = b.find((r) => r.brand === 'Alpha')
    expect(alpha.avgCpk).toBeNull()
    expect(alpha.purchaseCost).toBeNull()
    expect(alpha.warrantyRecovery).toBeNull()
    expect(alpha.avgLifeKm).toBe(90000)
  })

  it('picks headlines and writes insights only from measured figures', () => {
    const b = brandScoreboard(rows, { claims })
    const h = brandHeadlines(b)
    expect(h.best.brand).toBe('Alpha')
    expect(h.worstFailure.brand).toBe('Beta')
    const lines = brandInsight(b)
    expect(lines.join(' ')).toMatch(/Alpha has the best composite score/)
    expect(lines.join(' ')).toMatch(/Beta shows the highest failure rate at 100.0%/)
    expect(brandInsight(b, 'Gamma').join(' ')).toMatch(/cannot be measured/)
    expect(brandInsight(b, 'Missing')).toEqual([])
    expect(brandInsight([])).toEqual([])
  })

  it('shapes bars, initials, tones and export rows', () => {
    const b = brandScoreboard(rows, { claims })
    expect(rankingBars(b).map((x) => x.brand)).toEqual(['Alpha', 'Beta'])
    expect(failureBars(b).map((x) => x.brand)).toEqual(['Alpha', 'Beta'])
    expect(brandInitials('Double Coin')).toBe('DC')
    expect(brandInitials('Michelin')).toBe('MI')
    expect(brandInitials('')).toBe('NA')
    expect(scoreTone(85)).toBe('good')
    expect(scoreTone(65)).toBe('warn')
    expect(scoreTone(10)).toBe('bad')
    expect(scoreTone(null)).toBeNull()
    expect(failureTone(40)).toBe('bad')
    expect(failureTone(null)).toBeNull()
    const ex = scoreboardExportRows(b)
    expect(ex.find((r) => r.brand === 'Gamma').score).toBe('N/A')
  })
})
