/**
 * Board-level read for the accident CASE model — the org-wide view over every
 * case (accidents case spine + workstreams + open tasks) that feeds the
 * AccidentCases page: the case analytics KPIs (src/lib/accidentCaseAnalytics.js)
 * and the team inbox (src/components/accidents/CaseTeamInbox.jsx).
 *
 * Distinct from accidentCase.js, which loads ONE case for the detail screen.
 * This module loads the whole set for reporting, so it favours a lean, PII-light
 * column list and honest degradation over per-case richness.
 *
 * SHIP-BEFORE-MIGRATE. The case columns (case_status / case_no / closure_level /
 * reopened_flag) and the accident_case_workstreams / accident_case_tasks tables
 * are the V417 review artifact, not yet applied. Every read here degrades: if the
 * case columns are absent the whole board reports { cases: [], ok: false } so the
 * page can render an honest "workflow not yet activated" state instead of an
 * error; if only the workstream/task tables are absent the cases still render and
 * the bottleneck / inbox simply come back empty.
 *
 * Conventions copied verbatim from accidents.js / accidentCase.js: explicit
 * column lists (no SELECT *), unwrap() semantics, null-safe country scoping via
 * applyCountry, paging past the PostgREST 1000-row cap with a unique id tiebreak,
 * and org/role/country/site isolation enforced server-side by RLS.
 */
import {
  supabase, unwrap, applyCountry, fetchAllPages, isMissingRelation,
} from './_client'
import { CASE_STATUSES, WORKSTREAMS, caseStatusLabel } from '../accidentCase'
import { MIN_AUTHORITATIVE } from '../accidentCaseAnalytics'

// ── column lists (explicit; lean; least-privilege) ───────────────────────────

// The accidents row the case analytics need: identity + the V300 workflow fields
// (workflow_stage, sla_due_at, closure_status) + the V417 case columns. Only
// columns that genuinely exist post-V417 are selected; a missing case column
// pre-V417 makes this read fail with a missing-relation error, which the loader
// treats as "not provisioned yet" (ok: false).
const CASE_COLS =
  'id,reference_no,case_no,asset_no,site,country,incident_date,created_at,' +
  'severity,status,workflow_stage,case_status,closure_status,closure_level,' +
  'reopened_flag,sla_due_at,responsible_owner_id,release_date'

// Workstream rows drive byWorkstreamBottleneck (which workstream stalls a case).
const WS_COLS =
  'id,accident_id,country,site,workstream_key,status,required,owner_role,team,completed_at'

// Open case tasks drive the team inbox and the SLA breach rate: they carry the
// due_at + status the inbox and slaBreachRate read. Completed/cancelled tasks
// cannot breach and are not inbox items, so they are excluded server-side.
const TASK_COLS =
  'id,accident_id,country,site,workstream_key,title,assignee_role,team,priority,due_at,status,completed_at'

const MAX_CASES = 100000
const MAX_ROWS = 100000

/** Run a read that may hit an unprovisioned V417 relation; on a missing relation
 *  resolve to the given empty value instead of throwing. */
async function readOrEmpty(fn, empty = []) {
  try {
    return await fn()
  } catch (err) {
    if (isMissingRelation(err)) return empty
    throw err
  }
}

/**
 * Load the org-wide accident case board, country-scoped (null-safe).
 *
 * Returns:
 *   - cases:       accidents rows carrying the case columns (analytics source)
 *   - workstreams: accident_case_workstreams rows (bottleneck source)
 *   - inbox:       open tasks reshaped for <CaseTeamInbox> (case_no enriched)
 *   - ok:          true when the case model is provisioned; false when the case
 *                  columns are absent (pre-V417) so the page shows a not-enabled
 *                  state rather than an error. NEVER throws for a missing relation.
 *
 * @param {{ country?: string }} [opts]
 * @returns {Promise<{ cases: object[], workstreams: object[], inbox: object[], ok: boolean }>}
 */
