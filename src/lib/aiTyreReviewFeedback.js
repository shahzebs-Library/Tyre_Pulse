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

/**
 * Per-finding LABELLED dataset (reviewer decision next to the model's stored findings) for offline
 * evaluation and, later, expert-confirmed prompt comparison. A reviewer "accepted" label is an
 * opinion of one reviewer, not ground truth; "corrected" rows are the most informative.
 * Nothing consumes this automatically: no model is trained, tuned or re-prompted from it.
 */
export const LABEL_VALUES = Object.freeze(['accepted', 'rejected', 'corrected'])

export function shapeLabelledFindings(rows) {
  return (rows || [])
    .filter((r) => LABEL_VALUES.includes(r?.review_status))
    .map((r) => {
      const defects = Array.isArray(r.defects) ? r.defects : []
      return {
        jobId: r.job_id, inspectionId: r.inspection_id, asset: r.asset_no || '',
        position: r.tyre_position || '', model: r.model_version || 'unknown', prompt: r.prompt_version || 'unversioned',
        label: r.review_status, reviewerNote: String(r.reviewer_note || '').trim(), reviewedAt: r.reviewed_at || '',
        assessable: r.assessable == null ? null : !!r.assessable,
        recommendation: r.recommendation || '',
        defectTypes: defects.map((d) => d?.type).filter(Boolean),
        defects, photoRef: r.photo_ref || '',
        costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
      }
    })
}

export function labelledSummary(shaped) {
  const by = (l) => shaped.filter((r) => r.label === l).length
  return {
    total: shaped.length, accepted: by('accepted'), rejected: by('rejected'), corrected: by('corrected'),
    withNote: shaped.filter((r) => r.reviewerNote).length,
    // Rejected/corrected rows without a note are weak teaching signal: say so instead of hiding it.
    negativeWithoutNote: shaped.filter((r) => r.label !== 'accepted' && !r.reviewerNote).length,
  }
}

export const LABELLED_EXPORT_COLUMNS = [
  ['jobId', 'Job'], ['inspectionId', 'Inspection'], ['asset', 'Vehicle'], ['position', 'Position'],
  ['model', 'Model'], ['prompt', 'Prompt version'], ['label', 'Reviewer decision'], ['reviewerNote', 'Reviewer note'],
  ['reviewedAt', 'Reviewed at'], ['assessable', 'AI assessable'], ['recommendation', 'AI recommendation'],
  ['defectTypesText', 'AI defect types'], ['photoRef', 'Photo reference'], ['costUsd', 'Estimated cost USD'],
]

export function labelledExportRows(shaped) {
  return shaped.map((r) => Object.fromEntries(LABELLED_EXPORT_COLUMNS.map(([k]) => {
    const v = k === 'defectTypesText' ? (r.defectTypes.join(', ') || 'None') : r[k]
    return [k, v == null || v === '' ? 'N/A' : v]
  })))
}

/** One JSON object per line; stable keys, no photo bytes, ready for offline evaluation tooling. */
export function labelledJsonl(shaped) {
  return shaped.map((r) => JSON.stringify({
    job_id: r.jobId, inspection_id: r.inspectionId, asset_no: r.asset, position: r.position,
    model: r.model, prompt_version: r.prompt, label: r.label, reviewer_note: r.reviewerNote || null,
    reviewed_at: r.reviewedAt || null, ai_assessable: r.assessable, ai_recommendation: r.recommendation || null,
    ai_defects: r.defects, photo_ref: r.photoRef || null,
  })).join('\n')
}

export function feedbackExportRows(shaped) {
  return shaped.map((r) => Object.fromEntries(FEEDBACK_EXPORT_COLUMNS.map(([k]) => [k, r[k] == null ? 'N/A' : r[k]])))
}
