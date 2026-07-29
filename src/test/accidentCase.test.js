import { describe, it, expect } from 'vitest'
import {
  WORKSTREAMS, WORKSTREAM_KEYS, WORKSTREAM_STAGE, DIMENSION_OF, DIMENSIONS,
  WORKSTREAM_SATISFIED, workstreamStatus, workstreamSatisfied,
  naEnvelopeValid, markedNA,
  repairOccurred, correctiveRequired, insuranceInvolved,
  buildCaseRoute, requiredWorkstreams,
  completeness, closureBlockers,
  closureLevel, canFullyClose, NON_WAIVABLE,
  CASE_STATUSES, CASE_STATUS_STAGE, CASE_STATUS_TOKENS, caseStatusStage,
  TRANSITIONS, allowedTransitions, canTransition, transitionSpec,
  deriveCaseStatus,
} from '../lib/accidentCase'
import { WORKFLOW_STAGES, STAGE_KEYS } from '../lib/accidentWorkflow'

const NOW = new Date('2026-07-28T00:00:00Z').getTime()
const DAY = 86400000

// Build explicit accident_case_workstreams rows from a { ws: status } map.
const rows = (map) => Object.entries(map).map(([workstream, v]) =>
  (typeof v === 'string' ? { workstream, status: v } : { workstream, ...v }))

// A record whose fields make every derived workstream "completed" (belt & braces;
// most tests drive status through explicit rows for precision).
const fullRecord = () => ({
  incident_date: '2026-07-01', asset_no: 'TM100', site: 'NHC', description: 'hit a bollard',
  responsible_owner_id: 'u1', target_date: '2026-07-10',
  root_cause: 'driver error', corrective_action: 'retrain',
  insurer: 'Tawuniya', claim_amount: 5000,
  estimated_damage_cost: 4000, repair_type: 'Internal',
  repair_cost: 3800, closure_evidence: 'photos ok', release_date: '2026-07-20',
  recovered_amount: 3000, recovery_status: 'recovered',
})

// Explicit rows that satisfy a whole route.
const allCompleted = (route, record = {}) => {
  const req = [...requiredWorkstreams(route, record)]
  return rows(Object.fromEntries(req.map((ws) => [ws, 'completed'])))
}

describe('workstream + status constants', () => {
  it('has ten workstreams, unique keys, each with a known dimension + stage', () => {
    expect(WORKSTREAMS).toHaveLength(10)
    expect(new Set(WORKSTREAM_KEYS).size).toBe(10)
    for (const w of WORKSTREAMS) {
      expect(DIMENSIONS.concat('overall')).toContain(w.dimension)
      expect(STAGE_KEYS).toContain(WORKSTREAM_STAGE[w.key])
      expect(DIMENSION_OF[w.key]).toBe(w.dimension)
    }
  })

  it('the workstream-stage map points only at real WORKFLOW_STAGES', () => {
    const real = new Set(WORKFLOW_STAGES.map((s) => s.key))
    for (const stage of Object.values(WORKSTREAM_STAGE)) expect(real.has(stage)).toBe(true)
  })

  it('satisfied set is exactly completed / not_required / cancelled', () => {
    expect([...WORKSTREAM_SATISFIED].sort()).toEqual(['cancelled', 'completed', 'not_required'])
    expect(workstreamSatisfied('completed')).toBe(true)
    expect(workstreamSatisfied('not_required')).toBe(true)
    expect(workstreamSatisfied('cancelled')).toBe(true)
    for (const s of ['not_started', 'assigned', 'in_progress', 'waiting_info', 'waiting_approval', 'waiting_external', 'on_hold', 'rejected', 'reopened'])
      expect(workstreamSatisfied(s)).toBe(false)
  })
})