export async function loadAccidentCaseBoard({ country } = {}) {
  // Primary read: the case spine. Paged past the 1000-row cap, ordered newest
  // incident first with a unique id tiebreak so a page boundary never drops or
  // repeats a row (incident_date is not unique). A missing case column means the
  // workflow is not provisioned -> honest not-enabled state.
  const { data: cases, error: casesErr } = await fetchAllPages((from, to) => {
    let q = supabase
      .from('accidents')
      .select(CASE_COLS)
      .order('incident_date', { ascending: false })
      .order('id', { ascending: true })
    q = applyCountry(q, country)
    return q.range(from, to)
  }, { max: MAX_CASES })

  if (casesErr) {
    if (isMissingRelation(casesErr)) {
      return { cases: [], workstreams: [], inbox: [], ok: false }
    }
    // A real failure (RLS, network, ...) is surfaced as a sanitised message.
    unwrap({ error: casesErr }) // throws a ServiceError with a user-safe message
  }

  const caseList = cases || []

  // Secondary reads degrade to [] independently: a missing workstream/task table
  // only empties the bottleneck / inbox, it does not disable the whole board.
  const [workstreams, tasks] = await Promise.all([
    readOrEmpty(async () => {
      let q = supabase
        .from('accident_case_workstreams')
        .select(WS_COLS)
        .order('created_at', { ascending: true })
        .limit(MAX_ROWS)
      q = applyCountry(q, country)
      return unwrap(await q) || []
    }, []),
    readOrEmpty(async () => {
      let q = supabase
        .from('accident_case_tasks')
        .select(TASK_COLS)
        .not('status', 'in', '("completed","cancelled")')
        .order('due_at', { ascending: true })
        .limit(MAX_ROWS)
      q = applyCountry(q, country)
      return unwrap(await q) || []
    }, []),
  ])

  // Reshape open tasks into the read-only inbox shape <CaseTeamInbox> renders,
  // enriching each with its case reference so a row reads "Case ACC-..." rather
  // than a raw id when the case is in scope.
  const caseByAccident = new Map(caseList.map((c) => [c.id, c]))
  const inbox = (tasks || []).map((t) => {
    const parent = caseByAccident.get(t.accident_id)
    return {
      accident_id: t.accident_id,
      workstream_key: t.workstream_key,
      status: t.status,
      due_at: t.due_at,
      case_no: parent?.case_no ?? parent?.reference_no ?? null,
      site: t.site ?? parent?.site ?? null,
      country: t.country ?? parent?.country ?? null,
      team: t.team ?? null,
      owner_role: t.assignee_role ?? null,
    }
  })

  return { cases: caseList, workstreams: workstreams || [], inbox, ok: true }
}

// ── server-side aggregate fast path ───────────────────────────────────────────
//
// A browser can only compute buildCaseAnalytics over the rows it actually paged
// in, so the case-status breakdown, workstream bottleneck and headline KPIs all
// understate on a large fleet. These three RPCs (docs/accident-module/
// 17_REPORTING_RPCS.sql) compute the SAME figures server-side over the FULL,
// RLS-scoped dataset. This is purely an ENHANCEMENT with a fallback: when the
// RPCs are not provisioned yet (function missing), loadAccidentCaseAnalytics
// returns { server:false } and the page keeps its client-side buildCaseAnalytics
// path unchanged. It NEVER throws.

// Engine-vocabulary lookups so the server rows (which carry only bare
// token / key + value) are enriched with the same label / team / stage /
// name the client engine produces, and the page renders identically.
const CASE_STATUS_META = Object.fromEntries(CASE_STATUSES.map((c) => [c.token, c]))
const WORKSTREAM_META = Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w]))

/** Number coercion that preserves an honest null: a null / blank / non-finite
 *  value stays null (never coerced to 0), so an unmeasurable RPC figure
 *  (avg / median time-to-close, sla_breach_rate, reopen_rate) is passed through
 *  as null rather than dressed as a real reading of zero. */
