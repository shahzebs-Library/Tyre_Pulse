/**
 * The ERP evidence service: Codex's focused lookup (PR #522) feeding the shared
 * position service, and honest behaviour while the review tables and functions
 * are not in the database yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ERP_RULES_VERSION } from '../lib/tyrePositionService'

const h = vi.hoisted(() => {
  const state = { tables: {}, errors: {}, rpcError: null, calls: [] }
  function from(table) {
    const call = { table, filters: [] }
    state.calls.push(call)
    const done = () => Promise.resolve(state.errors[table]
      ? { data: null, error: state.errors[table] }
      : { data: state.tables[table] ?? [], error: null })
    const b = {
      select() { return b },
      eq(c, v) { call.filters.push(['eq', c, v]); return b },
      in(c, v) { call.filters.push(['in', c, v]); return b },
      gte(c, v) { call.filters.push(['gte', c, v]); return b },
      or(v) { call.filters.push(['or', v]); return b },
      order() { return b },
      limit(n) { call.limit = n; return b },
      maybeSingle() { return done().then((r) => (r.error ? r : { data: (r.data || [])[0] ?? null, error: null })) },
      then(f, r) { return done().then(f, r) },
    }
    return b
  }
  const rpc = vi.fn((name) => {
    if (name === 'observation_erp_rules') return Promise.resolve(state.rules)
    return Promise.resolve(state.rpcError ? { data: null, error: state.rpcError } : { data: { ok: true }, error: null })
  })
  return { state, supabase: { from, rpc } }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const api = await import('../lib/api/observationErpEvidence')

const inspection = { id: 'i1', asset_no: 'TM400', country: 'KSA', inspection_date: '2026-11-10', vehicle_type: 'TR-MIXER' }
const MISSING_TABLE = { code: '42P01', message: 'relation "observation_erp_links" does not exist' }

beforeEach(() => {
  h.state.tables = {
    tyre_records: [{ id: 't1', asset_no: 'TM400', country: 'KSA', serial_no: 'NEW-700100', tyre_position: 'RHCO', job_card: 'JC-1', issue_date: '2026-11-12' }],
    work_orders: [{ id: 'w1', work_order_no: 'JC-1', asset_no: 'TM400', country: 'KSA', opened_at: '2026-11-12', description: 'Tyre change' }],
    parts_consumption: [],
    vehicle_fleet: [{ vehicle_type: 'TR-MIXER', axle_count: null }],
    vehicle_diagram_configs: [],
    observation_erp_links: [],
    observation_erp_link_events: [],
  }
  h.state.errors = {}; h.state.rpcError = null; h.state.calls = []
  h.state.rules = { data: { rules_version: 'position-service-2', can_review: true, can_record_exception: false }, error: null }
  h.supabase.rpc.mockClear()
})

describe('focused evidence lookup', () => {
  it('reads only tyre movements on or after the inspection date, never the whole asset history', async () => {
    await api.findObservationErpEvidence({ inspection, finding: { rawPosition: 'R1Ro' } })
    const tyre = h.state.calls.find((c) => c.table === 'tyre_records')
    expect(tyre.filters).toContainEqual(['or', 'issue_date.gte.2026-11-10,removal_date.gte.2026-11-10'])
    expect(tyre.limit).toBe(200)
    const wo = h.state.calls.filter((c) => c.table === 'work_orders')
    expect(wo[0].filters).toContainEqual(['in', 'work_order_no', ['JC-1']])
  })

  it('matches the inspection slot to the ERP code through the position service', async () => {
    const r = await api.findObservationErpEvidence({ inspection, finding: { rawPosition: 'R1Ro' } })
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0].eligibleToConfirm).toBe(true)
    expect(r.candidates[0].evidenceSummary.canonicalPosition).toBe('RHCO')
  })

  it('an asset registered twice gets no assumed build, and an unplaceable ERP code stays pending', async () => {
    h.state.tables.vehicle_fleet = [{ vehicle_type: 'TR-MIXER' }, { vehicle_type: 'PICKUP' }]
    h.state.tables.tyre_records[0].tyre_position = 'RHR1-O'
    const r = await api.findObservationErpEvidence({ inspection, finding: { rawPosition: 'R1Ro' } })
    expect(r.candidates[0].status).toBe('manual_review')
    expect(r.candidates[0].eligibleToConfirm).toBe(false)
  })

  it('a failed read is an error, not an empty result', async () => {
    h.state.errors.tyre_records = { code: '42501', message: 'permission denied' }
    await expect(api.findObservationErpEvidence({ inspection, finding: { rawPosition: 'R1Ro' } })).rejects.toBeTruthy()
  })
})

describe('review tables not in the database yet', () => {
  it.each(['42P01', 'PGRST205', 'PGRST202', '42883'])('code %s reads as not set up, not as "no link" and not as an error', async (code) => {
    h.state.errors.observation_erp_links = { ...MISSING_TABLE, code }
    h.state.errors.observation_erp_link_events = { ...MISSING_TABLE, code }
    await expect(api.getObservationErpReviewState('a1')).resolves.toMatchObject({ provisioned: false, link: null, history: [] })
  })

  it('a permission failure is NOT reported as "not set up"', async () => {
    h.state.errors.observation_erp_links = { code: '42501', message: 'permission denied' }
    await expect(api.getObservationErpReviewState('a1')).rejects.toBeTruthy()
  })

  it('returns the link and history when the tables exist', async () => {
    h.state.tables.observation_erp_links = [{ id: 'l1', action_id: 'a1', source_job_card: 'JC-1' }]
    h.state.tables.observation_erp_link_events = [{ id: 'e1', decision: 'confirmed' }]
    const s = await api.getObservationErpReviewState('a1')
    expect(s.provisioned).toBe(true)
    expect(s.link.source_job_card).toBe('JC-1')
    expect(s.history).toHaveLength(1)
  })

  it('the evidence lookup still works while the review tables are missing', async () => {
    h.state.errors.observation_erp_links = MISSING_TABLE
    h.state.errors.observation_erp_link_events = MISSING_TABLE
    const r = await api.findObservationErpEvidence({ inspection, finding: { rawPosition: 'R1Ro' } })
    expect(r.candidates).toHaveLength(1)
    expect(h.state.calls.some((c) => c.table.startsWith('observation_erp'))).toBe(false)
  })

  it('layout versions and verified mappings are optional: missing tables read as none, other failures are errors', async () => {
    h.state.errors.vehicle_diagram_config_versions = { code: 'PGRST205', message: 'not found' }
    h.state.errors.tyre_layout_position_mappings = { code: '42P01', message: 'missing' }
    const r = await api.findObservationErpEvidence({ inspection, finding: { rawPosition: 'R1Ro' } })
    expect(r.candidates[0].eligibleToConfirm).toBe(true)
    h.state.errors.tyre_layout_position_mappings = { code: '42501', message: 'permission denied' }
    await expect(api.findObservationErpEvidence({ inspection, finding: { rawPosition: 'R1Ro' } })).rejects.toBeTruthy()
  })

  it('a confirm that fails because the function is missing is recognised', async () => {
    h.state.rpcError = { code: 'PGRST202', message: 'Could not find the function public.confirm_observation_erp_link' }
    let caught = null
    try { await api.confirmObservationErpLink({ actionId: 'a1', workOrderId: 'w1', note: 'Reviewed evidence' }) } catch (e) { caught = e }
    expect(caught).toBeTruthy()
    expect(api.isErpReviewNotProvisioned(caught)).toBe(true)
    expect(api.isErpReviewNotProvisioned({ code: '42501' })).toBe(false)
  })
})

describe('a decision the server refused is explained in plain words', () => {
  const refused = (message, code = 'PT409') => {
    const e = new Error('This record changed since you opened it. Refresh and try again.')
    e.code = code; e.cause = { code, message }
    return e
  }
  it.each([
    ['No ERP tyre movement matches the action position or serial', /no tyre movement on this job card/],
    ['The inspected wheel could not be matched on this vehicle (pending_manual_review). Pending manual review', /pending manual review/],
    ['Unknown inspection tyre position', /pending manual review/],
    ['Job card predates the inspection. Manual investigation required', /opened before the inspection/],
    ['Action already linked to another confirmed job card', /already linked to a different job card/],
    ['Only own inspection tyre actions may be linked', /Only tyre damage actions/],
  ])('%s', (serverText, want) => {
    const text = api.erpDecisionMessage(refused(serverText))
    expect(text).toMatch(want)
    expect(text).not.toMatch(/record changed/)
  })
  it('an unknown database error never shows its raw text', () => {
    const text = api.erpDecisionMessage(refused('relation "public.secret_table" violates constraint xyz', '23514'))
    expect(text).not.toMatch(/secret_table|constraint/)
  })
  it('works on the live function and on the follow-up: same RPC names and arguments', async () => {
    await api.confirmObservationErpLink({ actionId: 'a1', workOrderId: 'w1', note: ' Reviewed ' })
    await api.rejectObservationErpSuggestion({ actionId: 'a1', workOrderId: 'w1', note: 'Wrong wheel' })
    expect(h.supabase.rpc.mock.calls.filter(([n]) => n !== 'observation_erp_rules')).toEqual([
      ['confirm_observation_erp_link', { p_action_id: 'a1', p_work_order_id: 'w1', p_reason: 'Reviewed' }],
      ['reject_observation_erp_link', { p_action_id: 'a1', p_work_order_id: 'w1', p_reason: 'Wrong wheel' }],
    ])
  })
})

describe('a decision is offered only when client and database run the same rules', () => {
  it('old database (the rules function does not exist): not available', async () => {
    h.state.rules = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.observation_erp_rules' } }
    const a = await api.getErpDecisionAvailability()
    expect(a).toMatchObject({ available: false, reason: 'old_database', canReview: false, canRecordException: false })
  })
  it('new database, same version: available, with what this person may do', async () => {
    h.state.rules = { data: { rules_version: ERP_RULES_VERSION, can_review: true, can_record_exception: true }, error: null }
    expect(await api.getErpDecisionAvailability()).toMatchObject({ available: true, reason: 'ok', canReview: true, canRecordException: true })
  })
  it.each(['position-service-1', 'position-service-3'])('version mismatch (%s): not available, whichever side is ahead', async (v) => {
    h.state.rules = { data: { rules_version: v, can_review: true, can_record_exception: true }, error: null }
    expect(await api.getErpDecisionAvailability()).toMatchObject({ available: false, reason: 'version_mismatch', databaseVersion: v, canReview: false })
  })
  it('any other failure is not available either, never assumed', async () => {
    h.state.rules = { data: null, error: { code: '57014', message: 'timeout' } }
    expect(await api.getErpDecisionAvailability()).toMatchObject({ available: false, reason: 'unknown' })
    h.state.rules = { data: {}, error: null }
    expect((await api.getErpDecisionAvailability()).available).toBe(false)
  })
  it('the review state carries the availability', async () => {
    h.state.rules = { data: null, error: { code: '42883', message: 'function does not exist' } }
    const s = await api.getObservationErpReviewState('a1')
    expect(s.provisioned).toBe(true)
    expect(s.decisions.available).toBe(false)
  })
  it('the client version is the one written in the database draft', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/pending_migrations/20261116091000_observation_erp_decide_on_position_service.sql'), 'utf8')
    const found = [...sql.matchAll(/'rules_version', '([^']+)'/g)].map((m) => m[1])
    expect(found.length).toBe(2)
    expect(new Set(found)).toEqual(new Set([ERP_RULES_VERSION]))
  })
  it('the message is the agreed wording', () => {
    expect(api.ERP_DECISIONS_UNAVAILABLE_MESSAGE).toBe('ERP confirmation is not available yet. Evidence can be reviewed, but a decision cannot be recorded until the database update is approved.')
  })
  it('a withheld or missing decision function reads as not available, never a raw error', () => {
    const revoked = Object.assign(new Error('x'), { cause: { code: '42501', message: 'permission denied for function observation_erp_decide' } })
    expect(api.erpDecisionMessage(revoked)).toBe(api.ERP_DECISIONS_UNAVAILABLE_MESSAGE)
    expect(api.erpDecisionMessage({ code: 'PGRST202', message: 'Could not find the function public.confirm_observation_erp_link' })).toBe(api.ERP_DECISIONS_UNAVAILABLE_MESSAGE)
    const gate = Object.assign(new Error('x'), { cause: { code: '42501', message: 'Not authorised to confirm ERP evidence' } })
    expect(api.erpDecisionMessage(gate)).toBe('Your account is not allowed to record this decision.')
  })
  it('a serial exception needs a real reason and uses its own function', async () => {
    await expect(api.confirmObservationErpLinkByException({ actionId: 'a1', workOrderId: 'w1', note: 'too short' })).rejects.toBeTruthy()
    await api.confirmObservationErpLinkByException({ actionId: 'a1', workOrderId: 'w1', note: 'Serial read off the removed tyre by the workshop' })
    expect(h.supabase.rpc.mock.calls.at(-1)[0]).toBe('confirm_observation_erp_link_by_exception')
  })
})
