// ─────────────────────────────────────────────────────────────────────────────
// aiCopilot.js - Embedded AI copilot tasks (one-click contextual insights).
//
// Reuses the existing secure chat-ai edge-function client (invokeChatAI in
// lib/api/uploads.js → supabase.functions.invoke('chat-ai', { body })), the
// same contract used by lib/agents/index.js: { system, user, model, max_tokens }.
//
// Token discipline (CLAUDE.md): prompts are compact plain-text digests built
// from an explicit whitelist of relevant fields — never JSON.stringify of full
// rows. Lists are capped at LIST_CAP items, free text at TEXT_CAP chars.
// Responses are cached in-memory per record version to avoid double-billing.
// ─────────────────────────────────────────────────────────────────────────────
import { invokeChatAI } from './api/uploads'

export const COPILOT_MODEL = 'claude-haiku-4-5-20251001'
export const COPILOT_MAX_TOKENS = 900
export const LIST_CAP = 20
export const TEXT_CAP = 280
const TIMEOUT_MS = 30_000
const CACHE_MAX = 40

// ── Digest helpers (field whitelisting, capping) ──────────────────────────────

/** Truncate free text; collapse whitespace. Returns '' for empty/nullish. */
export function clip(value, max = TEXT_CAP) {
  if (value == null) return ''
  const s = String(value).replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Build 'Label: value' lines from [label, value] pairs, skipping empties. */
export function digestLines(pairs) {
  return pairs
    .map(([label, value]) => {
      const v = clip(value)
      return v ? `${label}: ${v}` : null
    })
    .filter(Boolean)
    .join('\n')
}

/** Cap a list to LIST_CAP entries, noting how many were omitted. */
export function capList(items, cap = LIST_CAP) {
  const list = Array.isArray(items) ? items : []
  return {
    items: list.slice(0, cap),
    omitted: Math.max(0, list.length - cap),
  }
}

function omittedNote(omitted, noun) {
  return omitted > 0 ? `(+${omitted} more ${noun} omitted)` : ''
}

function fmtMoney(v) {
  const n = Number(v)
  return Number.isFinite(n) && v !== null && v !== '' ? Math.round(n).toLocaleString() : ''
}

/**
 * Generic scalar digest for draft_action_plan: keeps only primitive
 * own-fields (string/number/boolean), skips empties, caps field count.
 * Never emits nested objects/arrays — no full-row dumps.
 */
export function scalarDigest(record, maxFields = 24) {
  if (!record || typeof record !== 'object') return ''
  const lines = []
  for (const [key, value] of Object.entries(record)) {
    if (lines.length >= maxFields) break
    const t = typeof value
    if (value == null || (t !== 'string' && t !== 'number' && t !== 'boolean')) continue
    const v = clip(value, 120)
    if (v === '') continue
    lines.push(`${key.replace(/_/g, ' ')}: ${v}`)
  }
  return lines.join('\n')
}

// ── System prompts ────────────────────────────────────────────────────────────

const BASE_PERSONA =
  'You are a senior tyre fleet engineer and claims analyst inside Tyre Pulse. ' +
  'Answer ONLY from the data provided; if something is missing, say "not recorded" — never invent numbers. ' +
  'Respond in concise markdown with exactly these bold section headers: ' +
  '**Observation**, **Root cause**, **Risk**, **Actions**. ' +
  'Use short bullet points, cite figures from the data, keep the whole answer under 180 words.'

// ── Task registry ─────────────────────────────────────────────────────────────

export const COPILOT_TASKS = {
  summarize_accident: {
    label: 'Summarize this accident',
    icon: 'FileText',
    cacheKey({ accident = {}, remarks = [], parts = [] }) {
      return [accident.id, accident.updated_at ?? '', remarks.length, parts.length].join(':')
    },
    buildPrompt({ accident = {}, remarks = [], parts = [] }) {
      const a = accident
      const gross = (Number(a.repair_cost) || 0) + (Number(a.parts_cost) || 0)
      const head = digestLines([
        ['Asset', a.asset_no],
        ['Site', a.site],
        ['Incident date', a.incident_date],
        ['Severity', a.severity],
        ['Status', a.status],
        ['Closure', a.closure_status],
        ['Description', a.description],
        ['Repair cost', fmtMoney(a.repair_cost)],
        ['Parts cost', fmtMoney(a.parts_cost)],
        ['Gross cost', gross ? fmtMoney(gross) : ''],
        ['Claim status', a.claim_status],
        ['Claim amount', fmtMoney(a.claim_amount)],
        ['Approved amount', fmtMoney(a.claim_approved_amount)],
        ['Recovered', fmtMoney(a.recovered_amount)],
        ['Recovery status', a.recovery_status],
        ['Insurer', a.insurer],
        ['Liable party', a.liable_party],
        ['Responsible party', a.responsible_party],
        ['Case stage', a.case_stage],
        ['Current status', a.current_status],
        ['Next action', a.action_to_be_taken],
        ['Expected release', a.expected_release_date],
      ])
      const p = capList(parts)
      const partLines = p.items
        .map((x) => `- ${clip(x.part_name, 60)} x${Number(x.quantity) || 1} = ${fmtMoney(x.total_cost) || '0'} (${x.status || 'needed'})`)
        .join('\n')
      const r = capList(remarks)
      const remarkLines = r.items
        .map((x) => `- [${clip(x.remark_type, 20) || 'note'}] ${clip(x.remark, 140)}`)
        .join('\n')
      return {
        system:
          BASE_PERSONA +
          ' Task: write an executive summary of one accident case — what happened, the cost & recovery position, where the case stands, and the single most important next action.',
        user: [
          'ACCIDENT CASE',
          head,
          partLines && `PARTS ${omittedNote(p.omitted, 'parts')}\n${partLines}`,
          remarkLines && `CASE LOG (newest first) ${omittedNote(r.omitted, 'entries')}\n${remarkLines}`,
        ].filter(Boolean).join('\n\n'),
      }
    },
  },

  assess_vehicle_tyres: {
    label: 'Assess tyre risk',
    icon: 'CircleDot',
    cacheKey({ vehicle = {}, tyres = [] }) {
      return [vehicle.asset_no ?? vehicle.id, vehicle.updated_at ?? '', tyres.length].join(':')
    },
    buildPrompt({ vehicle = {}, tyres = [], metrics = {} }) {
      const v = vehicle
      const head = digestLines([
        ['Asset', v.asset_no],
        ['Vehicle', [v.make, v.model].filter(Boolean).join(' ')],
        ['Type', v.vehicle_type],
        ['Site', v.site],
        ['Expected km per tyre', v.expected_km_per_tyre],
        ['Tyre records', metrics.total],
        ['Tyre spend', fmtMoney(metrics.spend)],
        ['Avg CPK', metrics.cpk ? Number(metrics.cpk).toFixed(2) : ''],
        ['Critical tyres', metrics.critical],
        ['Avg life km', metrics.avgLifeKm],
      ])
      const t = capList(tyres)
      const tyreLines = t.items
        .map((x) => {
          const km = (Number(x.km_at_removal) || 0) - (Number(x.km_at_fitment) || 0)
          return `- pos ${x.position || '?'} | ${clip(x.brand, 20) || '?'} | ${clip(x.size, 16) || '?'} | ${km > 0 ? `${km.toLocaleString()} km` : 'km n/a'} | risk ${x.risk_level || 'n/a'}`
        })
        .join('\n')
      return {
        system:
          BASE_PERSONA +
          ' Task: assess this vehicle\'s tyre risk. Call out problem wheel positions explicitly (steer/drive/trailer), compare life vs the expected km target, and prioritise actions by safety then cost.',
        user: [
          'VEHICLE',
          head,
          tyreLines && `TYRES (most recent first) ${omittedNote(t.omitted, 'tyres')}\n${tyreLines}`,
        ].filter(Boolean).join('\n\n'),
      }
    },
  },

  explain_workorder: {
    label: 'Explain this work order',
    icon: 'Wrench',
    cacheKey({ workOrder = {}, parts = [] }) {
      return [workOrder.id, workOrder.updated_at ?? '', parts.length].join(':')
    },
    buildPrompt({ workOrder = {}, parts = [] }) {
      const w = workOrder
      const head = digestLines([
        ['Work order', w.wo_number ?? w.id],
        ['Asset', w.asset_no],
        ['Site', w.site],
        ['Type', w.work_type ?? w.type],
        ['Priority', w.priority],
        ['Status', w.status],
        ['Opened', w.created_at],
        ['Due', w.due_date],
        ['Closed', w.closed_at ?? w.completed_at],
        ['Assigned to', w.assigned_to_name ?? w.assigned_to],
        ['Description', w.description],
        ['Labour cost', fmtMoney(w.labour_cost)],
        ['Total cost', fmtMoney(w.total_cost)],
      ])
      const p = capList(parts)
      const partLines = p.items
        .map((x) => `- ${clip(x.part_name ?? x.name, 60)} x${Number(x.quantity) || 1} @ ${fmtMoney(x.unit_cost) || '0'} = ${fmtMoney(x.total_cost) || '0'}`)
        .join('\n')
      return {
        system:
          BASE_PERSONA +
          ' Task: explain this work order in plain language and sanity-check the cost — flag any part quantity, unit price, or total that looks abnormal for tyre/fleet maintenance.',
        user: [
          'WORK ORDER',
          head,
          partLines && `PARTS ${omittedNote(p.omitted, 'parts')}\n${partLines}`,
        ].filter(Boolean).join('\n\n'),
      }
    },
  },

  draft_action_plan: {
    label: 'Draft action plan',
    icon: 'ClipboardList',
    cacheKey({ record = {}, recordType = 'record' }) {
      return [recordType, record.id ?? record.asset_no ?? '', record.updated_at ?? ''].join(':')
    },
    buildPrompt({ record = {}, recordType = 'record', notes = '' }) {
      return {
        system:
          BASE_PERSONA +
          ' Task: draft a prioritized action plan (max 5 actions, each with an owner role and timeframe) to resolve or improve the situation described by this record.',
        user: [
          `RECORD TYPE: ${clip(recordType, 40)}`,
          scalarDigest(record),
          notes && `CONTEXT NOTES\n${clip(notes, 500)}`,
        ].filter(Boolean).join('\n\n'),
      }
    },
  },
}

// ── Response cache (per record version — avoids double-billing on re-open) ────

const responseCache = new Map()

export function copilotCacheKey(taskKey, context) {
  const task = COPILOT_TASKS[taskKey]
  return task ? `${taskKey}:${task.cacheKey(context ?? {})}` : null
}

export function clearCopilotCache() {
  responseCache.clear()
}

function cacheSet(key, text) {
  if (responseCache.size >= CACHE_MAX) {
    const oldest = responseCache.keys().next().value
    responseCache.delete(oldest)
  }
  responseCache.set(key, text)
}

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Run a copilot task against the secure chat-ai edge function.
 * Returns { text, cached } or throws an Error with a user-friendly message.
 */
export async function runCopilotTask(taskKey, context, { bypassCache = false } = {}) {
  const task = COPILOT_TASKS[taskKey]
  if (!task) throw new Error(`Unknown AI copilot task "${taskKey}".`)

  const key = copilotCacheKey(taskKey, context)
  if (!bypassCache && key && responseCache.has(key)) {
    return { text: responseCache.get(key), cached: true }
  }

  const { system, user } = task.buildPrompt(context ?? {})

  let timer
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('The AI request timed out after 30 seconds. Please try again.')),
        TIMEOUT_MS,
      )
    })
    const res = await Promise.race([
      invokeChatAI({ system, user, model: COPILOT_MODEL, max_tokens: COPILOT_MAX_TOKENS }),
      timeout,
    ])

    if (res?.error) {
      // Surface the function's real error body (same pattern as callAiEdgeFunction)
      let detail = res.error.message
      try {
        const body = await res.error.context?.json?.()
        if (body?.error) detail = body.error
      } catch { /* keep message */ }
      throw new Error(`AI is unavailable: ${detail || 'edge function error'}`)
    }
    if (res?.data?.error) throw new Error(`AI is unavailable: ${res.data.error}`)

    const text = res?.data?.content
    if (!text || typeof text !== 'string') {
      throw new Error('The AI returned an empty response. Please try again.')
    }
    if (key) cacheSet(key, text)
    return { text, cached: false }
  } finally {
    clearTimeout(timer)
  }
}
