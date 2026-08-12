import { describe, it, expect } from 'vitest'
import {
  shapeProposals, filterStations, mappingSummary, acceptancePlan, acceptOne,
  ambiguousPairs, regionImpact, proposedRegions, evidenceNote, siteParent,
  confidenceMeta, stationStatusMeta, CONFIDENCE_META,
} from '../lib/stationMapping'

/**
 * Every case here is a real plant from the KSA production file. The Diriyah
 * gates and the Riyadh plants are the two shapes this engine exists for: one
 * where the place is certain and the plant is not, and one where nothing in the
 * text names a place at all.
 */

const diriyah39 = {
  station: '39', loads: 12000, m3: 96000, with_project: 11800, status: 'proposed',
  proposed_site: 'DIRIYAH-G1', site_share: 52, matched_m3: 90000,
  keywords: 'diriyah, gate', runner_up: 'DIRIYAH-G2', site_confidence: 'low',
  proposed_region: 'CENTRAL', region_share: 100, region_confidence: 'high',
  candidates: [
    { site: 'DIRIYAH-G1', score: 52, share: 52, matched_m3: 46800, keywords: 'diriyah', evidence: ['Diriyah Gate Package 4'] },
    { site: 'DIRIYAH-G2', score: 48, share: 48, matched_m3: 43200, keywords: 'diriyah', evidence: ['Diriyah Gate Package 7'] },
  ],
}

const riyadh81 = {
  station: '81', loads: 4000, m3: 31000, with_project: 3900, status: 'proposed',
  proposed_site: null, site_share: null, matched_m3: 30000,
  keywords: 'riyadh', runner_up: null, site_confidence: 'none',
  proposed_region: 'CENTRAL', region_share: 96, region_confidence: 'high',
  candidates: [{ site: null, score: 10, share: 96, matched_m3: 30000, keywords: 'riyadh', evidence: ['VARIOUS PROJECTS @ RIYADH'] }],
}

const jeddah70 = {
  station: '70', loads: 900, m3: 7200, with_project: 850, status: 'proposed',
  proposed_site: 'DHAHBAN', site_share: 91, matched_m3: 7000,
  keywords: 'dhahban', runner_up: 'JED', site_confidence: 'high',
  proposed_region: 'WESTERN', region_share: 99, region_confidence: 'high',
  candidates: [{ site: 'DHAHBAN', score: 91, share: 91, matched_m3: 7000, keywords: 'dhahban', evidence: ['Dhahban STP'] }],
}

const namedSite = {
  station: 'Diriyah-G1', loads: 500, m3: 4000, with_project: 480, status: 'named',
  named_site: 'DIRIYAH-G1', proposed_region: 'CENTRAL', region_confidence: 'high',
}

const noEvidence = {
  station: '96', loads: 200, m3: 1500, with_project: 0, status: 'no_evidence',
  site_confidence: 'none', region_confidence: 'none',
}

const payload = { ok: true, country: 'KSA', stations: [diriyah39, riyadh81, jeddah70, namedSite, noEvidence] }
const shaped = () => shapeProposals(payload).stations

describe('shapeProposals', () => {
  it('separates a failed read from an empty register', () => {
    // Opposite statements. An error rendered as an empty list reads as a
    // country with no batching plants at all.
    const failed = shapeProposals({ ok: false, reason: 'forbidden' })
    expect(failed.ok).toBe(false)
    expect(failed.reason).toBe('forbidden')
    expect(failed.stations).toEqual([])

    const empty = shapeProposals({ ok: true, country: 'KSA', stations: [] })
    expect(empty.ok).toBe(true)
    expect(empty.reason).toBeNull()
    expect(empty.stations).toEqual([])
  })

  it('never throws on junk', () => {
    for (const bad of [null, undefined, 'nope', 42, {}, { ok: true }]) {
      expect(() => shapeProposals(bad)).not.toThrow()
    }
    expect(shapeProposals(null).ok).toBe(false)
    expect(shapeProposals({ ok: true, stations: 'not a list' }).stations).toEqual([])
  })

  it('splits the comma separated keywords and keeps an unmeasured share null', () => {
    const [d] = shaped()
    expect(d.keywords).toEqual(['diriyah', 'gate'])
    const r = shaped()[1]
    expect(r.site_share).toBeNull()
    expect(r.site_confidence).toBe('none')
  })

  it('records what a station resolves to today, and on whose word', () => {
    const list = shaped()
    expect(list.find((s) => s.station === 'Diriyah-G1').resolved_by).toBe('named')
    expect(list.find((s) => s.station === '39').resolved_by).toBeNull()
    expect(list.find((s) => s.station === '39').resolved_site).toBeNull()
  })
})