describe('workstreamStatus', () => {
  it('an explicit row is the truth, over any derived value', () => {
    const rec = fullRecord() // derives to completed
    const r = rows({ insurance: 'waiting_external' })
    expect(workstreamStatus(rec, 'insurance', r)).toBe('waiting_external')
  })

  it('derives completed when the owning stage is fully filled', () => {
    expect(workstreamStatus(fullRecord(), 'incident_evidence')).toBe('completed')
    expect(workstreamStatus(fullRecord(), 'insurance')).toBe('completed')
  })

  it('derives in_progress when some required fields are filled, not_started when none', () => {
    expect(workstreamStatus({ incident_date: '2026-07-01', asset_no: 'TM1' }, 'incident_evidence')).toBe('in_progress')
    expect(workstreamStatus({}, 'incident_evidence')).toBe('not_started')
  })

  it('a money field of 0 does not count as filled (matches accidentStages)', () => {
    const rec = { insurer: 'X', claim_amount: 0 } // claim_amount required + money
    expect(workstreamStatus(rec, 'insurance')).toBe('in_progress')
  })
})

describe('NA envelope', () => {
  it('is valid only with reason + by + at', () => {
    expect(naEnvelopeValid({ reason: 'no third party', by: 'u1', at: '2026-07-01' })).toBe(true)
    expect(naEnvelopeValid({ reason: 'x', by: 'u1' })).toBe(false)
    expect(naEnvelopeValid({ reason: 'x', at: '2026-07-01' })).toBe(false)
    expect(naEnvelopeValid({ by: 'u1', at: '2026-07-01' })).toBe(false)
    expect(naEnvelopeValid(null)).toBe(false)
    expect(naEnvelopeValid({})).toBe(false)
  })

  it('requireApproval also demands approved_by', () => {
    const env = { reason: 'x', by: 'u1', at: '2026-07-01' }
    expect(naEnvelopeValid(env, { requireApproval: true })).toBe(false)
    expect(naEnvelopeValid({ ...env, approved_by: 'mgr' }, { requireApproval: true })).toBe(true)
  })

  it('markedNA reads an explicit row na_reason, then the stage_waivers fallback', () => {
    const rec = { stage_waivers: { insurance_claim: { required: false, reason: 'no cover', by: 'u1', at: '2026-07-01' } } }
    expect(markedNA(rec, [], 'insurance')).toBe(true)
    const rec2 = {}
    const r = rows({ insurance: { status: 'not_required', na_reason: { reason: 'x', by: 'u1', at: '2026-07-01' } } })
    expect(markedNA(rec2, r, 'insurance')).toBe(true)
    expect(markedNA({}, rows({ insurance: { status: 'not_required' } }), 'insurance')).toBe(false)
  })
})

describe('route detection helpers', () => {
  it('insuranceInvolved: explicit toggle wins, else inferred from insurer/policy/claim', () => {
    expect(insuranceInvolved({ insurance_involved: true })).toBe(true)
    expect(insuranceInvolved({ insurance_involved: false, insurer: 'X' })).toBe(false)
    expect(insuranceInvolved({ insurer: 'Tawuniya' })).toBe(true)
    expect(insuranceInvolved({ claim_amount: 100 })).toBe(true)
    expect(insuranceInvolved({})).toBe(false)
  })

  it('repairOccurred: repair type / cost signals a real repair, no-repair does not', () => {
    expect(repairOccurred({ repair_type: 'Internal' })).toBe(true)
    expect(repairOccurred({ repair_cost: 500 })).toBe(true)
    expect(repairOccurred({ repair_type: 'None' })).toBe(false)
    expect(repairOccurred({ no_repair: true, repair_cost: 500 })).toBe(false)
    expect(repairOccurred({})).toBe(false)
  })

  it('correctiveRequired: toggle or injury', () => {
    expect(correctiveRequired({ corrective_action_required: true })).toBe(true)
    expect(correctiveRequired({ injuries: true })).toBe(true)
    expect(correctiveRequired({ injury_count: 2 })).toBe(true)
    expect(correctiveRequired({})).toBe(false)
  })

  it('truthy coercion accepts case-insensitive ERP yes/true tokens (bug 5)', () => {
    // ERP text like injuries:'Yes' must not be silently read as false.
    expect(correctiveRequired({ injuries: 'Yes' })).toBe(true)
    expect(correctiveRequired({ injuries: 'yes' })).toBe(true)
    expect(correctiveRequired({ injuries: 'Y' })).toBe(true)
    expect(correctiveRequired({ injuries: 'TRUE' })).toBe(true)
    expect(correctiveRequired({ injuries: 'true' })).toBe(true)
    // real booleans/numbers still work; genuine "no" stays false
    expect(correctiveRequired({ injuries: true })).toBe(true)
    expect(correctiveRequired({ injuries: 'no' })).toBe(false)
    expect(correctiveRequired({ injuries: false })).toBe(false)
    expect(correctiveRequired({ injuries: 'n' })).toBe(false)
  })
})

