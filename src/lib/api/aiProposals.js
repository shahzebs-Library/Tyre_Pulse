/**
 * AI proposals service - the seam between the Action Center's "AI proposals"
 * panel and Supabase (table public.ai_proposals, migration 20261112102000).
 *
 *   loadDetectorInputs  - bounded, country-scoped reads the pure engine needs
 *   scanProposals       - run src/lib/aiProposals.js and record the output via
 *                         RPC ai_proposals_record (dedupe server-side)
 *   listAiProposals     - read the queue (RLS scopes org + country)
 *   decideAiProposal    - RPC ai_proposal_decide (accept / reject)
 *   listProposalEvents  - the append-only decision history
 *
 * Nothing here performs an action on a source record. Accepting records the
 * decision; the only side effect the server may take is opening ONE corrective
 * action when the decider asks for it.
 *
 * Before the migration is applied every call degrades honestly:
 * `notProvisioned: true` instead of an empty list that reads as "no findings".
 */
import { supabase, fetchAllPages, applyCountry, toServiceError, isNotProvisioned } from './_client'
import { detectProposals } from '../aiProposals'
import { getTyreRunningLife } from './tyreRunningLife'
import { shapeRunningLife } from '../tyreRunningLife'
import { getFleetCpk } from './fleetCpk'

export const PROPOSAL_COLS =
  'id,country,site,proposal_type,severity,dedupe_key,title,summary,recommended_action,' +
  'entity_refs,evidence,evidence_total,metrics,detector_version,status,decided_by,decided_at,' +
  'decision_note,corrective_action_id,created_at,updated_at,last_seen_at'

const DAY_MS = 86400000
const isoDay = (d) => d.toISOString().slice(0, 10)
const scoped = (c) => (c && c !== 'All' ? c : null)

/** Map an RPC jsonb refusal to a plain sentence. */
export function refusalMessage(reason) {
  switch (reason) {
    case 'forbidden': return 'Only an Admin, Manager or Director can do this.'
    case 'note_required': return 'Add a short reason before rejecting a proposal.'
    case 'not_found': return 'This proposal is no longer available.'
    case 'too_many': return 'Too many proposals in one scan. Narrow the country and try again.'
    case 'invalid_decision':
    case 'invalid': return 'The request was not valid.'
    default: return 'The request could not be completed.'
  }
}

/** Open (and recently decided) proposals, worst first. */
export async function listAiProposals({ country, status = 'proposed', limit = 500 } = {}) {
  try {
    let q = supabase.from('ai_proposals').select(PROPOSAL_COLS)
    if (status && status !== 'all') q = q.eq('status', status)
    q = applyCountry(q, scoped(country))
    const { data, error } = await q.order('created_at', { ascending: false }).order('id').limit(Math.min(limit, 1000))
    if (error) {
      if (isNotProvisioned(error)) return { rows: [], notProvisioned: true }
      throw toServiceError(error, 'Could not load AI proposals.')
    }
    const rank = { critical: 4, high: 3, medium: 2, low: 1 }
    const rows = (data || []).slice().sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0))
    return { rows, notProvisioned: false }
  } catch (err) {
    if (isNotProvisioned(err)) return { rows: [], notProvisioned: true }
    throw toServiceError(err, 'Could not load AI proposals.')
  }
}

export async function listProposalEvents(proposalId) {
  const { data, error } = await supabase.from('ai_proposal_events')
    .select('id,event,actor,note,detail,at').eq('proposal_id', proposalId).order('at').limit(200)
  if (error) {
    if (isNotProvisioned(error)) return []
    throw toServiceError(error, 'Could not load the proposal history.')
  }
  return data || []
}

/**
 * Bounded reads for the detector. Each source degrades to [] on its own so one
 * missing feed never blocks the others; the returned `sources` says which ones
 * actually answered, so the panel can state what the scan covered.
 */