describe('meta lookups', () => {
  it('treats anything unrecognised as no evidence, never a fake high', () => {
    expect(confidenceMeta('HIGH').key).toBe('high')
    expect(confidenceMeta('excellent').key).toBe('none')
    expect(confidenceMeta(null).key).toBe('none')
    expect(CONFIDENCE_META.high.rank).toBeGreaterThan(CONFIDENCE_META.low.rank)
  })

  it('names each station status', () => {
    expect(stationStatusMeta('named').label).toBe('Names a site')
    expect(stationStatusMeta('proposed').tone).toBe('info')
    expect(stationStatusMeta('rubbish').key).toBe('no_evidence')
  })
})

describe('filterStations', () => {
  it('searches the station, the sites, the keywords and the project names', () => {
    const list = shaped()
    expect(filterStations(list, { search: '81' }).map((s) => s.station)).toEqual(['81'])
    expect(filterStations(list, { search: 'dhahban' }).map((s) => s.station)).toEqual(['70'])
    // A project name only ever appears inside a candidate's evidence.
    expect(filterStations(list, { search: 'Package 7' }).map((s) => s.station)).toEqual(['39'])
    expect(filterStations(list, { search: 'nothing at all' })).toEqual([])
  })

  it('filters by status and by region', () => {
    const list = shaped()
    expect(filterStations(list, { status: 'named' }).map((s) => s.station)).toEqual(['Diriyah-G1'])
    expect(filterStations(list, { region: 'western' }).map((s) => s.station)).toEqual(['70'])
  })

  it('matches a confidence on either judgement', () => {
    // Station 39 is CERTAIN about its region and unsure about the plant. Someone
    // filtering on "low" is hunting exactly that, and it would vanish if only
    // one side were tested.
    const list = shaped()
    expect(filterStations(list, { confidence: 'low' }).map((s) => s.station)).toEqual(['39'])
    expect(filterStations(list, { confidence: 'high' }).map((s) => s.station)).toEqual(['39', '81', '70', 'Diriyah-G1'])
  })

  it('keeps only the plants with no answer yet', () => {
    const list = shaped()
    expect(filterStations(list, { unmappedOnly: true }).map((s) => s.station)).toEqual(['39', '81', '70', '96'])
  })

  it('returns everything when nothing is asked, and copes with junk', () => {
    expect(filterStations(shaped(), {})).toHaveLength(5)
    expect(filterStations(null, { search: 'x' })).toEqual([])
  })
})

describe('mappingSummary', () => {
  it('counts coverage in m3 and states the share', () => {
    const s = mappingSummary(shaped())
    expect(s.stations).toBe(5)
    expect(s.named).toBe(1)
    expect(s.proposed).toBe(3)
    expect(s.m3).toBe(139700)
    expect(s.m3WithRegion).toBe(4000)
    expect(s.m3WithoutRegion).toBe(135700)
    expect(Math.round(s.regionCoveragePct)).toBe(3)
    // Nothing solid on offer for station 96, and nothing else.
    expect(s.needsAttention).toBe(1)
  })

  it('returns a null share when there is nothing to divide, never zero', () => {
    const s = mappingSummary([])
    expect(s.regionCoveragePct).toBeNull()
    expect(s.m3).toBe(0)
  })
})

