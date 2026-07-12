/**
 * Onboarding Wizard — pure, dependency-free domain logic for the guided tenant
 * setup module (/onboarding). Reduces a set of onboarding tasks into completion
 * percentages, per-phase progress, go-live readiness, and a "what's next" queue.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/onboarding.js`) and page
 * (`src/pages/OnboardingWizard.jsx`) both build on these primitives so the
 * roll-up logic lives in exactly one place.
 */

/** Canonical phase order for a tenant activation journey. */
export const PHASE_ORDER = [
  'setup',
  'data_import',
  'configuration',
  'team',
  'integration',
  'go_live',
]

/** Human-readable labels for each phase (single source of truth for the UI). */
export const PHASE_LABELS = {
  setup: 'Account Setup',
  data_import: 'Data Import',
  configuration: 'Configuration',
  team: 'Team & Roles',
  integration: 'Integrations',
  go_live: 'Go Live',
}

/** Valid task statuses. */
export const STATUSES = ['not_started', 'in_progress', 'completed', 'skipped', 'blocked']

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Normalise to a safe array. */
function asList(rows) {
  return Array.isArray(rows) ? rows : []
}

/** Round to a whole-number percentage in the 0..100 range. */
function pct(n, total) {
  if (!total || total <= 0) return 0
  const p = Math.round((n / total) * 100)
  return Math.max(0, Math.min(100, p))
}

const isCompleted = (r) => r?.status === 'completed'
const isRequired = (r) => r?.required !== false // default-true

/**
 * Overall completion — the percentage of ALL tasks whose status is 'completed'
 * (0..100). An empty checklist reads as 0%.
 *
 * @param {Array<object>} rows
 * @returns {number}
 */
export function completionPct(rows = []) {
  const list = asList(rows)
  if (list.length === 0) return 0
  const done = list.filter(isCompleted).length
  return pct(done, list.length)
}

/**
 * Required completion — the percentage of REQUIRED tasks that are completed
 * (0..100). This is the go-live gauge: optional tasks don't dilute it. When
 * there are no required tasks it reads as 100% (nothing blocks go-live).
 *
 * @param {Array<object>} rows
 * @returns {number}
 */
export function requiredCompletionPct(rows = []) {
  const required = asList(rows).filter(isRequired)
  if (required.length === 0) return 100
  const done = required.filter(isCompleted).length
  return pct(done, required.length)
}

/**
 * Per-phase progress in canonical phase order. Every phase in PHASE_ORDER is
 * always present (total 0 when it has no tasks) so the UI can render a stable
 * set of bars.
 *
 * @param {Array<object>} rows
 * @returns {Array<{phase:string, total:number, completed:number, pct:number}>}
 */
export function phaseProgress(rows = []) {
  const list = asList(rows)
  return PHASE_ORDER.map((phase) => {
    const inPhase = list.filter((r) => r?.phase === phase)
    const completed = inPhase.filter(isCompleted).length
    return {
      phase,
      total: inPhase.length,
      completed,
      pct: pct(completed, inPhase.length),
    }
  })
}

/**
 * True when every REQUIRED task is completed (the tenant may go live). An empty
 * checklist, or one with no required tasks, is NOT considered ready — going
 * live requires at least one completed required task to be meaningful.
 *
 * @param {Array<object>} rows
 * @returns {boolean}
 */
export function isReadyForGoLive(rows = []) {
  const required = asList(rows).filter(isRequired)
  if (required.length === 0) return false
  return required.every(isCompleted)
}

/**
 * Roll a checklist up into the header summary:
 *   • totalTasks        — number of tasks
 *   • completedCount    — tasks with status 'completed'
 *   • blockedCount      — tasks with status 'blocked'
 *   • requiredRemaining — required tasks not yet completed
 *   • completionPct     — overall completion (see completionPct)
 *   • readyForGoLive    — every required task completed (see isReadyForGoLive)
 *
 * @param {Array<object>} rows
 * @returns {{ totalTasks:number, completedCount:number, blockedCount:number,
 *             requiredRemaining:number, completionPct:number, readyForGoLive:boolean }}
 */
export function summariseOnboarding(rows = []) {
  const list = asList(rows)
  const completedCount = list.filter(isCompleted).length
  const blockedCount = list.filter((r) => r?.status === 'blocked').length
  const requiredRemaining = list.filter((r) => isRequired(r) && !isCompleted(r)).length
  return {
    totalTasks: list.length,
    completedCount,
    blockedCount,
    requiredRemaining,
    completionPct: completionPct(list),
    readyForGoLive: isReadyForGoLive(list),
  }
}

/**
 * The "what's next" queue — the not_started / in_progress tasks, ordered by
 * sort_order (ascending), with phase order as a tiebreaker and title as a final
 * stable tiebreaker. In-progress tasks are surfaced ahead of not-started ones
 * at the same sort_order so active work stays visible.
 *
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function nextTasks(rows = []) {
  const openStatuses = new Set(['not_started', 'in_progress'])
  const statusRank = { in_progress: 0, not_started: 1 }
  const phaseRank = Object.fromEntries(PHASE_ORDER.map((p, i) => [p, i]))
  return asList(rows)
    .filter((r) => openStatuses.has(r?.status))
    .slice()
    .sort((a, b) => {
      const sa = toFiniteNumber(a?.sort_order) ?? 0
      const sb = toFiniteNumber(b?.sort_order) ?? 0
      if (sa !== sb) return sa - sb
      const ra = statusRank[a?.status] ?? 9
      const rb = statusRank[b?.status] ?? 9
      if (ra !== rb) return ra - rb
      const pa = phaseRank[a?.phase] ?? 99
      const pb = phaseRank[b?.phase] ?? 99
      if (pa !== pb) return pa - pb
      return String(a?.title || '').localeCompare(String(b?.title || ''))
    })
}
