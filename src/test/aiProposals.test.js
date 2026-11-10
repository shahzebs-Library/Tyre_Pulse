import { describe, it, expect } from 'vitest'
import {
  detectProposals, detectCriticalFindingsWithoutAction, detectRepeatedFailures, detectCpkSpikes,
  detectAbnormalConsumption, detectPrematureRemovals, detectWarrantyOpportunities, detectOverdueActions,
  detectTyresOverdueNoAction, detectDataIntegrity, summarizeProposals, PROPOSAL_TYPES, SEVERITIES, DEFAULTS,
} from '../lib/aiProposals'

const NOW = new Date('2026-11-10T08:00:00Z')

describe('critical findings without action', () => {
  const insp = { id: 'i1', asset_no: 'TM514', country: 'KSA', inspection_date: '2026-11-01', tyre_conditions: { LHF1: { condition: 'Damaged' }, RHF1: { condition: 'Good' } } }
  it('proposes when no corrective action is linked', () => {
    const out = detectCriticalFindingsWithoutAction({ inspections: [insp], correctiveActions: [] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ proposal_type: 'critical_finding_no_action', severity: 'critical', dedupe_key: 'critical_finding:i1' })
    expect(out[0].evidence).toEqual([{ table: 'inspections', id: 'i1' }])
  })
  it('stays silent when an action already covers the inspection', () => {
    const out = detectCriticalFindingsWithoutAction({ inspections: [insp], correctiveActions: [{ source_type: 'inspection', source_id: 'i1' }] })
    expect(out).toHaveLength(0)
  })
  it('wear alone is not critical', () => {
    const worn = { ...insp, tyre_conditions: { LHF1: { condition: 'Worn' } } }
    expect(detectCriticalFindingsWithoutAction({ inspections: [worn] })).toHaveLength(0)
  })
})

describe('repeated failures', () => {
  const rows = [
    { id: 't1', asset_no: 'TM1', tyre_position: 'LHF1', country: 'KSA', removal_date: '2026-09-01', removal_reason: 'PUNCTURE' },
    { id: 't2', asset_no: 'tm1', tyre_position: 'lhf1', country: 'KSA', removal_date: '2026-10-01', removal_reason: 'SIDE WALL DAMAGE' },
    { id: 't3', asset_no: 'TM1', tyre_position: 'LHF1', country: 'KSA', removal_date: '2026-10-05', removal_reason: 'Normal wear' },
    { id: 't4', asset_no: 'TM1', tyre_position: 'LHF1', country: 'KSA', removal_date: '2025-01-01', removal_reason: 'PUNCTURE' },
  ]
  it('groups case-insensitively, ignores normal wear and old removals', () => {
    const out = detectRepeatedFailures({ tyres: rows }, DEFAULTS, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].metrics.failures).toBe(2)
    expect(out[0].severity).toBe('medium')
    expect(out[0].dedupe_key).toBe('repeat_failure:KSA|TM1|LHF1')
  })
})

describe('cpk spikes', () => {
  it('flags rises above the threshold and skips missing priors', () => {
    const out = detectCpkSpikes({ cpkWindows: [
      { scope: 'fleet', country: 'KSA', currency: 'SAR', current: 0.03, prior: 0.02, period: '2026-10' },
      { scope: 'pumps', country: 'KSA', current: 0.021, prior: 0.02 },
      { scope: 'x', country: 'UAE', current: 0.5, prior: null },
      { scope: 'y', country: 'UAE', current: 0.5, prior: 0 },
    ] })
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('high')
    expect(out[0].metrics.change_pct).toBe(50)
  })
})

describe('abnormal consumption', () => {
  const base = ['2026-04', '2026-05', '2026-06', '2026-07'].map((m) => ({ month: m, country: 'KSA', count: 100 }))
  it('flags a month far above the recent average', () => {
    const out = detectAbnormalConsumption({ monthlyConsumption: [...base, { month: '2026-08', country: 'KSA', count: 260 }] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ dedupe_key: 'consumption:KSA|2026-08', severity: 'high' })
  })
  it('does not flag normal months or thin history', () => {
    expect(detectAbnormalConsumption({ monthlyConsumption: [...base, { month: '2026-08', country: 'KSA', count: 110 }] })).toHaveLength(0)
    expect(detectAbnormalConsumption({ monthlyConsumption: base.slice(0, 2) })).toHaveLength(0)
  })
})

