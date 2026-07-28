import { describe, it, expect } from 'vitest'
import {
  STAGE_FIELDS, STAGE_TEAMS, stageDepartment, fieldFilled, stageCompletion,
  caseProgress, teamPerformance, longestWaiting, skippedStageReport,
  buildStageIntelligence, median,
} from '../lib/accidentStages'
import { STAGE_FLOW, WORKFLOW_STAGES } from '../lib/accidentWorkflow'

const DAY = 86400000
const NOW = new Date('2026-07-28T00:00:00Z').getTime()
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString()

const ev = (accident_id, stage, { entered, exited = null, skipped = false, basis = 'observed', by = null } = {}) => ({
  accident_id, stage, department: stageDepartment(stage),
  entered_at: entered, exited_at: exited, skipped, basis, entered_by: by,
})

describe('field ownership', () => {
  it('covers every stage in the pipeline, and only real stages', () => {
    for (const k of STAGE_FLOW) expect(STAGE_FIELDS[k], k).toBeTruthy()
    for (const k of Object.keys(STAGE_FIELDS)) {
      expect(WORKFLOW_STAGES.map((s) => s.key), k).toContain(k)
    }
  })

  it('names an owning team for every stage, from the one source', () => {
    for (const k of STAGE_FLOW) expect(stageDepartment(k), k).toBeTruthy()
    // These are the teams the user works in. If a rename ever lands, this fails
    // loudly rather than silently orphaning a stage.
    expect(STAGE_TEAMS).toContain('Workshop')
    expect(STAGE_TEAMS).toContain('Insurance')
    expect(STAGE_TEAMS).toContain('Fleet / PMV')
    expect(STAGE_TEAMS).toContain('HSE / Safety')
    expect(STAGE_TEAMS).toContain('Finance')
  })

  it('MIRROR: the SQL accident_stage_department must agree stage for stage', () => {
    // V398's accident_stage_department is a copy of this map in Postgres. If the
    // two drift, the ledger records one team and the UI blames another.
    const sql = {
      reported: 'Site Management', initial_review: 'Operations',
      hse_investigation: 'HSE / Safety', workshop_assessment: 'Workshop',
      insurance_claim: 'Insurance', repair_approval: 'Fleet / PMV',
      repair_in_progress: 'Workshop', final_inspection: 'Workshop',
      vehicle_release: 'Operations', cost_recovery: 'Finance',
      closed: 'Site Management', cancelled: 'Operations',
    }
    for (const [stage, dept] of Object.entries(sql)) {
      expect(stageDepartment(stage), stage).toBe(dept)
    }
  })

  it('every owned field is a real accidents column, listed once', () => {
    const seen = new Map()
    for (const [stage, spec] of Object.entries(STAGE_FIELDS)) {
      for (const f of [...(spec.required || []), ...(spec.optional || [])]) {
        expect(f.key, `${stage}.${f.key}`).toMatch(/^[a-z][a-z0-9_]*$/)
        expect(f.label, f.key).toBeTruthy()
        const k = `${stage}:${f.key}`
        expect(seen.has(k), k).toBe(false)
        seen.set(k, true)
      }
    }
  })
})

describe('fieldFilled', () => {
  it('requires money to be NON-ZERO, not merely present', () => {
    // parts_cost is present on all 35 live incidents and every value is 0.00.
    // A null check marks the cost side complete while it contributes nothing.
    const f = { key: 'parts_cost', money: true }
    expect(fieldFilled({ parts_cost: 0 }, f)).toBe(false)
    expect(fieldFilled({ parts_cost: '0.00' }, f)).toBe(false)
    expect(fieldFilled({ parts_cost: 1200 }, f)).toBe(true)
    expect(fieldFilled({}, f)).toBe(false)
  })

  it('treats false as a recorded answer for a boolean', () => {
    // "not off road" is an answer. Requiring truthiness would make a team look
    // incomplete for correctly recording No.
    const f = { key: 'vor', kind: 'bool' }
    expect(fieldFilled({ vor: false }, f)).toBe(true)
    expect(fieldFilled({ vor: true }, f)).toBe(true)
    expect(fieldFilled({}, f)).toBe(false)
  })

  it('treats empty arrays, empty objects and blank strings as not recorded', () => {
    expect(fieldFilled({ photos: [] }, { key: 'photos' })).toBe(false)
    expect(fieldFilled({ photos: ['a'] }, { key: 'photos' })).toBe(true)
    expect(fieldFilled({ documents: {} }, { key: 'documents' })).toBe(false)
    expect(fieldFilled({ site: '   ' }, { key: 'site' })).toBe(false)
  })
})