describe('buildCaseRoute — fallback classifier', () => {
  it('total loss beats everything (removes the repair path)', () => {
    expect(buildCaseRoute({ total_loss: true, insurance_involved: true, injuries: true }).key).toBe('total_loss')
  })
  it('injury next', () => {
    expect(buildCaseRoute({ injuries: true, insurance_involved: true }).key).toBe('injury')
    expect(buildCaseRoute({ accident_type: 'Injury accident' }).key).toBe('injury')
  })
  it('insurance splits on repair type', () => {
    expect(buildCaseRoute({ insurance_involved: true, repair_type: 'External' }).key).toBe('external_repair_insurance')
    expect(buildCaseRoute({ insurance_involved: true, repair_type: 'Internal' }).key).toBe('internal_repair_insurance')
    expect(buildCaseRoute({ insurance_involved: true }).key).toBe('internal_repair_insurance')
  })
  it('minor uninsured takes the light path; unknown falls back to standard', () => {
    expect(buildCaseRoute({ severity: 'minor', insurance_involved: false }).key).toBe('minor_no_insurance')
    expect(buildCaseRoute({ severity: 'moderate', insurance_involved: false }).key).toBe('standard')
  })
  it('every fallback carries source:fallback and profile:null', () => {
    const r = buildCaseRoute({ severity: 'minor', insurance_involved: false })
    expect(r.source).toBe('fallback')
    expect(r.profile).toBeNull()
  })
})

describe('buildCaseRoute — config rule profiles win', () => {
  const profiles = [
    { active: true, priority: 20, route_key: 'internal_repair_insurance', country: 'KSA' },
    { active: true, priority: 5, route_key: 'external_repair_insurance', country: 'KSA', repair_type: null },
    { active: false, priority: 1, route_key: 'total_loss', country: 'KSA' },
  ]
  it('lowest priority active match wins and is source:rule', () => {
    const r = buildCaseRoute({ country: 'KSA', insurance_involved: true }, profiles)
    expect(r.key).toBe('external_repair_insurance')
    expect(r.source).toBe('rule')
    expect(r.profile).toBeTruthy()
  })
  it('a non-matching country falls through to the fallback classifier', () => {
    const r = buildCaseRoute({ country: 'UAE', insurance_involved: true, repair_type: 'Internal' }, profiles)
    expect(r.source).toBe('fallback')
    expect(r.key).toBe('internal_repair_insurance')
  })
  it('an inactive rule never matches', () => {
    const r = buildCaseRoute({ total_loss: false, country: 'KSA', severity: 'minor', insurance_involved: false }, [profiles[2]])
    expect(r.source).toBe('fallback')
  })

  it('a blank-priority profile sorts LAST, not first (bug 6: num("") is null, not 0)', () => {
    const withBlank = [
      { active: true, priority: '', route_key: 'total_loss', country: 'KSA' },
      { active: true, priority: 10, route_key: 'external_repair_insurance', country: 'KSA' },
    ]
    // Both match; the numbered priority must win over the blank one (which used to
    // coerce to 0 and sort as the highest-precedence rule).
    const r = buildCaseRoute({ country: 'KSA', insurance_involved: true }, withBlank)
    expect(r.key).toBe('external_repair_insurance')
    // a real priority of 0 is still honoured as highest precedence
    const withZero = [
      { active: true, priority: 0, route_key: 'total_loss', country: 'KSA' },
      { active: true, priority: 10, route_key: 'external_repair_insurance', country: 'KSA' },
    ]
    expect(buildCaseRoute({ country: 'KSA', insurance_involved: true }, withZero).key).toBe('total_loss')
  })
})