export async function loadDetectorInputs({ country, now = new Date() } = {}) {
  const c = scoped(country)
  const t = now.getTime()
  const since90 = isoDay(new Date(t - 90 * DAY_MS))
  const since365 = isoDay(new Date(t - 365 * DAY_MS))
  const since8m = isoDay(new Date(t - 240 * DAY_MS))
  const sources = {}

  // Each read is bounded (fetchAllPages + id tiebreak + max) and settles on its
  // own: a failed feed is reported in `sources`, never a thrown scan.
  const settle = async (key, pending) => {
    try {
      const { data, error, truncated } = await pending
      if (error) throw error
      sources[key] = { ok: true, rows: data.length, truncated: !!truncated }
      return data
    } catch {
      sources[key] = { ok: false }
      return []
    }
  }

  const [inspections, correctiveActions, removed, active, issued, warrantyClaims] = await Promise.all([
    settle('inspections', fetchAllPages((from, to) => applyCountry(supabase.from('inspections')
      .select('id,asset_no,country,site,inspection_date,created_at,tyre_conditions')
      .gte('inspection_date', since90), c).order('inspection_date', { ascending: false }).order('id').range(from, to), { max: 5000 })),
    settle('corrective_actions', fetchAllPages((from, to) => applyCountry(supabase.from('corrective_actions')
      .select('id,title,status,priority,due_date,asset_no,country,site,source_type,source_id,assigned_to'), c)
      .order('created_at', { ascending: false }).order('id').range(from, to), { max: 20000 })),
    settle('tyres_removed', fetchAllPages((from, to) => applyCountry(supabase.from('tyre_records')
      .select('id,serial_no,asset_no,tyre_position,vehicle_type,country,site,brand,size,status,issue_date,fitment_date,removal_date,removal_reason,km_at_fitment,km_at_removal,total_km')
      .gte('removal_date', since365), c).order('removal_date', { ascending: false }).order('id').range(from, to), { max: 30000 })),
    settle('tyres_active', fetchAllPages((from, to) => applyCountry(supabase.from('tyre_records')
      .select('id,serial_no,asset_no,tyre_position,country,status,issue_date,removal_date')
      .is('removal_date', null), c).order('id').range(from, to), { max: 30000 })),
    settle('tyres_issued', fetchAllPages((from, to) => applyCountry(supabase.from('tyre_records')
      .select('id,country,issue_date').gte('issue_date', since8m), c).order('id').range(from, to), { max: 30000 })),
    settle('warranty_claims', fetchAllPages((from, to) => supabase.from('warranty_claims')
      .select('id,serial_number').order('id').range(from, to), { max: 20000 })),
  ])

  // Monthly fitments per country (abnormal consumption).
  const counts = new Map()
  for (const r of issued) {
    const m = String(r.issue_date || '').slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(m)) continue
    const k = `${r.country || ''}|${m}`
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  // Only whole months: the running month would always look low.
  const thisMonth = isoDay(now).slice(0, 7)
  const monthlyConsumption = [...counts.entries()]
    .map(([k, count]) => { const [ctry, month] = k.split('|'); return { country: ctry || null, month, count } })
    .filter((r) => r.month < thisMonth)

  // CPK: last 30 days vs the 30 before, per country, total cost per km.
  let cpkWindows = []
  try {
    const curFrom = isoDay(new Date(t - 30 * DAY_MS))
    const prevFrom = isoDay(new Date(t - 60 * DAY_MS))
    const [cur, prev] = await Promise.all([
      getFleetCpk({ country: c, from: curFrom, to: isoDay(now) }),
      getFleetCpk({ country: c, from: prevFrom, to: curFrom }),
    ])
    const prevBy = new Map((prev.fleet || []).map((r) => [r.country, r]))
    cpkWindows = (cur.fleet || []).flatMap((r) => {
      const p = prevBy.get(r.country)
      if (!p) return []
      return [
        { scope: 'fleet', unit: 'km', country: r.country, currency: r.currency, metric: 'tyre_spend_ratio', current: r.km?.cpk_tyre, prior: p.km?.cpk_tyre, period: curFrom },
        { scope: 'fleet', unit: 'hours', country: r.country, currency: r.currency, current: r.hours?.cpk_total, prior: p.hours?.cpk_total, period: curFrom },
      ]
    })
    sources.cpk = { ok: true, rows: cpkWindows.length }
  } catch {
    sources.cpk = { ok: false }
  }

  let runningLife = []
  try {
    const res = await getTyreRunningLife({ country: c, dueOnly: true, maxAgeMs: 60000 })
    runningLife = shapeRunningLife(res).rows
    sources.running_life = { ok: res?.ok !== false, rows: runningLife.length }
  } catch {
    sources.running_life = { ok: false }
  }

  return {
    input: {
      inspections, correctiveActions, tyres: [...removed, ...active],
      warrantyClaims, monthlyConsumption, cpkWindows, runningLife,
    },
    sources,
  }
}

/**
 * Detect and record. Detection happens here (pure engine); the server only
 * stores, dedupes and refreshes. Returns server counts + what the scan covered.
 */
export async function scanProposals({ country, now = new Date() } = {}) {
  const { input, sources } = await loadDetectorInputs({ country, now })
  const proposals = detectProposals(input, { now })
  if (!proposals.length) return { ok: true, detected: 0, created: 0, refreshed: 0, skipped: 0, invalid: 0, sources }
  const { data, error } = await supabase.rpc('ai_proposals_record', { p_items: proposals })
  if (error) {
    if (isNotProvisioned(error)) return { ok: false, notProvisioned: true, sources }
    throw toServiceError(error, 'Could not record the proposals.')
  }
  if (!data || data.ok === false) throw new Error(refusalMessage(data?.reason))
  return { ok: true, detected: proposals.length, ...data, sources }
}

/**
 * Record a decision. `createAction` (accept only) asks the server to open one
 * corrective action linked to the proposal. Nothing else is changed.
 */
export async function decideAiProposal(id, decision, { note = '', createAction = false } = {}) {
  if (!id) throw new Error('Proposal id is required.')
  if (decision !== 'accepted' && decision !== 'rejected') throw new Error('Decision must be accepted or rejected.')
  if (decision === 'rejected' && !String(note || '').trim()) throw new Error(refusalMessage('note_required'))
  const { data, error } = await supabase.rpc('ai_proposal_decide', {
    p_id: id,
    p_decision: decision,
    p_note: String(note || '').trim().slice(0, 2000) || null,
    p_create_action: decision === 'accepted' && !!createAction,
  })
  if (error) throw toServiceError(error, 'Could not record the decision.')
  if (!data || data.ok === false) throw new Error(refusalMessage(data?.reason))
  return data
}
