/**
 * accidentCase - READ-ONLY mobile boundary for the accident CASE + WORKSTREAM
 * model (web V417). A field user opens an accident and sees its workflow case
 * status and per-workstream progress (which team is done / pending / not
 * required). This is the mobile mirror of the web CaseCompletionPanel; there is
 * NO write path here by design.
 *
 * The relational spine (accidents case columns + accident_case_workstreams) is a
 * web migration that may not be applied yet. SHIP-BEFORE-MIGRATE: every read
 * degrades. When the workstream table is not provisioned the loader returns a
 * `{ provisioned: false }` sentinel so the screen shows an honest "not yet
 * activated" note instead of crashing. The accident row itself is read with
 * `select('*')` so a missing case COLUMN can never error - absent case columns
 * simply come back undefined.
 *
 * Country is normalised per the app-wide normaliseCountry rule (profiles.country
 * is a text[]); the RESTRICTIVE org/country/site RLS is the real boundary, the
 * client filter is a null-safe convenience only.
 */
import { supabase } from './supabase'
import { normaliseCountry } from './types'

// ── engine vocabulary (read-only mirror of src/lib/accidentCase.js) ───────────
// The ten canonical workstreams, in pipeline order, each with its owning team.
// Display names/labels are resolved via i18n on the screen (key -> label); this
// list only fixes the set, order and team so the mobile view matches the web.
export const WORKSTREAM_ORDER = [
  'incident_evidence',
  'fleet_validation',
  'liability',
  'insurance',
  'assessment',
  'repair',
  'workshop_qc',
  'handover',
  'finance',
  'corrective',
] as const

export type WorkstreamKey = typeof WORKSTREAM_ORDER[number]

const WS_INDEX: Record<string, number> = Object.fromEntries(
  WORKSTREAM_ORDER.map((k, i) => [k, i]),
)

/** The four progress buckets a chip renders (engine vocabulary, collapsed for a
 *  read-only view): done / in_progress / pending / not_required. */
export type CaseChip = 'done' | 'in_progress' | 'pending' | 'not_required'

// Workstream status tokens (src/lib/accidentCase.js WORKSTREAM_STATUS) -> chip.
const CHIP_FOR_STATUS: Record<string, CaseChip> = {
  completed: 'done',
  not_required: 'not_required',
  cancelled: 'not_required',
  not_started: 'pending',
  rejected: 'pending',
  assigned: 'in_progress',
  in_progress: 'in_progress',
  waiting_info: 'in_progress',
  waiting_approval: 'in_progress',
  waiting_external: 'in_progress',
  on_hold: 'in_progress',
  reopened: 'in_progress',
}

/** Collapse a stored workstream row to one of the four display chips. A row
 *  explicitly marked not-applicable is "not required" regardless of its status
 *  token; an unknown/blank status reads as "pending" (not yet done). */
export function caseChipFor(status: string | null | undefined, notApplicable?: boolean | null): CaseChip {
  if (notApplicable) return 'not_required'
  const key = String(status ?? '').trim().toLowerCase()
  return CHIP_FOR_STATUS[key] ?? 'pending'
}

// ── row shapes ────────────────────────────────────────────────────────────────

/** The accident row, read with select('*') so any case columns that exist come
 *  through and any that do not are simply undefined. */
export interface AccidentCaseRecord {
  id: string
  reference_no?: string | null
  case_no?: string | null
  severity?: string | null
  status?: string | null
  workflow_stage?: string | null
  case_status?: string | null
  route_key?: string | null
  closure_level?: string | null
  completion_overall?: number | null
  completion_incident?: number | null
  completion_insurance?: number | null
  completion_repair?: number | null
  completion_financial?: number | null
  [k: string]: unknown
}

export interface CaseWorkstream {
  id: string
  workstream_key: string
  status: string | null
  required: boolean | null
  team: string | null
  owner_role: string | null
  progress_pct: number | null
  not_applicable: boolean | null
  na_reason: string | null
  notes: string | null
  updated_at: string | null
}

const WS_COLS =
  'id,workstream_key,status,required,team,owner_role,progress_pct,not_applicable,na_reason,notes,updated_at'

export type AccidentCaseResult =
  | { provisioned: true; case: AccidentCaseRecord; workstreams: CaseWorkstream[] }
  | { provisioned: false; case: AccidentCaseRecord }

/** True when the error indicates the case table/relation or a column is not
 *  provisioned (the web migration has not landed) - degrade, never error. */
function isMissingRelation(err: any): boolean {
  if (!err) return false
  const code = String(err.code ?? '')
  // 42P01 undefined_table, 42703 undefined_column, PGRST205 unknown table,
  // PGRST204 unknown column.
  if (code === '42P01' || code === '42703' || code === 'PGRST205' || code === 'PGRST204') return true
  const m = String(err.message ?? '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find')
}

/**
 * Load one accident's case view: the accident row plus its workstream rows.
 *
 * @param accidentId accidents.id
 * @param opts.country a raw profiles.country value (text[] or string); it is
 *   normalised and, when it collapses to a single country, applied as a
 *   null-safe client filter on the workstream read. RLS remains authoritative.
 * @returns the assembled case, a `{ provisioned:false }` sentinel when the
 *   workstream table is absent, or `null` when the accident does not exist.
 */
export async function loadAccidentCase(
  accidentId: string,
  opts: { country?: unknown } = {},
): Promise<AccidentCaseResult | null> {
  if (!accidentId) return null
  const country = normaliseCountry(opts.country)

  // The accident row. select('*') never errors on a missing case column, so this
  // works both before and after the case migration.
  const accRes = await supabase.from('accidents').select('*').eq('id', accidentId).maybeSingle()
  if (accRes.error) throw accRes.error
  if (!accRes.data) return null
  const record = accRes.data as AccidentCaseRecord

  // Workstream rows. A missing table means the case model is not provisioned yet.
  let q = supabase
    .from('accident_case_workstreams')
    .select(WS_COLS)
    .eq('accident_id', accidentId)
    .limit(50)
  // Null-safe country scope: only when it collapses to exactly one country, and
  // keep rows with no country (RLS already bounds the tenant/country visibility).
  if (country) q = q.or(`country.eq.${country},country.is.null`)

  const wsRes = await q
  if (wsRes.error) {
    if (isMissingRelation(wsRes.error)) return { provisioned: false, case: record }
    throw wsRes.error
  }

  const workstreams = ((wsRes.data ?? []) as CaseWorkstream[])
    .slice()
    .sort((a, b) => {
      const ia = WS_INDEX[a.workstream_key] ?? 99
      const ib = WS_INDEX[b.workstream_key] ?? 99
      return ia - ib
    })

  return { provisioned: true, case: record, workstreams }
}