describe('requiredWorkstreams — conditionals resolved against the record', () => {
  it('workshop_qc is required only where a repair occurred', () => {
    const withRepair = requiredWorkstreams('standard', { repair_type: 'Internal' })
    const noRepair = requiredWorkstreams('standard', {})
    expect(withRepair.has('workshop_qc')).toBe(true)
    expect(noRepair.has('workshop_qc')).toBe(false)
  })
  it('corrective is required only when the toggle/injury is on', () => {
    expect(requiredWorkstreams('minor_no_insurance', {}).has('corrective')).toBe(false)
    expect(requiredWorkstreams('minor_no_insurance', { corrective_action_required: true }).has('corrective')).toBe(true)
  })
  it('total_loss requires insurance + finance but no repair chain', () => {
    const req = requiredWorkstreams('total_loss', {})
    expect(req.has('insurance')).toBe(true)
    expect(req.has('finance')).toBe(true)
    expect(req.has('repair')).toBe(false)
    expect(req.has('handover')).toBe(false)
  })
  it('injury always requires corrective; repair chain only if the vehicle was repaired', () => {
    expect(requiredWorkstreams('injury', {}).has('corrective')).toBe(true)
    expect(requiredWorkstreams('injury', {}).has('repair')).toBe(false)
    expect(requiredWorkstreams('injury', { repair_type: 'Internal' }).has('repair')).toBe(true)
  })
  it('a config profile required_workstreams list is used verbatim', () => {
    const route = { key: 'x', profile: { required_workstreams: ['incident_evidence', 'finance'] } }
    expect([...requiredWorkstreams(route, {})].sort()).toEqual(['finance', 'incident_evidence'])
  })
  it('unknown workstream keys in config are ignored', () => {
    const route = { key: 'x', profile: { required_workstreams: ['incident_evidence', 'made_up'] } }
    expect([...requiredWorkstreams(route, {})]).toEqual(['incident_evidence'])
  })
})

describe('completeness — required workstreams only, honest nulls', () => {
  it('all satisfied -> every in-scope dimension is 100 and overall 100', () => {
    const route = 'internal_repair_insurance'
    const c = completeness({ repair_type: 'Internal' }, allCompleted(route, { repair_type: 'Internal' }), route)
    expect(c.incident).toBe(100)
    expect(c.insurance).toBe(100)
    expect(c.repair).toBe(100)
    expect(c.financial).toBe(100)
    expect(c.overall).toBe(100)
  })

  it('a dimension with no required items returns null, NEVER 100', () => {
    // minor_no_insurance has no insurance workstream in scope.
    const c = completeness({}, [], 'minor_no_insurance')
    expect(c.insurance).toBeNull()
    // and nothing done -> the in-scope dims are 0, not null
    expect(c.incident).toBe(0)
    expect(c.repair).toBe(0)
    expect(c.financial).toBe(0)
  })

  it('partial completion rounds correctly and overall pools all required', () => {
    // minor route: incident dim = {incident_evidence, fleet_validation, liability} = 3 ws
    const route = 'minor_no_insurance'
    const r = rows({ incident_evidence: 'completed', fleet_validation: 'completed', liability: 'not_started' })
    const c = completeness({}, r, route)
    expect(c.incident).toBe(67) // 2 of 3
    // repair dim {assessment, repair, handover} all not_started -> 0
    expect(c.repair).toBe(0)
    // overall: 2 satisfied of 7 required (3 incident + 3 repair + 1 finance) = 29
    expect(c.overall).toBe(29)
  })

  it('an all-N/A (with reason) case counts as satisfied, not dragged down', () => {
    // external_repair route, insurance formally NA with a reason envelope
    const route = 'external_repair_insurance'
    const req = [...requiredWorkstreams(route, { repair_type: 'External' })]
    const r = rows(Object.fromEntries(req.map((ws) => [ws,
      ws === 'insurance'
        ? { status: 'not_required', na_reason: { reason: 'self-insured', by: 'u1', at: '2026-07-01' } }
        : 'completed'])))
    const c = completeness({ repair_type: 'External' }, r, route)
    expect(c.insurance).toBe(100) // NA-with-reason satisfies
    expect(c.overall).toBe(100)
  })

  it('N/A WITHOUT a reason does not pad the score', () => {
    const route = 'internal_repair_insurance'
    const req = [...requiredWorkstreams(route, { repair_type: 'Internal' })]
    const r = rows(Object.fromEntries(req.map((ws) => [ws,
      ws === 'insurance' ? { status: 'not_required' } : 'completed'])))
    const c = completeness({ repair_type: 'Internal' }, r, route)
    expect(c.insurance).toBe(0) // bare switch-off is not satisfied
    expect(c.overall).toBeLessThan(100)
  })

  it('re-derives DOWNWARD on a return state (rejected handover drops repair)', () => {
    const route = 'minor_no_insurance'
    const done = rows({ incident_evidence: 'completed', fleet_validation: 'completed', liability: 'completed', assessment: 'completed', repair: 'completed', handover: 'completed', finance: 'completed' })
    expect(completeness({}, done, route).repair).toBe(100)
    const rejected = done.map((w) => (w.workstream === 'handover' ? { workstream: 'handover', status: 'rejected' } : w))
    expect(completeness({}, rejected, route).repair).toBe(67) // 2 of 3 repair-dim ws now satisfied
  })
})

