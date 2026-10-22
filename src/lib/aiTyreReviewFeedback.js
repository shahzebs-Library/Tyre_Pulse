/**
 * Reviewer-feedback aggregate for AI tyre findings.
 *
 * EVALUATION DATA ONLY. It counts what human reviewers decided per model/prompt version so
 * quality can be compared. It does not train, tune or update any model, and nothing here
 * feeds back into the worker automatically.
 */
export const FEEDBACK_DISCLAIMER =
  'Evaluation data only. Counts of reviewer decisions per model and prompt version. No model is retrained or tuned automatically from these decisions.'

const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v))
const rate = (num, den) => (den > 0 ? Number(((num / den) * 100).toFixed(1)) : null)

export function shapeFeedbackRows(rows) {
  return (rows || []).map((r) => {
    const reviewed = n(r.reviewed)
    return {
      model: r.model_version || 'unknown',
      prompt: r.prompt_version || 'unversioned',
      jobs: n(r.jobs), completed: n(r.completed), failed: n(r.failed),
      reviewed, accepted: n(r.accepted), rejected: n(r.rejected), corrected: n(r.corrected),
      unreviewed: n(r.unreviewed), withNote: n(r.with_reviewer_note),
      // null (N/A) when nothing was reviewed: never a flattering 0% or 100%.
      acceptRate: rate(n(r.accepted), reviewed),
      rejectRate: rate(n(r.rejected), reviewed),
      correctedRate: rate(n(r.corrected), reviewed),
      knownCostUsd: Number(n(r.known_cost_usd).toFixed(6)),
      unpricedJobs: n(r.unpriced_jobs),
    }
  })
}

export function summarizeFeedback(shaped) {
  const t = shaped.reduce((a, r) => ({
    jobs: a.jobs + r.jobs, reviewed: a.reviewed + r.reviewed, accepted: a.accepted + r.accepted,
    rejected: a.rejected + r.rejected, corrected: a.corrected + r.corrected, unreviewed: a.unreviewed + r.unreviewed,
  }), { jobs: 0, reviewed: 0, accepted: 0, rejected: 0, corrected: 0, unreviewed: 0 })
  return { ...t, acceptRate: rate(t.accepted, t.reviewed), rejectRate: rate(t.rejected, t.reviewed) }
}

export const FEEDBACK_EXPORT_COLUMNS = [
  ['model', 'Model'], ['prompt', 'Prompt version'], ['jobs', 'Jobs'], ['completed', 'Completed'], ['failed', 'Failed'],
  ['reviewed', 'Reviewed'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['corrected', 'Corrected'],
  ['unreviewed', 'Awaiting review'], ['acceptRate', 'Accept % of reviewed'], ['rejectRate', 'Reject % of reviewed'],
  ['withNote', 'With reviewer note'], ['knownCostUsd', 'Known cost USD'], ['unpricedJobs', 'Unpriced jobs'],
]

export function feedbackExportRows(shaped) {
  return shaped.map((r) => Object.fromEntries(FEEDBACK_EXPORT_COLUMNS.map(([k]) => [k, r[k] == null ? 'N/A' : r[k]])))
}
