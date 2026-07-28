/**
 * classificationLearning.js - the loop that lets the classifier improve from
 * human corrections (V400).
 *
 * Four calls, in the order a person uses them:
 *   listRuleProposals   what the reviewed items suggest the machine is missing
 *   previewLearnedRule  the exact rows a rule would claim, before deciding
 *   decideRule          accept or reject - a rejection is remembered forever
 *   applyLearnedRule    stamp an accepted rule's items into the material master
 *
 * APPLYING GOES THROUGH THE MASTER, not through the classifier. The classifier
 * already ranks a reviewed master row above every token (V368), so an accepted
 * rule inherits that precedence instead of re-inventing it, the money moves only
 * via `reclassify_from_master` (the one existing lever, with a dry run and an
 * undo), and every learned decision lands as a per-item row a human can override
 * individually rather than as an invisible global regex.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'

/** An older backend has no learning loop yet. That is an absence, not a failure. */
const isMissing = (error) =>
  /could not find the function|does not exist|schema cache/i.test(error?.message || '')

/**
 * Rules the reviewed items suggest, strongest evidence first.
 *
 * Already-decided tokens never come back - including REJECTED ones, which is
 * what stops the list nagging about something the reviewer has already answered.
 *
 * @param {{minSupport?:number, minPrecision?:number, minLift?:number, limit?:number}} [opts]
 * @returns {Promise<{ok:boolean, proposals:Array}>}
 */
export async function listRuleProposals(opts = {}) {
  const { minSupport = 4, minPrecision = 0.85, minLift = 1.5, limit = 40 } = opts
  const { data, error } = await supabase.rpc('propose_classification_rules', {
    p_min_support: minSupport,
    p_min_precision: minPrecision,
    p_min_lift: minLift,
    p_limit: limit,
  })
  if (error) {
    if (isMissing(error)) return { ok: false, proposals: [] }
    throw new Error(toUserMessage(error, 'Could not work out what the classifier is missing.'))
  }
  return { ok: true, proposals: Array.isArray(data) ? data : [] }
}

/**
 * The exact rows a rule would claim. Always show this before a decision - a
 * proposal's headline numbers describe the EVIDENCE, while these rows are what
 * would actually change, and the two can disagree.
 */
export async function previewLearnedRule(token, category, limit = 50) {
  if (!token || !category) return { ok: false, rows: [] }
  const { data, error } = await supabase.rpc('preview_learned_rule', {
    p_token: token,
    p_category: category,
    p_limit: limit,
  })
  if (error) {
    if (isMissing(error)) return { ok: false, rows: [] }
    throw new Error(toUserMessage(error, 'Could not show what this rule would change.'))
  }
  return { ok: true, rows: Array.isArray(data) ? data : [] }
}

/**
 * Record the human decision.
 *
 * @param {string} token
 * @param {string} category
 * @param {'accept'|'reject'} action
 * @param {string} [note]  why - worth capturing, since a rejection is permanent
 */
export async function decideRule(token, category, action, note) {
  const { data, error } = await supabase.rpc('decide_classification_rule', {
    p_token: token,
    p_category: category,
    p_action: action,
    p_note: note || null,
  })
  if (error) throw new Error(toUserMessage(error, 'Could not record that decision.'))
  return data || {}
}

/**
 * Apply an accepted rule.
 *
 * ALWAYS dry-run first. The dry run reports every item, line and amount that
 * would move and writes nothing. Only an ACCEPTED rule can be applied at all;
 * the server refuses anything else.
 *
 * Applying stamps the master. The loaded money moves on the next
 * `applyReviewedDecisions` (reclassify_from_master), which has its own preview.
 */
export async function applyLearnedRule(token, category, dryRun = true) {
  const { data, error } = await supabase.rpc('apply_learned_rule', {
    p_token: token,
    p_category: category,
    p_dry_run: dryRun !== false,
  })
  if (error) throw new Error(toUserMessage(error, 'Could not apply that rule.'))
  return data || {}
}

/** Agreement between the machine and the humans, by month. */
export async function getAccuracy() {
  const { data, error } = await supabase.rpc('classification_accuracy')
  if (error) {
    if (isMissing(error)) return { ok: false, periods: [] }
    throw new Error(toUserMessage(error, 'Could not load the accuracy history.'))
  }
  return { ok: true, periods: Array.isArray(data) ? data : [] }
}

/**
 * Which layer of the classifier gets overruled, and in which direction. This is
 * the actionable half of the accuracy figure: one percentage says how often the
 * machine is wrong, this says which part to fix.
 */
export async function getWeakSpots(limit = 20) {
  const { data, error } = await supabase.rpc('classification_weak_spots', { p_limit: limit })
  if (error) {
    if (isMissing(error)) return { ok: false, spots: [] }
    throw new Error(toUserMessage(error, 'Could not load the weak spots.'))
  }
  return { ok: true, spots: Array.isArray(data) ? data : [] }
}

/** Everything the learning page needs, each part degrading on its own. */
export async function loadLearningOverview() {
  const [proposals, accuracy, weak] = await Promise.allSettled([
    listRuleProposals(),
    getAccuracy(),
    getWeakSpots(),
  ])
  const val = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback)
  return {
    proposals: val(proposals, { ok: false, proposals: [] }).proposals,
    proposalsOk: val(proposals, { ok: false }).ok,
    periods: val(accuracy, { ok: false, periods: [] }).periods,
    spots: val(weak, { ok: false, spots: [] }).spots,
    failed: [proposals, accuracy, weak].filter((r) => r.status === 'rejected').length,
  }
}