describe('stageCompletion', () => {
  it('scores only the REQUIRED fields', () => {
    const c = stageCompletion({ root_cause: 'Tyre burst' }, 'hse_investigation')
    expect(c.total).toBe(2)                 // root cause + corrective action
    expect(c.filled.map((f) => f.key)).toEqual(['root_cause'])
    expect(c.missing.map((f) => f.key)).toEqual(['corrective_action'])
    expect(c.pct).toBe(50)
    expect(c.complete).toBe(false)
  })

  it('does not let optional fields inflate the score', () => {
    const rec = { hse_investigation: 'notes', preventive_action: 'x', fault_status: 'Faulty' }
    const c = stageCompletion(rec, 'hse_investigation')
    expect(c.pct).toBe(0)                   // all three filled are optional
    expect(c.optionalFilled).toHaveLength(3)
  })

  it('returns null, not 100, when a stage requires nothing', () => {
    // 100 would read as "this team finished" when there was nothing to finish.
    const c = stageCompletion({}, 'cancelled')
    expect(c.pct).toBeNull()
    expect(c.complete).toBe(false)
  })

  it('carries the team and the intent so a panel can explain itself', () => {
    const c = stageCompletion({}, 'insurance_claim')
    expect(c.department).toBe('Insurance')
    expect(c.intent).toMatch(/claim/i)
  })
})

