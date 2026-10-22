/**
 * Role gates for AI Tyre Inspection actions.
 *
 * MIRROR of supabase/functions/ai-tyre-inspection/logic.ts (ENQUEUE_ROLES, REVIEW_ROLES,
 * BACKFILL_ROLES). The edge function is the authority; this file only lets the UI hide or
 * disable actions the function would refuse. A parity test fails if the lists drift.
 */
export const AI_ENQUEUE_ROLES = Object.freeze(['admin', 'manager', 'director', 'maintenance supervisor', 'tyre man'])
export const AI_REVIEW_ROLES = Object.freeze(['admin', 'manager', 'director', 'maintenance supervisor'])
export const AI_BACKFILL_ROLES = Object.freeze(['admin', 'manager', 'director', 'maintenance supervisor', 'pmv manager'])

const norm = (role) => String(role ?? '').trim().toLowerCase()

/** Queue defect photos / screen all photographed tyres. */
export const canQueueAiAnalysis = (role) => AI_ENQUEUE_ROLES.includes(norm(role))
/** Accept / reject an AI finding. */
export const canReviewAiFinding = (role) => AI_REVIEW_ROLES.includes(norm(role))
/** Historic backfill. */
export const canBackfillAi = (role) => AI_BACKFILL_ROLES.includes(norm(role))
/** Evaluation aggregate follows the review gate (the RPC enforces the same list). */
export const canViewAiFeedback = canReviewAiFinding

export function aiActionNotice(role) {
  const r = String(role || '').trim() || 'your role'
  if (canReviewAiFinding(role) && canQueueAiAnalysis(role)) return ''
  if (canQueueAiAnalysis(role)) return `Queue only: ${r} cannot accept or reject AI findings.`
  return `Read-only: ${r} can view AI results but cannot queue photos or review findings.`
}
