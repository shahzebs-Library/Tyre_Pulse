/**
 * filterSelection - the ONE home for "does this row survive a filter selection".
 *
 * A register filter is either the sentinel 'all', a single value, or an ARRAY of
 * values (multi-select). Three surfaces already needed that rule - the inspection
 * register, tyre change tracking and running-and-remaining - and two of them had
 * grown their own copy of it, complete with a "mirrors the other one, change
 * both" comment. A rule written twice is a rule that drifts, and the drift shows
 * up as one filter behaving differently from the filter next to it.
 *
 * PURE: no I/O, no imports. `regionOf`-style resolvers are injected by the caller
 * because region lives on the site register, not on the row.
 */

/**
 * Is a filter selection actually narrowing anything?
 *
 * An EMPTY array means the user has cleared every option, and that is treated as
 * 'all' rather than as "match nothing": a filter panel that silently empties the
 * table the moment the last chip is unticked reads as lost data, and there is no
 * way back from it except knowing to re-tick something.
 */
export function isSelectionActive(sel) {
  if (Array.isArray(sel)) return sel.filter((v) => v != null && v !== '' && v !== 'all').length > 0
  return sel != null && sel !== '' && sel !== 'all'
}

/**
 * Does `value` satisfy `sel`? `sel` may be 'all', one value, or an array.
 *
 * `norm` folds both sides before comparing (vehicle_type is upper-cased by V245,
 * but the compare is case-folded rather than trusting either side). A row whose
 * value is MISSING never matches an active selection - an untyped machine is not
 * known to be a mixer, exactly as an unplaced site is not known to be in a region.
 */
export function selectionMatches(sel, value, norm = null) {
  if (!isSelectionActive(sel)) return true
  const f = typeof norm === 'function' ? norm : (v) => (v == null ? '' : String(v))
  const want = (Array.isArray(sel) ? sel : [sel])
    .filter((v) => v != null && v !== '' && v !== 'all')
    .map((v) => f(v))
  const got = f(value)
  if (got === '' || got == null) return false
  return want.includes(got)
}

/** The chosen values as a clean array ([] when the selection is not narrowing). */
export function selectionValues(sel) {
  if (!isSelectionActive(sel)) return []
  return (Array.isArray(sel) ? sel : [sel]).filter((v) => v != null && v !== '' && v !== 'all')
}

/**
 * Tick or untick one value, for a multi-select control.
 *
 * Always returns an ARRAY, and drops the 'all' sentinel on the way in, so a
 * control that starts life on 'all' becomes a real selection on the first click
 * without the caller having to special-case it.
 */
export function toggleSelection(sel, value) {
  const current = selectionValues(sel)
  return current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value]
}

/**
 * Plain-English description of a selection for a report header.
 *
 * A report headed "asset type" that in fact covers three of eleven types is a
 * false statement that outlives the screen it came from, so every chosen value is
 * named. Past `max` it says how many rather than running to a paragraph.
 * Returns '' when the selection is not narrowing - nothing to say.
 */
export function selectionLabel(sel, { max = 4 } = {}) {
  const values = selectionValues(sel)
  if (!values.length) return ''
  if (values.length <= max) return values.join(', ')
  return `${values.slice(0, max).join(', ')} and ${values.length - max} more`
}

/**
 * One spelling of a vehicle type, for comparing and for grouping.
 *
 * V245 normalised the stored column to UPPER, but a value can still arrive from
 * an import or an older row with different case or padding, and two spellings of
 * TR-MIXER would split one machine class into two filter options - the exact
 * defect V245/V246 exist to prevent. Blank stays blank so a caller can tell
 * "not recorded" from a real type.
 */
export function normVehicleType(value) {
  return String(value == null ? '' : value).trim().toUpperCase()
}