describe('caseProgress', () => {
  const record = {
    id: 'a1', workflow_stage: 'insurance_claim',
    incident_date: '2026-07-01', asset_no: 'TM704', site: 'NHC', description: 'Rear hit',
    responsible_owner_id: 'u1', target_date: '2026-07-20',
    insurer: 'Tawuniya',
  }

  it('marks a stage the case passed WITHOUT stopping as skipped, never done', () => {
    const events = [
      ev('a1', 'reported', { entered: at(20), exited: at(18) }),
      ev('a1', 'initial_review', { entered: at(18), exited: at(15) }),
      ev('a1', 'hse_investigation', { entered: at(15), exited: at(15), skipped: true }),
      ev('a1', 'workshop_assessment', { entered: at(15), exited: at(15), skipped: true }),
      ev('a1', 'insurance_claim', { entered: at(15) }),
    ]
    const p = caseProgress(record, events, NOW)
    const byStage = Object.fromEntries(p.rows.map((r) => [r.stage, r]))
    expect(byStage.reported.state).toBe('done')
    expect(byStage.initial_review.state).toBe('done')
    expect(byStage.hse_investigation.state).toBe('skipped')
    expect(byStage.workshop_assessment.state).toBe('skipped')
    expect(byStage.insurance_claim.state).toBe('current')
    expect(byStage.repair_approval.state).toBe('pending')
    expect(p.skipped.map((r) => r.stage)).toEqual(['hse_investigation', 'workshop_assessment'])
  })

  it('reports which team is holding it and for how long', () => {
    const p = caseProgress(record, [ev('a1', 'insurance_claim', { entered: at(15) })], NOW)
    expect(p.holdingTeam).toBe('Insurance')
    expect(p.heldDays).toBe(15)
  })

  it('does not charge a skipped stage any time', () => {
    const p = caseProgress(record, [
      ev('a1', 'hse_investigation', { entered: at(15), exited: at(15), skipped: true }),
      ev('a1', 'insurance_claim', { entered: at(15) }),
    ], NOW)
    const hse = p.rows.find((r) => r.stage === 'hse_investigation')
    expect(hse.heldDays).toBeNull()
    expect(hse.visits).toBe(0)
  })

  it('sums both visits when a case is sent back for rework', () => {
    const p = caseProgress({ ...record, workflow_stage: 'repair_in_progress' }, [
      ev('a1', 'repair_in_progress', { entered: at(10), exited: at(8) }),
      ev('a1', 'final_inspection', { entered: at(8), exited: at(7) }),
      ev('a1', 'repair_in_progress', { entered: at(7) }),
    ], NOW)
    const rip = p.rows.find((r) => r.stage === 'repair_in_progress')
    expect(rip.visits).toBe(2)
    expect(rip.heldDays).toBe(9) // 2 days first visit + 7 days since rework
  })

  it('names who owes what, across every stage the case has reached', () => {
    const p = caseProgress(record, [
      ev('a1', 'reported', { entered: at(20), exited: at(18) }),
      ev('a1', 'initial_review', { entered: at(18), exited: at(15) }),
      ev('a1', 'insurance_claim', { entered: at(15) }),
    ], NOW)
    // Insurance filled the insurer but not the amount claimed.
    const ins = p.outstanding.find((o) => o.stage === 'insurance_claim')
    expect(ins.department).toBe('Insurance')
    expect(ins.missing.map((f) => f.key)).toEqual(['claim_amount'])
    // A stage not reached yet cannot owe anything.
    expect(p.outstanding.some((o) => o.stage === 'cost_recovery')).toBe(false)
  })

  it('measures completeness against the stages REACHED, not all eleven', () => {
    // Otherwise every young case reads as neglected.
    const p = caseProgress(record, [ev('a1', 'insurance_claim', { entered: at(1) })], NOW)
    expect(p.reachedPct).toBeGreaterThan(0)
    expect(p.reachedRequired).toBeLessThan(
      Object.values(STAGE_FIELDS).reduce((a, s2) => a + (s2.required || []).length, 0),
    )
  })

  it('renders the ladder with honest nulls when there is no ledger at all', () => {
    const p = caseProgress(record, [], NOW)
    expect(p.rows).toHaveLength(STAGE_FLOW.length)
    expect(p.heldDays).toBeNull()   // never 0, which would read as instant
    expect(p.rows.find((r) => r.stage === 'insurance_claim').state).toBe('current')
  })

  it('flags a duration drawn from a backfilled entry time as an estimate', () => {
    const p = caseProgress(record, [ev('a1', 'insurance_claim', { entered: at(5), basis: 'backfilled' })], NOW)
    expect(p.estimated).toBe(true)
  })
})

describe('teamPerformance', () => {
  const cases = [
    { id: 'a1', workflow_stage: 'insurance_claim', insurer: 'T' },
    { id: 'a2', workflow_stage: 'insurance_claim' },
    { id: 'a3', workflow_stage: 'repair_in_progress', repair_cost: 500 },
  ]
  const events = [
    ev('a1', 'insurance_claim', { entered: at(40) }),
    ev('a2', 'insurance_claim', { entered: at(10) }),
    ev('a3', 'workshop_assessment', { entered: at(30), exited: at(20) }),
    ev('a3', 'repair_in_progress', { entered: at(20) }),
  ]

  it('counts what each team is holding now and how long they typically hold it', () => {
    const perf = teamPerformance(cases, events, NOW)
    const ins = perf.find((t) => t.department === 'Insurance')
    expect(ins.holdingNow).toBe(2)
    expect(ins.medianDays).toBe(25)  // median of 40 and 10
    expect(ins.worstDays).toBe(40)
  })

  it('lists every team, including ones holding nothing', () => {
    // A team with no cases is information: it is not the bottleneck.
    const perf = teamPerformance(cases, events, NOW)
    expect(perf.map((t) => t.department).sort()).toEqual([...STAGE_TEAMS].sort())
    const fin = perf.find((t) => t.department === 'Finance')
    expect(fin.holdingNow).toBe(0)
    expect(fin.medianDays).toBeNull()
  })

  it('counts missing fields per team without double-counting a case', () => {
    const perf = teamPerformance(cases, events, NOW)
    const ins = perf.find((t) => t.department === 'Insurance')
    // a1 has insurer, missing claim_amount (1). a2 missing both (2).
    expect(ins.missingFields).toBe(3)
  })

  it('attributes a skipped stage to the team that never got it', () => {
    const perf = teamPerformance(
      [{ id: 'a9', workflow_stage: 'closed' }],
      [ev('a9', 'hse_investigation', { entered: at(1), exited: at(1), skipped: true }),
        ev('a9', 'closed', { entered: at(1) })],
      NOW,
    )
    expect(perf.find((t) => t.department === 'HSE / Safety').skippedStages).toBe(1)
  })

  it('marks a team estimate when any of its durations rests on a backfill', () => {
    const perf = teamPerformance(cases, [ev('a1', 'insurance_claim', { entered: at(5), basis: 'backfilled' })], NOW)
    expect(perf.find((t) => t.department === 'Insurance').anyEstimated).toBe(true)
  })
})