describe('closureBlockers', () => {
  it('lists every required-but-unsatisfied workstream, in pipeline order', () => {
    const route = 'minor_no_insurance'
    const r = rows({ incident_evidence: 'completed', fleet_validation: 'in_progress', liability: 'completed', finance: 'not_started' })
    const b = closureBlockers({}, r, route)
    const keys = b.map((x) => x.workstream)
    expect(keys).toContain('fleet_validation')
    expect(keys).toContain('assessment')
    expect(keys).toContain('finance')
    expect(keys).not.toContain('incident_evidence')
    // pipeline order preserved
    expect(keys.indexOf('fleet_validation')).toBeLessThan(keys.indexOf('finance'))
  })

  it('is empty when every required workstream is satisfied', () => {
    const route = 'minor_no_insurance'
    expect(closureBlockers({}, allCompleted(route), route)).toEqual([])
  })
})

describe('closureLevel', () => {
  const route = 'minor_no_insurance'
  it('null while the case is not operationally complete', () => {
    expect(closureLevel({}, rows({ incident_evidence: 'completed' }), route)).toBeNull()
  })

  it('financially_open: operationally done but finance still pending', () => {
    const r = rows({ incident_evidence: 'completed', fleet_validation: 'completed', liability: 'completed', assessment: 'completed', repair: 'completed', handover: 'completed', finance: 'in_progress' })
    expect(closureLevel({}, r, route)).toBe('financially_open')
  })

  it('operationally_completed: all done but closure review not yet approved', () => {
    const r = allCompleted(route)
    expect(closureLevel({ closure_review_approved: false }, r, route)).toBe('operationally_completed')
  })

  it('fully_closed: all done and closure review approved', () => {
    const r = allCompleted(route)
    expect(closureLevel({ closure_review_approved: true }, r, route)).toBe('fully_closed')
  })

  it('an explicitly closed case reads fully_closed regardless', () => {
    expect(closureLevel({ case_status: 'closed' }, [], route)).toBe('fully_closed')
  })
})

