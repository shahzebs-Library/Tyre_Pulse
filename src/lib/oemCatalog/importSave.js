/**
 * Whether an import can be saved, and how to describe what was saved. Pure.
 *
 * A manual whose every row needs review is still worth saving: the PDF is stored once, the rows go to
 * the persistent review queue and the manual is marked needs_review (saveOemManual sets that status
 * whenever there are no publishable rows or a review queue). Refusing it lost the whole import.
 */
export function importSaveCounts(pipeline) {
  const publish = Array.isArray(pipeline?.publish) ? pipeline.publish.length : 0
  const review = Array.isArray(pipeline?.review) ? pipeline.review.length : 0
  return { publish, review, canSave: publish + review > 0, reviewOnly: publish === 0 && review > 0 }
}

export function importSavedNotice(saved, counts) {
  const name = `${saved?.manufacturer || ''} ${saved?.model || ''}`.trim()
  if (counts?.reviewOnly) {
    return `${name}: no parts were published yet. All ${counts.review.toLocaleString()} rows need review and the manual is marked as needing review. The PDF is stored once for future lookups.`
  }
  return `${name}: ${Number(saved?.item_count || 0).toLocaleString()} parts and variants saved. The PDF is stored once for future lookups.`
}
