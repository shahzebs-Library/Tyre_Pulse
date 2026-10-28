/**
 * Pure shaper: AI tyre job rows for ONE inspection -> live progress.
 * done = completed + review_required (analysis finished, a person may still review).
 * pending = pending + processing. Unknown statuses count toward total only.
 */
export function shapeAiTyreProgress(jobs) {
  const rows = Array.isArray(jobs) ? jobs.filter(Boolean) : []
  let done = 0
  let failed = 0
  let pending = 0
  for (const j of rows) {
    const s = String(j.status || '').toLowerCase()
    if (s === 'completed' || s === 'review_required') done += 1
    else if (s === 'failed') failed += 1
    else if (s === 'pending' || s === 'processing') pending += 1
  }
  const total = rows.length
  let label = ''
  if (total > 0) {
    if (pending > 0) label = `AI analysing ${done + failed} of ${total}`
    else if (failed > 0) label = `AI analysed ${done} of ${total}, ${failed} failed`
    else label = `AI analysis complete (${total})`
  }
  return { total, done, failed, pending, label, active: pending > 0 }
}