describe('canFullyClose — the §8.3 boolean AND', () => {
  const route = 'internal_repair_insurance'
  const rec = { repair_type: 'Internal', closure_review_approved: true }
  const complete = () => allCompleted(route, rec)

  it('ok when every required workstream is satisfied and no meta gate fails', () => {
    const res = canFullyClose(rec, complete(), route, { now: NOW })
    expect(res.ok).toBe(true)
    expect(res.blockers).toEqual([])
  })

  it('blocked when a required workstream is still open', () => {
    const r = complete().map((w) => (w.workstream === 'finance' ? { workstream: 'finance', status: 'in_progress' } : w))
    const res = canFullyClose(rec, r, route, { now: NOW })
    expect(res.ok).toBe(false)
    expect(res.blockers.some((b) => b.workstream === 'finance')).toBe(true)
  })

  it('blocked when a workstream is switched off with no NA reason', () => {
    const r = complete().map((w) => (w.workstream === 'insurance' ? { workstream: 'insurance', status: 'not_required' } : w))
    const res = canFullyClose(rec, r, route, { now: NOW })
    expect(res.ok).toBe(false)
    expect(res.blockers.some((b) => b.workstream === 'insurance')).toBe(true)
  })

  it('a valid + approved NA reason envelope unblocks that workstream', () => {
    // On a code/fallback route (no profile) an NA waiver of a waivable workstream
    // requires approval — a bare reason is not enough (see the fallback-route test).
    const r = complete().map((w) => (w.workstream === 'insurance'
      ? { workstream: 'insurance', status: 'not_required', na_reason: { reason: 'self-insured', by: 'u1', at: '2026-07-01', approved_by: 'mgr' } }
      : w))
    expect(canFullyClose(rec, r, route, { now: NOW }).ok).toBe(true)
  })

  it('when the route profile demands approval, an unapproved NA still blocks', () => {
    const req = [...requiredWorkstreams('internal_repair_insurance', rec)]
    const cfgRoute = { key: 'cfg', profile: { na_requires_approval: true, required_workstreams: req } }
    const base = Object.fromEntries(req.map((ws) => [ws, 'completed']))
    const noApproval = rows({ ...base, insurance: { status: 'not_required', na_reason: { reason: 'x', by: 'u1', at: '2026-07-01' } } })
    expect(canFullyClose(rec, noApproval, cfgRoute, { now: NOW }).ok).toBe(false)
    const approved = rows({ ...base, insurance: { status: 'not_required', na_reason: { reason: 'x', by: 'u1', at: '2026-07-01', approved_by: 'mgr' } } })
    expect(canFullyClose(rec, approved, cfgRoute, { now: NOW }).ok).toBe(true)
  })

  it('blocked by an overdue mandatory task', () => {
    const r = { ...rec, tasks: [{ mandatory: true, resolved: false, due: new Date(NOW - DAY).toISOString() }] }
    const res = canFullyClose(r, complete(), route, { now: NOW })
    expect(res.ok).toBe(false)
    expect(res.blockers.some((b) => b.check === 'mandatory_task')).toBe(true)
    // a resolved or not-yet-due task does not block
    const ok = { ...rec, tasks: [{ mandatory: true, resolved: true, due: new Date(NOW - DAY).toISOString() }, { mandatory: true, resolved: false, due: new Date(NOW + DAY).toISOString() }] }
    expect(canFullyClose(ok, complete(), route, { now: NOW }).ok).toBe(true)
  })

  it('blocked by a pending approval', () => {
    const r = { ...rec, approvals: [{ status: 'pending' }] }
    expect(canFullyClose(r, complete(), route, { now: NOW }).blockers.some((b) => b.check === 'pending_approval')).toBe(true)
  })

  it('blocked by a missing required document from the profile', () => {
    const req = [...requiredWorkstreams('internal_repair_insurance', rec)]
    const cfgRoute = { key: 'cfg', profile: { required_workstreams: req, required_documents: ['police_report', 'invoice'] } }
    const r = { ...rec, documents: [{ type: 'police_report' }] }
    const res = canFullyClose(r, allCompleted(cfgRoute, rec), cfgRoute, { now: NOW })
    expect(res.ok).toBe(false)
    expect(res.blockers.find((b) => b.check === 'required_document').reason).toContain('invoice')
  })

  it('blocked when closure review is not approved', () => {
    const res = canFullyClose({ repair_type: 'Internal' }, complete(), route, { now: NOW })
    expect(res.ok).toBe(false)
    expect(res.blockers.some((b) => b.check === 'closure_review')).toBe(true)
  })

  it('a repair with workshop_qc omitted from the route cannot fully close (bug 1 QC guard)', () => {
    // A config route whose required set includes repair but NOT workshop_qc — a
    // repair happened, so QC is mandatory and its absence must block closure.
    const req = ['incident_evidence', 'fleet_validation', 'liability', 'assessment', 'repair', 'handover', 'finance']
    const cfgRoute = { key: 'cfg', profile: { required_workstreams: req } }
    const record = { repair_type: 'Internal', closure_review_approved: true }
    const done = rows(Object.fromEntries(req.map((ws) => [ws, 'completed'])))
    const res = canFullyClose(record, done, cfgRoute, { now: NOW })
    expect(res.ok).toBe(false)
    expect(res.blockers.some((b) => b.check === 'workshop_qc')).toBe(true)
  })

  it('an unapproved NA on a fallback (no-profile) route does not satisfy closure (bug 2)', () => {
    // external_repair_insurance as a bare string => no profile => approval required.
    const fbRoute = 'external_repair_insurance'
    const rec2 = { repair_type: 'External', closure_review_approved: true }
    const req = [...requiredWorkstreams(fbRoute, rec2)]
    const base = Object.fromEntries(req.map((ws) => [ws, 'completed']))
    const bare = rows({ ...base, insurance: { status: 'not_required', na_reason: { reason: 'self-insured', by: 'u1', at: '2026-07-01' } } })
    expect(canFullyClose(rec2, bare, fbRoute, { now: NOW }).ok).toBe(false)
    // approving the NA on the same fallback route unblocks it
    const approved = rows({ ...base, insurance: { status: 'not_required', na_reason: { reason: 'self-insured', by: 'u1', at: '2026-07-01', approved_by: 'mgr' } } })
    expect(canFullyClose(rec2, approved, fbRoute, { now: NOW }).ok).toBe(true)
  })

  it('a NON_WAIVABLE workstream (incident_evidence) never satisfies closure via NA, even approved (bug 2)', () => {
    expect(NON_WAIVABLE.has('incident_evidence')).toBe(true)
    const nwRoute = 'minor_no_insurance'
    const rec2 = { closure_review_approved: true }
    const req = [...requiredWorkstreams(nwRoute, rec2)]
    const base = Object.fromEntries(req.map((ws) => [ws, 'completed']))
    const na = rows({ ...base, incident_evidence: { status: 'not_required', na_reason: { reason: 'x', by: 'u1', at: '2026-07-01', approved_by: 'mgr' } } })
    const res = canFullyClose(rec2, na, nwRoute, { now: NOW })
    expect(res.ok).toBe(false)
    expect(res.blockers.some((b) => b.workstream === 'incident_evidence')).toBe(true)
  })
})