describe('acceptancePlan', () => {
  it('takes a certain region while holding back an uncertain plant', () => {
    // The whole point. Diriyah 39 is certainly CENTRAL, and which gate it is
    // cannot be read from the loads, so the region goes in and the site stays
    // null rather than putting real money behind a name nobody chose.
    const plan = acceptancePlan(shaped(), { minSiteConfidence: 'high', minRegionConfidence: 'high' })
    const d = plan.find((p) => p.station === '39')
    expect(d).toBeTruthy()
    expect(d.site).toBeNull()
    expect(d.region).toBe('CENTRAL')
    expect(d.confidence).toBe('high')
    expect(typeof d.evidence).toBe('string')

    const j = plan.find((p) => p.station === '70')
    expect(j.site).toBe('DHAHBAN')
    expect(j.region).toBe('WESTERN')
  })

  it('takes the plant too once the bar is lowered', () => {
    const plan = acceptancePlan(shaped(), { minSiteConfidence: 'low', minRegionConfidence: 'high' })
    expect(plan.find((p) => p.station === '39').site).toBe('DIRIYAH-G1')
  })

  it('never accepts a station that has nothing, or one already answered', () => {
    const plan = acceptancePlan(shaped(), { minSiteConfidence: 'low', minRegionConfidence: 'low' })
    expect(plan.map((p) => p.station)).toEqual(['39', '81', '70'])
    // 'none' confidence is not an answer even when the bar is on the floor.
    expect(acceptancePlan(shaped(), { minSiteConfidence: 'none', minRegionConfidence: 'none' })
      .find((p) => p.station === '96')).toBeUndefined()
    expect(acceptancePlan(shaped()).find((p) => p.station === 'Diriyah-G1')).toBeUndefined()
  })

  it('stamps the evidence note with the date it was passed, never a clock of its own', () => {
    const plan = acceptancePlan(shaped(), { now: new Date('2026-08-12T09:00:00Z') })
    expect(plan[0].evidence).toContain('Accepted 2026-08-12')
    expect(acceptancePlan(shaped())[0].evidence).not.toContain('Accepted')
  })

  it('copes with junk', () => {
    expect(acceptancePlan(null)).toEqual([])
    expect(acceptancePlan(undefined, {})).toEqual([])
  })
})

describe('acceptOne', () => {
  it('takes the whole proposal by default and the region alone on request', () => {
    const [d] = shaped()
    expect(acceptOne(d).site).toBe('DIRIYAH-G1')
    const regionOnly = acceptOne(d, { site: null })
    expect(regionOnly.site).toBeNull()
    expect(regionOnly.region).toBe('CENTRAL')
    expect(regionOnly.confidence).toBe('high')
  })
})

describe('evidenceNote', () => {
  it('writes why the mapping was made, as a string both column types accept', () => {
    const note = evidenceNote(shaped()[0])
    expect(note).toContain('diriyah, gate')
    expect(note).toContain('DIRIYAH-G1 52%')
    expect(note).toContain('CENTRAL 100%')
    expect(note).toContain('Runner up DIRIYAH-G2')
    expect(note).toMatch(/^[\x20-\x7E]*$/)
  })

  it('says so rather than inventing a reason', () => {
    expect(evidenceNote({})).toBe('Accepted with no supporting evidence recorded.')
  })
})

describe('ambiguousPairs', () => {
  it('finds the Diriyah gates and puts them as a question', () => {
    const q = ambiguousPairs(shaped())
    expect(q).toHaveLength(1)
    expect(q[0].station).toBe('39')
    expect(q[0].parent).toBe('DIRIYAH')
    expect(q[0].leader).toBe('DIRIYAH-G1')
    expect(q[0].runnerUp).toBe('DIRIYAH-G2')
    expect(q[0].question).toBe('Station 39 is at DIRIYAH and in CENTRAL. Which plant is it, DIRIYAH-G1 or DIRIYAH-G2?')
  })

  it('leaves two genuinely different places alone', () => {
    // DHAHBAN and JED are not two gates of one place, so there is no question
    // to ask - the matcher simply preferred one.
    expect(ambiguousPairs(shaped()).map((q) => q.station)).not.toContain('70')
  })

  it('reads a multi word plateau name down to its parent', () => {
    expect(siteParent('QIDDIYA-UPPER PLATEAU')).toBe('QIDDIYA')
    expect(siteParent('QIDDIYA UPPER PLATEAU')).toBe('QIDDIYA')
    expect(siteParent('DIRIYAH')).toBeNull()
    expect(siteParent('')).toBeNull()

    const pair = shapeProposals({
      ok: true,
      stations: [{
        station: '57', status: 'proposed', m3: 100,
        proposed_site: 'QIDDIYA-UPPER PLATEAU', runner_up: 'QIDDIYA-LOWER PLATEAU',
        site_confidence: 'low', proposed_region: 'CENTRAL', region_confidence: 'high',
      }],
    }).stations
    expect(ambiguousPairs(pair)[0].parent).toBe('QIDDIYA')
  })
})

describe('regionImpact and proposedRegions', () => {
  it('adds up the production that would move, biggest region first', () => {
    const impact = regionImpact(shaped())
    expect(impact).toEqual([
      { region: 'CENTRAL', stations: 2, loads: 16000, m3: 127000 },
      { region: 'WESTERN', stations: 1, loads: 900, m3: 7200 },
    ])
  })

  it('reads the region list from the data, never a hardcoded pair', () => {
    expect(proposedRegions(shaped())).toEqual(['CENTRAL', 'WESTERN'])
    expect(proposedRegions([])).toEqual([])
  })
})
