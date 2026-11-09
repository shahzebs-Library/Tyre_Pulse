import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSiteHistory, siteAtDate, PLACEHOLDER_SITES } from '../lib/assetSiteHistory'

const wo = (asset, site, opened_at, o = {}) => ({ organisation_id: 'org', country: 'KSA', asset_no: asset, site, opened_at, ...o })
const reg = (asset, site, o = {}) => ({ organisation_id: 'org', country: 'KSA', asset_no: asset, site, ...o })
const TODAY = '2026-11-09'

describe('asset site history', () => {
  it('an asset that moved between branches gets two periods and the right site on each date', () => {
    const h = buildSiteHistory({
      today: TODAY,
      workOrders: [
        wo('TM1', 'NHC', '2025-01-05'), wo('TM1', 'NHC', '2025-01-20'), wo('TM1', 'NHC', '2025-02-10'),
        wo('TM1', 'DIRIYAH', '2025-04-03'), wo('TM1', 'diriyah ', '2025-05-01'), wo('TM1', 'DIRIYAH', '2025-06-01'),
      ],
      fleet: [reg('TM1', 'DIRIYAH')],
    })
    expect(h.map((p) => [p.site, p.valid_from, p.valid_to, p.confidence])).toEqual([
      ['NHC', '2025-01-05', '2025-04-02', 'confirmed'],
      ['DIRIYAH', '2025-04-03', null, 'confirmed'],
    ])
    expect(siteAtDate(h, 'tm1', '2025-02-15')).toEqual({ site: 'NHC', provisional: false, evidence: 'job_cards' })
    expect(siteAtDate(h, 'TM1', '2026-01-01')).toEqual({ site: 'DIRIYAH', provisional: false, evidence: 'job_cards' })
    expect(siteAtDate(h, 'TM1', '2024-01-01')).toEqual({ site: 'NHC', provisional: true, evidence: 'before_first_evidence' })
  })

  it('a missing branch is provisional: no job cards, a placeholder site, or thin evidence', () => {
    const h = buildSiteHistory({
      today: TODAY,
      workOrders: [wo('TM2', 'KSA', '2025-01-01'), wo('TM3', 'NHC', '2025-01-01')],
      fleet: [reg('TM2', 'AMAALA'), reg('TM4', 'JED')],
    })
    expect(siteAtDate(h, 'TM2', '2025-03-01')).toEqual({ site: 'AMAALA', provisional: true, evidence: 'register_current_only' })
    expect(siteAtDate(h, 'TM4', '2025-03-01')).toEqual({ site: 'JED', provisional: true, evidence: 'register_current_only' })
    expect(siteAtDate(h, 'TM3', '2025-03-01')).toEqual({ site: 'NHC', provisional: true, evidence: 'job_cards' })
    expect(siteAtDate(h, 'NOPE', '2025-03-01')).toEqual({ site: null, provisional: true, evidence: 'none' })
    expect(PLACEHOLDER_SITES).toContain('KSA')
  })

  it('latest job cards disagree with the register: closed at the last card, register period provisional', () => {
    const h = buildSiteHistory({
      today: TODAY,
      workOrders: [wo('BH6', 'RIY-SAL', '2020-06-25'), wo('BH6', 'RIY-SAL', '2020-07-08')],
      fleet: [reg('BH6', 'KSP-TP')],
    })
    expect(h.map((p) => [p.site, p.valid_from, p.valid_to, p.evidence, p.confidence])).toEqual([
      ['RIY-SAL', '2020-06-25', '2020-07-08', 'job_cards', 'provisional'],
      ['KSP-TP', '2020-07-09', null, 'register_current', 'provisional'],
    ])
    expect(siteAtDate(h, 'BH6', '2025-06-01')).toEqual({ site: 'KSP-TP', provisional: true, evidence: 'register_current' })
  })

  it('a flip-flop month or a tie stays provisional; future dates and other countries are ignored', () => {
    const h = buildSiteHistory({
      today: TODAY,
      workOrders: [
        wo('TM5', 'NHC', '2025-01-01'), wo('TM5', 'JED', '2025-01-02'),
        wo('TM5', 'NHC', '2025-02-01'), wo('TM5', 'NHC', '2025-02-02'),
        wo('TM5', 'JED', '2027-01-01'),
        wo('TM5', 'DUBAI', '2025-01-01', { country: 'UAE' }),
      ],
      fleet: [reg('TM5', 'NHC')],
    })
    const ksa = h.filter((p) => p.country === 'KSA')
    // January is a tie (latest card wins, JED) so it stays provisional; February is thin
    expect(ksa.map((p) => [p.site, p.confidence])).toEqual([['JED', 'provisional'], ['NHC', 'provisional']])
    expect(siteAtDate(h, 'TM5', '2025-02-10', { country: 'UAE' })).toEqual({ site: 'DUBAI', provisional: true, evidence: 'job_cards' })
  })

  it('SQL mirror: same evidence, placeholders and thresholds', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261110101000_asset_site_history.sql'), 'utf8')
    expect(sql).toContain("not in ('KSA', 'UAE', 'EGYPT', 'SAUDI ARABIA')")
    expect(sql).toContain('job_cards >= 3 and months >= 2 and min_share >= 0.8 and not any_tie')
    for (const ev of ["'job_cards'", "'register_current'", "'register_current_only'", "'before_first_evidence'"]) expect(sql).toContain(ev)
    expect(sql).toMatch(/order by n desc, last_d desc, site/)
    expect(sql).toMatch(/revoke all on function public\.asset_site_at\(text, text, date\) from public, anon/)
  })
})