describe('premature removals and warranty', () => {
  const tyres = [
    // mixer cap 80,000: 10,000 km = 12.5%
    { id: 'p1', serial_no: 'ABC12345', asset_no: 'TM1', vehicle_type: 'TR-MIXER', km_at_fitment: 5000, km_at_removal: 15000, removal_date: '2026-10-01', removal_reason: 'PUNCTURE' },
    // manufacturing defect -> warranty, not premature
    { id: 'w1', serial_no: 'DEF12345', asset_no: 'TM2', vehicle_type: 'TR-MIXER', km_at_fitment: 5000, km_at_removal: 15000, removal_date: '2026-10-02', removal_reason: 'Tread separation' },
    // placeholder fitment km -> cannot be trusted
    { id: 'p2', serial_no: 'GHI12345', asset_no: 'TM3', vehicle_type: 'TR-MIXER', km_at_fitment: 1, total_km: 300000, removal_date: '2026-10-03', removal_reason: 'WORN' },
    // healthy life
    { id: 'p3', serial_no: 'JKL12345', asset_no: 'TM4', vehicle_type: 'TR-MIXER', km_at_fitment: 1000, km_at_removal: 70000, removal_date: '2026-10-04', removal_reason: 'WORN' },
  ]
  it('premature only on trusted km below the share of class life', () => {
    const out = detectPrematureRemovals({ tyres })
    expect(out.map((p) => p.dedupe_key)).toEqual(['premature:p1'])
    expect(out[0].severity).toBe('high')
  })
  it('warranty only for manufacturing-type reasons, never already claimed', () => {
    expect(detectWarrantyOpportunities({ tyres }).map((p) => p.dedupe_key)).toEqual(['warranty:w1'])
    expect(detectWarrantyOpportunities({ tyres, warrantyClaims: [{ serial_number: 'DEF12345' }] })).toHaveLength(0)
  })
})

describe('overdue corrective actions', () => {
  it('flags open actions past due', () => {
    const out = detectOverdueActions({ correctiveActions: [
      { id: 'c1', title: 'Fix', status: 'Open', due_date: '2026-10-01', priority: 'Medium' },
      { id: 'c2', title: 'Done', status: 'Closed', due_date: '2026-10-01' },
      { id: 'c3', title: 'Later', status: 'Open', due_date: '2026-12-01' },
    ] }, DEFAULTS, NOW)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ dedupe_key: 'overdue_action:c1', severity: 'high' })
    expect(out[0].metrics.days_overdue).toBe(40)
  })
})

describe('tyre overdue with no action', () => {
  const row = { asset: 'TM9', position: 'LHF1', serial: 'S1', country: 'KSA', unit: 'km', remainingKm: 0, lifeUsedPct: 120, expectedLifeKm: 60000 }
  it('flags an overdue tyre on an asset with no open action', () => {
    expect(detectTyresOverdueNoAction({ runningLife: [row] })).toHaveLength(1)
    expect(detectTyresOverdueNoAction({ runningLife: [row], correctiveActions: [{ asset_no: 'tm9', status: 'Open' }] })).toHaveLength(0)
  })
})

describe('data integrity', () => {
  it('buckets issues per country and flags a serial active on two vehicles', () => {
    const out = detectDataIntegrity({ tyres: [
      { id: 'd1', country: 'KSA', issue_date: '2026-05-01', removal_date: '2026-04-01' },
      { id: 'd2', country: 'KSA', serial_no: 'YMA55312', asset_no: 'TM1', status: 'Active' },
      { id: 'd3', country: 'KSA', serial_no: 'YMA55312', asset_no: 'TM2', status: 'Active' },
      { id: 'd4', country: 'KSA', serial_no: 'NO SERIAL', asset_no: 'TM3', status: 'Active' },
      { id: 'd5', country: 'KSA', serial_no: 'NO SERIAL', asset_no: 'TM4', status: 'Active' },
    ] })
    const keys = out.map((p) => p.dedupe_key).sort()
    expect(keys).toEqual(['data:reversed_dates|KSA', 'data:serial_two_assets|KSA'])
    expect(out.find((p) => p.dedupe_key.startsWith('data:serial')).evidence).toHaveLength(2)
  })
})

describe('detectProposals', () => {
  it('is deterministic, deduped, sorted worst first and uses known enums', () => {
    const input = {
      inspections: [{ id: 'i1', asset_no: 'TM1', tyre_conditions: [{ position: 'LHF1', condition: 'Burst' }] }],
      correctiveActions: [{ id: 'c1', title: 'x', status: 'Open', due_date: '2026-01-01' }],
    }
    const a = detectProposals(input, { now: NOW })
    const b = detectProposals(input, { now: NOW })
    expect(a).toEqual(b)
    expect(a[0].severity).toBe('critical')
    for (const p of a) {
      expect(PROPOSAL_TYPES).toContain(p.proposal_type)
      expect(SEVERITIES).toContain(p.severity)
    }
    expect(new Set(a.map((p) => p.dedupe_key)).size).toBe(a.length)
    expect(summarizeProposals(a).bySeverity.critical).toBe(1)
  })
  it('caps output per type', () => {
    const correctiveActions = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, title: 't', status: 'Open', due_date: '2026-01-01' }))
    expect(detectProposals({ correctiveActions }, { now: NOW, config: { maxPerType: 3 } })).toHaveLength(3)
  })
  it('empty input yields no proposals', () => {
    expect(detectProposals({}, { now: NOW })).toEqual([])
  })
})
