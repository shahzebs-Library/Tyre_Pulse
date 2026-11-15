/**
 * Which alert-threshold metrics a person may create a rule for.
 *
 * The rules are evaluated by the hourly database job
 * `public.evaluate_alert_thresholds()`. A metric offered on the page that the
 * job cannot evaluate is worse than a missing option:
 *
 *   - `cpk` is not in the job's metric list at all, so a "Cost Per KM" rule is
 *     saved, shown as active, and never fires.
 *   - `tread_depth` makes the job read `inspections.tread_depth`, a column that
 *     does not exist. The first active tread rule raises an error that stops the
 *     whole run, for every rule of every user. The pending draft
 *     20261113153000_com_alert_thresholds_org_scope repoints it at the real
 *     source (inspections.tyre_conditions). When that draft is applied, remove
 *     `tread_depth` from this map.
 *
 * Existing rules on these metrics still render (labels stay in the page's
 * catalog); they just cannot be created.
 */
export const UNAVAILABLE_METRICS = Object.freeze({
  cpk: 'Cost per km rules are not evaluated yet.',
  tread_depth: 'Tread depth rules are switched off until the alert job reads tread from inspections.',
})

/** True when a new rule may be created on this metric. */
export function isMetricSelectable(metric) {
  return !Object.prototype.hasOwnProperty.call(UNAVAILABLE_METRICS, String(metric ?? ''))
}

/** Keep only the entries (metric options or presets) a new rule may use. */
export function selectableMetrics(list, keyOf = (m) => m?.value ?? m?.metric) {
  return (Array.isArray(list) ? list : []).filter((m) => isMetricSelectable(keyOf(m)))
}