describe('case-status transition machine', () => {
  it('draft -> submitted is allowed with the submit capability', () => {
    expect(canTransition('draft', 'submitted')).toBe(true)
    expect(transitionSpec('draft', 'submitted').cap).toBe('submit')
  })
  it('an illegal jump is refused', () => {
    expect(canTransition('draft', 'closed')).toBe(false)
    expect(transitionSpec('draft', 'closed')).toBeNull()
  })
  it('cancel + legal-hold are reachable from any non-terminal state', () => {
    expect(canTransition('technical_assessment', 'cancelled_duplicate')).toBe(true)
    expect(canTransition('technical_assessment', 'legal_hold')).toBe(true)
    // but not from a terminal state
    expect(canTransition('closed', 'cancelled_duplicate')).toBe(false)
    expect(allowedTransitions('cancelled_duplicate')).toEqual([])
  })
  it('closure_review -> closed carries the close_case capability', () => {
    expect(transitionSpec('closure_review', 'closed').cap).toBe('close_case')
  })
  it('TRANSITIONS only names real case-status tokens on both ends', () => {
    const valid = new Set(CASE_STATUS_TOKENS)
    for (const [from, specs] of TRANSITIONS) {
      expect(valid.has(from)).toBe(true)
      for (const s of specs) expect(valid.has(s.to)).toBe(true)
    }
  })

  it('a total-loss case can traverse from total_loss_processing to closure (bug 3)', () => {
    // total_loss_processing used to be a dead end (no outbound transition).
    expect(allowedTransitions('total_loss_processing').length).toBeGreaterThan(2) // + universal cancel/hold
    const path = [
      ['total_loss_processing', 'insurance_settlement_pending'],
      ['insurance_settlement_pending', 'financial_closure_pending'],
      ['financial_closure_pending', 'closure_review'],
      ['closure_review', 'closed'],
    ]
    for (const [from, to] of path) expect(canTransition(from, to)).toBe(true)
    // and the write-off (no claim) branch also leaves the total-loss state
    expect(canTransition('total_loss_processing', 'financial_closure_pending')).toBe(true)
  })
})