function num(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Normalise the three RPC payloads into the SAME shape buildCaseAnalytics emits,
 *  so the page consumes server figures with no branching in its render. */
function normalizeCaseAnalytics(status, bottleneck, kpis) {
  const total = num(kpis?.total) ?? 0
  const open = num(kpis?.open) ?? 0
  const closed = num(kpis?.closed) ?? 0
  const authoritative = total >= MIN_AUTHORITATIVE
  let note = ''
  if (total === 0) note = 'No cases in scope.'
  else if (!authoritative) {
    note = `Based on ${total} case${total === 1 ? '' : 's'}, too few to read as authoritative.`
  }

  const statusRows = (Array.isArray(status?.rows) ? status.rows : []).map((r) => {
    const token = String(r?.token ?? '')
    return {
      token,
      label: caseStatusLabel(token),
      team: CASE_STATUS_META[token]?.team ?? null,
      stage: CASE_STATUS_META[token]?.stage ?? null,
      value: num(r?.value) ?? 0,
    }
  })

  const bnRows = (Array.isArray(bottleneck?.rows) ? bottleneck.rows : []).map((r) => {
    const key = String(r?.key ?? '')
    return {
      key,
      name: WORKSTREAM_META[key]?.name ?? key,
      team: WORKSTREAM_META[key]?.team ?? null,
      cases: num(r?.cases) ?? 0,
    }
  })

  return {
    basis: { total, open, closed, authoritative, note },
    status: {
      rows: statusRows,
      total,
      distinct: num(status?.distinct) ?? statusRows.length,
      unrecorded: num(status?.unrecorded) ?? 0,
      top: statusRows[0] || null,
    },
    bottleneck: {
      rows: bnRows,
      measured: bottleneck?.measured === true,
      stalledCases: num(bottleneck?.stalled_cases) ?? 0,
      top: bnRows[0] || null,
    },
    timeToClose: {
      avgDays: num(kpis?.avg_time_to_close),        // honest null passthrough
      medianDays: num(kpis?.median_time_to_close),  // honest null passthrough
      longestDays: num(kpis?.longest_time_to_close),// honest null passthrough
      measured: num(kpis?.time_to_close_measured) ?? 0,
      closedTotal: closed,
    },
    reopen: {
      reopened: num(kpis?.reopened) ?? 0,
      total,
      rate: num(kpis?.reopen_rate),                 // honest null passthrough
    },
    sla: {
      tracked: num(kpis?.sla_tracked) ?? 0,
      breached: num(kpis?.sla_breached) ?? 0,
      rate: num(kpis?.sla_breach_rate),             // honest null passthrough
    },
  }
}

/**
 * Server-computed case analytics over the FULL, RLS-scoped dataset via the three
 * 17_REPORTING_RPCS. p_country / p_from / p_to match the RPC signatures and are
 * NULL-safe (a null country never widens beyond the caller's RLS scope).
 *
 * DEGRADES, never throws: if any RPC is unprovisioned (isMissingRelation) or the
 * read fails for any other reason, returns { server: false } so the caller falls
 * back to the client-side buildCaseAnalytics over the already-loaded case list.
 *
 * @param {{ country?: string, from?: string, to?: string }} [opts]
 * @returns {Promise<{ server: false } | ({ server: true } & object)>}
 */
export async function loadAccidentCaseAnalytics({ country, from, to } = {}) {
  const pCountry = country && country !== 'All' ? country : null
  const pFrom = from || null
  const pTo = to || null

  try {
    const [statusRes, bottleneckRes, kpiRes] = await Promise.all([
      supabase.rpc('get_accident_case_status_breakdown', { p_country: pCountry }),
      supabase.rpc('get_accident_workstream_bottleneck', { p_country: pCountry }),
      supabase.rpc('get_accident_case_kpis', { p_country: pCountry, p_from: pFrom, p_to: pTo }),
    ])
    // Any RPC error (a missing function pre-migration, or any other read failure)
    // simply means "no server fast path" - fall back to the client path. A missing
    // relation and a real failure both degrade the same way here because this is an
    // enhancement layered over data the client already holds.
    for (const r of [statusRes, bottleneckRes, kpiRes]) {
      if (r?.error) return { server: false }
    }
    const status = statusRes?.data
    const bottleneck = bottleneckRes?.data
    const kpis = kpiRes?.data
    if (!status || !bottleneck || !kpis) return { server: false }

    return { server: true, ...normalizeCaseAnalytics(status, bottleneck, kpis) }
  } catch (err) {
    // isMissingRelation caught here too (a thrown missing-function), plus any other
    // unexpected throw - never propagate; the client-side path stays authoritative.
    if (isMissingRelation(err)) return { server: false }
    return { server: false }
  }
}