describe('longestWaiting', () => {
  it('ranks open cases by time in their current stage and excludes finished ones', () => {
    const cases = [
      { id: 'a1', asset_no: 'TM1', workflow_stage: 'insurance_claim' },
      { id: 'a2', asset_no: 'TM2', workflow_stage: 'repair_approval' },
      { id: 'a3', asset_no: 'TM3', workflow_stage: 'closed' },
    ]
    const events = [
      ev('a1', 'insurance_claim', { entered: at(40) }),
      ev('a2', 'repair_approval', { entered: at(5) }),
      ev('a3', 'closed', { entered: at(90) }),
    ]
    const rows = longestWaiting(cases, events, { now: NOW })
    expect(rows.map((r) => r.asset)).toEqual(['TM1', 'TM2'])
    expect(rows[0].department).toBe('Insurance')
    expect(rows[0].heldDays).toBe(40)
  })
})

describe('skippedStageReport', () => {
  it('is the direct answer to "why did this go to closed on its own"', () => {
    const cases = [{ id: 'a1', asset_no: 'TM704', reference_no: 'ACC-2026-0001', workflow_stage: 'closed' }]
    const events = ['initial_review', 'hse_investigation', 'workshop_assessment', 'insurance_claim']
      .map((st) => ev('a1', st, { entered: at(1), exited: at(1), skipped: true }))
    const rep = skippedStageReport(cases, events)
    expect(rep.total).toBe(4)
    expect(rep.cases[0].reference).toBe('ACC-2026-0001')
    expect(rep.byTeam.map((t) => t.department)).toContain('Insurance')
    // Workshop owns one of the four skipped stages here.
    expect(rep.byTeam.find((t) => t.department === 'Workshop').count).toBe(1)
  })

  it('says nothing when nothing was skipped', () => {
    const rep = skippedStageReport([{ id: 'a1', workflow_stage: 'closed' }], [ev('a1', 'closed', { entered: at(1) })])
    expect(rep.cases).toEqual([])
    expect(rep.total).toBe(0)
  })
})

describe('buildStageIntelligence', () => {
  it('states outright when there is no ledger yet, instead of showing empty timings', () => {
    const out = buildStageIntelligence([{ id: 'a1', workflow_stage: 'reported' }], [])
    expect(out.ledgerReady).toBe(false)
    expect(out.total).toBe(1)
    expect(out.open).toBe(1)
  })

  it('counts open cases by stage, not by status', () => {
    const out = buildStageIntelligence([
      { id: 'a1', workflow_stage: 'closed' },
      { id: 'a2', workflow_stage: 'cancelled' },
      { id: 'a3', workflow_stage: 'insurance_claim' },
    ], [ev('a3', 'insurance_claim', { entered: at(2) })], NOW)
    expect(out.open).toBe(1)
    expect(out.ledgerReady).toBe(true)
  })
})

describe('median', () => {
  it('is reported beside the mean because one stalled claim drags an average', () => {
    expect(median([1, 2, 3])).toBe(2)
    expect(median([1, 2, 3, 100])).toBe(2.5)
    expect(median([])).toBeNull()
    expect(median([null, undefined, 4])).toBe(4)
  })
})