describe('case statuses + stage mapping', () => {
  it('has 30 statuses with unique tokens', () => {
    expect(CASE_STATUSES).toHaveLength(30)
    expect(new Set(CASE_STATUS_TOKENS).size).toBe(30)
  })
  it('every status maps to a real stage or null (hold/reopened)', () => {
    const real = new Set(WORKFLOW_STAGES.map((s) => s.key))
    for (const t of CASE_STATUS_TOKENS) {
      const stage = CASE_STATUS_STAGE[t]
      expect(stage === null || real.has(stage)).toBe(true)
    }
    expect(caseStatusStage('legal_hold')).toBeNull()
    expect(caseStatusStage('reopened')).toBeNull()
    expect(caseStatusStage('closed')).toBe('closed')
  })
})

describe('deriveCaseStatus — the projection (§3)', () => {
  const route = 'internal_repair_insurance'
  const submitted = { submitted: true, repair_type: 'Internal' }

  it('cross-cutting overrides win first', () => {
    expect(deriveCaseStatus({ legal_hold: true }, [], route)).toBe('legal_hold')
    expect(deriveCaseStatus({ cancelled: true }, [], route)).toBe('cancelled_duplicate')
    expect(deriveCaseStatus({ reopened: true }, [], route)).toBe('reopened')
    expect(deriveCaseStatus({ total_loss: true }, [], route)).toBe('total_loss_processing')
    expect(deriveCaseStatus({ case_status: 'closed' }, [], route)).toBe('closed')
  })

  it('a closed case wins over the total_loss / reopened projection (bug 4 precedence)', () => {
    // The terminal `closed` state must not be dragged back to a live stage by a
    // still-set total_loss or reopened flag.
    expect(deriveCaseStatus({ case_status: 'closed', total_loss: true }, [], route)).toBe('closed')
    expect(deriveCaseStatus({ case_status: 'closed', reopened: true }, [], route)).toBe('closed')
  })

  it('draft before submission, evidence_incomplete when returned', () => {
    expect(deriveCaseStatus({ submitted: false }, [], route)).toBe('draft')
    expect(deriveCaseStatus({ submitted: false, returned: true }, [], route)).toBe('evidence_incomplete')
  })

  it('submitted but evidence workstream not yet satisfied', () => {
    expect(deriveCaseStatus(submitted, rows({ incident_evidence: 'in_progress' }), route)).toBe('submitted')
  })

  it('picks the earliest unsatisfied required workstream headline', () => {
    const r = rows({ incident_evidence: 'completed', fleet_validation: 'completed', liability: 'completed', insurance: 'waiting_external' })
    expect(deriveCaseStatus(submitted, r, route)).toBe('awaiting_insurer_response')
    const r2 = rows({ incident_evidence: 'completed', fleet_validation: 'completed', liability: 'in_progress' })
    expect(deriveCaseStatus(submitted, r2, route)).toBe('liability_assessment')
  })

  it('once required workstreams are done, it lands on financial/review/closed', () => {
    const req = [...requiredWorkstreams(route, submitted)]
    const opDone = Object.fromEntries(req.map((ws) => [ws, 'completed']))
    // insurance settled but finance still open -> financial closure pending
    const financeOpen = rows({ ...opDone, finance: 'in_progress' })
    expect(deriveCaseStatus(submitted, financeOpen, route)).toBe('financial_closure_pending')
    // everything satisfied, review not approved -> closure_review
    const all = rows(opDone)
    expect(deriveCaseStatus(submitted, all, route)).toBe('closure_review')
    // review approved -> closed
    expect(deriveCaseStatus({ ...submitted, closure_review_approved: true }, all, route)).toBe('closed')
  })
})
