import { describe, it, expect } from 'vitest'
import {
  termDays,
  annualizedValue,
  enrichContract,
  enrichContracts,
  buildContractKpis,
  statusDistribution,
  valueByType,
  valueByVendor,
  renewalPipeline,
  nextRenewal,
  autoRenewSplit,
  expiringWithin,
  isLiveStatus,
  STATUS_BANDS,
} from './contractsAnalytics'

// Fixed reference clock (UTC) for deterministic assertions.
const NOW = Date.parse('2026-06-15T12:00:00.000Z')

function addDays(days) {
  return new Date(NOW + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const rows = [
  // active, 200d out, 1yr term, value 12000
  { id: 'a', title: 'Supply A', vendor: 'Michelin', contract_type: 'supply', value: 12000, start_date: '2025-12-27', end_date: addDays(200), status: 'active' },
  // expiring soon (20d), value 6000, 6mo term
  { id: 'b', title: 'Service B', vendor: 'Bridgestone', contract_type: 'service', value: 6000, start_date: addDays(-160), end_date: addDays(20), status: 'active' },
  // expired (30d ago), value 5000
  { id: 'c', title: 'Lease C', vendor: 'Michelin', contract_type: 'lease', value: 5000, start_date: '2025-01-01', end_date: addDays(-30), status: 'active' },
  // pending, no dates, value 3000
  { id: 'd', title: 'Pending D', vendor: 'Goodyear', contract_type: 'service', value: 3000, status: 'pending' },
  // cancelled, value 9999 (excluded from live value)
  { id: 'e', title: 'Cancelled E', vendor: 'Michelin', contract_type: 'supply', value: 9999, start_date: '2025-01-01', end_date: addDays(100), status: 'cancelled' },
  // active, no value, no end -> live but no value
  { id: 'f', title: 'Open F', vendor: '', contract_type: '', status: 'active' },
]

describe('termDays / annualizedValue', () => {
  it('computes term length in whole days', () => {
    expect(termDays({ start_date: '2026-01-01', end_date: '2026-01-31' })).toBe(30)
  })
  it('returns null when a date is missing or non-positive', () => {
    expect(termDays({ start_date: '2026-01-01' })).toBeNull()
    expect(termDays({ start_date: '2026-02-01', end_date: '2026-01-01' })).toBeNull()
  })
  it('annualizes value over its term (short term scales up)', () => {
    const v = annualizedValue({ value: 1000, start_date: '2026-01-01', end_date: '2026-07-01' })
    expect(v).toBeGreaterThan(1000)
    // ~181 day term -> roughly double
    expect(Math.round(v)).toBe(Math.round((1000 * 365) / 181))
  })
  it('is null (not 0) when value or term is missing', () => {
    expect(annualizedValue({ value: 1000 })).toBeNull()
    expect(annualizedValue({ start_date: '2026-01-01', end_date: '2027-01-01' })).toBeNull()
  })
})

describe('enrichContract', () => {
  it('adds derived lifecycle fields non-mutatingly', () => {
    const src = rows[0]
    const out = enrichContract(src, NOW)
    expect(out._status).toBe('active')
    expect(out._days).toBe(200)
    expect(out._value).toBe(12000)
    expect(out._annualized).toBeGreaterThan(0)
    expect(src._status).toBeUndefined() // original untouched
  })
  it('marks a 20-day contract expiring-soon', () => {
    expect(enrichContract(rows[1], NOW)._status).toBe('expiring-soon')
  })
})

describe('buildContractKpis', () => {
  const k = buildContractKpis(rows, NOW)
  it('counts total and active', () => {
    expect(k.total).toBe(6)
    // active statuses: a (active), f (active) ; b is expiring-soon
    expect(k.active).toBe(2)
  })
  it('counts pending, cancelled, expired', () => {
    expect(k.pending).toBe(1)
    expect(k.cancelled).toBe(1)
    expect(k.expired).toBe(1)
  })
  it('counts expiring within 60d and 30d windows', () => {
    expect(k.expiringSoonCount).toBe(1) // b @20d
    expect(k.expiringUrgentCount).toBe(1)
  })
  it('sums live value excluding expired + cancelled', () => {
    // live: a(12000) + b(6000) + d(3000) + f(no value) = 21000
    expect(k.totalValue).toBe(21000)
  })
  it('exposes next renewal', () => {
    expect(k.nextRenewal.contract.id).toBe('b')
    expect(k.nextRenewal.daysRemaining).toBe(20)
  })
  it('honors a custom urgent window', () => {
    const k2 = buildContractKpis(rows, NOW, { urgentDays: 10 })
    expect(k2.expiringUrgentCount).toBe(0)
  })
  it('gives a numeric or null annualized live value', () => {
    expect(k.liveAnnualizedValue == null || k.liveAnnualizedValue > 0).toBe(true)
  })
})

describe('statusDistribution', () => {
  it('returns only nonzero bands, in order', () => {
    const dist = statusDistribution(rows, NOW)
    const total = dist.reduce((s, b) => s + b.count, 0)
    expect(total).toBe(6)
    expect(dist.every((b) => b.count > 0)).toBe(true)
    const keys = dist.map((b) => b.key)
    // order follows STATUS_BANDS
    const order = STATUS_BANDS.map((b) => b.key)
    const sorted = [...keys].sort((x, y) => order.indexOf(x) - order.indexOf(y))
    expect(keys).toEqual(sorted)
  })
  it('handles an empty list', () => {
    expect(statusDistribution([], NOW)).toEqual([])
  })
})

describe('valueByType / valueByVendor', () => {
  it('groups by type, sorted by value desc', () => {
    const t = valueByType(rows, NOW)
    // supply: a(12000)+e(9999)=21999 highest
    expect(t[0].type).toBe('supply')
    expect(t[0].value).toBe(21999)
    expect(t[0].count).toBe(2)
  })
  it('labels missing type as Unspecified', () => {
    const t = valueByType(rows, NOW)
    expect(t.some((x) => x.type === 'Unspecified')).toBe(true)
  })
  it('groups by vendor and top-N limits', () => {
    const v = valueByVendor(rows, NOW, { limit: 2 })
    expect(v.length).toBe(2)
    expect(v[0].type).toBe('Michelin') // 12000+5000+9999
    expect(v[0].value).toBe(26999)
  })
  it('labels empty vendor as Unassigned', () => {
    const v = valueByVendor(rows, NOW)
    expect(v.some((x) => x.type === 'Unassigned')).toBe(true)
  })
})

describe('renewalPipeline', () => {
  it('produces a continuous forward window of buckets', () => {
    const p = renewalPipeline(rows, NOW, { months: 12 })
    expect(p.length).toBe(12)
    expect(p[0].key).toBe('2026-06') // month of NOW
  })
  it('buckets contracts by end-date month within window', () => {
    const p = renewalPipeline(rows, NOW, { months: 12 })
    const total = p.reduce((s, b) => s + b.count, 0)
    // a(+200d ~Jan2027 out of 12mo window from Jun26? +200d = ~Jan 1 2027, within 12), b(+20d Jul26), e(+100d Sep26 cancelled still bucketed by date)
    // c expired (-30d) excluded, d/f no end excluded
    expect(total).toBeGreaterThanOrEqual(2)
    const july = p.find((b) => b.key === '2026-07')
    expect(july.count).toBe(1) // contract b
    expect(july.contracts[0].id).toBe('b')
  })
  it('omits contracts with no end date', () => {
    const p = renewalPipeline([{ id: 'x', title: 'No end' }], NOW)
    expect(p.reduce((s, b) => s + b.count, 0)).toBe(0)
  })
})

describe('nextRenewal', () => {
  it('finds the soonest upcoming non-cancelled end date', () => {
    const nr = nextRenewal(rows, NOW)
    expect(nr.contract.id).toBe('b')
  })
  it('returns null when nothing is upcoming', () => {
    expect(nextRenewal([rows[2]], NOW)).toBeNull() // only an expired one
    expect(nextRenewal([], NOW)).toBeNull()
  })
})

describe('autoRenewSplit', () => {
  it('reports not-available when no column exists', () => {
    const s = autoRenewSplit(rows, NOW)
    expect(s.available).toBe(false)
  })
  it('splits when the field is present', () => {
    const s = autoRenewSplit([
      { id: '1', auto_renew: true, status: 'active' },
      { id: '2', auto_renew: false, status: 'active' },
      { id: '3', auto_renew: true, status: 'active' },
    ], NOW)
    expect(s.available).toBe(true)
    expect(s.auto).toBe(2)
    expect(s.manual).toBe(1)
  })
})

describe('expiringWithin', () => {
  it('lists soonest-first contracts inside the window', () => {
    const list = expiringWithin(rows, NOW, 60)
    expect(list.length).toBe(1)
    expect(list[0].id).toBe('b')
    expect(list[0].daysRemaining).toBe(20)
  })
  it('excludes expired and cancelled', () => {
    const list = expiringWithin(rows, NOW, 400)
    expect(list.some((c) => c.id === 'c')).toBe(false) // expired
    expect(list.some((c) => c.id === 'e')).toBe(false) // cancelled
  })
})

describe('isLiveStatus', () => {
  it('classifies live vs terminal', () => {
    expect(isLiveStatus('active')).toBe(true)
    expect(isLiveStatus('expiring-soon')).toBe(true)
    expect(isLiveStatus('pending')).toBe(true)
    expect(isLiveStatus('expired')).toBe(false)
    expect(isLiveStatus('cancelled')).toBe(false)
  })
})

describe('enrichContracts', () => {
  it('handles non-array input', () => {
    expect(enrichContracts(null, NOW)).toEqual([])
  })
})
